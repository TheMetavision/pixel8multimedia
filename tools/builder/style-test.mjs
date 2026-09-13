/**
 * Pixel8 style feasibility harness.
 *
 *   node tools/builder/style-test.mjs [options]
 *
 *     --manifest <file>   default ./styles.manifest.mjs (next to this script)
 *     --photos   <dir>    default ./test-photos
 *     --out      <dir>    default ./style-tests
 *     --size     1K|2K|4K default 2K
 *     --model    <id>     default STYLE_MODEL env, else gemini-3-pro-image-preview
 *     --style    a,b,c    only run these manifest ids
 *     --force             re-run cells that already have an output (default: skip)
 *     --dry-run           list the calls and cost estimate, call nothing
 *
 * For every style in the manifest × every photo in --photos it sends the
 * style's refs + the photo + PREAMBLE + style.prompt to Gemini at 1:1 and
 * writes:
 *
 *   <out>/<style>/<photo>.png          full-size result
 *   <out>/<style>/<photo>.thumb.jpg    800px thumb for the sheet
 *   <out>/thumbs/<photo>.jpg           original, for column one
 *   <out>/results.json                 one entry per cell (kept across runs)
 *   <out>/log.jsonl                    append-only call log
 *   <out>/contact-sheet.html           styles down, photos across
 *
 * Every call costs money: one request per cell, one retry on 429/5xx only,
 * failures are recorded and the run continues. Re-running skips cells that
 * already have a PNG, so a partial run can be resumed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import 'dotenv/config';
import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_MODEL = 'gemini-3-pro-image-preview';
const SIZES = ['1K', '2K', '4K'];
const COST = { '1K': 0.10, '2K': 0.10, '4K': 0.22 }; // GBP, rough
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.heic': 'image/heic', '.heif': 'image/heif',
};

// ---------------------------------------------------------------- args ----
function usage(msg) {
  if (msg) console.error(`\n  ${msg}`);
  console.error(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].slice(3));
  process.exit(msg ? 1 : 0);
}

function parseArgs(argv) {
  const o = {
    manifest: path.join(HERE, 'styles.manifest.mjs'),
    photos: path.join(HERE, 'test-photos'),
    out: path.join(HERE, 'style-tests'),
    size: '2K',
    model: process.env.STYLE_MODEL || DEFAULT_MODEL,
    only: null,
    force: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage();
    else if (a === '--manifest') o.manifest = path.resolve(argv[++i]);
    else if (a === '--photos') o.photos = path.resolve(argv[++i]);
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '--size') o.size = argv[++i];
    else if (a === '--model') o.model = argv[++i];
    else if (a === '--style') o.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--force') o.force = true;
    else if (a === '--dry-run') o.dryRun = true;
    else usage(`Unknown option ${a}`);
  }
  if (!SIZES.includes(o.size)) usage(`--size must be one of ${SIZES.join(', ')}`);
  return o;
}

// ------------------------------------------------------------- helpers ----
const isImage = (f) => Object.hasOwn(MIME, path.extname(f).toLowerCase());
const listImages = (dir) =>
  fs.existsSync(dir) ? fs.readdirSync(dir).filter(isImage).sort().map((f) => path.join(dir, f)) : [];
const stem = (p) => path.basename(p, path.extname(p));
const readPart = (p) => ({
  inlineData: { mimeType: MIME[path.extname(p).toLowerCase()], data: fs.readFileSync(p).toString('base64') },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class StyleError extends Error {
  constructor(message, extra = {}) { super(message); Object.assign(this, extra); }
  describe() {
    return [this.message,
      this.finishReason && `finishReason=${this.finishReason}`,
      this.blockReason && `blockReason=${this.blockReason}`,
      this.status && `status=${this.status}`,
      this.modelText && `model said: ${this.modelText.slice(0, 200)}`,
    ].filter(Boolean).join(' | ');
  }
}

async function callGemini(ai, { model, size, refParts, photoPart, prompt }) {
  const request = {
    model,
    contents: [{ role: 'user', parts: [...refParts, photoPart, { text: prompt }] }],
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: size } },
  };
  let res;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await ai.models.generateContent(request);
      break;
    } catch (err) {
      const status = err.status ?? err.code;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (attempt === 0 && retryable) { await sleep(4000); continue; }
      throw new StyleError(err.message, { status });
    }
  }
  const block = res.promptFeedback?.blockReason;
  if (block) throw new StyleError('Prompt blocked', { blockReason: block });
  const cand = res.candidates?.[0];
  const parts = cand?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) {
    throw new StyleError('No image in response', {
      finishReason: cand?.finishReason,
      modelText: parts.map((p) => p.text).filter(Boolean).join(' '),
    });
  }
  return Buffer.from(img.inlineData.data, 'base64');
}

// ------------------------------------------------------- contact sheet ----
function writeSheet(out, styles, photos, results, opts) {
  const rel = (p) => path.relative(out, p).split(path.sep).join('/');
  const th = photos.map((p) => `<th>${stem(p)}</th>`).join('');
  const rows = styles.map((s) => {
    const cells = photos.map((p) => {
      const r = results[`${s.id}/${stem(p)}`];
      if (!r) return `<td class="empty">not run</td>`;
      if (!r.ok) return `<td class="fail"><div>FAILED</div><small>${escape(r.error || '')}</small></td>`;
      return `<td><a href="${rel(r.png)}" target="_blank"><img src="${rel(r.thumb)}" loading="lazy"></a><small>${r.ms} ms · ${r.width}×${r.height}</small></td>`;
    }).join('');
    const okCount = photos.filter((p) => results[`${s.id}/${stem(p)}`]?.ok).length;
    return `<tr><th class="style"><div>${s.label}</div><small>${s.id}${s.letter ? ` · Option ${s.letter}` : ''} · ${s.refCount} refs</small><div class="score">${okCount}/${photos.length} styled</div><div class="pass">likeness ___ / ${photos.length}</div></th>${cells}</tr>`;
  }).join('\n');
  const origRow = photos.map((p) => `<td><img src="${rel(path.join(out, 'thumbs', `${stem(p)}.jpg`))}" loading="lazy"></td>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><title>Pixel8 style tests</title>
<style>
  body{font:14px system-ui;background:#1a1a1e;color:#eee;margin:16px}
  table{border-collapse:collapse}
  th,td{padding:6px;vertical-align:top;border:1px solid #333;text-align:left}
  th.style{width:150px;background:#222}
  img{width:220px;height:220px;object-fit:cover;display:block;background:#000}
  small{display:block;color:#999;margin-top:4px;word-break:break-word}
  .score{margin-top:6px;color:#8fd}
  .pass{color:#fc6;margin-top:2px}
  .fail{background:#3a1c1c;color:#f99;width:220px}
  .empty{color:#666;width:220px}
</style>
<h1>Pixel8 style tests</h1>
<p>Model ${escape(opts.model)} · size ${opts.size} · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}. Click any cell for the full-size result. Pass rule: a photo passes only if every person is recognisable unprompted; 4/5 keeps the style in v1.</p>
<table>
<tr><th class="style">original</th>${origRow}</tr>
<tr><th></th>${th}</tr>
${rows}
</table>`;
  fs.writeFileSync(path.join(out, 'contact-sheet.html'), html);
}
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------- main ----
async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const manifest = await import(pathToFileURL(opts.manifest).href);
  const { PREAMBLE, STYLES } = manifest;
  if (!PREAMBLE || !Array.isArray(STYLES)) usage(`${opts.manifest} must export PREAMBLE and STYLES`);

  const allStyles = STYLES.map((s) => {
    const refsDir = path.resolve(path.dirname(opts.manifest), s.refsDir);
    const refs = listImages(refsDir);
    return { ...s, refsDir, refs, refCount: refs.length };
  });
  let styles = allStyles;
  if (opts.only) {
    const unknown = opts.only.filter((id) => !styles.some((s) => s.id === id));
    if (unknown.length) usage(`Unknown style id(s): ${unknown.join(', ')}`);
    styles = styles.filter((s) => opts.only.includes(s.id));
  }
  const photos = listImages(opts.photos);
  if (!photos.length) usage(`No photos found in ${opts.photos}`);
  for (const s of styles) {
    if (!s.refs.length) console.warn(`  ! ${s.id}: no refs in ${s.refsDir} — running with prompt only`);
    if (s.refs.length > 6) console.warn(`  ! ${s.id}: ${s.refs.length} refs — that is a lot of tokens per call`);
  }

  fs.mkdirSync(path.join(opts.out, 'thumbs'), { recursive: true });
  const resultsPath = path.join(opts.out, 'results.json');
  const results = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, 'utf8')) : {};
  const saveResults = () => fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  // cells to run
  const cells = [];
  for (const s of styles) for (const p of photos) {
    const png = path.join(opts.out, s.id, `${stem(p)}.png`);
    if (!opts.force && fs.existsSync(png)) continue;
    cells.push({ s, p, png });
  }
  const est = (cells.length * COST[opts.size]).toFixed(2);
  console.log(`\n  ${styles.length} styles × ${photos.length} photos = ${styles.length * photos.length} cells; ${cells.length} to run at ${opts.size} (≈ £${est}), model ${opts.model}\n`);
  if (opts.dryRun) {
    for (const c of cells) console.log(`  ${c.s.id.padEnd(18)} ${stem(c.p)}`);
    console.log();
    return;
  }
  if (!process.env.GOOGLE_AI_API_KEY) {
    console.error('  GOOGLE_AI_API_KEY is not set. Put it in .env at the repo root.\n');
    process.exit(1);
  }

  // originals for the sheet
  for (const p of photos) {
    const t = path.join(opts.out, 'thumbs', `${stem(p)}.jpg`);
    if (!fs.existsSync(t)) await sharp(p).rotate().resize(800, 800, { fit: 'cover' }).jpeg({ quality: 85 }).toFile(t);
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GOOGLE_AI_API_KEY,
    // pin to Google directly so a team-level AI gateway can't intercept the call
    httpOptions: { baseUrl: 'https://generativelanguage.googleapis.com' },
  });

  const log = path.join(opts.out, 'log.jsonl');
  const refCache = new Map();
  let failed = 0;
  let i = 0;
  for (const { s, p, png } of cells) {
    i++;
    const key = `${s.id}/${stem(p)}`;
    const row = { key, style: s.id, photo: path.basename(p), model: opts.model, size: opts.size, refs: s.refCount, ms: null, width: null, height: null, ok: false, error: null, png: null, thumb: null, at: new Date().toISOString() };
    process.stdout.write(`→ [${i}/${cells.length}] ${s.id.padEnd(18)} ${stem(p).padEnd(12)} … `);
    const t0 = Date.now();
    try {
      if (!refCache.has(s.id)) refCache.set(s.id, s.refs.map(readPart));
      const buffer = await callGemini(ai, {
        model: opts.model,
        size: opts.size,
        refParts: refCache.get(s.id),
        photoPart: readPart(p),
        prompt: `${PREAMBLE}\n\n${s.prompt}`,
      });
      row.ms = Date.now() - t0;
      fs.mkdirSync(path.dirname(png), { recursive: true });
      fs.writeFileSync(png, buffer);
      const meta = await sharp(buffer).metadata();
      row.width = meta.width; row.height = meta.height;
      const thumb = png.replace(/\.png$/, '.thumb.jpg');
      await sharp(buffer).resize(800, 800, { fit: 'inside' }).jpeg({ quality: 85 }).toFile(thumb);
      row.png = png; row.thumb = thumb; row.ok = true;
      console.log(`${row.ms} ms  ${row.width}×${row.height}`);
    } catch (err) {
      row.ms = Date.now() - t0;
      row.error = err instanceof StyleError ? err.describe() : err.message;
      failed++;
      console.log(`FAILED — ${row.error}`);
    }
    results[key] = row;
    saveResults();
    fs.appendFileSync(log, JSON.stringify(row) + '\n');
  }

  writeSheet(opts.out, allStyles, photos, results, opts);

  // summary
  console.log('\n  style               styled   median ms');
  console.log('  ------------------  -------  ---------');
  for (const s of styles) {
    const rows = photos.map((p) => results[`${s.id}/${stem(p)}`]).filter(Boolean);
    const ok = rows.filter((r) => r.ok);
    const times = ok.map((r) => r.ms).sort((a, b) => a - b);
    const med = times.length ? times[Math.floor(times.length / 2)] : '—';
    console.log(`  ${s.id.padEnd(18)}  ${String(ok.length).padStart(2)}/${photos.length}     ${String(med).padStart(9)}`);
  }
  for (const s of styles) for (const p of photos) {
    const r = results[`${s.id}/${stem(p)}`];
    if (r && !r.ok) console.log(`  ! ${r.key}: ${r.error}`);
  }
  console.log(`\n  Sheet: ${path.join(opts.out, 'contact-sheet.html')}\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  Harness failed:', err.message, '\n');
  process.exit(1);
});
