# Sendcloud shipping and returns (metavision-shipping)

Branch `feat/sendcloud-dispatch`. Ported from Comic Strip Canvas, following
Pixel8's own conventions (`.mts` functions with `config.path`).

**Everything Sendcloud is behind `SHIPPING_ENABLED`.** Unset, the site works
as it does today. The one deliberate exception is that **dispatch emails for
hand dispatches** (shop orders, which never had one, and commissions, as
before) go out as soon as the Sanity webhook points at the new router, with
or without the flag.

## How it works

| Step | What happens | Code |
|---|---|---|
| Order paid | `webhook.mjs` stamps `orderNumber` (`P8-` + last 8 chars of the session id), which also appears in the confirmation email. With shipping on, it also proposes a `parcelPlan` (one parcel per item) and flags any line it can't place | `_shared/order-ref.mjs`, `_shared/parcel-bands.mjs` |
| Commission paid | With shipping on, `stripe-webhook-commission` also stores `shippingAddressFields`. Older commissions are read from Stripe at dispatch | `_shared/commission-address.mjs` |
| Alan: Shipment → **Ready to ship**, publish | The webhook calls the router, which starts `shipping-dispatch-background`. That buys one label per planned parcel, writes `shipmentResult`, and sends the team a **"Label ready"** email with print links | `_shared/orders-router.mjs`, `_shared/shipping-dispatch.mjs` |
| Print label | `/admin/shipping/label/<id>` (Basic Auth) proxies the PDF, signing the request with `SHIPPING_SECRET` | `shipping-label.mts` |
| First carrier scan | `/api/shipping-event`: `shipmentResult.dispatchedAt`; the order moves to Dispatched (or the commission to Shipped) with tracking; the **branded dispatch email is sent once** | `_shared/shipping-events.mjs`, `_shared/dispatch-email.mjs` |
| Delivered | `shipmentResult.deliveredAt`. The 14-day return window counts from this | |
| Hand dispatch | Order set to Dispatched with a tracking number, or commission set to Shipped: the same dispatch email, once | `_shared/dispatch-email.mjs` |
| Customer return | `/returns`: look up the order (reference or `pi_` + email, Turnstile), tick items, **see the return postage from `quote-return` before submitting**, submit. This creates `returnRequest.<ref>` and emails the team | `_shared/returns-api.mjs`, `src/pages/returns.astro` |
| Alan approves / rejects | The router starts `shipping-return-background`. On approval, `create-return` runs and the label is emailed with "£X.XX will be deducted" (`postageDeduction`). On rejection, the reason is emailed | `_shared/shipping-returns.mjs` |
| Return at collection point | The team email names the point (InPost locker, 59 West Road / ASDA Shoebury / Skanda, 93-95 West Road). The customer is never told | `_shared/site-config.mjs` |
| Faulty item | Order → **Create return (free label)**. No deduction | `studio/actions/CreateReturnAction.tsx` |

**Returns eligibility:**
- Stock lines only, within 14 days of `deliveredAt`.
- If there is no `deliveredAt`, the request is allowed but flagged "delivery date unknown".
- Excluded: any line with a `personalisationId` (Your Photo) and all commissions (a PX- reference gets a polite no).
- Refunds stay manual in Stripe.

**Parcel bands:**

| Item | Small | Medium | Large |
|---|---|---|---|
| Shop poster (square) | P5 | P6 | P7 |
| Shop standard canvas (square) | CS5 | CS6 | CS7 |
| Shop gallery canvas (square) | CG5 | CG6 | CG7 |
| Commission, 3:2 poster | P1 | P3 | P4 |
| Commission, 3:2 standard canvas | CS1 | CS3 | CS4 |
| Commission, 3:2 gallery canvas | CG1 | CG3 | CG4 |

- A commission counts as 3:2 when its service has `printSizeLabels`; otherwise it uses the square shop bands.
- Legacy 16x12 commissions map to P2 / CS2 / CG2.
- Shop lines with labels only (no format/size keys) are flagged, never guessed.

