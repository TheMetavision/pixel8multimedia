// netlify/functions/commission-checkout.mts
// Receives commission wizard payload (multipart), uploads customer files to Sanity,
// creates a commission document with structured briefData, creates a Stripe
// Checkout Session, returns the checkout URL.
//
// PHASE 2 CHANGES (May 13 2026):
//  - Accepts `briefData` JSON array (structured per-service answers)
//  - Reads `printUpcharges` from the service doc (no more hardcoded surcharges)
//  - Supports new size keys (small/medium/large) alongside legacy keys
//  - Writes formatChoice + priceBreakdown to the commission doc
//
// Backwards compatible with the old CommissionForm.jsx for any service pages
// not yet migrated to the wizard.

import type { Context } from '@netlify/functions';
import Stripe from 'stripe';
import { createClient } from '@sanity/client';
import { nanoid } from 'nanoid';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.acacia' });

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN!,
  useCdn: false,
});

const SITE_URL = process.env.URL || 'https://pixel8multimedia.co.uk';
const FALLBACK_DIGITAL_PENCE = 2999; // £29.99 fallback if service.price unset

// ── Legacy → new size key map ────────────────────────────────────────────────
// The old CommissionForm sends 12x8 / 16x12 / 24x16. The new wizard sends
// small / medium / large. Normalise both to the new keys.
const SIZE_KEY_MAP: Record<string, 'small' | 'medium' | 'large'> = {
  '12x8': 'small',
  '16x12': 'medium',
  '24x16': 'large',
  small: 'small',
  medium: 'medium',
  large: 'large',
};

// ── Hardcoded fallback surcharges (only used if service has no printUpcharges) ─
const FALLBACK_SURCHARGES: Record<string, Record<'small' | 'medium' | 'large', number>> = {
  poster: { small: 1499, medium: 1899, large: 2299 },
  'canvas-standard': { small: 3299, medium: 3899, large: 4999 },
  'canvas-gallery': { small: 3599, medium: 4199, large: 5299 },
};

// ── Sanity printUpcharges field name lookup ─────────────────────────────────
// Customer-facing format value → Sanity field key inside printUpcharges
const FORMAT_TO_SANITY_KEY: Record<string, string> = {
  poster: 'poster',
  'canvas-standard': 'canvasStandard',
  'canvas-gallery': 'canvasGallery',
};

interface PriceBreakdown {
  digitalBase: number;       // £
  printUpcharge: number;     // £
  printFormatLabel: string;  // E.g. "Canvas Gallery — Medium"
  total: number;             // £
}

function pretty(format: string, size: string): string {
  const formatLabels: Record<string, string> = {
    poster: 'Poster Print',
    'canvas-standard': 'Canvas Standard',
    'canvas-gallery': 'Canvas Gallery',
  };
  const sizeLabels: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
  return `${formatLabels[format] || format} — ${sizeLabels[size] || size}`;
}

