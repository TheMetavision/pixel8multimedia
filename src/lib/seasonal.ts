// Seasonal homepage hero (siteSettings.seasonalCampaign). The homepage is prerendered, so
// this is read once per build (publishing Site Settings rebuilds the site). The browser
// decides on the day whether the season is on (seasonHeadScript), so it starts and ends on
// time without a rebuild. Any failure here means "no campaign": the normal hero, never a
// failed build or a broken page.

import { sanityClient } from './sanity';
import { parseCampaign, type SeasonalCampaign } from './seasonal-campaign.mjs';

export { isSeasonOn, seasonHeadScript, type SeasonalCampaign } from './seasonal-campaign.mjs';

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
