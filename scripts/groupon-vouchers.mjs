#!/usr/bin/env node
// scripts/groupon-vouchers.mjs
//
// Ops CLI for the Groupon voucher lifecycle. Everything you need to do between
// "Groupon sold a voucher" and "the money reconciles" lives here.
//
//   node --env-file=.env scripts/groupon-vouchers.mjs <command> [options]
//
// Commands
//   template [file]            Write a blank import CSV with the right headers.
//   import <file.csv>          Import vouchers sold on Groupon. Idempotent.
//   status [--campaign NAME]   Counts by status and campaign, plus money in/out.
//   lookup <code>              Everything we know about one voucher.
//   reconcile <file.csv>       Match a Groupon redemption report against us.
//   sweep                      Expire stale vouchers, release lapsed claims,
//                              deactivate orphaned Stripe promotion codes.
//   set-status <code> <status> Force a status by hand (audited in notes).
//
// Global options
//   --dry-run    Show what would change without writing anything.
//   --json       Machine-readable output.
//
// Requires SANITY_TOKEN (write) and, for `sweep`, STRIPE_SECRET_KEY.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createClient } from '@sanity/client';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = resolve(__dirname, '..', 'src', 'data', 'groupon-campaigns.json');

const argv = process.argv.slice(2);
const command = argv[0];
const positionals = argv.slice(1).filter((a) => !a.startsWith('--'));
const flags = new Set(argv.filter((a) => a.startsWith('--')));
const flagValue = (name) => {
  const hit = argv.find((a) => a.startsWith(`${name}=`));
  if (hit) return hit.slice(name.length + 1);
  const idx = argv.indexOf(name);
  return idx !== -1 ? argv[idx + 1] : undefined;
};

const DRY = flags.has('--dry-run');
const AS_JSON = flags.has('--json');

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

// ── small helpers ───────────────────────────────────────────────────────────

const GBP = (pence) => `£${((Number(pence) || 0) / 100).toFixed(2)}`;

function normaliseCode(input) {
  return String(input ?? '').toUpperCase().replace(/[\s\-_.]/g, '').trim();
}