function calculatePrice(args: {
  deliveryType: string;
  printFormat?: string;
  printSize?: string;
  servicePrice?: number | null;
  servicePrintUpcharges?: any; // shape: { poster: {small,medium,large}, canvasStandard: {...}, canvasGallery: {...} }
}): { amountPence: number; breakdown: PriceBreakdown } {
  const baseGbp = args.servicePrice ?? FALLBACK_DIGITAL_PENCE / 100;
  const basePence = Math.round(baseGbp * 100);

  // Digital-only path
  if (args.deliveryType === 'digital') {
    return {
      amountPence: basePence,
      breakdown: {
        digitalBase: baseGbp,
        printUpcharge: 0,
        printFormatLabel: 'Digital download only',
        total: baseGbp,
      },
    };
  }

  // Print or Both — need a format + size
  const normalisedSize = args.printSize ? SIZE_KEY_MAP[args.printSize] : undefined;
  if (!args.printFormat || !normalisedSize) {
    // Missing print details — fall back to digital pricing rather than crash
    return {
      amountPence: basePence,
      breakdown: {
        digitalBase: baseGbp,
        printUpcharge: 0,
        printFormatLabel: 'Digital download only (print details missing)',
        total: baseGbp,
      },
    };
  }

  // Look up the upcharge: prefer the service's own printUpcharges, fallback to hardcoded
  const sanityKey = FORMAT_TO_SANITY_KEY[args.printFormat];
  let upchargeGbp = 0;
  if (sanityKey && args.servicePrintUpcharges?.[sanityKey]?.[normalisedSize] != null) {
    upchargeGbp = Number(args.servicePrintUpcharges[sanityKey][normalisedSize]) || 0;
  } else {
    const fallbackPence = FALLBACK_SURCHARGES[args.printFormat]?.[normalisedSize] ?? 0;
    upchargeGbp = fallbackPence / 100;
  }
  const upchargePence = Math.round(upchargeGbp * 100);

  if (args.deliveryType === 'print') {
    // Print-only: total = upcharge (digital is effectively free / bundled in)
    // KEEP behaviour from original function: print-only means upcharge OR base if surcharge=0
    const totalPence = upchargePence || basePence;
    return {
      amountPence: totalPence,
      breakdown: {
        digitalBase: 0,
        printUpcharge: totalPence / 100,
        printFormatLabel: pretty(args.printFormat, normalisedSize),
        total: totalPence / 100,
      },
    };
  }

  // 'both' = digital + print upcharge
  const totalPence = basePence + upchargePence;
  return {
    amountPence: totalPence,
    breakdown: {
      digitalBase: baseGbp,
      printUpcharge: upchargeGbp,
      printFormatLabel: pretty(args.printFormat, normalisedSize),
      total: totalPence / 100,
    },
  };
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await req.formData();

    // ── Extract fields ──────────────────────────────────────────────────────
    const serviceSlug = formData.get('serviceSlug') as string;
    const serviceTitle = formData.get('serviceTitle') as string;
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const phone = (formData.get('phone') as string) || undefined;
    const brief = (formData.get('brief') as string) || '';
    const deliveryType = formData.get('deliveryType') as string;
    const printSize = (formData.get('printSize') as string) || undefined;
    const printFormat = (formData.get('printFormat') as string) || undefined;
    const shippingAddress = (formData.get('shippingAddress') as string) || undefined;

    // New: structured per-service brief data (JSON-stringified array of {key, label, value})
    const briefDataRaw = formData.get('briefData') as string | null;
    let briefData: Array<{ key: string; label: string; value: string }> = [];
    if (briefDataRaw) {
      try {
        const parsed = JSON.parse(briefDataRaw);
        if (Array.isArray(parsed)) {
          briefData = parsed
            .filter((b) => b && typeof b === 'object' && b.key)
            .map((b) => ({
              key: String(b.key),
              label: String(b.label || b.key),
              value: b.value == null ? '' : String(b.value),
            }));
        }
      } catch (e) {
        console.warn('commission-checkout: invalid briefData JSON, ignoring', e);
      }
    }

    if (!serviceSlug || !name || !email || !deliveryType) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Look up service doc for price + printUpcharges + _id ──────────────
    const service = await sanity.fetch(
      `*[_type == "service" && slug.current == $slug][0]{
        _id, price, printUpcharges, commissionEnabled
      }`,
      { slug: serviceSlug }
    );

    if (!service) {
      return new Response(
        JSON.stringify({ error: 'Service not found.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (service.commissionEnabled === false) {
      return new Response(
        JSON.stringify({ error: 'This service is not currently accepting new commissions.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ── Upload files to Sanity ─────────────────────────────────────────────
    const files = formData.getAll('files') as File[];
    const uploadedAssets: Array<{ _type: 'image'; _key: string; asset: { _type: 'reference'; _ref: string } }> = [];

    for (const file of files) {
      if (!file.size) continue;
      const buffer = Buffer.from(await file.arrayBuffer());
      const asset = await sanity.assets.upload('image', buffer, {
        filename: file.name,
        contentType: file.type,
      });
      uploadedAssets.push({
        _type: 'image',
        _key: nanoid(8),
        asset: { _type: 'reference', _ref: asset._id },
      });
    }

    // ── Generate order ref ────────────────────────────────────────────────
    const orderRef = `PX-${nanoid(8).toUpperCase()}`;

    // ── Calculate price ───────────────────────────────────────────────────
    const { amountPence, breakdown } = calculatePrice({
      deliveryType,
      printFormat,
      printSize,
      servicePrice: service.price,
      servicePrintUpcharges: service.printUpcharges,
    });

    // ── Build formatChoice string ─────────────────────────────────────────
    let formatChoice = 'digital';
    if (deliveryType === 'print' && printFormat && printSize) {
      formatChoice = `${printFormat}-${SIZE_KEY_MAP[printSize] || printSize}`;
    } else if (deliveryType === 'both' && printFormat && printSize) {
      formatChoice = `digital+${printFormat}-${SIZE_KEY_MAP[printSize] || printSize}`;
    }

    // ── Create commission doc (pending) ───────────────────────────────────
    const commissionDoc: any = {
      _type: 'commission',
      orderRef,
      service: { _type: 'reference', _ref: service._id },
      status: 'pending',
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      brief,
      deliveryType,
      printSize: printSize ? SIZE_KEY_MAP[printSize] || printSize : undefined,
      printFormat,
      shippingAddress,
      uploadedFiles: uploadedAssets,
      amount: amountPence / 100,
      formatChoice,
      priceBreakdown: breakdown,
    };

    // Add structured briefData if we got it (Phase 2 wizard flow)
    if (briefData.length > 0) {
      commissionDoc.briefData = briefData.map((b, i) => ({
        _type: 'briefAnswer',
        _key: `ba-${nanoid(6)}-${i}`,
        key: b.key,
        label: b.label,
        value: b.value,
      }));
    }

    const commission = await sanity.create(commissionDoc);

    // ── Create Stripe Checkout Session ────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      metadata: {
        commissionId: commission._id,
        orderRef,
        serviceSlug,
      },
      line_items: [
        {
          price_data: {
            currency: 'gbp',
            unit_amount: amountPence,
            product_data: {
              name: `${serviceTitle} — Commission`,
              description: `Order ${orderRef} · ${breakdown.printFormatLabel}`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${SITE_URL}/commission/success?ref=${orderRef}`,
      cancel_url: `${SITE_URL}/services/${serviceSlug}#commission`,
    });

    return new Response(JSON.stringify({ url: session.url, orderRef }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    console.error('commission-checkout error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to create checkout session. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export const config = { path: '/.netlify/functions/commission-checkout' };