### Lessons from CSC, built in

1. **One webhook.** The plan allows two, and both are used. "Commission Delivery" is edited in place into the router (below). No new webhook is needed.
2. **4 KB function env.** Non-secret values live in `_shared/site-config.mjs`, with an env override allowed. Shipping adds only `SHIPPING_SECRET` and `SHIPPING_ENABLED`. Background functions are started with a key derived from `PERSONALISATION_SALT` under its own HMAC label (`_shared/shipping-internal.mjs`). It is not the personalisation key and needs no env var.
3. **One dispatch-email module with an atomic claim** (`ifRevisionId`). It is used by the router, `commission-deliver`, and the tracking callback. `afterDispatchEmail()` is the single hook for anything that must follow the email. Nothing does today: there is no MailerLite customers group, and retention counts from printing, not dispatch.
4. **Server results in `shipmentResult`, never in `shipment.status` / `parcelPlan`.** Every server write also patches an existing draft (`_shared/server-patch.mjs`), so publishing a draft can't undo it.
5. **Return points** are in `site-config.mjs` and appear in team emails only.

**Loop guard.** The webhook projection carries `before()`. Work starts only when a document *moves into* a state. After an exception, Alan retries by setting On hold → Ready to ship (or Requested → Approved for a return). Hand-dispatched orders from before this change are never emailed by a later edit. Without the projection, orders created before `DISPATCH_EMAIL_SINCE` (2026-11-01) are skipped.

## Alan's setup: in order, nothing here has been done

### 1. Shipping service (metavision-shipping Netlify site)

```powershell
cd C:\Users\chris\Projects\metavision-shipping
$s = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
$s | Set-Clipboard   # paste it into Pixel8's env in step 2 as well; never commit it
npx netlify env:unset SHIPPING_SECRET_PIXEL8
npx netlify env:set SHIPPING_SECRET_PIXEL8 $s --secret --context production deploy-preview
npx netlify env:set CALLBACK_URL_PIXEL8 "https://pixel8multimedia.co.uk/api/shipping-event" --context production deploy-preview
# Test mode for Pixel8 (add to whatever is there, e.g. "CSC,PIXEL8"):
npx netlify env:get SHIPPING_TEST_BRANDS
npx netlify env:set SHIPPING_TEST_BRANDS "CSC,PIXEL8" --context production
```

Before any **real** label: fill the band sizes and weights for P1–P7 / CS1–CS7 / CG1–CG7 in `config/shipping.json` (all are `null` today). Test labels don't need them.

### 2. Pixel8 Netlify env

```powershell
cd C:\Users\chris\Projects\pixel8
npx netlify env:unset SHIPPING_SECRET
npx netlify env:set SHIPPING_SECRET "<the value from step 1>" --secret --context production deploy-preview
npx netlify env:set SHIPPING_ENABLED "true" --context production deploy-preview   # Functions AND Builds scope (the /returns page reads it at build)
npx netlify env:set SHIPPING_TEST_MODE "true" --context production deploy-preview # test labels only; unset before going live
```

**Headroom.** The CLI masks secrets, so figures are estimates (±300 bytes):

| | Functions-scope env |
|---|---|
| Today | ~3.0–3.3 KB (28 vars; 2,184 bytes measured with secrets masked) |
| Shipping adds | ~+0.1 KB (`SHIPPING_SECRET`, `SHIPPING_ENABLED`, `SHIPPING_TEST_MODE` while testing) |
| After the clean-up below | ~2.3–2.5 KB |

Clean-up, after this branch is live and verified (each step is safe on its own, because the code falls back):

