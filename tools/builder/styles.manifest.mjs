// Pixel8 personalisation — style manifest for the style-test harness.
//
// Usage:
//   node tools/builder/style-test.mjs            # all styles, all photos
//   node tools/builder/style-test.mjs --style tim-burton
//   node tools/builder/style-test.mjs --dry-run
//
// The harness sends every image in refsDir (4096px catalogue masters — never
// lifestyle mockups) + the photo + PREAMBLE + style.prompt, and writes
// style-tests/<style.id>/<photo>.png plus contact-sheet.html.
//
// Ref selection rules (pulled from the catalogue masters):
//   1. Human subjects only. No cartoon characters — character refs pull the
//      model toward drawing the character, not the customer.
//   2. Different faces, mixed gender, at least one non-front-facing pose.
//   3. Avoid subjects with a signature prop or costume that could leak in.
//   4. Avoid any ref with lettering baked in, and never a lifestyle mockup.
//
// Pass gate per style: >= 4 of 5 photos where a friend would recognise every
// person unprompted. Below that, the style is out of v1.

export const PREAMBLE = `Transform the uploaded photograph into a finished square wall-art illustration in the style described below and shown in the reference images.

Identity is non-negotiable: keep every person's facial identity, features, expression, hairstyle, skin tone, body shape, pose and clothing recognisable — a friend must instantly recognise them. Change only the rendering technique, palette, line quality and finish. Do not add, remove, age, slim or idealise anyone.

Composition: fill the full square frame with the subject(s) as the focal point. Keep every subject fully in frame — no cropped heads or hands. Simplify the photo's background into the style; do not invent a busy new scene.

No text, lettering, logos, signatures, watermarks, borders or frames.

Output the artwork itself, filling the frame edge to edge — never a photograph of a print, canvas, frame, wall or room containing it, and never a mockup.

Match the technique of the reference images as closely as possible while taking the people, pose and clothing only from the photograph.`;

export const STYLES = [
  {
    id: "banksy",
    letter: null,
    label: "Stencil street art",
    refsDir: "refs/banksy",
    prompt: `Style: hand-cut spray-paint stencil street art. Flat, high-contrast black and white built from hard-edged stencil shapes, with slightly rough sprayed edges and faint overspray. Render the subject in two or three tonal layers so the facial features read clearly through the shadow shapes. Exactly one spot-colour accent (a single item of clothing or one object). Background: pale distressed concrete or painted brick, kept minimal. Gritty, urban, deadpan.`,
  },
  {
    id: "dr-seuss",
    letter: null,
    label: "Whimsical picture-book",
    refsDir: "refs/dr-seuss",
    prompt: `Style: whimsical rhyming-picture-book cartoon. Every surface filled with flat, saturated colour — no bare paper, no pencil-sketch look, and a fully coloured background rather than cream: bold tomato red, sunflower yellow, turquoise, sky blue, pink and grass green. Loose, confident, slightly wobbly ink outlines. Exaggerated curvy shapes everywhere — tall wavy trees with tufted pom-pom tops, swooping tilted buildings and furniture, curly striped patterns, bendy limbs, tufted or swirled hair. Round cheerful eyes. Playful and absurd in the surroundings, while the faces stay clearly the same people with only gentle cartoon exaggeration.`,
  },
  {
    id: "josh-agle",
    letter: null,
    label: "Mid-century lounge",
    refsDir: "refs/josh-agle",
    prompt: `Style: mid-century modern retro illustration. Crisp flat vector-like shapes, no gradients, no visible brushwork. Stylised angular figures with tapered limbs, long necks and slightly small heads; cocktail-lounge or tiki-bar atmosphere. Limited palette of muted orange, olive, turquoise, mustard and charcoal on a warm flat background with geometric 1960s décor elements. Cool, sophisticated, tongue-in-cheek. Keep the faces readable despite the stylised proportions.`,
  },
  {
    id: "roy-lichtenstein",
    letter: null,
    label: "Comic-book pop art",
    refsDir: "refs/roy-lichtenstein",
    prompt: `Style: 1960s comic-book pop art. Heavy uniform black outlines, flat primary colours (red, yellow, blue) plus white and black, and large, clearly visible Ben-Day dot screens for skin tones and shading. Bold, graphic, one dramatic frozen moment; features simplified but faithful. Flat background — a solid block or a dot field. No speech balloons, captions or lettering.`,
  },
  {
    id: "frank-miller",
    letter: null,
    label: "Noir graphic novel",
    refsDir: "refs/frank-miller",
    prompt: `Style: high-contrast noir graphic-novel ink art. Stark black ink shapes against white with hard-edged shadows, almost no mid-tones, dramatic under- or side-lighting, rain-streak and splattered-ink texture. Optional single red or yellow accent. Gritty, cinematic chiaroscuro. The faces are carved out of the shadow shapes — make sure enough of each face is lit that it stays recognisable.`,
  },
  {
    id: "jeff-soto",
    letter: null,
    label: "Surreal graffiti-pop",
    refsDir: "refs/jeff-soto",
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
    id: "tim-burton",
    letter: null,
    label: "Gothic stop-motion",
    refsDir: "refs/tim-burton",
    prompt: `Style: gothic stop-motion animation character design. Pale skin, large expressive eyes with dark shadowed rings, slender elongated proportions, wild spiky or wispy hair. Keep each person's actual outfit from the photograph, restyled with stripes and quirky patched details — do not swap clothing for costumes. Muted palette of greys, deep blues and purples with a hint of moonlight; a twisted tree or crooked skyline behind. Spooky-cute and Halloween-friendly, never gory or frightening — and unmistakably the same person, same hairstyle, same expression.`,
  },
];