function die(message) {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

function log(...args) {
  if (!AS_JSON) console.log(...args);
}

/**
 * Minimal RFC-4180 CSV reader. Groupon exports quote any field containing a
 * comma (option titles routinely do), so a naive split on commas silently
 * shifts every column after it — which would mis-price vouchers. Hence a real
 * parser rather than a one-liner.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
  if (nonEmpty.length === 0) return [];

  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (r[i] ?? '').trim(); });
    return obj;
  });
}

function toPence(value) {
  if (value == null || value === '') return null;
  const cleaned = String(value).replace(/[£$,\s]/g, '');
  if (!cleaned) return null;
  // A bare integer is ambiguous. Treat anything with a decimal point as pounds,
  // anything without as pence — and the template documents which to use.
  if (cleaned.includes('.')) return Math.round(parseFloat(cleaned) * 100);
  const n = parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : null;
}

function toIso(value) {
  if (!value) return null;
  const t = Date.parse(value);
  if (Number.isFinite(t)) return new Date(t).toISOString();
  // Groupon UK exports dd/mm/yyyy — Date.parse reads that as US mm/dd.
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) {
    const [, d, mo, y] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d)).toISOString();
  }
  return null;
}

function loadMap() {
  if (!existsSync(MAP_PATH)) die(`Campaign map not found at ${MAP_PATH}`);
  return JSON.parse(readFileSync(MAP_PATH, 'utf8'));
}

/** Resolve a CSV row onto a service + entitlement value. */
function resolveEntitlement(row, map) {
  const dealId = row.dealid || row.deal || '';
  const campaign = map.campaigns[dealId];

  let serviceSlug = row.serviceslug || campaign?.serviceSlug || '';
  let valuePence = toPence(row.valuepence ?? row.value ?? row.originalvalue);
  let orderType = row.ordertype || '';
  let dealPence = toPence(row.dealpence ?? row.paid ?? row.dealprice);
  const optionLabel = row.optionlabel || row.option || row.optiontitle || '';

  if (campaign) {
    let option = null;
    if (valuePence != null) {
      option = campaign.options.find((o) => o.valuePence === valuePence) || null;
    }
    if (!option && optionLabel) {
      const hay = optionLabel.toLowerCase();
      option = campaign.options.find((o) => o.match && hay.includes(o.match.toLowerCase())) || null;
    }
    if (!option && campaign.options.length === 1) option = campaign.options[0];

    if (option) {
      valuePence = valuePence ?? option.valuePence;
      orderType = orderType || option.orderType;
      dealPence = dealPence ?? option.dealPence;
    }
  }

  return {
    serviceSlug,
    valuePence,
    orderType: orderType || null,
    dealPence: dealPence ?? null,
    optionLabel: optionLabel || null,
    campaignName: campaign?.campaignName || row.campaignname || null,
    dealId: dealId || null,
  };
}

// ── commands ────────────────────────────────────────────────────────────────

async function cmdTemplate() {
  const target = positionals[0] || 'groupon-import-template.csv';
  const csv = [
    'code,dealId,optionLabel,valuePence,dealPence,purchasedAt,expiresAt,serviceSlug,orderType',
    '# code        — the Groupon voucher / security code (required)',
    '# dealId      — the campaign id; resolves service + value from groupon-campaign-map.json',
    '# optionLabel — the option title from Groupon; used to pick the right tier',
    '# valuePence  — original value. Use pence (1499) or pounds with a point (14.99)',
    '# dealPence   — what the customer paid Groupon. Reporting only',
    '# purchasedAt / expiresAt — any parseable date, or dd/mm/yyyy',
    '# serviceSlug / orderType — only needed to override the map',
    'GN4B7KQ2X9,db3e255f-955c-41b1-afea-750f2425baaf,Cartoonify Me digital,1499,1099,01/08/2026,01/08/2027,,',
  ].join('\n');
  if (DRY) { log(csv); return; }
  writeFileSync(target, csv + '\n', 'utf8');
  log(`\n  Template written to ${target}\n`);
}

async function cmdImport() {
  const file = positionals[0];
  if (!file) die('Usage: import <file.csv>');
  if (!existsSync(file)) die(`File not found: ${file}`);

  const map = loadMap();
  const rows = parseCsv(readFileSync(file, 'utf8')).filter((r) => r.code && !r.code.startsWith('#'));
  if (rows.length === 0) die('No rows found in that file.');

  const batch = flagValue('--batch') || `import-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}`;

  // Resolve the service references once rather than per row.
  const slugs = [...new Set(rows.map((r) => resolveEntitlement(r, map).serviceSlug).filter(Boolean))];
  const services = await sanity.fetch(
    `*[_type == "service" && slug.current in $slugs]{ _id, title, "slug": slug.current }`,
    { slugs }
  );
  const serviceBySlug = Object.fromEntries(services.map((s) => [s.slug, s]));

  const codes = rows.map((r) => normaliseCode(r.code));
  const existing = await sanity.fetch(
    `*[_type == "grouponVoucher" && code in $codes]{
      _id, code, status, serviceSlug, valuePence, verificationStatus, notes, orderRef,
      "commissionId": commission->_id
    }`,
    { codes }
  );
  const existingByCode = Object.fromEntries(existing.map((v) => [v.code, v]));

  const created = [];
  const skipped = [];
  const errors = [];
  const autoVerified = [];
  const autoMismatched = [];

  for (const row of rows) {
    const code = normaliseCode(row.code);
    if (!code) { errors.push({ row: row.code, reason: 'blank code' }); continue; }

    const already = existingByCode[code];
    if (already) {
      // The code is already here — but if it arrived via a customer redeeming
      // before we had imported it, this row is Groupon confirming it is real.
      // Verifying here means most held orders clear on the next import with no
      // separate step, and only genuinely unexplained codes need a lookup.
      if (already.verificationStatus === 'unchecked' || already.verificationStatus === 'mismatch') {
        const ent = resolveEntitlement(row, map);
        const serviceOk = !ent.serviceSlug || ent.serviceSlug === already.serviceSlug;
        const valueOk = !ent.valuePence || ent.valuePence === already.valuePence;
        if (serviceOk && valueOk) {
          if (!DRY) await markVerified(already, 'import');
          autoVerified.push({ code, orderRef: already.orderRef });
        } else {
          const detail =
            `customer claimed ${already.serviceSlug} ${GBP(already.valuePence)}; ` +
            `Groupon says ${ent.serviceSlug || '?'} ${ent.valuePence ? GBP(ent.valuePence) : '?'}`;
          if (!DRY) await markProblem(already, 'mismatch', `Mismatch found during import: ${detail}`);
          autoMismatched.push({ code, detail });
        }
        continue;
      }
      skipped.push({ code, reason: `already imported (${already.status})` });
      continue;
    }

    const ent = resolveEntitlement(row, map);
    if (!ent.serviceSlug) {
      errors.push({ code, reason: `no service — deal id "${ent.dealId}" is not in groupon-campaign-map.json and no serviceSlug column was given` });
      continue;
    }
    if (!serviceBySlug[ent.serviceSlug]) {
      errors.push({ code, reason: `service "${ent.serviceSlug}" does not exist in Sanity` });
      continue;
    }
    if (!ent.valuePence || ent.valuePence <= 0) {
      errors.push({ code, reason: 'could not work out the entitlement value — add a valuePence column or map the option' });
      continue;
    }

    const doc = {
      _type: 'grouponVoucher',
      code,
      status: 'imported',
      dealId: ent.dealId || undefined,
      campaignName: ent.campaignName || undefined,
      optionLabel: ent.optionLabel || undefined,
      service: { _type: 'reference', _ref: serviceBySlug[ent.serviceSlug]._id },
      serviceSlug: ent.serviceSlug,
      entitlementOrderType: ent.orderType || undefined,
      valuePence: ent.valuePence,
      paidPence: ent.dealPence ?? undefined,
      purchasedAt: toIso(row.purchasedat) || undefined,
      expiresAt: toIso(row.expiresat) || undefined,
      verified: true,
      verificationStatus: 'verified',
      claimCount: 0,
      importBatch: batch,
    };

    if (DRY) {
      created.push({ code, serviceSlug: ent.serviceSlug, valuePence: ent.valuePence, orderType: ent.orderType });
      continue;
    }
    try {
      await sanity.create(doc);
      created.push({ code, serviceSlug: ent.serviceSlug, valuePence: ent.valuePence, orderType: ent.orderType });
    } catch (e) {
      errors.push({ code, reason: e.message });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ batch, created, skipped, errors, autoVerified, autoMismatched, dryRun: DRY }, null, 2));
    return;
  }

  log(`\n  Groupon import ${DRY ? '(dry run) ' : ''}— batch ${batch}`);
  log(`  ${'─'.repeat(60)}`);
  log(`  Imported        : ${created.length}`);
  log(`  Orders released : ${autoVerified.length}${autoVerified.length ? '  ← were on hold' : ''}`);
  log(`  Mismatches      : ${autoMismatched.length}`);
  log(`  Skipped         : ${skipped.length}  (already present)`);
  log(`  Errors          : ${errors.length}`);
  if (created.length) {
    const byService = {};
    for (const c of created) byService[c.serviceSlug] = (byService[c.serviceSlug] || 0) + 1;
    log('');
    for (const [slug, n] of Object.entries(byService).sort()) log(`    ${slug.padEnd(24)} ${n}`);
  }
  if (autoVerified.length) {
    log('\n  Released for work — Groupon confirmed these codes:');
    for (const a of autoVerified) log(`    ✓ ${a.code.padEnd(18)} ${a.orderRef || ''}`);
  }
  if (autoMismatched.length) {
    log('\n  ⚠ Ordered something other than what Groupon sold them — contact before working:');
    for (const a of autoMismatched) {
      log(`    ${a.code.padEnd(18)} ${a.detail}`);
    }
  }
  if (errors.length) {
    log('\n  Errors:');
    for (const e of errors) log(`    ${String(e.code).padEnd(16)} ${e.reason}`);
    log('\n  Nothing was imported for those rows. Fix them and re-run — codes already');
    log('  imported are skipped, so it is safe to re-run the whole file.');
  }
  log('');
  if (errors.length) process.exitCode = 1;
}

