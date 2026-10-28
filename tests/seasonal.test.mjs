// Seasonal homepage hero (siteSettings.seasonalCampaign): which campaigns show, the date
// window, the copy fallbacks and the <head> script that switches the season on in the browser.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';

const { parseCampaign, isSeasonOn, seasonHeadScript } = await import('../src/lib/seasonal-campaign.mjs');

const IMG = 'https://cdn.sanity.io/images/bqb4w421/production/abc-2048x2048.png';
const raw = (over = {}) => ({
  enabled: true,
  startDate: '2026-11-20T00:00:00.000Z',
  endDate: '2026-12-27T00:00:00.000Z',
  imageUrl: IMG,
  heroImageAlt: 'Nine pixel-art Christmas prints in a 3 by 3 grid',
  eyebrow: 'Order by 18 December',
  headlineLine1: "Pop Culture's",
  headlineLine2: 'Christmas Collection',
  body: 'Gifts they will actually hang.',
  ctaLabel: 'Shop Christmas',
  ctaHref: '/store/christmas/',
  ...over,
});

test('a complete, enabled campaign parses', () => {
  const c = parseCampaign(raw());
  assert.equal(c.start, Date.parse('2026-11-20T00:00:00.000Z'));
  assert.equal(c.end, Date.parse('2026-12-27T00:00:00.000Z'));
  assert.equal(c.imageUrl, IMG);
  assert.equal(c.line1, 'Pop Culture’s', 'typographic apostrophe');
  assert.equal(c.line2, 'Christmas Collection');
  assert.equal(c.ctaHref, '/store/christmas/');
  assert.equal(c.snow, true, 'snow defaults on');
  assert.equal(parseCampaign(raw({ snow: false })).snow, false);
});

test('off, missing or invalid campaigns mean the default hero', () => {
  assert.equal(parseCampaign(null), null);
  assert.equal(parseCampaign(undefined), null);
  assert.equal(parseCampaign(raw({ enabled: false })), null);
  assert.equal(parseCampaign(raw({ enabled: undefined })), null);
  assert.equal(parseCampaign(raw({ startDate: undefined })), null);
  assert.equal(parseCampaign(raw({ endDate: 'nonsense' })), null);
  assert.equal(parseCampaign(raw({ endDate: '2026-11-20T00:00:00.000Z' })), null, 'end must be after start');
  assert.equal(parseCampaign(raw({ imageUrl: null })), null);
  assert.equal(parseCampaign(raw({ imageUrl: 'https://example.com/x.jpg' })), null);
  assert.equal(parseCampaign(raw({ heroImageAlt: '  ' })), null);
});

test('empty copy is blank (the hero falls back to its normal copy)', () => {
  const c = parseCampaign(raw({ eyebrow: '', headlineLine1: ' ', headlineLine2: undefined, body: null, ctaLabel: '', ctaHref: '' }));
  for (const k of ['eyebrow', 'line1', 'line2', 'body', 'ctaLabel', 'ctaHref']) assert.equal(c[k], '', k);
});

test('the button link is a site path or https, nothing else', () => {
  assert.equal(parseCampaign(raw({ ctaHref: 'https://pixel8multimedia.co.uk/store/' })).ctaHref, 'https://pixel8multimedia.co.uk/store/');
  assert.equal(parseCampaign(raw({ ctaHref: 'javascript:alert(1)' })).ctaHref, '');
  assert.equal(parseCampaign(raw({ ctaHref: '//evil.example/' })).ctaHref, '');
  assert.equal(parseCampaign(raw({ ctaHref: 'http://pixel8multimedia.co.uk/' })).ctaHref, '');
  assert.equal(parseCampaign(raw({ ctaHref: 'store/' })).ctaHref, '');
});

test('the window includes its start and excludes its end', () => {
  const c = parseCampaign(raw());
  assert.equal(isSeasonOn(null), false);
  assert.equal(isSeasonOn(c, c.start - 1), false);
  assert.equal(isSeasonOn(c, c.start), true);
  assert.equal(isSeasonOn(c, c.end - 1), true);
  assert.equal(isSeasonOn(c, c.end), false);
});

/* Runs the inline script against a fake document at a given time and query string */
function runHead(c, now, search = '') {
  const html = { dataset: {} };
  const ctx = {
    document: { documentElement: html },
    location: { search },
    URLSearchParams,
    Date: { now: () => now },
  };
  vm.runInNewContext(seasonHeadScript(c), ctx);
  return html.dataset.season;
}

test('head script: dates, and the ?season override', () => {
  const c = parseCampaign(raw());
  assert.equal(runHead(c, c.start - 1), 'off');
  assert.equal(runHead(c, c.start), 'on');
  assert.equal(runHead(c, c.end), 'off');
  assert.equal(runHead(c, c.start - 1, '?season=on'), 'on');
  assert.equal(runHead(c, c.start, '?season=off'), 'off');
  assert.equal(runHead(c, c.start, '?season=maybe'), 'on');
});
