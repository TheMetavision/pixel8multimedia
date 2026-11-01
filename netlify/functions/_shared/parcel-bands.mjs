/**
 * Format + size -> the shipping service's parcel band, and the parcel plan an
 * order or commission is proposed with.
 *
 * The bands are refs into metavision-shipping's config/shipping.json, where the
 * real box sizes and weights live. This file only says which box a thing goes
 * in. It never guesses: a line it cannot place is reported as a problem and
 * the shipment is flagged, because a wrong band is a label for the wrong box
 * -- a surcharge, or a parcel the carrier refuses.
 *
 * SHOP (orders): square prints, keys from the server-priced checkout
 * (lineItems[].formatKey / sizeKey; print-spec.mjs):
 *     poster          12x12 / 16x16 / 20x20 -> P5 / P6 / P7
 *     canvasStandard                         -> CS5 / CS6 / CS7
 *     canvasGallery                          -> CG5 / CG6 / CG7
 *   "Your Photo" lines are the same squares and the same keys.
 *   Lines from before the keys were stamped carry labels only: flagged.
 *
 * COMMISSIONS: prints[] { format: poster|canvas-standard|canvas-gallery,
 * size: small|medium|large }. The shape is the SERVICE's: a service with
 * printSizeLabels set sells 3:2 prints (12x8 / 18x12 / 24x16, either way up);
 * one without sells the shop's squares (service.ts says "Leave blank for the
 * square sizes").
 *     3:2 poster      12x8 / 18x12 / 24x16  -> P1 / P3 / P4
 *     3:2 standard                          -> CS1 / CS3 / CS4
 *     3:2 gallery                           -> CG1 / CG3 / CG4
 *     square                                -> as the shop
 *   The retired 16x12 (legacy commissions) -> P2 / CS2 / CG2.
 */

export const SQUARE_BANDS = {
  poster: { small: 'P5', medium: 'P6', large: 'P7' },
  canvasStandard: { small: 'CS5', medium: 'CS6', large: 'CS7' },
  canvasGallery: { small: 'CG5', medium: 'CG6', large: 'CG7' },
};

export const RATIO_BANDS = {
  poster: { small: 'P1', medium: 'P3', large: 'P4' },
  canvasStandard: { small: 'CS1', medium: 'CS3', large: 'CS4' },
  canvasGallery: { small: 'CG1', medium: 'CG3', large: 'CG4' },
};

/** The retired 16x12 commission size. */
export const LEGACY_16X12_BANDS = { poster: 'P2', canvasStandard: 'CS2', canvasGallery: 'CG2' };

export const BAND_TITLES = {
  P1: 'P1 — poster 12×8 (envelope)',
  P2: 'P2 — poster 16×12 (legacy commission)',
  P3: 'P3 — poster 18×12',
  P4: 'P4 — poster 24×16 (tube)',
  P5: 'P5 — poster 12×12 (envelope)',
  P6: 'P6 — poster 16×16 (envelope)',
  P7: 'P7 — poster 20×20 (tube)',
  CS1: 'CS1 — standard canvas 12×8',
  CS2: 'CS2 — standard canvas 16×12 (legacy)',
  CS3: 'CS3 — standard canvas 18×12',
  CS4: 'CS4 — standard canvas 24×16',
  CS5: 'CS5 — standard canvas 12×12',
  CS6: 'CS6 — standard canvas 16×16',
  CS7: 'CS7 — standard canvas 20×20',
  CG1: 'CG1 — gallery canvas 12×8',
  CG2: 'CG2 — gallery canvas 16×12 (legacy)',
  CG3: 'CG3 — gallery canvas 18×12',
  CG4: 'CG4 — gallery canvas 24×16',
  CG5: 'CG5 — gallery canvas 12×12',
  CG6: 'CG6 — gallery canvas 16×16',
  CG7: 'CG7 — gallery canvas 20×20',
};

/** Every band Pixel8 can use, for the Studio's band pickers. */
export const ALL_BANDS = Object.keys(BAND_TITLES);

