# Groupon exports — drop folder

Put CSV exports from Groupon Merchant Center in **this folder**. The daily
8am task picks up anything new, acts on it, and moves it into `processed/`.

## Which export goes here

Any CSV with a `code` column. The task works out what to do with it:

- **A voucher list** (codes Groupon has sold) — imported, which also releases
  any orders already held against those codes.
- **A redemption report** — run through verification, releasing every held
  order it confirms.

You don't need to label them or keep them separate. Both are run through both
paths, and both are safe to re-run: importing skips codes already known, and
verifying only ever acts on orders that are still waiting.

## What happens to them

Processed files move to `processed/` with a timestamp, so the folder only ever
shows what hasn't been handled yet. Nothing is deleted.

## If you'd rather do it by hand

    node --env-file=.env scripts/groupon-vouchers.mjs pending
    node --env-file=.env scripts/groupon-vouchers.mjs verify groupon-exports/whatever.csv
    node --env-file=.env scripts/groupon-vouchers.mjs import groupon-exports/whatever.csv

Add `--dry-run` to any of them to see what would happen without writing.
