# Admin auth â€” required before deploying phase 4

`netlify/edge-functions/admin-auth.ts` puts HTTP Basic Auth in front of
everything under `/admin/*`.

## Why this is needed

`personalisation-print-file.mts` (phase 4) serves **un-watermarked,
full-resolution print files built from customers' own photos** at
`/admin/personalisation/print`. I'd assumed this repo already had admin
protection like the Comic Strip Canvas one does; it doesn't. Without this
edge function that endpoint is public.

The personalisation ids are 128-bit random, so they aren't guessable â€” but an
unguessable URL is not access control, and ids appear in logs, emails and the
Studio.

## Install

```powershell
cd C:\Users\chris\Projects\pixel8
Expand-Archive "$env:USERPROFILE\Downloads\pixel8-admin-auth.zip" -DestinationPath . -Force
```

Generate a password and add both variables locally:

```powershell
$pw = -join ((1..24) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$pw
Add-Content .env "`nADMIN_USER=<your-admin-username>
```

Then in Netlify â†’ Site configuration â†’ Environment variables, add
`ADMIN_USER` and `ADMIN_PASSWORD` with the same values. Mark **both** as
secret. Save the password in your password manager â€” it's the only copy.

## Behaviour

- Wrong or missing credentials â†’ 401 with a browser login prompt.
- `ADMIN_USER` or `ADMIN_PASSWORD` missing from the environment â†’ **503, all
  requests denied**. It fails closed on purpose: a half-configured deploy
  should lock you out rather than let the internet in.
- Successful responses get `Cache-Control: no-store, private` and
  `X-Robots-Tag: noindex` so nothing from the admin area is cached by a CDN or
  indexed.
- Credentials are compared in constant time, so a wrong username and a wrong
  password take the same time to reject.

## Check it after deploying

```powershell
# no credentials â†’ 401
curl.exe -i "https://<your-site>/admin/personalisation/print?pid=test"

# with credentials â†’ 400/404 from the function itself (not 401)
curl.exe -i -u "<username>:<password>" "https://<your-site>/admin/personalisation/print?pid=test"
```

The first must be 401. If it isn't, the edge function isn't deployed â€” check
the Netlify deploy log lists `admin-auth` under Edge Functions.

Locally, `netlify dev` runs edge functions too, so the same check works against
localhost.

## Note

This protects anything you put under `/admin/*` from now on. If you already
have other admin pages served elsewhere, they are not covered unless they
live under that prefix.
