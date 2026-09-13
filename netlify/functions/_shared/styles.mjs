// netlify/functions/_shared/styles.mjs
//
// The PRIVATE half of the "Your Photo" styles. Prompts, reference images and
// the Gemini call live here and only here â€” never in Sanity (the dataset is
// publicly readable) and never in anything shipped to the browser.
//
// Each entry is keyed by the shop's public style key (style-a â€¦ style-j) so the
// builder, the Sanity personalisationStyle docs and the catalogue all speak the
// same language. The `slug` is the internal folder name used for refs; it
// must never appear in a response.
//
// Refs are bundled with the function from _shared/refs/<slug>/ (1024px JPEGs
// produced by tools/builder/prepare-refs.mjs) â€” add them to
// [functions] included_files in netlify.toml.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

export const DEFAULT_MODEL = process.env.STYLE_MODEL || 'gemini-3-pro-image-preview';
export const PREVIEW_SIZE = '2K';

// â”€â”€ Public labels (mirror studio/schemas/product.ts) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const STYLE_META = {
  'style-a': { letter: 'A', label: 'Stencil' },
  'style-b': { letter: 'B', label: 'Picture Book' },
  'style-c': { letter: 'C', label: 'Gothic' },
  'style-d': { letter: 'D', label: 'Noir' },
  'style-e': { letter: 'E', label: 'Surreal' },
  'style-f': { letter: 'F', label: 'Lounge' },
  'style-g': { letter: 'G', label: 'Psychedelic' },
  'style-h': { letter: 'H', label: 'Pop Art' },
  'style-i': { letter: 'I', label: 'Geometric' },
  'style-j': { letter: 'J', label: 'Street Art' },
};

// â”€â”€ Shared preamble â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export const PREAMBLE = `Transform the uploaded photograph into a finished square wall-art illustration in the style described below and shown in the reference images.

Identity is non-negotiable: keep every person's facial identity, features, expression, hairstyle, skin tone, body shape, pose and clothing recognisable â€” a friend must instantly recognise them. Change only the rendering technique, palette, line quality and finish. Do not add, remove, age, slim or idealise anyone.

Composition: fill the full square frame with the subject(s) as the focal point. Keep every subject fully in frame â€” no cropped heads or hands. Simplify the photo's background into the style; do not invent a busy new scene.

No text, lettering, logos, signatures, watermarks, borders or frames.

Output the artwork itself, filling the frame edge to edge â€” never a photograph of a print, canvas, frame, wall or room containing it, and never a mockup.

