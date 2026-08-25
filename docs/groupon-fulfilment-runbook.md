# Groupon fulfilment — runbook

How a Groupon voucher becomes a finished piece of work, and what to do when it
doesn't. Everything here is live in the repo; nothing depends on a spreadsheet.

---

## The shape of it

```
Groupon sells a voucher
        │
        ▼
  customer visits pixel8multimedia.co.uk/groupon
  enters their code + which deal they bought
        │
        │  code known to us?  ── yes ──►  our record wins (service, option, value)
        │                    ── no  ──►  take their word, flag for checking
        ▼
  the normal commission wizard  ──►  Stripe (£0, or the extras)
        │
        ▼
  order created.  Unconfirmed codes are HELD: the order cannot be
  moved past Paid, and delivery refuses to fire.
        │
        │  you confirm the code — in bulk from an export, or by
        │  looking it up in Merchant Center
        ▼
  hold clears  ──►  existing pipeline: work, deliver, done
```

**Groupon publishes no API for validating a voucher code.** That single fact
shapes everything here. We cannot check a code at the moment a customer types
it, so we accept it, take the order, and hold the work until the code has been
confirmed. A bad code costs a minute of checking. It never costs a delivered
commission.

The real validation lives in Merchant Center: paste the code into its Redeem
function and it shows the voucher's validity *and* which deal and option was
bought — which is also the step Groupon expects you to perform for every
voucher, so it is not extra work you would otherwise avoid.

---

## Confirming codes without it eating your day

This is designed so the per-order lookup is the exception, not the routine.

**The queue.** Everything waiting on you, oldest first:

```bash
node --env-file=.env scripts/groupon-vouchers.mjs pending
```

**Bulk release — the one that scales.** Any Groupon export containing a code
column will do. Every order the export explains is released in one pass:

```bash
node --env-file=.env scripts/groupon-vouchers.mjs verify export.csv
```

It reports three groups, and they mean different things:

| Result | Meaning | Action |
|---|---|---|
| Released | Code is real and matches what they ordered | None — the order is now workable |
| Mismatch | Real code, but they ordered a different deal from the one they bought | Contact the customer. The credit applied was wrong |
| Unexplained | The export doesn't cover it | Re-export with a wider date range, then look up whatever still won't match |

**The import releases orders too.** Any held code that shows up in a routine
import is confirmed automatically, because an import *is* Groupon telling you
the voucher is real. In practice most holds clear on the next import without
you doing anything specific about them.

**One-offs**, after a Merchant Center lookup:

```bash
node --env-file=.env scripts/groupon-vouchers.mjs confirm GN4B7KQ2X9
node --env-file=.env scripts/groupon-vouchers.mjs confirm GN4B7KQ2X9 --reject
```

At volume the shape is: import daily-ish, run `verify` against whatever export
you have, and only hand-check the handful of codes that neither covers.

---

## What the hold actually stops

Three independent layers, because the work is the thing you cannot take back:

1. **Studio validation** refuses to move a held order to In Progress, Review,
   Complete, Shipped or Delivered.
2. **The delivery function** re-checks for itself before sending anything. The
   Studio rule can be bypassed by an API patch or a bulk edit; delivery is
   irreversible, so it does not take that on trust.
3. **The Studio list** shows held orders as `[ON HOLD]` and held vouchers as
   `NEEDS CHECKING`, so the queue is visible without running anything.

---

## The design decision that matters

**A voucher is worth a fixed number of pence against one specific service. It is
not "100% off whatever is in the basket."**

The discount is a Stripe `amount_off` coupon equal to the Groupon *original
value* — £14.99 on the Cartoonify deal buys a £14.99 credit. Consequences,
all of them deliberate:

- A customer who adds a canvas print at checkout **pays for the canvas**. This is
  the digital-first / hard-copy-upgrade strategy working as intended, and
  `upgradePaidPence` on the voucher is the number that proves it.
- A customer who upgrades to a bigger option pays the difference, not the lot.
- A customer who orders something cheaper than they bought simply uses less of
  the credit. Stripe does not refund the gap, and neither do we.
- The discount is additionally **capped at the base tier the customer chose**.
  A £109.99 animation voucher spent on the £14.99 digital tier plus a canvas
  takes £14.99 off, not £109.99 — otherwise the surplus would quietly pay for
  the canvas. Unused entitlement is forfeited, exactly as on Groupon.
- A print-only order against a voucher is refused with an explanation rather
  than charged in full, because there is no service tier for the credit to
  attach to.
- A percentage discount would have given away every upgrade for free. Never
  switch the coupon to `percent_off`.

---

## Importing vouchers

The import is no longer a gate — a customer can redeem the moment they buy,
whether or not we've imported their code. What the import buys you is
*certainty*: an imported code carries an authoritative service, option and
value, so the customer's own declaration is overridden and there is nothing to
confirm later. It also releases any orders already held against those codes.

