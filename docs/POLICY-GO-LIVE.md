# Policy wording to publish at go-live (Pixel8)

Prepared 2026-11-01 on branch `chore/policy-wording`. **Nothing here is applied.** Pixel8's policy pages are code (`.astro`), so merging this branch must not change them early. Apply these edits on a new branch once `/returns` and real Sendcloud labels are live, then merge.

Pixel8 has no Group A ("fix now") items.

⚠ Legal wording. Check it yourself before publishing.

## 1. Privacy policy: `src/pages/privacy-policy.astro`

Add a new section after "Payment Processing" (after its closing `</div>`, around line 43). This is Comic Strip Canvas's live wording; it names no brand, so nothing needs swapping:

```html
      <div>
        <h2 class="font-montserrat font-semibold text-off-white text-lg uppercase tracking-wide mb-3">Delivery &amp; Returns</h2>
        <p class="mb-3">To get your order to you, we share your name and delivery address with Sendcloud, the shipping platform we use to create postage labels, and with the carrier that delivers your parcel (such as Royal Mail, Evri, InPost, DPD or UPS). We do this because it's necessary to fulfil your order.</p>
        <p class="mb-3">Sendcloud processes these details on our behalf and only on our instructions. Carriers use them to deliver and track your parcel, and handle them under their own privacy policies.</p>
        <p class="mb-3">If you return an item, we share your name, address, email address and, if you've given us one, your phone number with Sendcloud and with the carrier that collects or handles your return, so they can arrange a collection or send you drop-off details and keep you updated. We buy the return label for you and never share your payment details.</p>
        <p>Sendcloud is based in the Netherlands and processes data within the European Economic Area. You can read its privacy policy at sendcloud.com/en_uk/privacy-policy, and each carrier's privacy policy is on its own website.</p>
      </div>
```

Pixel8 doesn't send a phone number to Sendcloud today; the sentence is conditional, so it is accurate as written.

## 2. Refund policy: `src/pages/refund-policy.astro`

The return window stays Pixel8's own: **14 days from delivery to cancel ready-made wall art, then 14 days to send it back**. Faulty or wrong items stay free ("Damaged, faulty or wrong" is unchanged).

"Changing Your Mind" (line 28): replace "Return postage is paid by you, unless the item is faulty or we sent you the wrong one." with:

> Return postage is paid by you, unless the item is faulty or we sent you the wrong one. You can request a return at pixel8multimedia.co.uk/returns: we email you a prepaid return label, and its cost is deducted from your refund (you'll see the amount before you submit).

Line 27 says "To cancel, tell us within those 14 days — an email is enough." Leave it: a customer may still cancel by email, the returns page is an extra route.

## 3. Terms & Conditions: `src/pages/terms-and-conditions.astro`

"Cancellation & Returns" (line 47): after "…so we recommend a tracked service.", insert:

> You can request a return at pixel8multimedia.co.uk/returns; if we email you a prepaid return label, its cost is deducted from your refund. Faulty or incorrect items are returned free.
