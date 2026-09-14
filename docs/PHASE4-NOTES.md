# Your Photo builder — Phase 4 (proof, approval, print)

Unzip at the repo root. This closes the loop: a paid order now produces a proof
email, a one-click approval, and a print-ready file you can download.

| File | New? | Route |
|---|---|---|
| `personalisation-proof.mts` | new | `POST /api/personalisation/proof` (internal) |
| `personalisation-approve.mts` | new | `GET /api/personalisation/approve` (the emailed link) |
| `personalisation-print-background.mts` | new | internal, triggered by approval |
| `personalisation-print-file.mts` | new | `GET /admin/personalisation/print` (**admin-only**) |
| `netlify/functions/webhook.mjs` | replaces | now fires the proof send |
| `studio/schemas/pendingPersonalisation.ts` | replaces | print + proof fields (includes the phase 2 three) |

```powershell
cd C:\Users\chris\Projects\pixel8
Expand-Archive "$env:USERPROFILE\Downloads\pixel8-phase4.zip" -DestinationPath . -Force
git diff --stat
cd studio; npx sanity deploy; cd ..
```

## 1. Check the admin auth covers the new route

`personalisation-print-file.mts` serves **un-watermarked print files** and is
protected only by living under `/admin/*`. Before deploying, confirm your
existing admin edge function matches `/admin/*` and not a narrower path like
`/admin/orders/*`. If it's narrower, widen it or the print files are public.

## 2. Environment

Nothing new is required — `RESEND_API_KEY`, `EMAIL_FROM` and `PERSONALISATION_SALT`
already exist. Optional additions:

| Env | Default | Meaning |
|---|---|---|
| `EMAIL_REPLY_TO` | hello@pixel8multimedia.co.uk | Where "not quite right" replies land |
| `PERSONALISATION_PRINT_PX` | 4096 | Print resolution before wrap |
| `UPSCALE_SERVICE_URL` | — | Real-ESRGAN endpoint, if/when you deploy one |
| `UPSCALE_SERVICE_TOKEN` | — | Bearer token for that service |

## 3. How fulfilment works now

1. Customer pays → webhook marks the session `paid` and calls the proof function.
2. Proof email: the design at 900px (unwatermarked — they've paid), the order
   details, and an **Approve & print** button. Reply-to is a real inbox so
   "the glasses look wrong" comes back to you, not into a void.
3. They click → token is consumed (single use), status becomes `approved`,
   and the print build starts in the background.
4. The design appears in Studio → Personalisation → **Ready to print**.
5. You download the file:
   `https://pixel8multimedia.co.uk/admin/personalisation/print?pid=<pid>`
   Add `&kind=proof` or `&kind=original` if you need those too.
6. Print, post, then set the session's status to `printed` and fill `printedAt`
   in the Studio — that's what starts the 90-day retention clock.

To resend a proof (customer deleted it, or you fixed something), call the proof
endpoint again with `{"pid": "...", "resend": true}` — otherwise it skips
sessions that already have one out.

## 4. The print file

- **Poster**: the square at 4096px. That's 341 ppi at 12", 256 at 16", 205 at 20".
- **Canvas**: the square centred on a larger sheet, the surround filled with a
  block colour sampled from the artwork's own outer edge — so the wrap matches
  and nothing from the design is lost round the sides. Standard frame adds 1"
  per side, gallery 1.75" (frame depth plus grip). A 20" gallery canvas comes
  out 4812×4812 with 23.5" of material.
- The wrap colour is stored on the session (`printWrapColour`) so you can check
  it before printing.

**On the upscale.** Real-ESRGAN on Fly isn't built. Rather than block phase 4
on a new service, the print step upscales with Lanczos plus a light unsharp
pass, which holds up well here because these styles are flat colour and hard
edges rather than photographic detail. When you do stand up an ESRGAN service,
set `UPSCALE_SERVICE_URL` to it — it POSTs the 2048px PNG and expects an image
back at ≥4096px, and falls back to sharp automatically if the service is down,
so a print never fails because the upscaler is unavailable. `printMethod` on
each session records which was used.

Before the first real order, print one at 20" and look at it. If Lanczos is
good enough at that size, ESRGAN is an optimisation rather than a requirement.

## 5. Test without spending money

With `netlify dev` running and a session that reached `ready`:

```powershell
$base = "http://localhost:<port>"
$pid8 = "<pid from the Studio>"
$key  = node -e "const c=require('crypto');console.log(c.createHash('sha256').update('internal:'+process.env.PERSONALISATION_SALT).digest('hex').slice(0,40))"

# pretend it was paid
# (in the Studio: set status = paid, customerEmail = your address, format/size)

Invoke-RestMethod -Method Post -Uri "$base/api/personalisation/proof" `
  -Headers @{ "x-personalisation-key" = $key } -ContentType "application/json" `
  -Body (@{ pid = $pid8 } | ConvertTo-Json)
```

Check the email arrives, click Approve, watch the print build in the terminal,
then download:

```
$base/admin/personalisation/print?pid=<pid>
```

Open it and check the dimensions and the wrap colour against the artwork.
Click the approve link a second time — it should say "already approved"
rather than erroring.

## 6. What's left before launch

- **Turnstile keys** — the upload endpoint has no bot protection until both
  are set. This is the one I'd do next.
- **Privacy policy section** at `/privacy-policy#your-photo` (the builder links
  to it) and a terms clause for personalised items — say the word and I'll draft.
- **A billing alert** on the Google billing account as a backstop to the
  code-side daily cap.
- **The hero stat** still says "10 Options"; the builder offers eight styles.
- **One real paid order** end to end.
- Optional: a digital-bundle upsell in the compare view (all eight styles at
  full resolution for £14.99) — the delivery mechanism would reuse the signed
  URLs the commission flow already has.