async function cmdStatus() {
  const campaign = flagValue('--campaign');
  const filter = campaign ? ` && campaignName match $campaign` : '';
  const params = campaign ? { campaign: `${campaign}*` } : {};

  const rows = await sanity.fetch(
    `*[_type == "grouponVoucher"${filter}]{
      status, campaignName, serviceSlug, valuePence, paidPence,
      discountAppliedPence, upgradePaidPence, verified, flags
    }`,
    params
  );

  const byStatus = {};
  const byCampaign = {};
  let redeemedValue = 0;
  let upgradeRevenue = 0;
  let unverified = 0;
  let flagged = 0;

  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const key = r.campaignName || r.serviceSlug || 'unmapped';
    byCampaign[key] = byCampaign[key] || { total: 0, redeemed: 0, upgrade: 0 };
    byCampaign[key].total++;
    if (r.status === 'redeemed') {
      byCampaign[key].redeemed++;
      redeemedValue += r.discountAppliedPence || 0;
      upgradeRevenue += r.upgradePaidPence || 0;
      byCampaign[key].upgrade += r.upgradePaidPence || 0;
    }
    if (r.verified === false) unverified++;
    if (Array.isArray(r.flags) && r.flags.length) flagged++;
  }

  if (AS_JSON) {
    console.log(JSON.stringify({ total: rows.length, byStatus, byCampaign, redeemedValue, upgradeRevenue, unverified, flagged }, null, 2));
    return;
  }

  log(`\n  Groupon vouchers — ${rows.length} total`);
  log(`  ${'─'.repeat(66)}`);
  for (const [status, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    log(`    ${status.padEnd(12)} ${String(n).padStart(5)}`);
  }
  log(`\n  By campaign`);
  log(`    ${'campaign'.padEnd(26)} ${'sold'.padStart(6)} ${'redeemed'.padStart(9)} ${'upgrades'.padStart(10)}`);
  for (const [name, c] of Object.entries(byCampaign).sort((a, b) => b[1].total - a[1].total)) {
    log(`    ${name.slice(0, 26).padEnd(26)} ${String(c.total).padStart(6)} ${String(c.redeemed).padStart(9)} ${GBP(c.upgrade).padStart(10)}`);
  }
  log(`\n  Value redeemed (covered by vouchers) : ${GBP(redeemedValue)}`);
  log(`  Paid to us on top of vouchers        : ${GBP(upgradeRevenue)}`);
  if (unverified) log(`\n  ⚠ ${unverified} unverified voucher(s) — reconcile before delivering.`);
  if (flagged) log(`  ⚠ ${flagged} voucher(s) carry flags — check them in the Studio.`);
  log('');
}

