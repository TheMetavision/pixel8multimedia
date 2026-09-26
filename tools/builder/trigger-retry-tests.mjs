/**
 * The hourly sweep re-trying failed triggers.
 *
 *   node tools/builder/trigger-retry-tests.mjs
 *
 * A doc flagged proofTriggerError / printTriggerError is retried each hour, up
 * to 3 times, then left in Studio's "Needs attention" list with its count.
 */
import { retryPlan, retryFlagged, MAX_TRIGGER_RETRIES } from '../../netlify/functions/_shared/trigger-retry.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);

/** A fake Sanity + trigger pair that records what the sweep did. */
function harness(results = {}) {
  const calls = [];
  const patches = [];
  return {
    calls, patches,
    trigger: async (path, pid) => {
      calls.push({ path, pid });
      const r = results[path];
      return typeof r === 'function' ? r() : (r ?? { ok: true, status: 200 });
    },
    patch: async (id, p) => { patches.push({ id, ...p }); },
    nowIso: () => '2026-09-26T12:00:00.000Z',
  };
}
const PROOF = '/api/personalisation/proof';
const PRINT = '/api/personalisation/print-background';
const doc = (over) => ({ _id: 'pendingPersonalisation.p1', pid: 'p1', status: 'paid', ...over });

say('\n1. WHAT EACH FLAG GETS\n');
{
  const plan = (d) => retryPlan(d).map((s) => `${s.kind}:${s.action}`).join(',');
  ok(plan(doc({ proofTriggerError: 'x' })) === 'proof:retry', 'paid + proof flag → retry the proof');
  ok(plan(doc({ status: 'proof-sent', proofTriggerError: 'x' })) === 'proof:clear', 'proof already sent (e.g. resent by hand) → just clear the flag');
  ok(plan(doc({ status: 'approved', printTriggerError: 'x' })) === 'print:retry', 'approved + print flag → retry the print build');
  ok(plan(doc({ status: 'approved', printTriggerError: 'x', printBuiltAt: 't' })) === 'print:clear', 'print file already built → just clear');
  ok(plan(doc({ proofTriggerError: 'x', triggerRetries: MAX_TRIGGER_RETRIES })) === 'proof:gave-up', `after ${MAX_TRIGGER_RETRIES} retries → give up`);
  ok(plan(doc({ status: 'expired', printTriggerError: 'x' })) === 'print:skip', 'an odd status is skipped, not triggered');
  ok(plan(doc({})) === '', 'no flags → nothing');
}

say('\n2. RETRY SUCCEEDS → FLAG CLEARED\n');
{
  const h = harness();
  const s = await retryFlagged([doc({ proofTriggerError: 'old', triggerRetries: 1 })], h);
  ok(h.calls.length === 1 && h.calls[0].path === PROOF && h.calls[0].pid === 'p1', 'the proof endpoint is called for that pid');
  const p = h.patches[0];
  ok(p && p.unset.includes('proofTriggerError') && p.unset.includes('triggerRetries') && !p.inc && !p.set, 'flag and count cleared, nothing incremented', JSON.stringify(p));
  ok(s.recovered === 1 && s.failed === 0, 'summary: 1 recovered');
}

say('\n3. RETRY FAILS → COUNTED, FLAG KEPT\n');
{
  const h = harness({ [PROOF]: { ok: false, error: 'HTTP 503' } });
  const s = await retryFlagged([doc({ proofTriggerError: 'old' })], h);
  const p = h.patches[0];
  ok(p.inc?.triggerRetries === 1, 'triggerRetries + 1');
  ok(/retry: HTTP 503/.test(p.set?.proofTriggerError) && !p.unset, 'the flag stays, with the new reason', p.set?.proofTriggerError);
  ok(s.failed === 1, 'summary: 1 failed');
}

say('\n4. FOUR HOURS OF FAILURE → THREE TRIES, THEN LEFT ALONE\n');
{
  const d = doc({ proofTriggerError: 'webhook: timed out' });
  let tries = 0;
  for (let hour = 1; hour <= 4; hour++) {
    const h = harness({ [PROOF]: () => { tries++; return { ok: false, error: 'fetch failed' }; } });
    await retryFlagged([d], h);
    // apply the patch to our copy, as Sanity would
    for (const p of h.patches) {
      if (p.set) Object.assign(d, p.set);
      if (p.inc) d.triggerRetries = (d.triggerRetries || 0) + p.inc.triggerRetries;
    }
  }
  ok(tries === 3 && d.triggerRetries === 3, 'tried in hours 1–3, not in hour 4', `${tries} tries, triggerRetries=${d.triggerRetries}`);
  ok(Boolean(d.proofTriggerError), 'the flag is still set, so it stays in Needs attention with its count');
}

say('\n5. BOTH FLAGS, MIXED RESULT\n');
{
  const h = harness({ [PROOF]: { ok: true, status: 200 }, [PRINT]: { ok: false, error: 'HTTP 500' } });
  // Contrived (a doc can't be 'paid' and 'approved' at once) — exercise the bookkeeping:
  const d = doc({ status: 'paid', proofTriggerError: 'a', printTriggerError: 'b' });
  const s = await retryFlagged([d], h);
  const p = h.patches[0];
  ok(h.calls.length === 1 && s.skipped === 1, 'the print flag on a not-yet-approved doc is skipped, not fired');
  ok(p.unset.includes('proofTriggerError') && !p.unset.includes('triggerRetries'), 'proof flag cleared; count kept because the print flag remains');

  const h2 = harness({ [PRINT]: { ok: false, error: 'HTTP 500' } });
  await retryFlagged([doc({ status: 'approved', proofTriggerError: 'a', printTriggerError: 'b' })], h2);
  const p2 = h2.patches[0];
  ok(p2.unset?.includes('proofTriggerError') && /HTTP 500/.test(p2.set?.printTriggerError) && p2.inc?.triggerRetries === 1,
    'approved: stale proof flag cleared, print retried and failed → counted', JSON.stringify(p2));
}

say('\n6. TIME AND DRY RUN\n');
{
  const h = harness();
  const s = await retryFlagged([doc({ proofTriggerError: 'x' })], { ...h, timeLeft: () => 3000, minTimePerDoc: 7000 });
  ok(h.calls.length === 0 && h.patches.length === 0 && s.deferred === 1,
    'less than a trigger\'s budget left in the sweep\'s 30 s → deferred to next hour, untouched');
  const h2 = harness();
  const s2 = await retryFlagged([doc({ proofTriggerError: 'x' }), doc({ _id: 'x2', status: 'proof-sent', proofTriggerError: 'y' })], { ...h2, dry: true });
  ok(h2.calls.length === 0 && h2.patches.length === 0 && s2.retried === 1 && s2.cleared === 1, 'dry run: plans, calls nothing, writes nothing');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