Match the technique of the reference images as closely as possible while taking the people, pose and clothing only from the photograph.`;

// â”€â”€ Private style table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// TODO(alan): set `styleKey` on each entry to the shop Option letter it
// corresponds to. The module refuses to load while any are null or duplicated.
const PRIVATE_STYLES = [
  {
    slug: 'banksy',
    styleKey: 'style-a',
    prompt: `Style: hand-cut spray-paint stencil street art. Flat, high-contrast black and white built from hard-edged stencil shapes, with slightly rough sprayed edges and faint overspray. Render the subject in two or three tonal layers so the facial features read clearly through the shadow shapes. Exactly one spot-colour accent (a single item of clothing or one object). Background: pale distressed concrete or painted brick, kept minimal. Gritty, urban, deadpan.`,
  },
  {
    slug: 'dr-seuss',
    styleKey: 'style-b',
    prompt: `Style: whimsical rhyming-picture-book cartoon. Every surface filled with flat, saturated colour â€” no bare paper, no pencil-sketch look, and a fully coloured background rather than cream: bold tomato red, sunflower yellow, turquoise, sky blue, pink and grass green. Loose, confident, slightly wobbly ink outlines. Exaggerated curvy shapes everywhere â€” tall wavy trees with tufted pom-pom tops, swooping tilted buildings and furniture, curly striped patterns, bendy limbs, tufted or swirled hair. Round cheerful eyes. Playful and absurd in the surroundings, while the faces stay clearly the same people with only gentle cartoon exaggeration.`,
  },
  {
    slug: 'josh-agle',
    styleKey: 'style-f',
    prompt: `Style: mid-century modern retro illustration. Crisp flat vector-like shapes, no gradients, no visible brushwork. Stylised angular figures with tapered limbs, long necks and slightly small heads; cocktail-lounge or tiki-bar atmosphere. Limited palette of muted orange, olive, turquoise, mustard and charcoal on a warm flat background with geometric 1960s dÃ©cor elements. Cool, sophisticated, tongue-in-cheek. Keep the faces readable despite the stylised proportions.`,
  },
  {
    slug: 'roy-lichtenstein',
    styleKey: 'style-h',
    prompt: `Style: 1960s comic-book pop art. Heavy uniform black outlines, flat primary colours (red, yellow, blue) plus white and black, and large, clearly visible Ben-Day dot screens for skin tones and shading. Bold, graphic, one dramatic frozen moment; features simplified but faithful. Flat background â€” a solid block or a dot field. No speech balloons, captions or lettering.`,
  },
  {
    slug: 'frank-miller',
    styleKey: 'style-d',
    prompt: `Style: high-contrast noir graphic-novel ink art. Stark black ink shapes against white with hard-edged shadows, almost no mid-tones, dramatic under- or side-lighting, rain-streak and splattered-ink texture. Optional single red or yellow accent. Gritty, cinematic chiaroscuro. The faces are carved out of the shadow shapes â€” make sure enough of each face is lit that it stays recognisable.`,
  },
  {
    slug: 'jeff-soto',
    styleKey: 'style-e',
    prompt: `Style: surreal contemporary street-art painting. Rich saturated colours with smooth airbrushed gradients, glossy stylised forms and thick dark outlines. Swirling organic motifs â€” flowers, leaves, smoke, geometric fragments, small robots or creatures â€” woven around and behind the subject without covering the faces. Dreamlike, painted acrylic finish with a slight gloss.`,
  },
  {
    slug: 'psychedelic',
    styleKey: 'style-g',
    prompt: `Style: late-1960s psychedelic poster cartoon. Flowing, melting, swirling line-work; kaleidoscopic rainbow colour bands, flowers and paisley motifs; wavy optical distortion in the background and clothing only â€” faces rendered clearly and undistorted. Bold outlines, flat vivid colours, groovy energy.`,
  },
  {
    slug: 'tim-burton',
    styleKey: 'style-c',
    prompt: `Style: gothic stop-motion animation character design. Pale skin, large expressive eyes with dark shadowed rings, slender elongated proportions, wild spiky or wispy hair. Keep each person's actual outfit from the photograph, restyled with stripes and quirky patched details â€” do not swap clothing for costumes. Muted palette of greys, deep blues and purples with a hint of moonlight; a twisted tree or crooked skyline behind. Spooky-cute and Halloween-friendly, never gory or frightening â€” and unmistakably the same person, same hairstyle, same expression.`,
  },
];

// Validate the mapping once at load.
{
  const keys = PRIVATE_STYLES.map((s) => s.styleKey);
  const missing = PRIVATE_STYLES.filter((s) => !s.styleKey).map((s) => s.slug);
  const dupes = keys.filter((k, i) => k && keys.indexOf(k) !== i);
  const unknown = keys.filter((k) => k && !STYLE_META[k]);
  if (missing.length || dupes.length || unknown.length) {
    throw new Error(
      `styles.mjs: styleKey mapping incomplete â€” missing: [${missing}] duplicate: [${dupes}] unknown: [${unknown}]`,
    );
  }
}

const BY_KEY = new Map(PRIVATE_STYLES.map((s) => [s.styleKey, s]));

/** Style keys the builder may offer, in shop-letter order. */
export const STYLE_KEYS = [...BY_KEY.keys()].sort();

export function isStyleKey(key) {
  return BY_KEY.has(key);
}

/** Public shape only â€” safe to return to the browser. */
export function listPublicStyles() {
  return STYLE_KEYS.map((key) => ({ key, ...STYLE_META[key] }));
}