const FORMAT_ALIASES = {
  poster: 'poster',
  canvasStandard: 'canvasStandard', 'canvas-standard': 'canvasStandard',
  canvasGallery: 'canvasGallery', 'canvas-gallery': 'canvasGallery',
};
export const normaliseFormat = (f) => FORMAT_ALIASES[String(f || '').trim()] || null;

const SIZE_KEYS = new Set(['small', 'medium', 'large']);
/** '12x8' etc. as the legacy commission form posted them -> key. '16x12' -> 'legacy16x12'. */
const SIZE_VALUES = {
  '12x8': 'small', '8x12': 'small', '18x12': 'medium', '12x18': 'medium', '24x16': 'large', '16x24': 'large',
  '12x12': 'small', '16x16': 'medium', '20x20': 'large',
  '16x12': 'legacy16x12', '12x16': 'legacy16x12',
};
const SQUARE_VALUES = new Set(['12x12', '16x16', '20x20']);
const RATIO_VALUES = new Set(['12x8', '8x12', '18x12', '12x18', '24x16', '16x24']);

/** The shop: format + size key -> band, or null. */
export const bandFor = (formatKey, sizeKey) => SQUARE_BANDS[normaliseFormat(formatKey)]?.[sizeKey] ?? null;

/** Lines that are not a thing in a box. Pixel8 has none today; kept for safety. */
export const isNonPhysical = (line) => !line || line.format === '—';

/** One order line: { band } or { problem }. */
export function bandForLine(line) {
  if (line.band && ALL_BANDS.includes(line.band)) return { band: line.band };
  if (!line.formatKey || !line.sizeKey) {
    return { problem: `"${line.productTitle || 'a line'}" (${line.format || '?'} / ${line.size || '?'}) has no format/size key — choose its band by hand` };
  }
  const band = bandFor(line.formatKey, line.sizeKey);
  if (!band) return { problem: `"${line.productTitle || 'a line'}" is ${line.formatKey} / ${line.sizeKey}, which has no parcel band — choose one by hand` };
  return { band };
}

/* ------------------------------------------------------------- commissions */

const hasLabels = (labels) => Boolean(labels && ['small', 'medium', 'large'].some((k) => String(labels[k] || '').trim()));

/**
 * The band for one commission print.
 *
 * @param {{ format: string, size: string }} print
 * @param {{ printSizeLabels?: object|null } | null} service   null = unknown
 * @returns {{ band: string } | { problem: string }}
 */
