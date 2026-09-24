/**
 * Bring the FAQs into line with the Your Photo builder.
 *
 *   node tools/builder/seed-faqs.mjs --dry-run
 *   node tools/builder/seed-faqs.mjs
 *
 * Three jobs:
 *
 *   1. Add six new FAQs about the self-serve builder.
 *   2. Update three existing answers that are now incomplete or wrong —
 *      "What products do you offer?", "Can I order a custom piece?" and the
 *      returns policy, which currently says commissions can't be returned
 *      "once we've started work" and doesn't mention the proof step at all.
 *   3. Renumber displayOrder 1-12 so the homepage's top eight covers what the
 *      site actually sells, rather than four shipping questions in a row.
 *
 * The homepage shows *[_type == "faq"] | order(displayOrder asc)[0...8], so
 * the first eight below are what appears there. Everything else still shows
 * on /faqs, grouped by category.
 *
 * Existing FAQs are matched by question text, so this is safe to re-run.
 * Needs SANITY_TOKEN in .env.
 */
import 'dotenv/config';
import { createClient } from '@sanity/client';

const dryRun = process.argv.includes('--dry-run');

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// ── 1. New FAQs ─────────────────────────────────────────────────────────────
const NEW = [
  {
    _id: 'faq-yourphoto-what',
    displayOrder: 3,
    category: 'ordering',
    question: 'Can I turn my own photo into wall art?',
    answer: `Yes — that's our Your Photo, Your Style tool, and you can do it yourself in about a minute.

Upload a photo, crop it square, and pick one of eight house styles. We redraw your photo in that style and show you the result straight away. Try up to four styles, compare them side by side, then choose a poster or canvas in the same sizes as everything else in the shop.

Prices start at £14.99, which includes a £5 personalisation fee. Once you've paid we email you a proof — nothing is printed until you approve it.`,
  },
  {
    _id: 'faq-yourphoto-photo',
    displayOrder: 4,
    category: 'ordering',
    question: 'What kind of photo works best?',
    answer: `The clearer the photo, the better the result:

• Good light, in focus, faces clearly visible
• Facing the camera, or a three-quarter angle
• One person works best, but couples, families and groups all work well
• Phone photos are fine — no need for anything professional

Avoid heavy shadows across faces, very small or blurry images, and shots where people are far away in frame. Our square crop tool lets you zoom and position before you commit, so you can cut a group down to the people you want.`,
  },
  {
    _id: 'faq-yourphoto-cost',
    displayOrder: 71,
    category: 'product-info',
    question: 'How much does a personalised photo print cost?',
    answer: `The same as our standard wall art plus a £5 personalisation fee, which covers creating your design. Prices start at £14.99 for a 12×12" poster, and canvas and larger sizes are priced as they are everywhere else in the shop.

Trying different styles costs you nothing — you only pay when you add a design to your cart. If you cancel before approving your proof, the fee is refunded with the rest of the order.`,
  },
  {
    _id: 'faq-yourphoto-quality',
    displayOrder: 72,
    category: 'product-info',
    question: 'Will my photo be sharp enough to print?',
    answer: `Almost certainly. The preview you see on screen is deliberately lower resolution and watermarked; the design we print from is a much larger file, prepared at print resolution for the size you chose.

The main thing that affects the result is the photo you start with. A small, blurry or heavily cropped image gives the model less to work with, and no amount of processing fully makes up for that. If you're unsure, use the largest original you have rather than one saved from social media.

You'll see a proof before anything is printed, so you can judge the result yourself.`,
  },
  {
    _id: 'faq-yourphoto-refused',
    displayOrder: 73,
    category: 'product-info',
    question: 'Why was my photo refused?',
    answer: `Our image provider automatically refuses photos of well-known people, stills from films and television, and other copyrighted images. It's an automatic safety check, and we can't override it.

If your photo is refused you haven't been charged, and you're welcome to try a different one. The tool is designed for your own photos — you, your family, your friends, your pets.`,
  },
  {
    _id: 'faq-yourphoto-privacy',
    displayOrder: 74,
    category: 'product-info',
    question: 'What happens to my photo after I upload it?',
    answer: `Your photo is sent to Google's Gemini image model, which creates your design. That happens only after you tick the consent box, and only for the design you asked for.

If you don't place an order, your photo and every design made from it are deleted automatically after 48 hours. If you do order, we keep them while we make and send your print and for 90 days afterwards in case there's a problem, then delete them automatically.

We don't use your photo to train any AI model, we don't use facial recognition, and we never share it beyond the providers involved in making your order. Full detail is in our <a href="/privacy-policy#your-photo">privacy policy</a>.`,
  },
];