```powershell
cd C:\Users\chris\Projects\pixel8
# a) Sanity write tokens -> one. Confirm SANITY_WRITE_TOKEN is an Editor token first
#    (webhook.mjs already creates orders with it). Every function now falls back to it.
npx netlify env:unset SANITY_TOKEN        # ~195 bytes
npx netlify env:unset SANITY_API_TOKEN    # ~200 bytes
#    SANITY_READ_TOKEN stays: the build and SSR pages read with it (Viewer).
# b) Non-secrets now committed in netlify/functions/_shared/site-config.mjs:
npx netlify env:unset EMAIL_FROM; npx netlify env:unset TEAM_EMAIL; npx netlify env:unset MAILERLITE_GROUP_ID
npx netlify env:unset GA4_MEASUREMENT_ID; npx netlify env:unset SANITY_PROJECT_ID; npx netlify env:unset SANITY_DATASET
# c) Unused anywhere in the code:
npx netlify env:unset STRIPE_PUBLISHABLE_KEY   # 131 bytes
```

Also, in the Netlify UI:
- Re-scope `PUBLIC_TURNSTILE_SITE_KEY` to **Builds only**. It is inlined at build time, so functions don't need it.
- **`MAILERLITE_API_KEY` (988 characters) is not marked secret.** Delete it and re-create it as a secret (same value).

### 3. Sanity webhook: edit "Commission Delivery" in place (sanity.io/manage → bqb4w421 → API → Webhooks)

Only once this branch is merged and deployed. Until the live test passes, `commission-deliver` stays live, and you can point the webhook back at it to roll back.

| Field | Value |
|---|---|
| Name | `Pixel8 orders` |
| URL | `https://pixel8multimedia.co.uk/api/sanity-orders-webhook` |
| Dataset | production |
| Trigger on | Create, Update |
| Filter | `_type in ["order", "commission", "returnRequest"] && delta::changedAny((status, trackingNumber, carrier, shipment, parcelPlan, band, freeLabel, rejectionReason))` |
| Projection | `{..., "before": before(){ status, trackingNumber, "shipmentStatus": shipment.status }}` |
| Drafts / versions | off |
| HTTP method | POST |
| Secret | leave as is (it is `SANITY_WEBHOOK_SECRET`) |

"Netlify rebuild" is unchanged.

### 4. Studio: schema + hosted Studio (two deploys)

```powershell
cd C:\Users\chris\Projects\pixel8\studio
Add-Content .env "SANITY_STUDIO_SHIPPING_ENABLED=true"   # leave out to deploy the schema with the shipping UI hidden
npx sanity schema deploy
npx sanity deploy
```

The new fields are: `orderNumber`, `carrier`, `dispatchEmailSentAt`, `shipment`, `parcelPlan`, `shipmentResult` (order); `prints`, `shippingAddressFields`, the shipping fields, and InPost/Other carriers (commission); and the `returnRequest` type. The new Studio sections are **Shipping** and **Returns** queues, and **Create return (free label)** on orders.

### 5. Drafts for you to apply (not applied)

**Privacy policy:** new section after "Payment Processing" in `src/pages/privacy-policy.astro`. The wording is CSC's; it contains no brand name to swap.

```html
      <div>
        <h2 class="font-montserrat font-semibold text-off-white text-lg uppercase tracking-wide mb-3">Delivery &amp; Returns</h2>
        <p class="mb-3">To get your order to you, we share your name and delivery address with Sendcloud, the shipping platform we use to create postage labels, and with the carrier that delivers your parcel (such as Royal Mail, Evri, InPost, DPD or UPS). We do this because it's necessary to fulfil your order.</p>
        <p class="mb-3">Sendcloud processes these details on our behalf and only on our instructions. Carriers use them to deliver and track your parcel, and handle them under their own privacy policies.</p>
        <p class="mb-3">If you return an item, we share your name, address, email address and, if you've given us one, your phone number with Sendcloud and with the carrier that collects or handles your return, so they can arrange a collection or send you drop-off details and keep you updated. We buy the return label for you and never share your payment details.</p>
        <p>Sendcloud is based in the Netherlands and processes data within the European Economic Area. You can read its privacy policy at sendcloud.com/en_uk/privacy-policy, and each carrier's privacy policy is on its own website.</p>
      </div>
```

Pixel8 doesn't send a phone number to Sendcloud today. The sentence is conditional ("if you've given us one"), so it is accurate as written.

