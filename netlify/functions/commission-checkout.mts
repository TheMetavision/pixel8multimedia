// netlify/functions/commission-checkout.mts
// Receives commission wizard payload (multipart), uploads customer files to Sanity,
// creates a commission document with structured briefData + prints array, creates
// a Stripe Checkout Session with separate line items per print, returns checkout URL.
//
// PHASE 3 (May 16 2026):
//   - New orderType payload: 'digital' | 'singlePrint' | 'bundle'
//   - Bundle path waives the £5 artwork fee per print
//   - Multi-print support — `prints` is an array
//   - Stripe line items rendered per print for clearer audit trail
//   - Each print can have its own style key (from service.styleOptions)
//
// Backwards compatible with legacy deliveryType payload from old wizard.

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
const ARTWORK_FEE_GBP = 5.0;

const SIZE_LABELS: Record<string, string> = {
  small: 'Small (12×12")',
  medium: 'Medium (16×16")',
  large: 'Large (20×20")',
};

const FORMAT_LABELS: Record<string, string> = {
  poster: 'Poster Print',
  'canvas-standard': 'Canvas Standard',
  'canvas-gallery': 'Canvas Gallery',
};

const FORMAT_TO_SANITY_KEY: Record<string, string> = {
  poster: 'poster',
  'canvas-standard': 'canvasStandard',
  'canvas-gallery': 'canvasGallery',
};

// Legacy size key map for backward compat with old wizard payloads
const SIZE_KEY_MAP: Record<string, 'small' | 'medium' | 'large'> = {
  '12x8': 'small',
  '16x12': 'medium',
  '24x16': 'large',
  '12x12': 'small',
  '16x16': 'medium',
  '20x20': 'large',
  small: 'small',
  medium: 'medium',
  large: 'large',
};

interface PrintLineItem {
  styleKey?: string;
  styleLabel?: string;
  format: string;
  size: 'small' | 'medium' | 'large';
  shopPriceGbp: number;          // shop product price (no artwork fee)
  standalonePriceGbp: number;    // shop + £5 artwork fee
  appliedPriceGbp: number;       // what we actually charge for this line
  artworkFeeApplied: boolean;    // false if waived (bundle path)
}

interface PriceBreakdown {
  orderType: 'digital' | 'singlePrint' | 'bundle';
  digitalBundle?: { label: string; amount: number };
  prints: Array<{ label: string; amount: number; artworkFeeWaived: boolean }>;
  total: number;
  totalArtworkFeeSaved: number;
}

interface ParsedPrint {
  styleKey?: string;
  format?: string;
  size?: string;
}

function pretty(format: string, size: string, styleLabel?: string): string {
  const base = `${FORMAT_LABELS[format] || format} — ${SIZE_LABELS[size] || size}`;
  return styleLabel ? `${base} (${styleLabel})` : base;
}

