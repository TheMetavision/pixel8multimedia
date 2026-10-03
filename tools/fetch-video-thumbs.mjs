#!/usr/bin/env node
/**
 * tools/fetch-video-thumbs.mjs
 *
 * Downloads a thumbnail for every YouTube video on the service pages into
 * public/video-thumbs/<youtubeId>.jpg, so click-to-load videos show a
 * self-hosted image and nothing is fetched from YouTube (i.ytimg.com) until
 * the visitor clicks play. Re-run after adding a video in Sanity; a missing
 * thumbnail falls back to a plain poster, never to YouTube.
 *
 *   node tools/fetch-video-thumbs.mjs            # only missing thumbnails
 *   node tools/fetch-video-thumbs.mjs --force    # re-download all
 *
 * Reads video ids from Sanity (service.examples[].videos[]). The dataset is
 * private, so it needs SANITY_READ_TOKEN or SANITY_TOKEN (shell or .env).
 */
import dotenv from 'dotenv';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env'), quiet: true });
const OUT = join(ROOT, 'public', 'video-thumbs');
const FORCE = process.argv.includes('--force');
const TOKEN = process.env.SANITY_READ_TOKEN || process.env.SANITY_TOKEN;

const query = `*[_type == "service" && !(_id in path("drafts.**"))].examples[].videos[].youtubeId`;
const res = await fetch(
  `https://bqb4w421.api.sanity.io/v2021-06-07/data/query/production?query=${encodeURIComponent(query)}`,
  { headers: { Authorization: `Bearer ${TOKEN}` } }
);
if (!res.ok) throw new Error(`Sanity query failed: HTTP ${res.status}`);
const ids = [...new Set((await res.json()).result.filter((id) => /^[\w-]{11}$/.test(id || '')))];

await mkdir(OUT, { recursive: true });
// Landscape 16:9 frames to match the player; largest available first.
const VARIANTS = ['maxresdefault', 'sddefault', 'hqdefault'];

for (const id of ids) {
  const file = join(OUT, `${id}.jpg`);
  if (!FORCE) {
    try { await access(file); console.log(`skip  ${id} (exists)`); continue; } catch { /* fetch it */ }
  }
  let saved = false;
  for (const v of VARIANTS) {
    const r = await fetch(`https://i.ytimg.com/vi/${id}/${v}.jpg`);
    if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) continue; // YouTube's grey "no thumbnail" placeholder
    await writeFile(file, buf);
    console.log(`saved ${id} (${v}, ${Math.round(buf.length / 1024)}KB)`);
    saved = true;
    break;
  }
  if (!saved) console.log(`MISSING ${id}: no thumbnail available`);
}
