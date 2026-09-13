# Your Photo builder — Phase 1 (data model + server-side styles)

Unzip at the repo root on `feat/personalisation-builder`. Paths are relative to
`C:\Users\chris\Projects\pixel8`.

| File | Purpose |
|---|---|
| `studio/schemas/personalisationStyle.ts` | Public style docs (label, letter, examples, active). No prompts, no artist names. |
| `studio/schemas/pendingPersonalisation.ts` | One customer session: blob keys, status, renders tried, consent, order link, proof/approval. |
| `netlify/functions/_shared/styles.mjs` | Private: prompts, refs loader, Gemini call. **Needs the letter mapping.** |
| `tools/builder/prepare-refs.mjs` | 4096px harness refs → 1024px JPEGs in `netlify/functions/_shared/refs/<slug>/`. |
| `tools/builder/seed-styles.mjs` | Creates the eight `personalisationStyle` docs. |

## 1. Fill the mapping (blocks everything else)

In `netlify/functions/_shared/styles.mjs`, set `styleKey` on each of the eight
entries to the shop Option key (`style-a` … `style-j`) that style corresponds
to. The module throws at load until all eight are set, unique and valid — the
seed script and any function importing it will refuse to run, on purpose.

Two of the ten letters will be unused; that's fine — the builder offers only
the eight keys in the module.

## 2. Register the schemas

`studio/schemas/index.ts`:

```ts
import personalisationStyle from './personalisationStyle'
import pendingPersonalisation from './pendingPersonalisation'
// …
export const schemaTypes = [
  product, category, blogPost, faq, testimonial, order, commission, service,
  siteSettings, contactSubmission, newsletterSubscriber, grouponVoucher,
  personalisationStyle, pendingPersonalisation,
]
```

Deploy the studio as you normally do.

## 3. Bundle the refs

```powershell
node tools\builder\prepare-refs.mjs
```

Then in `netlify.toml`, so the JPEGs ship inside the functions:

```toml
[functions]
  included_files = ["netlify/functions/_shared/refs/**"]
```

The output folder is committed (unlike `tools/builder/refs`, which stays
ignored) — these are your own catalogue images, downsized.

Spot-check that 1024px refs still hit the same likeness as the 4096px run:
add `--refs netlify/functions/_shared/refs` support to the harness later, or
simply eyeball the first live previews. Gemini is not sensitive to ref
resolution at this size.

## 4. Seed the style documents

```powershell
node tools\builder\seed-styles.mjs --dry-run
node tools\builder\seed-styles.mjs
```

Creates `personalisationStyle.style-x` docs (id = key, so re-running updates
in place). Afterwards, in the Studio, add a one-line blurb and before/after
example images to each — the builder shows those on the style pills. Use the
harness outputs of the solo test photo for the "after" examples.

## 5. Environment (Netlify site env, not just `.env`)

| Var | Notes |
|---|---|
| `GOOGLE_AI_API_KEY` | The Pixel8 project key (gen-lang-client-0510645318). |
| `STYLE_MODEL` | Optional override; defaults to `gemini-3-pro-image-preview`. |
| `SANITY_TOKEN` | Already set (upload/commission functions use it). The new functions use this name, not `SANITY_WRITE_TOKEN`. |
| `PERSONALISATION_SALT` | Any long random string — used to hash IPs for the abuse cap. |

Also enable **Netlify Blobs** on the site (Site configuration → Blobs) and add
`@netlify/blobs` to the repo: `npm install @netlify/blobs`.

Local dev: Blobs need `netlify dev` rather than `astro dev` once the upload
function exists.

## 6. Cart / checkout / webhook changes (phase 3–4, but decide now)

These are small diffs to existing files; they're described here so the data
model is settled before the UI is built. Not included as files because the
edits are a few lines each in code you're actively changing.

### `src/stores/cart.ts`

```ts
export interface CartItem {
  // …existing fields…
  personalisationId?: string;   // pendingPersonalisation.pid
  styleKey?: string;            // style-x, for the cart line label
  personalisationFee?: number;  // 5 — folded into unitPrice, kept for display
}
```

In `addToCart`, never merge a personalised line:

```ts
const existing = item.personalisationId
  ? undefined
  : current.find((i) => !i.personalisationId && i.productId === item.productId && i.format === item.format && i.size === item.size);
```

and build the id as `${item.personalisationId ?? item.productId}-${item.format}-${item.size}-${Date.now()}`.

`unitPrice` for a personalised line = `PRICES[format][size] + personalisationFee`.

### `netlify/functions/checkout.mjs`

- Add `personalisationId` and `styleKey` to both `product_data.metadata` and
  `cartMeta`.
- **Stripe caps each metadata value at 500 characters.** `cartItems` as
  currently serialised overflows at roughly four lines even without the new
  fields. Slim it: drop `title`, `collection` and `unitPrice` from `cartMeta`
  (they're recoverable from the line items and Sanity) and keep
  `{ productId, format, size, quantity, personalisationId? }`, with short
  keys if needed (`p`, `f`, `s`, `q`, `pid`). The webhook reads the same shape.
- Before creating the session, validate every `personalisationId` against
  Sanity: status must be `ready`, `selectedStyleKey` set, and not expired.
  Reject the checkout otherwise — this is the server-side check that the
  customer actually generated what they're paying for.

### `netlify/functions/webhook.mjs`

- Write `personalisationId` and `styleKey` onto each order `lineItem`
  (add those two string fields to `order.ts` lineItems too).
- After the order doc is created, for each personalised line:
  `patch(pendingPersonalisation).set({ status: 'paid', order: {_type:'reference', _ref: orderId}, customerEmail, format, size, expiresAt: null })`.
  Clearing `expiresAt` is what stops the retention sweep from deleting a paid
  session's blobs.
- Fire the proof email from here (or a background function it triggers) —
  phase 4.

## 7. Blob layout (for the phase 2 functions)

```
personalisation/<pid>/original.<ext>      customer upload, as received
personalisation/<pid>/square.jpg          cropped square, what Gemini sees
personalisation/<pid>/<styleKey>.png      2K render, one per style tried
personalisation/<pid>/print.png           4K upscale of the approved render
```

Cache key for dedupe: `sha256(square.jpg) + styleKey` — the same photo in the
same style is served from the existing blob rather than re-generated.

## What phase 2 delivers

`personalisation-upload`, `personalisation-style-background`,
`personalisation-status`, `personalisation-image`, `personalisation-sweep`
(scheduled), and the caps: 16 calls per session, 3 style switches free,
per-IP daily cap, and a global daily spend guard that returns a friendly
"try again tomorrow" instead of a bill.