function calculatePricing(args: {
  orderType: string;
  service: any;
  prints: ParsedPrint[];
}): { breakdown: PriceBreakdown; stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] } {
  const { service, prints } = args;
  const digitalPriceGbp = Number(service.digitalPrice) || 0;
  const styleOptions: Array<{ key: string; label: string }> = service.styleOptions || [];

  function labelForStyle(styleKey?: string): string | undefined {
    if (!styleKey) return undefined;
    return styleOptions.find((s) => s.key === styleKey)?.label;
  }

  // ─── Digital path ──────────────────────────────────────────────────────
  if (args.orderType === 'digital') {
    const breakdown: PriceBreakdown = {
      orderType: 'digital',
      digitalBundle: {
        label: `Digital bundle (all ${styleOptions.length} styles)`,
        amount: digitalPriceGbp,
      },
      prints: [],
      total: digitalPriceGbp,
      totalArtworkFeeSaved: 0,
    };

    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: 'gbp',
          unit_amount: Math.round(digitalPriceGbp * 100),
          product_data: {
            name: `${service.title} — Digital Bundle`,
            description: `All ${styleOptions.length} styles delivered as digital files`,
          },
        },
        quantity: 1,
      },
    ];

    return { breakdown, stripeLineItems };
  }

  // ─── Single print path ─────────────────────────────────────────────────
  if (args.orderType === 'singlePrint') {
    const p = prints[0];
    if (!p?.format || !p?.size) {
      throw new Error('Single print path requires a format and size');
    }
    const sanityFormatKey = FORMAT_TO_SANITY_KEY[p.format];
    const sizeKey = SIZE_KEY_MAP[p.size] || (p.size as 'small' | 'medium' | 'large');
    const standalonePrice = Number(service.printUpcharges?.[sanityFormatKey]?.[sizeKey]) || 0;

    if (standalonePrice <= 0) {
      throw new Error(`No price configured for ${p.format} / ${sizeKey}`);
    }

    const styleLabel = labelForStyle(p.styleKey);
    const lineLabel = pretty(p.format, sizeKey, styleLabel);

    const breakdown: PriceBreakdown = {
      orderType: 'singlePrint',
      prints: [
        {
          label: lineLabel,
          amount: standalonePrice,
          artworkFeeWaived: false,
        },
      ],
      total: standalonePrice,
      totalArtworkFeeSaved: 0,
    };

    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: 'gbp',
          unit_amount: Math.round(standalonePrice * 100),
          product_data: {
            name: `${service.title} — ${lineLabel}`,
            description: `Includes £${ARTWORK_FEE_GBP.toFixed(2)} artwork creation fee`,
          },
        },
        quantity: 1,
      },
    ];

    return { breakdown, stripeLineItems };
  }

  // ─── Bundle path ───────────────────────────────────────────────────────
  if (args.orderType === 'bundle') {
    const validPrints = prints.filter((p) => p.format && p.size);
    if (validPrints.length === 0) {
      // Bundle without prints = same as digital path
      return calculatePricing({ ...args, orderType: 'digital' });
    }

    const breakdownPrints: PriceBreakdown['prints'] = [];
    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        price_data: {
          currency: 'gbp',
          unit_amount: Math.round(digitalPriceGbp * 100),
          product_data: {
            name: `${service.title} — Digital Bundle`,
            description: `All ${styleOptions.length} styles delivered as digital files`,
          },
        },
        quantity: 1,
      },
    ];

    let total = digitalPriceGbp;
    let saved = 0;

    for (const p of validPrints) {
      const sanityFormatKey = FORMAT_TO_SANITY_KEY[p.format!];
      const sizeKey = SIZE_KEY_MAP[p.size!] || (p.size as 'small' | 'medium' | 'large');
      const standalonePrice = Number(service.printUpcharges?.[sanityFormatKey]?.[sizeKey]) || 0;
      if (standalonePrice <= 0) continue;

      // Bundle waives the £5 artwork fee — pay shop price only
      const shopPrice = Math.max(0, standalonePrice - ARTWORK_FEE_GBP);
      const styleLabel = labelForStyle(p.styleKey);
      const lineLabel = pretty(p.format!, sizeKey, styleLabel);

      breakdownPrints.push({
        label: lineLabel,
        amount: shopPrice,
        artworkFeeWaived: true,
      });

      stripeLineItems.push({
        price_data: {
          currency: 'gbp',
          unit_amount: Math.round(shopPrice * 100),
          product_data: {
            name: `${service.title} — ${lineLabel}`,
            description: '£5 artwork fee waived (bundle order)',
          },
        },
        quantity: 1,
      });

      total += shopPrice;
      saved += ARTWORK_FEE_GBP;
    }

    const breakdown: PriceBreakdown = {
      orderType: 'bundle',
      digitalBundle: {
        label: `Digital bundle (all ${styleOptions.length} styles)`,
        amount: digitalPriceGbp,
      },
      prints: breakdownPrints,
      total,
      totalArtworkFeeSaved: saved,
    };

    return { breakdown, stripeLineItems };
  }

  throw new Error(`Unknown orderType: ${args.orderType}`);
}