async function cmdLookup() {
  const code = normaliseCode(positionals[0]);
  if (!code) die('Usage: lookup <code>');
  const v = await sanity.fetch(
    `*[_type == "grouponVoucher" && code == $code][0]{
      ..., "serviceTitle": service->title, "commissionRef": commission->orderRef
    }`,
    { code }
  );
  if (!v) die(`No voucher found with code ${code}`);
  if (AS_JSON) { console.log(JSON.stringify(v, null, 2)); return; }
  log(`\n  ${v.code}  —  ${v.status.toUpperCase()}`);
  log(`  ${'─'.repeat(60)}`);
  log(`    Campaign      ${v.campaignName || '—'}`);
  log(`    Option        ${v.optionLabel || '—'}`);
  log(`    Service       ${v.serviceTitle || v.serviceSlug}`);
  log(`    Worth         ${GBP(v.valuePence)}${v.paidPence ? `  (customer paid Groupon ${GBP(v.paidPence)})` : ''}`);
  log(`    Purchased     ${v.purchasedAt || '—'}`);
  log(`    Expires       ${v.expiresAt || 'no expiry'}`);
  log(`    Claims        ${v.claimCount || 0}`);
  if (v.status === 'redeemed') {
    log(`    Order         ${v.orderRef || v.commissionRef || '—'}  (${v.customerEmail || 'no email'})`);
    log(`    Redeemed      ${v.redeemedAt}`);
    log(`    Covered       ${GBP(v.discountAppliedPence)} — customer paid us ${GBP(v.upgradePaidPence)} on top`);
  }
  if (v.verified === false) log(`    ⚠ UNVERIFIED — not matched to a Groupon import`);
  if (v.flags?.length) log(`    ⚠ Flags: ${v.flags.join(', ')}`);
  if (v.notes) log(`    Notes: ${v.notes}`);
  log('');
}

