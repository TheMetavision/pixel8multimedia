# Groupon fulfilment — runbook

How a Groupon voucher becomes a finished piece of work, and what to do when it
doesn't. Everything here is live in the repo; nothing depends on a spreadsheet.

---

## The shape of it

```
Groupon sells a voucher
        │
        │  you export the voucher list from Merchant Center
        ▼
  import  ──►  Sanity: grouponVoucher (status: imported)
        │
        │  customer visits pixel8multimedia.co.uk/groupon and types their code
        ▼
  groupon-redeem  ──►  status: claimed  +  a 2-hour claim token
        │
        │  customer goes through the normal commission wizard
        ▼
  commission-checkout  ──►  status: checkout
        │                    Stripe coupon (amount_off) + single-use promo code
        │                    commission doc created, source = "groupon"
        ▼
  Stripe Checkout  ──►  £0.00 if the voucher covers it, or the upgrade difference
        │
        ▼
  stripe-webhook-commission  ──►  status: redeemed, commission marked paid
        │
        ▼
  the existing pipeline takes over — Sanity delivery webhook, Resend, download link
```

The Groupon order joins the normal pipeline at the point of payment. There is
one production process, not two.

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

## Weekly: importing vouchers

Groupon does not push voucher data to us, so the import is the one recurring
manual step. Do it at least as often as vouchers sell — a customer whose code
hasn't been imported cannot redeem.

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

- **not found** — not imported yet. Import, then tell them to try again.
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
- The claim token is single-use, expires in two hours, and is stored only as a
  SHA-256 hash. It never appears in a URL. It travels in sessionStorage and, as
  a backstop for browsers that block site data, in an HttpOnly cookie — so a
  customer in a private window is never silently charged full price.
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

`GROUPON_ALLOW_UNVERIFIED` turns off the first of those. It exists for the case
where Groupon volume outruns the import cadence and customers are being turned
away. It is off by default and should stay off. If it goes on, check the
unverified queue every day and reconcile weekly, not monthly.

---

## What still needs doing before launch

- [ ] **Deploy the Studio schema.** `grouponVoucher` won't appear until the studio
      is redeployed (`cd studio && npx sanity deploy`).
- [ ] **Test the whole flow in Stripe test mode** — see the checklist below.
- [ ] **Set the voucher instructions on each Groupon campaign** to point at
      `https://pixel8multimedia.co.uk/groupon`. Currently they point at the
      service URLs, which sends customers to a page that will charge them full
      price. This is the one change that must happen before a single voucher
      sells.
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