**Refund policy:** replace the sentence "Return postage is paid by you, unless the item is faulty or we sent you the wrong one." in "Changing Your Mind" (`src/pages/refund-policy.astro`, line 28) with:

> Return postage is paid by you, unless the item is faulty or we sent you the wrong one. You can request a return at pixel8multimedia.co.uk/returns: we email you a prepaid return label, and its cost is deducted from your refund (you'll see the amount before you submit).

The Terms & Conditions "Cancellation & Returns" paragraph says the same about return postage. Worth the same sentence there. ⚠ This is legal wording: check it yourself before publishing.

## Live test plan (test labels only)

Prerequisites: steps 1–4 done, with `SHIPPING_TEST_MODE=true` and `PIXEL8` in `SHIPPING_TEST_BRANDS`. Test labels are the free `sendcloud:letter`.

1. **Router alive.** An unsigned POST is refused:
   ```powershell
   (Invoke-WebRequest -Method Post -Uri https://pixel8multimedia.co.uk/api/sanity-orders-webhook -Body '{}' -SkipHttpErrorCheck).StatusCode   # 401
   (Invoke-WebRequest -Method Post -Uri https://pixel8multimedia.co.uk/api/shipping-event -Body '{}' -SkipHttpErrorCheck).StatusCode          # 401
   (Invoke-WebRequest -Uri https://pixel8multimedia.co.uk/admin/shipping/label/x -SkipHttpErrorCheck).StatusCode                              # 401 (Basic Auth)
   ```
   On Windows PowerShell 5.1, drop `-SkipHttpErrorCheck` and read the status from the error.
2. **Hand dispatch email (shop).** Place a real low-value order to your own address. Set it to Dispatched with tracking `TEST123` and carrier Royal Mail, then publish. You should get one email showing `P8-…` and a Royal Mail link, and `dispatchEmailSentAt` is stamped. Publish again: no second email.
3. **Hand dispatch email (commission).** On a test commission, set Shipped with carrier and tracking. You should get one email, the same as before the change.
4. **Labels.** On the order from step 2, open the Shipping queue and check the parcel plan (P5 for a small poster). Set Shipment → Ready to ship and publish. You should get a "[TEST] Label ready" email to contact@, a `TEST` parcel in the panel, and a PDF from **Print label** (asks for the admin password).
5. **First scan → dispatch email.** For a fresh order (not dispatched by hand):
   ```powershell
   cd C:\Users\chris\Projects\metavision-shipping
   node --env-file=.env tools/simulate-event.mjs --brand=PIXEL8 --parcel=<parcelId> --status=in_transit
   ```
   The order becomes Dispatched, the customer email arrives once, and running the command again sends nothing.
6. **Delivered.** Run `--status=delivered`. Check that `shipmentResult.deliveredAt` is set and the order is Delivered.
7. **Exception and retry.** Set a parcel plan band to one with no sizes, with test mode off on a deploy preview only, or use `--status=exception`. You should get a team alert; nothing goes to the customer. Set On hold → Ready to ship: one retry, not a loop.
8. **Return.** At `/returns`, enter `P8-…` and your email. Tick the poster: the postage figure shows before Submit. Submit, then check the team email and the Returns → Requested queue. Approve and publish: a label email with "£X.XX will be deducted". Then run:
   ```powershell
   node --env-file=.env tools/simulate-event.mjs --brand=PIXEL8 --parcel=<returnParcelId> --status=ready_to_collect
   ```
   You should get a team email naming the InPost locker, 59 West Road.
9. **Rejected return.** Reject with a reason; the customer receives it word for word.
10. **Clean up.**
    ```powershell
    node --env-file=.env tools/cancel-test-parcels.mjs --dry-run
    node --env-file=.env tools/cancel-test-parcels.mjs
    ```
    Delete the test documents in the Studio. Once all of this passes, `commission-deliver.mts` can be retired.

**Going live:** fill the band sizes on the service, unset `SHIPPING_TEST_MODE`, and apply the privacy and refund wording.
