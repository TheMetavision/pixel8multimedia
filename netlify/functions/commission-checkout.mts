// netlify/functions/commission-checkout.mts
// Receives commission wizard payload (multipart), uploads customer files to Sanity,
// creates a commission document, creates Stripe Checkout Session, returns URL.
//
// PHASE 4 (May 17 2026):
//   - New orderTypes: 'animation-music' and 'animation-vo' (Missing Moment)
//   - includePrintsWithAnimation flag — prints can be added to animation orders
//   - Per-service `artworkFee` (Cartoonify £5, Missing Moment £19.99)
//   - Per-service `printSizeLabels` for non-square services
//   - Stripe line items rendered per print/animation/digital for clear audit trail

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

const DEFAULT_SIZE_LABELS: Record<string, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
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

const SIZE_KEY_MAP: Record<string, 'small' | 'medium' | 'large'> = {
  '12x8': 'small',  '16x12': 'medium', '24x16': 'large',
  '12x12': 'small', '16x16': 'medium', '20x20': 'large',
  small: 'small',   medium: 'medium',  large: 'large',
};

type OrderType = 'digital' | 'digital-secondary' | 'digital-both' | 'singlePrint' | 'bundle' | 'animation-music' | 'animation-vo';
type BundleCollection = 'primary' | 'secondary' | 'both';

interface ParsedPrint { styleKey?: string; format?: string; size?: string; }

interface BreakdownLine { label: string; amount: number; artworkFeeWaived: boolean; }
interface PriceBreakdown {
  orderType: OrderType;
  digitalBundle?: { label: string; amount: number };
  animation?: { label: string; amount: number };
  prints: BreakdownLine[];
  total: number;
  totalArtworkFeeSaved: number;
  printFormatLabel: string;
}

function sizeLabel(service: any, sizeKey: string): string {
  return service?.printSizeLabels?.[sizeKey] || DEFAULT_SIZE_LABELS[sizeKey] || sizeKey;
}

function pretty(service: any, format: string, sizeKey: string, styleLabel?: string): string {
  const base = `${FORMAT_LABELS[format] || format} — ${sizeLabel(service, sizeKey)}`;
  return styleLabel ? `${base} (${styleLabel})` : base;
}

