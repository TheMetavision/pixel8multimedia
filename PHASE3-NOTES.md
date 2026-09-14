# Your Photo builder — Phase 3 (the customer-facing page)

Unzip at the repo root. **Four of these five files replace existing ones** —
they're full files built from the versions you sent me, with the changes
described below. Check `git diff` after unzipping.

| File | New? | What changed |
|---|---|---|
| `src/pages/store/your-photo.astro` | new | The builder page |
| `src/stores/cart.ts` | replaces | Three optional fields; personalised lines match on the personalisation id |
| `netlify/functions/checkout.mjs` | replaces | Per-line metadata instead of one blob; validates personalised lines; label maps fixed |
| `netlify/functions/webhook.mjs` | replaces | Rebuilds the cart from Stripe line items; marks personalisations paid; proof note in the email |
| `studio/schemas/order.ts` | replaces | Two fields on `lineItems` |

## 1. Install

```powershell
cd C:\Users\chris\Projects\pixel8
Expand-Archive "$env:USERPROFILE\Downloads\pixel8-phase3.zip" -DestinationPath . -Force
git diff --stat
cd studio; npx sanity deploy; cd ..
```

## 2. Link it up

The store listing filters `category == 'personalised'` out, and the homepage
"Personalised" tile currently points at `/services`. Point both at the builder:

- Homepage tile / nav: link to `/store/your-photo`.
- Optional: a card at the top of `/store` — the page is deliberately not a
  Sanity `product`, so it won't appear in the grid on its own.

Cartoonify Me under `/services` is untouched, as agreed.

## 3. What the page does

Upload → square crop (drag to position, slider or wheel to zoom, exported at
2048px) → the eight style pills → watermarked preview, about 40 seconds →
format, size, quantity → Add to Cart.

Details worth knowing:

- **Consent gates the upload.** The tick box must be ticked before the file
  dialog opens or a drop is accepted. Nothing leaves the browser before that.
- **The crop happens client-side**, so what's uploaded is a ~1 MB JPEG, well
  under the 5 MB cap and the platform's 6 MB request ceiling.
- **Styles already tried** get a tick and their own thumbnail on the pill, and
  switching back to one is instant and free (served from Blobs).
- **"Show original"** toggles between the customer's photo and the design.
- **"Redraw this style"** is the regenerate path (2 per style).
- **Caps** surface as a message, and the styles already generated stay usable —
  the customer is never left with a dead page.
- **A blocked upload** (celebrity, film still) clears the session and shows the
  "own photos only" copy, so they can start again with a different photo.
- Turnstile renders only if `PUBLIC_TURNSTILE_SITE_KEY` is set in the Astro env;
  the upload function skips verification while `TURNSTILE_SECRET_KEY` is unset.
  Set both together before launch.

## 4. Checkout and webhook — the important change

The old `checkout.mjs` put the whole cart in `session.metadata.cartItems`.
Stripe caps each metadata value at 500 characters, which a four-line cart
already exceeded — the webhook would have created an order with missing items.
Now each line carries its own metadata on its Stripe product, and the webhook
rebuilds the cart with `listLineItems`. **This fixes an existing bug**
regardless of the builder.

The webhook still falls back to `metadata.cartItems` if `listLineItems` fails,
so any sessions created by the old code still complete.

Also fixed in both files: the format/size label maps used `canvas-standard`
and 12×8" sizes, neither of which matches what the cart sends. Confirmation
emails were showing raw keys and wrong dimensions for canvas orders.

On payment, each personalised line's session is patched to `status: 'paid'`,
linked to the order, and has `expiresAt` cleared so the retention sweep leaves
its images alone. The customer's confirmation email gains a note that a proof
is coming.

## 5. Test

```powershell
$env:NETLIFY_DEV_SERVER_TIMEOUT = "600000"
npx netlify dev
```

Open `http://localhost:<port>/store/your-photo` and walk it:

1. Click "Choose a photo" without ticking consent → prompted to tick it first.
2. Tick, pick a photo, drag and zoom, "Use this crop".
3. Spinner ~40s → watermarked design, pill A ticked.
4. Click another style → generates. Click back to A → instant, no call.
5. Try five styles → the fifth is refused with the cap message; the four tried
   stay selectable.
6. Format → canvas: wrap notice appears, price updates (+£5 fee throughout).
7. Add to Cart → the cart drawer shows the line with its preview thumbnail.
8. Add the *same* design again → quantity 2. Add a different photo → separate
   line.

Stripe end-to-end needs test keys; if you want to verify the webhook path
locally, use `stripe listen --forward-to localhost:<port>/api/webhook`.

## What's left (phase 4)

Proof email on `status: 'paid'`, one-shot approve link, the Real-ESRGAN
upscale of the approved render, the print-file render with the sampled canvas
wrap colour, and the digital bundle delivery. Plus the privacy-policy section
the page links to (`/privacy-policy#your-photo`) and the terms clause for
personalised items — those are copy, and I'd suggest writing them before
launch rather than after.