// ── 2. Existing answers that are now incomplete ─────────────────────────────
const UPDATES = [
  {
    match: 'What products do you offer?',
    displayOrder: 1,
    answer: `At Pixel8, we create premium wall art inspired by pop culture, music, film, sport, and modern design. Each piece is made to order and available as a poster print or a canvas, in three square sizes.

There are three ways to buy:

• **Our designs** — over a thousand artworks in the shop, each available in ten design options.
• **Your photo** — upload your own photo and we'll redraw it in one of eight house styles, ready in about a minute.
• **Commissions** — bespoke pieces made to brief, from photo restoration to animated shorts.`,
  },
  {
    match: 'Can I order a custom piece?',
    displayOrder: 6,
    answer: `Yes, in two different ways.

**Your Photo, Your Style** is self-serve. Upload a photo, pick a style, and see the result in about a minute. No brief, no waiting, from £14.99.

**Commissions** are for anything more involved — photo restoration, scene recreations, life-story timelines, song writing and animated shorts. You send us a brief and we make the piece by hand. These take longer and are priced per service.

If you just want a photo of someone turned into artwork, start with Your Photo. If you have something specific in mind that needs a person's judgement, a commission is the right route.`,
  },
  {
    match: 'What is your returns policy?',
    displayOrder: 11,
    answer: `We offer a 14-day returns policy on all standard products. Items must be returned in their original packaging, unused and undamaged.

Personalised items — anything made from a photo you supply — can't be returned once printed, because they're made specifically for you. That's exactly why we email you a proof first: nothing goes to print until you approve it, and you can cancel free of charge at any point before you do.

If anything arrives damaged, faulty, or different from the proof you approved, contact us within 30 days and we'll replace it or refund you in full. That applies to personalised items too.`,
  },
];

// ── 3. Renumbering so the homepage top eight is the right eight ─────────────
const REORDER = [
  ['What art styles do you offer?', 2],
  ['How do I place an order?', 5],
  ['How long does delivery take?', 7],
  ['Do you offer free shipping?', 8],
  ['Do you ship internationally?', 9],
  ['How are orders packaged?', 10],
  ['What if my order arrives damaged?', 12],
];

// ── Run ─────────────────────────────────────────────────────────────────────
async function idFor(question) {
  const docs = await sanity.fetch(`*[_type == "faq" && question == $q][0]{_id, displayOrder}`, { q: question });
  return docs || null;
}

console.log(`\n  FAQ update${dryRun ? ' (dry run)' : ''}\n`);

if (!dryRun && !process.env.SANITY_TOKEN) {
  console.error('  SANITY_TOKEN is not set.\n');
  process.exit(1);
}

console.log('  New FAQs');
for (const f of NEW) {
  console.log(`    [${String(f.displayOrder).padStart(2)}] ${f.question}`);
  if (dryRun) continue;
  await sanity.createOrReplace({ _type: 'faq', ...f });
}

console.log('\n  Updated answers');
for (const u of UPDATES) {
  const doc = await idFor(u.match);
  if (!doc) { console.warn(`    ! not found: "${u.match}"`); continue; }
  console.log(`    [${String(u.displayOrder).padStart(2)}] ${u.match}`);
  if (dryRun) continue;
  await sanity.patch(doc._id).set({ answer: u.answer, displayOrder: u.displayOrder }).commit();
}

console.log('\n  Renumbered');
for (const [question, order] of REORDER) {
  const doc = await idFor(question);
  if (!doc) { console.warn(`    ! not found: "${question}"`); continue; }
  console.log(`    [${String(order).padStart(2)}] ${question}  (was ${doc.displayOrder})`);
  if (dryRun) continue;
  await sanity.patch(doc._id).set({ displayOrder: order }).commit();
}

if (!dryRun) {
  const homepage = await sanity.fetch(`*[_type == "faq"] | order(displayOrder asc)[0...8]{question, displayOrder, category}`);
  console.log('\n  Homepage will now show:');
  homepage.forEach((f, i) => console.log(`    ${i + 1}. [${f.displayOrder}] (${f.category}) ${f.question}`));
}

console.log(dryRun ? '\n  Nothing written.\n' : '\n  Done — rebuild the site to see the changes.\n');