function calculatePricing(args: {
  orderType: OrderType;
  service: any;
  prints: ParsedPrint[];
  includePrintsWithAnimation: boolean;
  bundleCollection: BundleCollection;
}): { breakdown: PriceBreakdown; stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] } {
  const { service, prints, orderType, includePrintsWithAnimation, bundleCollection } = args;
  const digitalPriceGbp = Number(service.digitalPrice) || 0;
  const digitalPriceSecondaryGbp = Number(service.digitalPriceSecondary) || 0;
  const digitalPriceBothGbp = Number(service.digitalPriceBoth) || 0;
  const animationMusicGbp = Number(service.animationMusicPrice) || 0;
  const animationVoGbp = Number(service.animationVoPrice) || 0;
  const artworkFee = service.artworkFee != null ? Number(service.artworkFee) : 5.0;
  const styleOptions: Array<{ key: string; label: string }> = service.styleOptions || [];
  const styleOptionsSecondary: Array<{ key: string; label: string }> = service.styleOptionsSecondary || [];
  const allStyleOptions = [...styleOptions, ...styleOptionsSecondary];
  const collectionLabel = service.collectionLabel || 'Collection 1';
  const collectionLabelSecondary = service.collectionLabelSecondary || 'Collection 2';
  const hasSecondaryCollection = styleOptionsSecondary.length > 0 && digitalPriceSecondaryGbp > 0;

  // Style label lookup spans both collections so prints can use any style
  const labelForStyle = (k?: string) => k ? allStyleOptions.find((s) => s.key === k)?.label : undefined;

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
  const breakdownPrints: BreakdownLine[] = [];
  let total = 0;
  let saved = 0;
  let breakdown: Partial<PriceBreakdown> = { orderType, prints: breakdownPrints };

  // ── Add base tier ──────────────────────────────────────────────────────────
  if (orderType === 'digital') {
    const label = hasSecondaryCollection
      ? `${service.title} — Digital — ${collectionLabel} (${styleOptions.length} styles)`
      : styleOptions.length > 0
        ? `${service.title} — Digital Bundle (all ${styleOptions.length} styles)`
        : `${service.title} — Digital Download`;
    breakdown.digitalBundle = { label, amount: digitalPriceGbp };
    total += digitalPriceGbp;
    lineItems.push({
      price_data: {
        currency: 'gbp', unit_amount: Math.round(digitalPriceGbp * 100),
        product_data: { name: label },
      },
      quantity: 1,
    });
  }

  if (orderType === 'digital-secondary') {
    const label = `${service.title} — Digital — ${collectionLabelSecondary} (${styleOptionsSecondary.length} styles)`;
    breakdown.digitalBundle = { label, amount: digitalPriceSecondaryGbp };
    total += digitalPriceSecondaryGbp;
    lineItems.push({
      price_data: {
        currency: 'gbp', unit_amount: Math.round(digitalPriceSecondaryGbp * 100),
        product_data: { name: label },
      },
      quantity: 1,
    });
  }

  if (orderType === 'digital-both') {
    const totalStyles = styleOptions.length + styleOptionsSecondary.length;
    const label = `${service.title} — Both Collections Digital (${totalStyles} styles total)`;
    breakdown.digitalBundle = { label, amount: digitalPriceBothGbp };
    total += digitalPriceBothGbp;
    lineItems.push({
      price_data: {
        currency: 'gbp', unit_amount: Math.round(digitalPriceBothGbp * 100),
        product_data: { name: label },
      },
      quantity: 1,
    });
  }

  if (orderType === 'bundle') {
    // For services with a secondary collection, the bundle picks which digital
    // tier is included via bundleCollection. For single-collection services,
    // we just use the primary digitalPrice.
    let bundleDigitalLabel: string;
    let bundleDigitalAmount: number;
    if (hasSecondaryCollection && bundleCollection === 'secondary') {
      bundleDigitalLabel = `${service.title} — Digital — ${collectionLabelSecondary} (${styleOptionsSecondary.length} styles)`;
      bundleDigitalAmount = digitalPriceSecondaryGbp;
    } else if (hasSecondaryCollection && bundleCollection === 'both' && digitalPriceBothGbp > 0) {
      const totalStyles = styleOptions.length + styleOptionsSecondary.length;
      bundleDigitalLabel = `${service.title} — Both Collections Digital (${totalStyles} styles total)`;
      bundleDigitalAmount = digitalPriceBothGbp;
    } else {
      bundleDigitalLabel = hasSecondaryCollection
        ? `${service.title} — Digital — ${collectionLabel} (${styleOptions.length} styles)`
        : styleOptions.length > 0
          ? `${service.title} — Digital Bundle (all ${styleOptions.length} styles)`
          : `${service.title} — Digital Download`;
      bundleDigitalAmount = digitalPriceGbp;
    }
    breakdown.digitalBundle = { label: bundleDigitalLabel, amount: bundleDigitalAmount };
    total += bundleDigitalAmount;
    lineItems.push({
      price_data: {
        currency: 'gbp', unit_amount: Math.round(bundleDigitalAmount * 100),
        product_data: { name: bundleDigitalLabel },
      },
      quantity: 1,
    });
  }

  if (orderType === 'animation-music' || orderType === 'animation-vo') {
    const animPrice = orderType === 'animation-music' ? animationMusicGbp : animationVoGbp;
    const animLabel = orderType === 'animation-music'
      ? `${service.title} — Animation (30s with music) + digital still`
      : `${service.title} — Animation (30s with music + voiceover) + digital still`;
    breakdown.animation = { label: animLabel, amount: animPrice };
    total += animPrice;
    lineItems.push({
      price_data: {
        currency: 'gbp', unit_amount: Math.round(animPrice * 100),
        product_data: { name: animLabel },
      },
      quantity: 1,
    });
  }

  // ── Add prints (if applicable) ─────────────────────────────────────────────
  const shouldAddPrints =
    orderType === 'singlePrint' ||
    orderType === 'bundle' ||
    ((orderType === 'animation-music' || orderType === 'animation-vo') && includePrintsWithAnimation);

  if (shouldAddPrints) {
    const validPrints = prints.filter((p) => p.format && p.size);

    if (orderType === 'singlePrint') {
      const p = validPrints[0];
      if (!p) throw new Error('Single print path requires a format and size');
      const sanityFmt = FORMAT_TO_SANITY_KEY[p.format!];
      const sizeKey = SIZE_KEY_MAP[p.size!] || (p.size as 'small' | 'medium' | 'large');
      const basePrintPrice = Number(service.printUpcharges?.[sanityFmt]?.[sizeKey]) || 0;
      if (basePrintPrice <= 0) throw new Error(`No price configured for ${p.format} / ${sizeKey}`);

      // Standalone print = base + artwork fee
      const total1 = basePrintPrice + artworkFee;
      const styleLabel = labelForStyle(p.styleKey);
      const lineLabel = pretty(service, p.format!, sizeKey, styleLabel);

      breakdownPrints.push({ label: lineLabel, amount: total1, artworkFeeWaived: false });
      total += total1;
      lineItems.push({
        price_data: {
          currency: 'gbp', unit_amount: Math.round(total1 * 100),
          product_data: {
            name: `${service.title} — ${lineLabel}`,
            description: `Includes £${artworkFee.toFixed(2)} artwork creation fee`,
          },
        },
        quantity: 1,
      });
    } else {
      // bundle, animation-music, animation-vo
      // Determine whether to waive the artwork fee on this order's prints.
      // For animation paths, always waive (artwork is part of animation production).
      // For 'bundle' path, honour the service's artworkBundledWithDigital flag.
      const isAnimationPath = orderType === 'animation-music' || orderType === 'animation-vo';
      const artworkBundledWithDigital = service.artworkBundledWithDigital !== false; // default true
      const artworkFeePerOrder = service.artworkFeePerOrder === true; // default false
      const waiveArtwork = isAnimationPath || artworkBundledWithDigital;

      for (const p of validPrints) {
        const sanityFmt = FORMAT_TO_SANITY_KEY[p.format!];
        const sizeKey = SIZE_KEY_MAP[p.size!] || (p.size as 'small' | 'medium' | 'large');
        const basePrintPrice = Number(service.printUpcharges?.[sanityFmt]?.[sizeKey]) || 0;
        if (basePrintPrice <= 0) continue;

        const styleLabel = labelForStyle(p.styleKey);
        const lineLabel = pretty(service, p.format!, sizeKey, styleLabel);

        breakdownPrints.push({ label: lineLabel, amount: basePrintPrice, artworkFeeWaived: waiveArtwork });
        total += basePrintPrice;
        if (waiveArtwork) saved += artworkFee;
        lineItems.push({
          price_data: {
            currency: 'gbp', unit_amount: Math.round(basePrintPrice * 100),
            product_data: {
              name: `${service.title} — ${lineLabel}`,
              description: waiveArtwork
                ? `£${artworkFee.toFixed(2)} artwork fee waived (bundle order)`
                : `Print only — artwork fee charged separately`,
            },
          },
          quantity: 1,
        });
      }

      // If artwork still applies (e.g. YSYS), add it as separate line item(s)
      if (!waiveArtwork && validPrints.length > 0) {
        if (artworkFeePerOrder) {
          // Single artwork fee per order
          total += artworkFee;
          lineItems.push({
            price_data: {
              currency: 'gbp', unit_amount: Math.round(artworkFee * 100),
              product_data: {
                name: `${service.title} — Artwork creation fee`,
                description: 'One-time charge per order',
              },
            },
            quantity: 1,
          });
        } else {
          // Per-print artwork fee
          for (let i = 0; i < validPrints.length; i++) {
            total += artworkFee;
            lineItems.push({
              price_data: {
                currency: 'gbp', unit_amount: Math.round(artworkFee * 100),
                product_data: {
                  name: `${service.title} — Artwork fee (print ${i + 1})`,
                },
              },
              quantity: 1,
            });
          }
        }
      }
    }
  }

  // ── Build summary label ────────────────────────────────────────────────────
  let formatLabel = 'Digital only';
  if (orderType === 'singlePrint' && breakdownPrints.length === 1) {
    formatLabel = breakdownPrints[0].label;
  } else if (orderType === 'bundle') {
    formatLabel = `Digital bundle + ${breakdownPrints.length} print(s)`;
  } else if (orderType === 'animation-music') {
    formatLabel = breakdownPrints.length > 0
      ? `Animation (music) + ${breakdownPrints.length} print(s)`
      : 'Animation (music)';
  } else if (orderType === 'animation-vo') {
    formatLabel = breakdownPrints.length > 0
      ? `Animation (music + voiceover) + ${breakdownPrints.length} print(s)`
      : 'Animation (music + voiceover)';
  }

  const finalBreakdown: PriceBreakdown = {
    orderType,
    digitalBundle: breakdown.digitalBundle,
    animation: breakdown.animation,
    prints: breakdownPrints,
    total,
    totalArtworkFeeSaved: saved,
    printFormatLabel: formatLabel,
  };

  return { breakdown: finalBreakdown, stripeLineItems: lineItems };
}