Import as often as is convenient. Daily makes most holds disappear before you
ever look at them; weekly means a slightly longer `pending` queue. Neither
turns a customer away.

1. Merchant Center → your campaign → export the voucher list as CSV.
2. Line the columns up with the template:

   ```bash
   node --env-file=.env scripts/groupon-vouchers.mjs template groupon-import.csv
   ```

   Required: `code`. Everything else is resolved from `dealId` via
   `scripts/groupon-campaign-map.json`. `valuePence` accepts pence (`1499`) or
   pounds with a decimal point (`14.99`); dates accept `dd/mm/yyyy`.

3. Dry-run first, always:

   ```bash
   node --env-file=.env scripts/groupon-vouchers.mjs import groupon-import.csv --dry-run
   ```

4. Then for real. It's idempotent — codes already imported are skipped, so
   re-running the whole export is safe and is the easiest way to catch up:

   ```bash
   node --env-file=.env scripts/groupon-vouchers.mjs import groupon-import.csv
   ```

**A new campaign, or a changed option, means editing
`scripts/groupon-campaign-map.json` first.** An unmapped deal id fails the row
loudly rather than guessing a price — that is on purpose.

---

## Weekly: the sweep

Releases claims from customers who wandered off, expires vouchers past their
date, deactivates orphaned Stripe promotion codes, and repairs any voucher whose
order was paid but whose webhook finalisation failed.

```bash
node --env-file=.env scripts/groupon-vouchers.mjs sweep --dry-run
node --env-file=.env scripts/groupon-vouchers.mjs sweep
```

Safe to run any time; safe to schedule. Nothing in the flow *depends* on it —
lapsed claims also self-heal on the next redemption attempt — but it keeps the
Stripe dashboard readable and the status counts honest.

---

## Monthly: reconciliation

The one control that catches both fraud and our own bugs. Export the redemption
report from Merchant Center, then:

```bash
node --env-file=.env scripts/groupon-vouchers.mjs reconcile groupon-report.csv
```

Three findings, three different meanings:

| Finding | What it means | What to do |
|---|---|---|
| In Groupon's report, not in ours | Vouchers sold that we never imported. Those customers **cannot redeem**. | Import them today. Check for a stuck export. |
| Redeemed here, absent from report | Either the report predates the redemption, or the code was never genuinely sold. | Re-export with a wider date range. If it's still missing, do not deliver — investigate. |
| Unverified, now confirmed | A code accepted without an import that Groupon has since confirmed. | Nothing — reconcile marks it verified. |

Then check the money:

```bash
node --env-file=.env scripts/groupon-vouchers.mjs status
```

`Paid to us on top of vouchers` is the number to take into any conversation with
Groupon about commission. It is upgrade revenue the deal price never touches.

---

## When something goes wrong

**"My code doesn't work."**

```bash
node --env-file=.env scripts/groupon-vouchers.mjs lookup GN4B7KQ2X9
```

The status tells you which of these it is:

- **not found** — the code has never been entered. They mistyped it, or the
  voucher is not ours. Nothing to fix on our side.
- **claimed / checkout with a live window** — they have it open in another tab,
  or abandoned a checkout. It frees itself within the hour; `set-status <code>
  imported` releases it immediately.
- **redeemed** — already used. `lookup` names the order and the email it went to.
  If that isn't them, treat it as a shared or stolen code and escalate.
- **expired** — past the date on the voucher. UK vouchers normally keep their
  paid value after the promotional period; if Groupon confirms it, honour it with
  `set-status <code> imported`.

**A customer paid and got nothing.** Check the commission in the Studio. If
`paidAt` is set, the pipeline has it and delivery is the issue, not Groupon. If
`paidAt` is empty but Stripe shows the session complete, look at the webhook
logs for `[GROUPON]`.

**A voucher is stuck at `checkout` after a genuine payment.** The webhook
finalises the voucher separately from the commission, so a failure there leaves
the order correct and the voucher stale. `sweep` detects this — a paid
commission behind an unfinalised voucher — and repairs it automatically,
reporting it as *"Paid but not finalised"*. Nothing is at risk in the meantime:
a voucher with a paid order behind it is refused everywhere regardless of what
its status says.

**Groupon refunded a customer after we delivered.** `set-status <code> refunded`
so it can never be reused, and note it. This is a chargeback conversation with
Groupon, not something the code can decide.

---

## Fraud posture

The honest summary: **we cannot verify a Groupon code with Groupon in real
time.** There is no merchant API for it. Everything rests on the imported list
being current, which is why the import cadence matters more than any other step
here.

What is in place:

- Codes are checked against imported records only. An unknown code is refused,
  and the refusal message is identical whether the code is malformed or simply
  unknown — nothing leaks the format.