// Legacy fallback for old wizard payloads (deliveryType-based)
function legacyCalculatePricing(args: {
  deliveryType: string;
  printFormat?: string;
  printSize?: string;
  service: any;
}): { breakdown: PriceBreakdown; stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] } {
  // Map legacy deliveryType -> new orderType
  if (args.deliveryType === 'digital') {
    return calculatePricing({ orderType: 'digital', service: args.service, prints: [] });
  }
  if (args.deliveryType === 'print') {
    return calculatePricing({
      orderType: 'singlePrint',
      service: args.service,
      prints: [{ format: args.printFormat, size: args.printSize }],
    });
  }
  // 'both' = treat as bundle path
  return calculatePricing({
    orderType: 'bundle',
    service: args.service,
    prints: [{ format: args.printFormat, size: args.printSize }],
  });
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

    // ─── Extract fields ──────────────────────────────────────────────────
    const serviceSlug = formData.get('serviceSlug') as string;
    const serviceTitle = formData.get('serviceTitle') as string;
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const phone = (formData.get('phone') as string) || undefined;
    const brief = (formData.get('brief') as string) || '';
    const shippingAddress = (formData.get('shippingAddress') as string) || undefined;

    // New: orderType + prints array
    const orderType = (formData.get('orderType') as string) || '';

    // Legacy: deliveryType + single printFormat/printSize
    const legacyDeliveryType = (formData.get('deliveryType') as string) || '';
    const legacyPrintFormat = (formData.get('printFormat') as string) || undefined;
    const legacyPrintSize = (formData.get('printSize') as string) || undefined;

    // Parse prints array (new wizard format)
    let prints: ParsedPrint[] = [];
    const printsRaw = formData.get('prints') as string | null;
    if (printsRaw) {
      try {
        const parsed = JSON.parse(printsRaw);
        if (Array.isArray(parsed)) {
          prints = parsed.map((p) => ({
            styleKey: p.styleKey ? String(p.styleKey) : undefined,
            format: p.format ? String(p.format) : undefined,
            size: p.size ? String(p.size) : undefined,
          }));
        }
      } catch (e) {
        console.warn('Invalid prints JSON:', e);
      }
    }

    // Structured brief data
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
        console.warn('Invalid briefData JSON:', e);
      }
    }

    if (!serviceSlug || !name || !email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── Look up service doc ─────────────────────────────────────────────
    const service = await sanity.fetch(
      `*[_type == "service" && slug.current == $slug][0]{
        _id, title, price, digitalPrice, printUpcharges, styleOptions, commissionEnabled
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

    // ─── Upload files to Sanity ──────────────────────────────────────────
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

    // ─── Generate order ref ──────────────────────────────────────────────
    const orderRef = `PX-${nanoid(8).toUpperCase()}`;

    // ─── Calculate pricing ───────────────────────────────────────────────
    let breakdown: PriceBreakdown;
    let stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (orderType) {
      // New wizard payload
      ({ breakdown, stripeLineItems } = calculatePricing({ orderType, service, prints }));
    } else if (legacyDeliveryType) {
      // Legacy wizard payload
      ({ breakdown, stripeLineItems } = legacyCalculatePricing({
        deliveryType: legacyDeliveryType,
        printFormat: legacyPrintFormat,
        printSize: legacyPrintSize,
        service,
      }));
    } else {
      return new Response(
        JSON.stringify({ error: 'Missing orderType or deliveryType.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ─── Build commission doc ────────────────────────────────────────────
    const commissionDoc: any = {
      _type: 'commission',
      orderRef,
      service: { _type: 'reference', _ref: service._id },
      status: 'pending',
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      brief,
      orderType: breakdown.orderType,
      shippingAddress: breakdown.orderType !== 'digital' ? shippingAddress : undefined,
      uploadedFiles: uploadedAssets,
      amount: breakdown.total,
      priceBreakdown: {
        orderType: breakdown.orderType,
        digitalBundle: breakdown.digitalBundle?.amount ?? 0,
        digitalBundleLabel: breakdown.digitalBundle?.label || '',
        prints: breakdown.prints.map((p, i) => ({
          _key: `pb-${nanoid(6)}-${i}`,
          label: p.label,
          amount: p.amount,
          artworkFeeWaived: p.artworkFeeWaived,
        })),
        total: breakdown.total,
        totalArtworkFeeSaved: breakdown.totalArtworkFeeSaved,
        // Customer-facing summary line
        printFormatLabel: breakdown.prints.length === 0
          ? 'Digital bundle only'
          : breakdown.prints.length === 1
            ? breakdown.prints[0].label
            : `${breakdown.prints.length} prints + digital bundle`,
      },
      // Persist the structured prints array
      prints: prints
        .filter((p) => p.format && p.size)
        .map((p, i) => ({
          _key: `pr-${nanoid(6)}-${i}`,
          styleKey: p.styleKey,
          format: p.format,
          size: SIZE_KEY_MAP[p.size!] || p.size,
        })),
    };

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

    // ─── Create Stripe Checkout Session ──────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: email,
      metadata: {
        commissionId: commission._id,
        orderRef,
        serviceSlug,
        orderType: breakdown.orderType,
        printCount: String(breakdown.prints.length),
      },
      line_items: stripeLineItems,
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
      JSON.stringify({ error: err.message || 'Failed to create checkout session. Please try again.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export const config = { path: '/.netlify/functions/commission-checkout' };