export function commissionBand(print, service) {
  const fmt = normaliseFormat(print?.format);
  const raw = String(print?.size || '').trim().toLowerCase().replace(/[×\s"]/g, 'x').replace(/x+/g, 'x');
  if (!fmt) return { problem: `a print with format "${print?.format || '?'}" has no parcel band — choose one by hand` };
  const key = SIZE_KEYS.has(raw) ? raw : SIZE_VALUES[raw];
  if (!key) return { problem: `a ${fmt} print with size "${print?.size || '?'}" has no parcel band — choose one by hand` };
  if (key === 'legacy16x12') return { band: LEGACY_16X12_BANDS[fmt] };
  // A size written as dimensions says its own shape; a key needs the service.
  if (SQUARE_VALUES.has(raw)) return { band: SQUARE_BANDS[fmt][key] };
  if (RATIO_VALUES.has(raw)) return { band: RATIO_BANDS[fmt][key] };
  if (!service) return { problem: `a ${fmt} ${key} print: the service could not be read, so square or 3:2 is unknown — choose its band by hand` };
  return { band: (hasLabels(service.printSizeLabels) ? RATIO_BANDS : SQUARE_BANDS)[fmt][key] };
}

const FORMAT_TITLES = { poster: 'Poster', canvasStandard: 'Standard canvas', canvasGallery: 'Gallery canvas' };

/**
 * A commission's prints as order-like lines, so planning, validation and the
 * label items work the same for both. Prints come from `prints[]`; a legacy
 * commission with only printFormat / printSize gives one line.
 *
 * @param {object} commission  needs prints, printFormat, printSize, priceBreakdown, serviceTitle
 * @param {object|null} service  { printSizeLabels } or null if unknown
 */
export function commissionLines(commission, service) {
  const c = commission || {};
  const priced = Array.isArray(c.priceBreakdown?.prints) ? c.priceBreakdown.prints : [];
  let prints = Array.isArray(c.prints) ? c.prints.filter((p) => p && p.format && p.size) : [];
  if (!prints.length && c.printFormat && c.printSize) {
    prints = [{ _key: 'legacy-print', format: c.printFormat, size: c.printSize }];
  } else if (prints.length === 1 && /^16\s*[x×]\s*12$|^12\s*[x×]\s*16$/i.test(String(c.printSize || '').trim())) {
    // Checkout maps the old 16x12 to "medium" in prints[]; the legacy field
    // still says what was actually ordered.
    prints = [{ ...prints[0], size: '16x12' }];
  }
  return prints.map((p, i) => {
    const fmt = normaliseFormat(p.format);
    const r = commissionBand(p, service);
    return {
      _key: p._key || `print-${i + 1}`,
      productTitle: c.serviceTitle || 'Commission print',
      format: FORMAT_TITLES[fmt] || p.format,
      size: String(p.size),
      quantity: 1,
      unitPrice: Number(priced[i]?.amount) || 0,
      formatKey: fmt || undefined,
      sizeKey: p.size,
      ...(r.band ? { band: r.band } : { bandProblem: r.problem }),
    };
  });
}

/* ------------------------------------------------------------------ plans */

/**
 * The plan a shipment starts with: one parcel per physical item, so a line of
 * two posters is two parcels. Alan combines them in the Studio before shipping
 * (two posters in one tube) by editing the plan.
 *
 * A line that could not be placed is still planned, with no band, so the plan
 * shows everything and dispatch refuses it until a band is chosen.
 *
 * @returns {{ plan: object[], problems: string[] }}
 */
export function proposeParcelPlan(lines = []) {
  const plan = [];
  const problems = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    if (isNonPhysical(line)) continue;
    const r = line.bandProblem ? { problem: line.bandProblem } : bandForLine(line);
    if (r.problem) problems.push(r.problem);
    const qty = Math.max(1, Math.floor(Number(line.quantity) || 1));
    for (let i = 0; i < qty; i++) {
      const parcelRef = String(plan.length + 1);
      plan.push({
        _key: `p${parcelRef}`,
        _type: 'plannedParcel',
        parcelRef,
        ...(r.band ? { band: r.band } : {}),
        items: [{ _key: `i${parcelRef}`, _type: 'plannedItem', title: [line.productTitle, line.format, line.size].filter(Boolean).join(' — '), lineKey: line._key, quantity: 1 }],
      });
    }
  }
  return { plan, problems };
}

/** Check a plan (possibly edited in the Studio) before any label is bought. Every problem is listed. */
export function validateParcelPlan(plan, lines = []) {
  const problems = [];
  const byKey = new Map((lines || []).map((l) => [l._key, l]));
  if (!Array.isArray(plan) || !plan.length) return ['The parcel plan is empty'];
  const refs = new Set();
  const planned = new Map();
  for (const p of plan) {
    const ref = String(p?.parcelRef ?? '').trim();
    const label = `Parcel ${ref || '(no ref)'}`;
    if (!ref) problems.push('A parcel has no parcel ref');
    else if (!/^[A-Za-z0-9_-]{1,32}$/.test(ref)) problems.push(`${label}: the parcel ref may only use letters, digits, - and _`);
    else if (refs.has(ref)) problems.push(`${label}: the parcel ref is used twice`);
    refs.add(ref);
    if (!p?.band) problems.push(`${label} has no band`);
    else if (!ALL_BANDS.includes(p.band)) problems.push(`${label}: "${p.band}" is not a known band`);
    const items = Array.isArray(p?.items) ? p.items : [];
    if (!items.length) problems.push(`${label} has nothing in it`);
    for (const it of items) {
      const line = byKey.get(it?.lineKey);
      if (!line) { problems.push(`${label} lists an item that is not on this order (${it?.lineKey || 'blank'})`); continue; }
      const q = Math.floor(Number(it.quantity) || 0);
      if (q < 1) problems.push(`${label}: quantity for "${line.productTitle}" must be at least 1`);
      planned.set(it.lineKey, (planned.get(it.lineKey) || 0) + Math.max(q, 0));
    }
  }
  for (const line of lines || []) {
    if (isNonPhysical(line)) continue;
    const want = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const got = planned.get(line._key) || 0;
    if (got !== want) problems.push(`"${line.productTitle}" (${[line.format, line.size].filter(Boolean).join(' ')}): ${want} ordered, ${got} in the parcel plan`);
  }
  return problems;
}

/** The item list the service puts on the label. */
export function parcelItems(parcel, lines = []) {
  const byKey = new Map((lines || []).map((l) => [l._key, l]));
  return (parcel.items || []).map((it) => {
    const line = byKey.get(it.lineKey) || {};
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    return {
      description: [line.productTitle, line.format, line.size].filter(Boolean).join(' — ').slice(0, 120) || 'Print',
      qty,
      valueGBP: Math.round((Number(line.unitPrice) || 0) * qty * 100) / 100,
      sku: [line.productSlug, line.formatKey, line.sizeKey].filter(Boolean).join('-') || undefined,
    };
  });
}

/**
 * The service's view of where a parcel goes: name and address only.
 * `address` is { line1, line2, city, county, postcode, country } -- the order's
 * shippingAddress, or a commission's structured address.
 */
export function recipientFor(name, address) {
  const a = address || {};
  return {
    name: name || '',
    addressLine1: a.line1 || '',
    addressLine2: a.line2 || '',
    houseNumber: '',
    city: a.city || '',
    postalCode: a.postcode || '',
    countryCode: String(a.country || '').toUpperCase(),
    email: '',
    phone: '',
  };
}

/* ------------------------------------------------------------------ carriers */

/** Sendcloud carrier codes -> the Studio's carrier values (order and commission). */
const CARRIERS = [
  [/^royal[_-]?mail/i, 'royalmail', 'Royal Mail'],
  [/^(hermes|evri)/i, 'evri', 'Evri'],
  [/^inpost/i, 'inpost', 'InPost'],
  [/^dpd/i, 'dpd', 'DPD'],
  [/^ups/i, 'ups', 'UPS'],
];

/** The carrier enum shared by orders and commissions. */
export const CARRIER_OPTIONS = [
  { title: 'Royal Mail', value: 'royalmail' },
  { title: 'Evri', value: 'evri' },
  { title: 'InPost', value: 'inpost' },
  { title: 'DPD', value: 'dpd' },
  { title: 'UPS', value: 'ups' },
  { title: 'Other', value: 'other' },
];

/** { carrier, carrierOther } for the document. */
export function mapCarrier(code) {
  const s = String(code || '');
  for (const [re, value] of CARRIERS) if (re.test(s)) return { carrier: value, carrierOther: null };
  return { carrier: 'other', carrierOther: s ? s.replace(/[_:].*$/, '').replace(/^\w/, (c) => c.toUpperCase()) : 'Courier' };
}

/** The name a customer reads, from a Sendcloud code or a Studio value. */
export function carrierName(code, other) {
  const s = String(code || '');
  for (const [re, value, name] of CARRIERS) if (re.test(s) || s === value) return name;
  if (/^sendcloud/i.test(s)) return 'Sendcloud (test)';
  if (s === 'other') return other || 'Courier';
  return s || other || 'Courier';
}

/** A tracking page for a hand-entered tracking number, or null (the email then shows the number only). */
export function trackingUrlFor(carrier, trackingNumber) {
  const n = String(trackingNumber || '').trim();
  if (!carrier || !n) return null;
  const num = encodeURIComponent(n);
  switch (String(carrier).toLowerCase().replace(/[\s_-]+/g, '')) {
    // Royal Mail recommends the query form while its hash-route links have known issues.
    case 'royalmail': return `https://www.royalmail.com/track-your-item?trackNumber=${num}`;
    case 'evri': return `https://www.evri.com/track/parcel/${num}`;
    case 'dpd': return `https://track.dpd.co.uk/parcels/${num}`;
    case 'ups': return `https://www.ups.com/track?tracknum=${num}&loc=en_GB`;
    default: return null;
  }
}
