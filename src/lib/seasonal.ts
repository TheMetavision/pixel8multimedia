// Seasonal homepage hero (siteSettings.seasonalCampaign). The homepage is prerendered, so
// this is read once per build (publishing Site Settings rebuilds the site). The browser
// decides on the day whether the season is on (seasonHeadScript), so it starts and ends on
// time without a rebuild. Any failure here means "no campaign": the normal hero, never a
// failed build or a broken page.

import { sanityClient } from './sanity';
import { parseCampaign, type SeasonalCampaign } from './seasonal-campaign.mjs';

export { isSeasonOn, seasonHeadScript, type SeasonalCampaign } from './seasonal-campaign.mjs';

/* Rendered width of the square seasonal art (SeasonalHero.astro): the right column from lg
   (584px at max-w-7xl, 50vw - 56px at 1024), else full width under the copy up to 560px. */
export const SEASONAL_SIZES = '(min-width: 1280px) 584px, (min-width: 1024px) calc(50vw - 56px), min(560px, calc(100vw - 32px))';

const QUERY = `*[_type == "siteSettings"][0].seasonalCampaign{
  enabled, startDate, endDate, heroImageAlt,
  eyebrow, headlineLine1, headlineLine2, body, ctaLabel, ctaHref, snow,
  "imageUrl": heroImage.asset->url
}`;

export async function getSeasonalCampaign(): Promise<SeasonalCampaign | null> {
  try {
    const raw = await sanityClient.fetch(QUERY, {}, { signal: AbortSignal.timeout(15_000) });
    return parseCampaign(raw);
  } catch (err) {
    console.warn('[seasonal] Sanity fetch failed, using the default hero:', (err as Error).message);
    return null;
  }
}
