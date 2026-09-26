/**
 * netlify/functions/_shared/trigger-retry.mjs
 *
 * The hourly sweep's second job: re-try a trigger that failed.
 *
 * When the Stripe webhook can't start a proof email, or the approve page
 * can't start a print build, the pendingPersonalisation doc gets
 * proofTriggerError / printTriggerError. Every hour the sweep tries again,
 * up to MAX_TRIGGER_RETRIES times per doc (counted in triggerRetries). After
 * that the flag stays set and the doc stays in Studio → Personalisation →
 * Needs attention, showing the count, for a person to look at.
 *
 * Pure apart from the injected `trigger` and `patch`, so it can be tested.
 */

export const MAX_TRIGGER_RETRIES = 3;

/** Statuses at which the proof has already gone out. */
const PROOF_DONE = new Set(['proof-sent', 'approved', 'printed']);

/**
 * What to do for each flag on one doc.
 * @returns {Array<{ kind: 'proof'|'print', action: 'retry'|'clear'|'gave-up'|'skip', reason?: string }>}
 */
export function retryPlan(doc) {
  const retries = doc.triggerRetries || 0;
  const steps = [];
  if (doc.proofTriggerError) {
    if (PROOF_DONE.has(doc.status)) steps.push({ kind: 'proof', action: 'clear', reason: 'proof already sent' });
    else if (retries >= MAX_TRIGGER_RETRIES) steps.push({ kind: 'proof', action: 'gave-up' });
    else if (doc.status === 'paid') steps.push({ kind: 'proof', action: 'retry' });
    else steps.push({ kind: 'proof', action: 'skip', reason: `status ${doc.status}` });
  }
  if (doc.printTriggerError) {
    if (doc.printBuiltAt) steps.push({ kind: 'print', action: 'clear', reason: 'print file already built' });
    else if (retries >= MAX_TRIGGER_RETRIES) steps.push({ kind: 'print', action: 'gave-up' });
    else if (doc.status === 'approved') steps.push({ kind: 'print', action: 'retry' });
    else steps.push({ kind: 'print', action: 'skip', reason: `status ${doc.status}` });
  }
  return steps;
}

const PATHS = {
  proof: '/api/personalisation/proof',
  print: '/api/personalisation/print-background',
};
const FLAG = { proof: 'proofTriggerError', print: 'printTriggerError' };

/**
 * Work through flagged docs until done or out of time.
 *
 * @param {Array} docs   { _id, pid, status, proofTriggerError?, printTriggerError?, printBuiltAt?, triggerRetries? }
 * @param {object} deps
 *   trigger(path, pid) → Promise<{ ok, error? }>   (triggerInternal with the sweep budget)
 *   patch(docId, { set?, unset?, inc? }) → Promise
 *   timeLeft() → ms remaining in the sweep's own budget
 *   minTimePerDoc  don't start a doc with less than this left (a trigger may take its whole budget)
 *   dry            plan only
 */
export async function retryFlagged(docs, { trigger, patch, timeLeft = () => Infinity, minTimePerDoc = 7000, dry = false, nowIso = () => new Date().toISOString() }) {
  const summary = { retried: 0, recovered: 0, failed: 0, cleared: 0, gaveUp: 0, deferred: 0, skipped: 0 };
  for (const doc of docs) {
    const steps = retryPlan(doc);
    const retries = steps.filter((s) => s.action === 'retry');
    if (retries.length && timeLeft() < minTimePerDoc) { summary.deferred++; continue; }

    const unset = [];
    const set = {};
    let anyFailed = false;
    for (const s of steps) {
      if (s.action === 'gave-up') { summary.gaveUp++; continue; }
      if (s.action === 'skip') { summary.skipped++; continue; }
      if (s.action === 'clear') { summary.cleared++; unset.push(FLAG[s.kind]); continue; }
      summary.retried++;
      if (dry) continue;
      const r = await trigger(PATHS[s.kind], doc.pid);
      if (r.ok) { summary.recovered++; unset.push(FLAG[s.kind]); }
      else {
        summary.failed++;
        anyFailed = true;
        set[FLAG[s.kind]] = `${nowIso()} — retry: ${String(r.error).slice(0, 200)}`;
      }
    }
    if (dry || (!unset.length && !anyFailed)) continue;

    // Every flag gone → the count has done its job; otherwise count this try.
    const remainingFlags = ['proof', 'print'].filter((k) => doc[FLAG[k]] && !unset.includes(FLAG[k]));
    if (!remainingFlags.length) unset.push('triggerRetries');
    await patch(doc._id, {
      set: Object.keys(set).length ? set : undefined,
      unset: unset.length ? unset : undefined,
      inc: anyFailed ? { triggerRetries: 1 } : undefined,
    });
  }
  return summary;
}
