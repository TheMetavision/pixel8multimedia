# Your Photo builder — Phase 2 (functions)

Unzip at the repo root. Six functions plus a shared module, all following the
existing conventions (`config.path` under `/api/…`, `SANITY_TOKEN`, project
`bqb4w421`).

| File | Route | What it does |
|---|---|---|
| `_shared/personalisation.mts` | — | Sanity + Blobs clients, ids, caps, daily guards, helpers |
| `personalisation-upload.mts` | `POST /api/personalisation/upload` | Takes the cropped square, normalises (≤2048px, EXIF stripped), stores to Blobs, creates the session doc |
| `personalisation-style.mts` | `POST /api/personalisation/style` | Checks caps + guards, serves cached renders, enqueues the background job |
| `personalisation-style-background.mts` | internal | The Gemini call (30–45s). Writes the render and the outcome to the doc |
| `personalisation-status.mts` | `GET /api/personalisation/status` | What the browser polls |
| `personalisation-image.mts` | `GET /api/personalisation/image` | Cropped photo, or watermarked 1024px preview of a render |
| `personalisation-sweep.mts` | scheduled `@daily` | Expires unpaid sessions (48h), purges paid ones after 90 days |

## 1. Schema additions (three fields the functions write)

In `studio/schemas/pendingPersonalisation.ts`, add after `switchesUsed`:

```ts
defineField({ name: 'failCode', title: 'Failure code', type: 'string', readOnly: true }),
defineField({ name: 'failMessage', title: 'Failure message (shown to customer)', type: 'string', readOnly: true }),
defineField({ name: 'purgedAt', title: 'Images purged', type: 'datetime', readOnly: true }),
```

Deploy the studio again.

## 2. Config

`netlify.toml` — you already added `included_files` for the refs. Nothing else;
scheduled functions are picked up from `config.schedule`.

Env (site-level, secret): `GOOGLE_AI_API_KEY`, `PERSONALISATION_SALT`,
`SANITY_TOKEN` (exists). Optional: `TURNSTILE_SECRET_KEY` (upload skips the
check while it's unset — set it before launch, along with the site key in the
UI), and any of the tunables below.

| Env | Default | Meaning |
|---|---|---|
| `PERSONALISATION_CALLS_PER_SESSION` | 16 | hard cap per photo |
| `PERSONALISATION_FREE_SWITCHES` | 3 | distinct styles beyond the first |
| `PERSONALISATION_REGENS_PER_STYLE` | 2 | "try again" on the same style |
| `PERSONALISATION_IP_DAILY_CAP` | 24 | per hashed IP per day |
| `PERSONALISATION_DAILY_CAP` | 400 | global per day (≈ £40 at 2K) |
| `PERSONALISATION_UNPAID_TTL_HOURS` | 48 | unpaid session lifetime |
| `PERSONALISATION_PAID_RETENTION_DAYS` | 90 | blob retention after printing |
| `PERSONALISATION_MAX_UPLOAD_MB` | 12 | upload ceiling |

The daily guards are soft counters in a second Blobs store
(`personalisation-guards`). If the global cap trips, the customer sees
"We're at capacity for today" — a message, not a bill.

## 3. The contract the builder UI (phase 3) codes against

```
POST /api/personalisation/upload      multipart: file, consent=true, crop?, turnstile?
  → { ok, pid, expiresAt }

POST /api/personalisation/style       { pid, styleKey, regenerate? }
  → { ok, status: 'ready', cached: true, … }      already have it — show it
  → { ok, status: 'styling', callsLeft, switchesLeft }   poll /status
  → 429 { error }   session cap — show error, keep the styles already tried selectable
  → 503 { error }   daily guard — show error
  → 409/410         locked / expired — start over

GET  /api/personalisation/status?pid=…
  → { ok, status, selectedStyleKey, styles:[{styleKey}], callsLeft, switchesLeft,
      failCode?, failMessage?, expiresAt }
  status: uploaded | styling | ready | failed  (paid+ never seen by the builder)

GET  /api/personalisation/image?pid=…&kind=square|<styleKey>&w=…
  → image/jpeg (renders are watermarked; 404 until ready)
```

Poll every 3s while `styling`. When `failed`, show `failMessage` verbatim —
the `blocked` one is the "own photos only" copy — and let them pick another
style or photo. The pid goes into the cart line as `personalisationId`.

## 4. Local test (before any UI exists)

```powershell
netlify dev
```

then in a second terminal, with any square-ish JPEG as `me.jpg`:

```powershell
$r = curl.exe -s -F "file=@me.jpg" -F "consent=true" http://localhost:8888/api/personalisation/upload | ConvertFrom-Json
$r
curl.exe -s -X POST -H "Content-Type: application/json" -d "{`"pid`":`"$($r.pid)`",`"styleKey`":`"style-a`"}" http://localhost:8888/api/personalisation/style
# wait ~40s, then:
curl.exe -s "http://localhost:8888/api/personalisation/status?pid=$($r.pid)"
curl.exe -s "http://localhost:8888/api/personalisation/image?pid=$($r.pid)&kind=style-a" -o preview.jpg
```

Open `preview.jpg` — a watermarked stencil of your photo. Check the Studio:
Personalisation → All sessions shows the doc with one render.

Note on `netlify dev` and background functions: locally, the foreground
function calls `http://localhost:8888/api/personalisation/style-background`
via `process.env.URL`; the CLI sets that. If the enqueue fails locally with a
connection error, set `URL=http://localhost:8888` in `.env`.

## 5. Behaviour worth knowing

- **Dedupe:** same session + same style → served from Blobs, no call. A
  customer flicking back and forth between styles they've already seen costs
  nothing.
- **Refunds:** a failed generation gives the go back (`callsUsed - 1`); it still
  counts toward the daily guards so a hostile client can't loop on failures.
- **Blocked uploads:** Gemini refusing the *input* (celebrities, film stills)
  comes back as `failCode: 'blocked'` with the friendly copy already written.
- **Privacy:** raw IPs are never stored — only a salted hash. Photos are in
  Blobs, not Sanity's CDN. Unpaid sessions and every image are gone after 48h.
- **The pid is the capability.** It's 128-bit random; treat links containing
  it like any unlisted share link.

## Phase 3 next

The builder page: upload + square crop/zoom (canvas), style pills from the
`personalisationStyle` docs, polling, watermarked preview, format/size/price
from the existing PDP, `addToCart` with `personalisationId`. Plus the
`cart.ts` / `checkout.mjs` / `webhook.mjs` changes from PHASE1-NOTES §6.