async function cmdReconcile() {
  const file = positionals[0];
  if (!file) die('Usage: reconcile <groupon-report.csv>');
  if (!existsSync(file)) die(`File not found: ${file}`);

  const rows = parseCsv(readFileSync(file, 'utf8')).filter((r) => r.code && !r.code.startsWith('#'));
  const reportCodes = new Set(rows.map((r) => normaliseCode(r.code)));

  const ours = await sanity.fetch(
    `*[_type == "grouponVoucher" && status != "void"]{
      _id, code, status, valuePence, verified, orderRef, flags
    }`
  );
  const oursByCode = Object.fromEntries(ours.map((v) => [v.code, v]));

  // Three ways the two sides can disagree, each meaning something different.
  const missingHere = [...reportCodes].filter((c) => !oursByCode[c]);
  const redeemedNotInReport = ours.filter((v) => v.status === 'redeemed' && !reportCodes.has(v.code));
  const unverifiedNowConfirmed = ours.filter((v) => v.verified === false && reportCodes.has(v.code));

  if (AS_JSON) {
    console.log(JSON.stringify({
      reportRows: rows.length,
      missingHere,
      redeemedNotInReport: redeemedNotInReport.map((v) => ({ code: v.code, orderRef: v.orderRef })),
      unverifiedNowConfirmed: unverifiedNowConfirmed.map((v) => v.code),
    }, null, 2));
    return;
  }

  log(`\n  Reconciliation against ${file}`);
  log(`  ${'─'.repeat(66)}`);
  log(`  Rows in Groupon report        : ${rows.length}`);
  log(`  Vouchers we hold              : ${ours.length}`);
  log('');

  if (missingHere.length) {
    log(`  ⚠ ${missingHere.length} code(s) in the Groupon report that we have never imported.`);
    log(`    These customers can't redeem. Import them:`);
    for (const c of missingHere.slice(0, 20)) log(`      ${c}`);
    if (missingHere.length > 20) log(`      … and ${missingHere.length - 20} more`);
    log('');
  }

  if (redeemedNotInReport.length) {
    log(`  ⚠ ${redeemedNotInReport.length} voucher(s) redeemed here but absent from the report.`);
    log(`    Either the report is older than the redemption, or the code was never`);
    log(`    genuinely sold. Check each one before delivering the work:`);
    for (const v of redeemedNotInReport.slice(0, 20)) log(`      ${v.code.padEnd(16)} ${v.orderRef || ''}`);
    if (redeemedNotInReport.length > 20) log(`      … and ${redeemedNotInReport.length - 20} more`);
    log('');
  }

  if (unverifiedNowConfirmed.length) {
    log(`  ${unverifiedNowConfirmed.length} previously-unverified voucher(s) now confirmed by Groupon.`);
    if (!DRY) {
      for (const v of unverifiedNowConfirmed) {
        await sanity.patch(v._id)
          .set({ verified: true, reconciledAt: new Date().toISOString() })
          .unset(['flags[@ == "unverified"]'])
          .commit();
      }
      log(`  Marked verified.`);
    } else {
      log(`  (dry run — not marking them)`);
    }
    log('');
  }

  if (!missingHere.length && !redeemedNotInReport.length && !unverifiedNowConfirmed.length) {
    log('  ✓ Both sides agree. Nothing to do.\n');
  }
}