- The claim token is single-use, expires after a day, and is stored only as a
  SHA-256 hash. It never appears in a URL. It travels in sessionStorage and, as
  a backstop for browsers that block site data, in an HttpOnly cookie — so a
  customer in a private window is never silently charged full price.
- **Claiming a code is not exclusive.** A customer who starts on a phone and
  finishes on a laptop is never told their own voucher is in use elsewhere.
  Exclusivity lives at checkout only.
- **Double-spending is blocked by a compare-and-swap on the voucher's document
  revision**, not by hope. Two tabs submitting at once cannot both win the
  `_rev`; the loser is told the voucher is in use. The single-use Stripe
  promotion code (`max_redemptions: 1`) is a second layer, but note that on its
  own it would not be enough — each attempt mints its own code.
- A customer who presses Back from Stripe and re-submits gets **the same
  checkout session back**, never a second discounted one.
- A voucher whose order was actually paid can never be handed back to the pool,
  even if its status is stale — every check consults the commission's `paidAt`
  rather than trusting the status field alone.
- The customer never sees the Groupon code in Stripe, and never sees a Stripe
  code they could share.
- The voucher is bound to one service. A Past Perfect voucher cannot be spent on
  Crayon To Creation.
- Redemption attempts are rate-limited per IP.
- Repeated claims on one code raise a `repeat-claims` flag rather than blocking —
  worth a look, not worth punishing an honest customer with a flaky connection.
- One address can only hold a few unconfirmed vouchers at once, so inventing
  codes in bulk stops quickly.

The residual risk is a customer who redeems a fake code and abandons the order
before you check it — which costs nothing but a line in the `pending` queue. The
thing to never do is work an order that is still on hold, and that is precisely
what the three layers above prevent.

---

## What still needs doing before launch

- [ ] **Deploy the Studio schema.** `grouponVoucher` won't appear until the studio
      is redeployed (`cd studio && npx sanity deploy`).
- [ ] **Test the whole flow in Stripe test mode** — see the checklist below.
- [ ] **Set the voucher instructions on each Groupon campaign** to its own
      deal link, so the customer arrives with the right deal pre-selected:
      `https://pixel8multimedia.co.uk/groupon?deal=<key>` — the keys are in
      `src/data/groupon-campaigns.json` (e.g. `cartoonify-me-1499`). They
      currently point at the service URLs, which sends customers to a page that
      will charge them full price. This is the one change that must happen
      before a single voucher sells.
- [ ] **Ask Ross two things:** whether marking a voucher redeemed in Merchant
      Center is what triggers payout, and whether an online-only merchant can get
      an automated voucher feed. A yes to the second would remove most of the
      confirmation work entirely.
- [ ] **Decide the import cadence** and put it in the calendar.
- [ ] Nothing here depends on the Groupon commission dispute resolving — the
      flow works at any commission rate.

### Fixed in passing

While wiring this up, a pre-existing bug turned up in `commission-checkout.mts`:
the service GROQ projection was missing `digitalPriceSecondary`,
`digitalPriceBoth`, `styleOptionsSecondary`, `collectionLabel` and
`collectionLabelSecondary`. On the live site that meant **`digital-secondary`
and `digital-both` orders priced at zero and were rejected outright**, and a
bundle on the secondary collection silently charged the primary price. Back in
Time is the service this affects. The projection now selects those fields —
worth a test order on Back in Time's "both collections" option to confirm.

### Test-mode checklist

With `STRIPE_SECRET_KEY` on a test key:

1. Import one test voucher (`GNTEST0001`, Cartoonify, 1499).
2. `/groupon` → enter it → lands on `/services/cartoonify-me` with the green
   voucher banner showing £14.99 credit.
3. Complete the wizard with **digital only** → Stripe total should be **£0.00**,
   and the page should complete without asking for a card.
4. Confirm in the Studio: commission `paid`, `source: groupon`,
   `discountPence: 1499`; voucher `redeemed`, `upgradePaidPence: 0`.
5. Confirm the customer received the confirmation email.
6. Repeat with **digital + a canvas print** → total should be the print plus
   shipping, not £0. Voucher `upgradePaidPence` should equal what they paid.
7. Try the same code a second time → refused as already redeemed.
8. Enter a made-up code → refused, with no hint about the format.
9. **Double-submit test.** Get to Stripe, then press Back and submit again →
   you should return to the *same* Stripe session, and there should be exactly
   one commission doc and one active promotion code for that voucher.
10. **Cancel test.** Cancel out of Stripe → the wizard should still show the
    voucher banner, and re-submitting should work without re-entering the code.
11. **Cap test.** Use a high-value voucher on a low-value tier plus a print →
    the discount should equal the tier, not the voucher's face value.

Step 3 is the one that matters most: a fully-covered order produces a £0 Stripe
session, which reports `payment_status: no_payment_required` rather than `paid`.
The webhook handles that explicitly. If that handling is ever removed, every
free Groupon order will silently never be delivered.
