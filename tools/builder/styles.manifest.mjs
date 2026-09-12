// Pixel8 personalisation — style manifest for the style-test harness.
//
// Usage (port of CSC scripts/style-test.mjs, looping over styles):
//   node scripts/style-test.mjs --manifest styles.manifest.mjs \
//     --photos test-photos/ --out style-tests/ --size 2K
//
// Expected harness changes vs CSC:
//   - loop STYLES x photos, output style-tests/<style.id>/<photo>.png
//   - prompt = PREAMBLE + "\n\n" + style.prompt
//   - refs resolved from style.refsDir (3 images, 4096px catalogue masters)
//   - write style-tests/contact-sheet.html: one row per style, one column per
//     photo, original photo in column 0, so likeness can be judged side by side
//
// Budget: 8 styles x 5 photos = 40 calls at 2K ≈ £4.
//
// Test photos (same five as CSC): solo portrait, couple, family of four,
// group of six, action/full-body. Front-facing, decent light.
//
// Ref selection rules (three per style, pulled from pixel8-upscaled/<letter>/):
//   1. Human subjects only (music / sport categories). No cartoon characters —
//      character refs pull the model toward drawing the character, not the customer.
//   2. Three DIFFERENT faces, mixed gender, at least one non-front-facing pose,
//      so no single face dominates the style signal.
//   3. Avoid subjects with a signature prop or costume that could leak in
//      (guitars, kits, capes). Head-and-shoulders or clean full-body preferred.
//   4. Avoid any ref with lettering baked into the artwork.
//
// Pass gate per style: >= 4 of 5 photos where a friend would recognise every
// person unprompted. Below that, the style is out of v1 — same rule that
// retired the LoRA route on CSC.
//
// Highest likeness risk (proportions change most): seuss, lounge, gothic.
// Watch those first.

export const PREAMBLE = `Transform the uploaded photograph into a finished square wall-art illustration in the style described below and shown in the three reference images.

Identity is non-negotiable: keep every person's facial identity, features, expression, hairstyle, skin tone, body shape, pose and clothing recognisable — a friend must instantly recognise them. Change only the rendering technique, palette, line quality and finish. Do not add, remove, age, slim or idealise anyone.

Composition: fill the full square frame with the subject(s) as the focal point. Keep every subject fully in frame — no cropped heads or hands. Simplify the photo's background into the style; do not invent a busy new scene.

No text, lettering, logos, signatures, watermarks, borders or frames.

Match the technique of the reference images as closely as possible while taking the people, pose and clothing only from the photograph.`;

export const STYLES = [
  {
    id: "stencil",
    letter: null, // catalogue Option letter — fill in
    label: "Stencil street art",
    refsDir: "refs/stencil",
    prompt: `Style: hand-cut spray-paint stencil street art. Flat, high-contrast black and white built from hard-edged stencil shapes, with slightly rough sprayed edges and faint overspray. Render the subject in two or three tonal layers so the facial features read clearly through the shadow shapes. Exactly one spot-colour accent (a single item of clothing or one object). Background: pale distressed concrete or painted brick, kept minimal. Gritty, urban, deadpan.`,
  },
  {
    id: "seuss",
    letter: null,
    label: "Whimsical picture-book",
    refsDir: "refs/seuss",
    prompt: `Style: whimsical children's picture-book illustration. Loose, wobbly ink outlines; exaggerated, elongated and curly shapes; tufted hair, droopy or wavy forms, bendy limbs and bendy furniture. Flat limited palette of a few bold colours (mustard, tomato red, teal, sky blue) on a cream ground with visible pen texture. Playful and slightly absurd — but the faces stay clearly the same people, with only gentle exaggeration.`,
  },
  {
    id: "lounge",
    letter: null,
    label: "Mid-century lounge",
    refsDir: "refs/lounge",
    prompt: `Style: mid-century modern retro illustration. Crisp flat vector-like shapes, no gradients, no visible brushwork. Stylised angular figures with tapered limbs, long necks and slightly small heads; cocktail-lounge or tiki-bar atmosphere. Limited palette of muted orange, olive, turquoise, mustard and charcoal on a warm flat background with geometric 1960s décor elements. Cool, sophisticated, tongue-in-cheek. Keep the faces readable despite the stylised proportions.`,
  },
  {
    id: "popdots",
    letter: null,
    label: "Comic-book pop art",
    refsDir: "refs/popdots",
    prompt: `Style: 1960s comic-book pop art. Heavy uniform black outlines, flat primary colours (red, yellow, blue) plus white and black, and large, clearly visible Ben-Day dot screens for skin tones and shading. Bold, graphic, one dramatic frozen moment; features simplified but faithful. Flat background — a solid block or a dot field. No speech balloons, captions or lettering.`,
  },
  {
    id: "noir",
    letter: null,
    label: "Noir graphic novel",
    refsDir: "refs/noir",
    prompt: `Style: high-contrast noir graphic-novel ink art. Stark black ink shapes against white with hard-edged shadows, almost no mid-tones, dramatic under- or side-lighting, rain-streak and splattered-ink texture. Optional single red or yellow accent. Gritty, cinematic chiaroscuro. The faces are carved out of the shadow shapes — make sure enough of each face is lit that it stays recognisable.`,
  },
  {
    id: "surreal",
    letter: null,
    label: "Surreal graffiti-pop",
    refsDir: "refs/surreal",
    prompt: `Style: surreal contemporary street-art painting. Rich saturated colours with smooth airbrushed gradients, glossy stylised forms and thick dark outlines. Swirling organic motifs — flowers, leaves, smoke, geometric fragments, small robots or creatures — woven around and behind the subject without covering the faces. Dreamlike, painted acrylic finish with a slight gloss.`,
  },
  {
    id: "psychedelic",
    letter: null,
    label: "Psychedelic cartoon",
    refsDir: "refs/psychedelic",
    prompt: `Style: late-1960s psychedelic poster cartoon. Flowing, melting, swirling line-work; kaleidoscopic rainbow colour bands, flowers and paisley motifs; wavy optical distortion in the background and clothing only — faces rendered clearly and undistorted. Bold outlines, flat vivid colours, groovy energy.`,
  },
  {
    id: "gothic",
    letter: null,
    label: "Gothic stop-motion",
    refsDir: "refs/gothic",
    prompt: `Style: gothic stop-motion animation character design. Pale skin, large expressive eyes with dark shadowed rings, slender elongated proportions, wild spiky or wispy hair, stripes and stitched or tattered details on clothing. Muted palette of greys, deep blues and purples with a hint of moonlight; a twisted tree or crooked skyline behind. Whimsically macabre — but unmistakably the same person, same hairstyle, same expression.`,
  },
];
