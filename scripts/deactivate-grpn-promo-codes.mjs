// scripts/deactivate-grpn-promo-codes.mjs
//
// One-off, for the switch from Groupon promotion codes to minted coupons.
//
// Before feat/promo-codes, every voucher checkout minted a single-use
// promotion code (GRPN + 10 hex). They lapse after an hour, but any still
// active when the promo box goes live (allow_promotion_codes) could be typed
// into a shop or commission checkout. This lists every still-active one and,
// with --apply, deactivates it. Deactivation is reversible in the Dashboard;
// nothing is deleted.
//
// A code counts as a Groupon code when it starts "GRPN" OR its metadata says
// source = "groupon". Anything else (PIX10 and the like) is never touched.
//
// Usage
//   node --env-file=.env scripts/deactivate-grpn-promo-codes.mjs            # dry run: list only
//   node --env-file=.env scripts/deactivate-grpn-promo-codes.mjs --apply    # deactivate them
//
// Requires STRIPE_SECRET_KEY. Prints the account and mode, never the key.

import Stripe from 'stripe';

const APPLY = process.argv.includes('--apply');
const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}
const mode = key.startsWith('sk_test_') || key.startsWith('rk_test_') ? 'TEST' : 'LIVE';
const stripe = new Stripe(key, { apiVersion: '2024-12-18.acacia' });

const isGroupon = (p) => /^GRPN/i.test(p.code || '') || p.metadata?.source === 'groupon';

const account = await stripe.accounts.retrieve();
console.log(`\n  Account ${account.id} (${account.settings?.dashboard?.display_name || 'unnamed'}) — ${mode} mode`);
console.log(`  ${APPLY ? 'APPLYING: active Groupon promotion codes will be deactivated.' : 'Dry run: nothing will be changed. Re-run with --apply to deactivate.'}\n`);

const found = [];
let scanned = 0;
for await (const p of stripe.promotionCodes.list({ active: true, limit: 100 })) {
  scanned++;
  if (isGroupon(p)) found.push(p);
}

const when = (t) => (t ? new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16) : 'never');
for (const p of found) {
  console.log(`  ${p.code.padEnd(16)} ${p.id}  expires ${when(p.expires_at)}  used ${p.times_redeemed}/${p.max_redemptions ?? '∞'}` +
    `${p.metadata?.grouponVoucherId ? `  voucher ${p.metadata.grouponVoucherId}` : ''}`);
}
console.log(`\n  ${scanned} active promotion code(s) scanned, ${found.length} Groupon code(s) active.`);

if (!APPLY || !found.length) process.exit(0);

let done = 0, failed = 0;
for (const p of found) {
  try {
    await stripe.promotionCodes.update(p.id, { active: false });
    done++;
  } catch (e) {
    failed++;
    console.error(`  could not deactivate ${p.code} (${p.id}): ${e.message}`);
  }
}
console.log(`  Deactivated ${done}${failed ? `, ${failed} failed` : ''}.`);
process.exit(failed ? 1 : 0);