// Legacy fallback for old wizard payloads
function legacyCalculatePricing(args: {
  deliveryType: string;
  printFormat?: string;
  printSize?: string;
  service: any;
}): { breakdown: PriceBreakdown; stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] } {
  if (args.deliveryType === 'digital') {
    return calculatePricing({ orderType: 'digital', service: args.service, prints: [], includePrintsWithAnimation: false, bundleCollection: 'primary' });
  }
  if (args.deliveryType === 'print') {
    return calculatePricing({
      orderType: 'singlePrint',
      service: args.service,
      prints: [{ format: args.printFormat, size: args.printSize }],
      includePrintsWithAnimation: false,
      bundleCollection: 'primary',
    });
  }
  return calculatePricing({
    orderType: 'bundle',
    service: args.service,
    prints: [{ format: args.printFormat, size: args.printSize }],
    includePrintsWithAnimation: false,
    bundleCollection: 'primary',
  });
}

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const formData = await req.formData();

    const serviceSlug = formData.get('serviceSlug') as string;
    const serviceTitle = formData.get('serviceTitle') as string;
    const name = formData.get('name') as string;
    const email = formData.get('email') as string;
    const phone = (formData.get('phone') as string) || undefined;
    const brief = (formData.get('brief') as string) || '';
    const shippingAddress = (formData.get('shippingAddress') as string) || undefined;
    const orderType = (formData.get('orderType') as string) || '';
    const includePrintsWithAnimation = (formData.get('includePrintsWithAnimation') as string) === 'true';
    const bundleCollectionRaw = (formData.get('bundleCollection') as string) || 'primary';
    const bundleCollection: BundleCollection =
      bundleCollectionRaw === 'secondary' || bundleCollectionRaw === 'both'
        ? bundleCollectionRaw
        : 'primary';

    const legacyDeliveryType = (formData.get('deliveryType') as string) || '';
    const legacyPrintFormat = (formData.get('printFormat') as string) || undefined;
    const legacyPrintSize = (formData.get('printSize') as string) || undefined;

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
      } catch (e) { console.warn('Invalid prints JSON:', e); }
    }

    const briefDataRaw = formData.get('briefData') as string | null;
    let briefData: Array<{ key: string; label: string; value: string }> = [];
    if (briefDataRaw) {
      try {
        const parsed = JSON.parse(briefDataRaw);
        if (Array.isArray(parsed)) {
          briefData = parsed
            .filter((b) => b && typeof b === 'object' && b.key)
            .map((b) => ({
              key: String(b.key), label: String(b.label || b.key),
              value: b.value == null ? '' : String(b.value),
            }));
        }
      } catch (e) { console.warn('Invalid briefData JSON:', e); }
    }

    if (!serviceSlug || !name || !email) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Look up service doc with all new fields
    const service = await sanity.fetch(
      `*[_type == "service" && slug.current == $slug][0]{
        _id, title, price, digitalPrice, printUpcharges, styleOptions,
        animationMusicPrice, animationVoPrice, artworkFee, printSizeLabels,
        artworkBundledWithDigital, artworkFeePerOrder,
        commissionEnabled
      }`,
      { slug: serviceSlug }
    );

    if (!service) {
      return new Response(JSON.stringify({ error: 'Service not found.' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } });
    }
    if (service.commissionEnabled === false) {
      return new Response(JSON.stringify({ error: 'This service is not currently accepting new commissions.' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } });
    }

    // Upload files to Sanity. New: filename prefix like "fieldKey__realname"
    // tells us which briefing field each file came from. Preserved in metadata
    // for the team email and Studio review.
    const files = formData.getAll('files') as File[];
    const uploadedAssets: Array<{
      _type: 'object'; _key: string;
      fieldKey: string;
      asset: { _type: 'reference'; _ref: string };
      originalName: string;
    }> = [];

    for (const file of files) {
      if (!file.size) continue;
      const buffer = Buffer.from(await file.arrayBuffer());

      // Parse "fieldKey__originalName" filename pattern
      const parts = file.name.split('__');
      const fieldKey = parts.length > 1 ? parts[0] : 'unknown';
      const originalName = parts.length > 1 ? parts.slice(1).join('__') : file.name;

      const asset = await sanity.assets.upload('image', buffer, {
        filename: originalName,
        contentType: file.type,
      });
      uploadedAssets.push({
        _type: 'object',
        _key: nanoid(8),
        fieldKey,
        originalName,
        asset: { _type: 'reference', _ref: asset._id },
      });
    }

    const orderRef = `PX-${nanoid(8).toUpperCase()}`;

    let breakdown: PriceBreakdown;
    let stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (orderType) {
      ({ breakdown, stripeLineItems } = calculatePricing({
        orderType: orderType as OrderType, service, prints, includePrintsWithAnimation, bundleCollection,
      }));
    } else if (legacyDeliveryType) {
      ({ breakdown, stripeLineItems } = legacyCalculatePricing({
        deliveryType: legacyDeliveryType,
        printFormat: legacyPrintFormat, printSize: legacyPrintSize, service,
      }));
    } else {
      return new Response(JSON.stringify({ error: 'Missing orderType or deliveryType.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    // Build commission doc
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
      bundleCollection: bundleCollection,
      shippingAddress: breakdown.prints.length > 0 ? shippingAddress : undefined,
      uploadedFiles: uploadedAssets,
      amount: breakdown.total,
      priceBreakdown: {
        orderType: breakdown.orderType,
        digitalBundle: breakdown.digitalBundle?.amount ?? 0,
        digitalBundleLabel: breakdown.digitalBundle?.label || '',
        animationAmount: breakdown.animation?.amount ?? 0,
        animationLabel: breakdown.animation?.label || '',
        prints: breakdown.prints.map((p, i) => ({
          _key: `pb-${nanoid(6)}-${i}`,
          label: p.label, amount: p.amount, artworkFeeWaived: p.artworkFeeWaived,
        })),
        total: breakdown.total,
        totalArtworkFeeSaved: breakdown.totalArtworkFeeSaved,
        printFormatLabel: breakdown.printFormatLabel,
      },
      prints: prints
        .filter((p) => p.format && p.size)
        .map((p, i) => ({
          _key: `pr-${nanoid(6)}-${i}`,
          styleKey: p.styleKey, format: p.format,
          size: SIZE_KEY_MAP[p.size!] || p.size,
        })),
    };

    if (briefData.length > 0) {
      commissionDoc.briefData = briefData.map((b, i) => ({
        _type: 'briefAnswer',
        _key: `ba-${nanoid(6)}-${i}`,
        key: b.key, label: b.label, value: b.value,
      }));
    }

    const commission = await sanity.create(commissionDoc);

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
      status: 200, headers: { 'Content-Type': 'application/json' },
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