async function cmdSweep() {
  const now = new Date().toISOString();

  // Vouchers whose claim window lapsed WITHOUT a paid order behind them.
  // The `commission->paidAt` guard is the important half: a webhook that failed
  // to finalise leaves a paid voucher sitting in `checkout`, and releasing that
  // would make a spent voucher redeemable all over again.
  const stale = await sanity.fetch(
    `*[_type == "grouponVoucher" && status in ["claimed","checkout"]
        && defined(claimExpiresAt) && claimExpiresAt < $now
        && !defined(commission->paidAt)]{
      _id, code, status, stripePromotionCodeId
    }`,
    { now }
  );

  // The mirror image: paid orders whose voucher never got finalised. These are
  // repaired here rather than left for someone to notice.
  const strandedPaid = await sanity.fetch(
    `*[_type == "grouponVoucher" && status in ["claimed","checkout"] && defined(commission->paidAt)]{
      _id, code, orderRef,
      "paidAt": commission->paidAt,
      "commissionId": commission->_id
    }`
  );

  const expired = await sanity.fetch(
    `*[_type == "grouponVoucher" && status in ["imported","claimed","checkout"]
        && defined(expiresAt) && expiresAt < $now
        && !defined(commission->paidAt)]{
      _id, code
    }`,
    { now }
  );

  log(`\n  Sweep ${DRY ? '(dry run)' : ''}`);
  log(`  ${'─'.repeat(60)}`);
  log(`  Lapsed claims to release : ${stale.length}`);
  log(`  Vouchers past expiry     : ${expired.length}`);
  log(`  Paid but not finalised   : ${strandedPaid.length}${strandedPaid.length ? '  ← repairing' : ''}`);

  if (!DRY) {
    // Repair first — a stranded voucher must not linger a moment longer than
    // needed, and the release loop below deliberately never touches these.
    for (const v of strandedPaid) {
      await sanity.patch(v._id)
        .set({
          status: 'redeemed',
          redeemedAt: v.paidAt,
          notes: `[${now}] finalised by sweep — the payment webhook did not complete this voucher.`,
        })
        .unset(['claimTokenHash', 'claimExpiresAt'])
        .commit();
      log(`    repaired ${v.code} → redeemed (${v.orderRef || v.commissionId})`);
    }

    // Release lapsed claims back to `imported` so the customer can start again.
    for (const v of stale) {
      await sanity.patch(v._id)
        .set({ status: 'imported' })
        .unset(['claimTokenHash', 'claimExpiresAt', 'stripePromotionCodeId', 'stripeSessionId'])
        .commit();
    }

    // Orphaned single-use promotion codes are harmless once expired, but
    // deactivating them keeps the Stripe dashboard readable and removes any
    // chance of one being applied by hand.
    const withPromo = stale.filter((v) => v.stripePromotionCodeId);
    if (withPromo.length) {
      if (!process.env.STRIPE_SECRET_KEY) {
        log(`  ⚠ ${withPromo.length} promotion code(s) left active — STRIPE_SECRET_KEY not set.`);
      } else {
        const { default: Stripe } = await import('stripe');
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        let done = 0;
        for (const v of withPromo) {
          try { await stripe.promotionCodes.update(v.stripePromotionCodeId, { active: false }); done++; }
          catch (e) { log(`    could not deactivate ${v.stripePromotionCodeId}: ${e.message}`); }
        }
        log(`  Deactivated ${done} orphaned promotion code(s).`);
      }
    }

    for (const v of expired) {
      await sanity.patch(v._id).set({ status: 'expired' }).commit();
    }
    log(`  Done.`);
  }
  log('');
}

async function cmdSetStatus() {
  const code = normaliseCode(positionals[0]);
  const status = positionals[1];
  const allowed = ['imported', 'claimed', 'checkout', 'redeemed', 'expired', 'refunded', 'void'];
  if (!code || !status) die('Usage: set-status <code> <status>');
  if (!allowed.includes(status)) die(`Status must be one of: ${allowed.join(', ')}`);

  const v = await sanity.fetch(`*[_type == "grouponVoucher" && code == $code][0]{ _id, code, status, notes }`, { code });
  if (!v) die(`No voucher found with code ${code}`);

  log(`\n  ${v.code}: ${v.status} → ${status}${DRY ? ' (dry run)' : ''}`);
  if (DRY) { log(''); return; }

  const stamp = `[${new Date().toISOString()}] status ${v.status} → ${status} via CLI`;
  await sanity.patch(v._id)
    .set({ status, notes: v.notes ? `${v.notes}\n${stamp}` : stamp })
    .commit();
  log('  Done.\n');
}


// ── verification ────────────────────────────────────────────────────────────

/**
 * Release an order for work: the voucher is real and matches what was ordered.
 * Clearing the commission's hold is the whole point — the voucher record alone
 * changes nothing about whether the work can be made.
 */
async function markVerified(voucher, source) {
  await sanity
    .patch(voucher._id)
    .set({
      verificationStatus: 'verified',
      verified: true,
      reconciledAt: new Date().toISOString(),
    })
    .unset(['flags[@ == "unverified"]'])
    .commit();

  if (voucher.commissionId) {
    await sanity.patch(voucher.commissionId).set({ awaitingVoucherCheck: false }).commit();
  }
  return `${voucher.code} verified (${source})`;
}

async function markProblem(voucher, status, note) {
  const stamp = `[${new Date().toISOString()}] ${note}`;
  await sanity
    .patch(voucher._id)
    .set({
      verificationStatus: status,
      verified: false,
      reconciledAt: new Date().toISOString(),
      notes: voucher.notes ? `${voucher.notes}\n${stamp}` : stamp,
    })
    .commit();
}

