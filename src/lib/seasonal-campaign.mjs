// Seasonal homepage hero: the rules for siteSettings.seasonalCampaign, kept free of the
// Sanity client so tests/seasonal.test.mjs can run them. Loaded by src/lib/seasonal.ts.

/**
 * @typedef {object} SeasonalCampaign
 * @property {number} start      ms since the epoch
 * @property {number} end        ms since the epoch, exclusive
 * @property {string} imageUrl   Sanity CDN URL of the square art
 * @property {string} alt
 * @property {string} eyebrow    '' = not set (the hero uses its normal copy)
 * @property {string} line1
 * @property {string} line2
 * @property {string} body
 * @property {string} ctaLabel
 * @property {string} ctaHref    '' = not set; only a site path or an https:// link
 * @property {boolean} snow
 */

const isSanityImage = (u) => typeof u === 'string' && u.startsWith('https://cdn.sanity.io/images/');

/* Copy is typed in Studio with a straight apostrophe; show the typographic one */
const text = (s) => (typeof s === 'string' ? s.trim().replace(/'/g, '’') : '');

/* A site path (/store/...) or an https link. Anything else (javascript:, //host) = not set */
const href = (s) => {
  const v = typeof s === 'string' ? s.trim() : '';
  return /^(\/(?!\/)|https:\/\/)/.test(v) ? v : '';
};

/**
 * A campaign the site can show, or null (off, or anything missing or invalid).
 * @returns {SeasonalCampaign | null}
 */
export function parseCampaign(raw) {
  if (!raw || raw.enabled !== true) return null;
  const start = Date.parse(raw.startDate);
  const end = Date.parse(raw.endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  if (!isSanityImage(raw.imageUrl)) return null;
  const alt = typeof raw.heroImageAlt === 'string' ? raw.heroImageAlt.trim() : '';
  if (!alt) return null;
  return {
    start,
    end,
    imageUrl: raw.imageUrl,
    alt,
    eyebrow: text(raw.eyebrow),
    line1: text(raw.headlineLine1),
    line2: text(raw.headlineLine2),
    body: text(raw.body),
    ctaLabel: text(raw.ctaLabel),
    ctaHref: href(raw.ctaHref),
    snow: raw.snow !== false,
  };
}

/** @param {SeasonalCampaign | null} c */
export function isSeasonOn(c, now = Date.now()) {
  return !!c && now >= c.start && now < c.end;
}

/**
 * The inline <head> script: sets html[data-season] to "on" or "off" from the visitor's clock,
 * so the season starts and ends on time between builds. ?season=on / ?season=off overrides.
 * @param {SeasonalCampaign} c
 */
export function seasonHeadScript(c) {
  return `(function(){var q=new URLSearchParams(location.search).get('season'),n=Date.now();` +
    `document.documentElement.dataset.season=(q==='on'||(q!=='off'&&n>=${Number(c.start)}&&n<${Number(c.end)}))?'on':'off';})();`;
}