// â”€â”€ Refs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REF_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function refsDirCandidates(slug) {
  return [
    fileURLToPath(new URL(`./refs/${slug}/`, import.meta.url)),
    path.join(process.cwd(), 'netlify', 'functions', '_shared', 'refs', slug),
  ];
}

const refCache = new Map();

/** Load a style's bundled reference images as Gemini inline parts (cached per invocation). */
export function loadRefParts(styleKey) {
  if (refCache.has(styleKey)) return refCache.get(styleKey);
  const { slug } = BY_KEY.get(styleKey);
  const dir = refsDirCandidates(slug).find((d) => fs.existsSync(d));
  if (!dir) throw new Error(`styles.mjs: no refs dir for ${styleKey} (looked in ${refsDirCandidates(slug).join(', ')})`);
  const parts = fs
    .readdirSync(dir)
    .filter((f) => REF_MIME[path.extname(f).toLowerCase()])
    .sort()
    .map((f) => ({
      inlineData: {
        mimeType: REF_MIME[path.extname(f).toLowerCase()],
        data: fs.readFileSync(path.join(dir, f)).toString('base64'),
      },
    }));
  if (!parts.length) throw new Error(`styles.mjs: refs dir for ${styleKey} is empty`);
  refCache.set(styleKey, parts);
  return parts;
}

// â”€â”€ Gemini â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export class StyleError extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.name = 'StyleError';
    Object.assign(this, extra);
  }
  /** True when Google refused the *input* â€” typically a recognisable person or protected image. */
  get isInputBlocked() {
    return this.blockReason != null;
  }
  /** True when a plain retry is worth it (rate limit, transient, or output filter noise). */
  get isRetryable() {
    return this.status === 429 || (this.status >= 500 && this.status < 600) || this.finishReason === 'IMAGE_OTHER';
  }
  describe() {
    return [
      this.message,
      this.finishReason && `finishReason=${this.finishReason}`,
      this.blockReason && `blockReason=${this.blockReason}`,
      this.status && `status=${this.status}`,
      this.modelText && `model said: ${this.modelText.slice(0, 200)}`,
    ]
      .filter(Boolean)
      .join(' | ');
  }
}

let aiClient;
function ai() {
  if (!aiClient) {
    if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not set');
    aiClient = new GoogleGenAI({
      apiKey: process.env.GOOGLE_AI_API_KEY,
      // Pin to Google directly so a team-level AI gateway can't intercept the call.
      httpOptions: { baseUrl: 'https://generativelanguage.googleapis.com' },
    });
  }
  return aiClient;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Style one square photo.
 *
 * @param {object} opts
 * @param {string} opts.styleKey   public style key (style-a â€¦)
 * @param {Buffer} opts.buffer     the cropped square photo
 * @param {string} opts.mimeType   image/jpeg | image/png | image/webp
 * @param {'1K'|'2K'|'4K'} [opts.size]
 * @param {string} [opts.model]
 * @returns {Promise<{buffer: Buffer, mimeType: string, model: string, ms: number}>}
 */
export async function styleImage({ styleKey, buffer, mimeType, size = PREVIEW_SIZE, model = DEFAULT_MODEL }) {
  if (!isStyleKey(styleKey)) throw new StyleError(`Unknown style ${styleKey}`, { status: 400 });
  const style = BY_KEY.get(styleKey);
  const request = {
    model,
    contents: [{
      role: 'user',
      parts: [
        ...loadRefParts(styleKey),
        { inlineData: { mimeType, data: buffer.toString('base64') } },
        { text: `${PREAMBLE}\n\n${style.prompt}` },
      ],
    }],
    config: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: size } },
  };

  const t0 = Date.now();
  let res;
  for (let attempt = 0; ; attempt++) {
    try {
      res = await ai().models.generateContent(request);
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
  return {
    buffer: Buffer.from(img.inlineData.data, 'base64'),
    mimeType: img.inlineData.mimeType || 'image/png',
    model,
    ms: Date.now() - t0,
  };
}