const PENDING_PROJECTION = `{
  _id, code, status, serviceSlug, valuePence, optionLabel, campaignName,
  declaredDealKey, verificationStatus, orderRef, customerEmail, notes,
  claimIp, _createdAt,
  "commissionId": commission->_id,
  "commissionStatus": commission->status,
  "commissionPaidAt": commission->paidAt,
  "customerName": commission->customerName
}`;

async function cmdPending() {
  const rows = await sanity.fetch(
    `*[_type == "grouponVoucher" && verificationStatus in ["unchecked","mismatch"]
        && defined(commission->paidAt)] | order(_createdAt asc) ${PENDING_PROJECTION}`
  );

  if (AS_JSON) { console.log(JSON.stringify(rows, null, 2)); return; }

  if (rows.length === 0) {
    log('\n  ✓ Nothing waiting. Every paid Groupon order has a confirmed voucher.\n');
    return;
  }

  log(`\n  ${rows.length} order(s) held pending a voucher check`);
  log(`  ${'─'.repeat(74)}`);
  log(`  Look each code up in Merchant Center → Redeem. Confirm the deal matches,`);
  log(`  mark it redeemed there, then release it here.\n`);

  for (const v of rows) {
    const flag = v.verificationStatus === 'mismatch' ? '  ⚠ MISMATCH' : '';
    log(`  ${v.code.padEnd(18)} ${GBP(v.valuePence).padStart(8)}  ${(v.campaignName || v.serviceSlug || '').slice(0, 24).padEnd(24)}${flag}`);
    log(`  ${''.padEnd(18)} ${(v.optionLabel || '').slice(0, 46)}`);
    log(`  ${''.padEnd(18)} order ${v.orderRef || '—'} · ${v.customerName || ''} <${v.customerEmail || ''}>`);
    log('');
  }

  log(`  Release them all at once from a Groupon export:`);
  log(`    node --env-file=.env scripts/groupon-vouchers.mjs verify export.csv\n`);
  log(`  Or one at a time after looking it up:`);
  log(`    node --env-file=.env scripts/groupon-vouchers.mjs confirm ${rows[0].code}`);
  log(`    node --env-file=.env scripts/groupon-vouchers.mjs confirm ${rows[0].code} --reject\n`);
}

/**
 * Bulk verification. This is what stops the manual check scaling with volume:
 * one export from Merchant Center clears every order it covers, and only the
 * codes the export does NOT explain are left for a human.
 */
async function cmdVerify() {
  const file = positionals[0];
  if (!file) die('Usage: verify <groupon-export.csv>   (any export containing a code column)');
  if (!existsSync(file)) die(`File not found: ${file}`);

  const map = loadMap();
  const rows = parseCsv(readFileSync(file, 'utf8')).filter((r) => r.code && !r.code.startsWith('#'));
  if (rows.length === 0) die('No rows with a "code" column found in that file.');

  // What the export says each code actually is.
  const fromExport = new Map();
  for (const row of rows) {
    const code = normaliseCode(row.code);
    if (code) fromExport.set(code, resolveEntitlement(row, map));
  }

  const pending = await sanity.fetch(
    `*[_type == "grouponVoucher" && verificationStatus in ["unchecked","mismatch"]] ${PENDING_PROJECTION}`
  );

  const verified = [];
  const mismatched = [];
  const missing = [];

  for (const v of pending) {
    const truth = fromExport.get(v.code);
    if (!truth) { missing.push(v); continue; }

    // The export knows the real deal. If the customer declared something else,
    // the credit already applied was wrong — that needs a human, not a flag.
    const serviceOk = !truth.serviceSlug || truth.serviceSlug === v.serviceSlug;
    const valueOk = !truth.valuePence || truth.valuePence === v.valuePence;

    if (serviceOk && valueOk) {
      if (!DRY) await markVerified(v, 'export');
      verified.push(v);
    } else {
      const detail =
        `customer claimed ${v.serviceSlug} ${GBP(v.valuePence)}; ` +
        `Groupon says ${truth.serviceSlug || '?'} ${truth.valuePence ? GBP(truth.valuePence) : '?'}`;
      if (!DRY) await markProblem(v, 'mismatch', `Mismatch against export: ${detail}`);
      mismatched.push({ v, detail });
    }
  }

  if (AS_JSON) {
    console.log(JSON.stringify({
      exportRows: rows.length,
      verified: verified.map((v) => v.code),
      mismatched: mismatched.map((m) => ({ code: m.v.code, detail: m.detail })),
      stillUnchecked: missing.map((v) => v.code),
      dryRun: DRY,
    }, null, 2));
    return;
  }

  log(`\n  Verification against ${file}${DRY ? ' (dry run)' : ''}`);
  log(`  ${'─'.repeat(74)}`);
  log(`  Codes in export        : ${fromExport.size}`);
  log(`  Orders released        : ${verified.length}`);
  log(`  Mismatches             : ${mismatched.length}`);
  log(`  Still unexplained      : ${missing.length}`);

  if (verified.length) {
    log('');
    for (const v of verified) log(`    ✓ ${v.code.padEnd(18)} ${v.orderRef || ''}`);
  }
  if (mismatched.length) {
    log(`\n  ⚠ These ordered something other than what Groupon sold them.`);
    log(`    The credit already applied was wrong — contact the customer before working:`);
    for (const m of mismatched) {
      log(`    ${m.v.code.padEnd(18)} ${m.v.orderRef || ''}`);
      log(`    ${''.padEnd(18)} ${m.detail}`);
    }
  }
  if (missing.length) {
    log(`\n  ${missing.length} code(s) this export does not cover. Either the export predates`);
    log(`  them, or the codes are not real. Re-export with a wider date range, then`);
    log(`  look up whatever still will not match:`);
    for (const v of missing.slice(0, 15)) log(`    ${v.code.padEnd(18)} ${v.orderRef || ''}`);
    if (missing.length > 15) log(`    … and ${missing.length - 15} more`);
  }
  log('');
}

