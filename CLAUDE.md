# Pixel8 Multimedia -- agent handoff

---

## Path migration (May 2026)

Generated 2026-05-02 during the Downloads -> Projects migration.

### Path change

- **Old path:** `C:\Users\chris\Downloads\Pixel8 Site`
- **New path:** `C:\Users\chris\Projects\pixel8`

Any older agent instructions, scripts, or notes that reference the old path should be treated as referring to the new path.

### Quick stack reference

- **Brand:** Pixel8 Multimedia
- **Sanity project ID:** `bqb4w421`
- **GitHub remote:** https://github.com/TheMetavision/pixel8multimedia.git
- **Stack:** Astro + Sanity CMS + Netlify (per Metavision house standard)

### Notes

Studio nested at Projects\pixel8\studio\. Favicons now at Projects\pixel8\public\favicons\. Pending: commission function 500 error, Resend DNS verify, domain DNS to Netlify, Sanity build hook, live Stripe keys.


---

## Shipping (Sendcloud via metavision-shipping)

Branch `feat/sendcloud-dispatch`; full write-up, setup and live test plan in
`docs/SHIPPING.md`. Everything Sendcloud is behind `SHIPPING_ENABLED`
(functions) and `SANITY_STUDIO_SHIPPING_ENABLED` (Studio build); hand-dispatch
emails go regardless once the webhook points at the router.

- One Sanity webhook ("Commission Delivery", to be edited into "Pixel8 orders")
  -> `/api/sanity-orders-webhook` routes orders, commissions and return
  requests (`_shared/orders-router.mjs`). The plan allows two webhooks; "Netlify
  rebuild" is the other. Do not plan a third.
- The dispatch email is only ever sent by `_shared/dispatch-email.mjs` (atomic
  claim). Anything that must follow it goes in `afterDispatchEmail()`.
- Alan owns `shipment.status` and `parcelPlan`; the server writes
  `shipmentResult` (and the email stamps) via `_shared/server-patch.mjs`,
  which patches an open draft too.
- Non-secret settings: `_shared/site-config.mjs` (`setting()`), env override.
  Write tokens: `sanityWriteToken()`; SANITY_TOKEN / SANITY_API_TOKEN are
  being retired in favour of SANITY_WRITE_TOKEN. Check the 4 KB function-env
  budget before adding any variable.