/** Single code, after you have looked it up in Merchant Center by hand. */
async function cmdConfirm() {
  const code = normaliseCode(positionals[0]);
  if (!code) die('Usage: confirm <code> [--reject]');

  const v = await sanity.fetch(
    `*[_type == "grouponVoucher" && code == $code][0] ${PENDING_PROJECTION}`,
    { code }
  );
  if (!v) die(`No voucher found with code ${code}`);

  const reject = flags.has('--reject');

  if (DRY) {
    log(`\n  ${code}: would be marked ${reject ? 'REJECTED' : 'VERIFIED'} (dry run)\n`);
    return;
  }

  if (reject) {
    await markProblem(v, 'rejected', 'Rejected after a Merchant Center lookup — Groupon has no such voucher.');
    log(`\n  ${code} marked rejected. Order ${v.orderRef || ''} stays on hold.`);
    log(`  Refund or cancel it, then void the voucher:`);
    log(`    node --env-file=.env scripts/groupon-vouchers.mjs set-status ${code} void\n`);
    return;
  }

  log(`\n  ${await markVerified(v, 'manual')}`);
  log(`  Order ${v.orderRef || ''} released for work.\n`);
}

// ── dispatch ────────────────────────────────────────────────────────────────

const commands = {
  template: cmdTemplate,
  import: cmdImport,
  status: cmdStatus,
  lookup: cmdLookup,
  reconcile: cmdReconcile,
  pending: cmdPending,
  verify: cmdVerify,
  confirm: cmdConfirm,
  sweep: cmdSweep,
  'set-status': cmdSetStatus,
};

if (!command || command === '--help' || command === '-h' || !commands[command]) {
  console.log(`
  Groupon voucher ops

    node --env-file=.env scripts/groupon-vouchers.mjs <command>

    pending                     Orders held waiting on a voucher check
    verify <export.csv>         Release every order a Groupon export confirms
    confirm <code> [--reject]   Release (or reject) one code after a lookup

    template [file]             Blank import CSV with the right headers
    import <file.csv>           Import vouchers sold on Groupon (idempotent)
    status [--campaign NAME]    Counts, and how much came in on top of vouchers
    lookup <code>               Everything about one voucher
    reconcile <report.csv>      Compare a Groupon report against our records
    sweep                       Release lapsed claims, expire old vouchers
    set-status <code> <status>  Force a status by hand

    --dry-run   change nothing
    --json      machine-readable output
`);
  process.exit(command && !commands[command] ? 1 : 0);
}

if (!process.env.SANITY_TOKEN) {
  die('SANITY_TOKEN is not set. Run with:  node --env-file=.env scripts/groupon-vouchers.mjs …');
}

commands[command]().catch((err) => {
  console.error(`\n  ✗ ${command} failed: ${err.message}\n`);
  process.exit(1);
});
