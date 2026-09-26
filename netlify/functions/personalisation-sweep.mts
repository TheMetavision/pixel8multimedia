// netlify/functions/personalisation-sweep.mts
//
// Scheduled hourly. Three jobs, in this order:
//
//   1. Unpaid sessions more than UNPAID_GRACE_MINUTES past expiresAt → delete
//      every blob under personalisation/<pid>/, mark the doc 'expired' (kept
//      for stats, no image data remains).
//   2. Paid sessions printed more than LIMITS.paidRetentionDays ago → delete
//      blobs, keep the doc. (Printed work is on the customer's wall; we don't
//      need to hold their photo any longer than the returns window plus
//      margin.)
//   3. Sessions flagged proofTriggerError / printTriggerError → try the
//      trigger again (up to 3 times; see _shared/trigger-retry.mjs).
//
// Jobs 1 and 2 are idempotent, so running hourly (it was daily) only makes
// them more prompt: 1 moves a doc to 'expired', which its query excludes; 2
// sets purgedAt, which its query excludes.
//
// The grace period closes a race hourly runs would make likelier: checkout
// accepts a design until expiresAt, so a customer could be on the Stripe page
// when it passes. checkout.mjs gives carts with a personalised line a
// 30-minute Stripe session, and this sweep waits 60 minutes past expiresAt,
// so a design is never deleted while someone can still pay for it. Unpaid
// photos are deleted 48-50 hours after upload (was up to 72 with a daily run).
//
// Netlify's scheduled-function limit is 30 s and not configurable
// (https://docs.netlify.com/build/functions/scheduled-functions/), so job 3
// only starts a retry while there's time for it to finish.
//
// Scheduled functions have no public URL. To test locally:
//   netlify dev            (in one terminal)
//   netlify functions:invoke personalisation-sweep --querystring "dry=1"

import { LIMITS, sanity, images, blobKey, nowIso, json, INTERNAL_HEADER, internalKey } from './_shared/personalisation.mts';
import { triggerInternal, TRIGGER_BUDGETS } from './_shared/origin.mjs';
import { retryFlagged } from './_shared/trigger-retry.mjs';

type Row = { _id: string; pid: string; status: string };

const UNPAID_GRACE_MINUTES = 60;
const SWEEP_BUDGET_MS = 25_000; // of Netlify's 30 s, leaving room to log and return

async function deleteBlobs(pid: string): Promise<number> {
  const store = images();
  const { blobs } = await store.list({ prefix: blobKey.prefix(pid) });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
  return blobs.length;
}

export default async function handler(req: Request): Promise<Response> {
  const started = Date.now();
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  const now = nowIso();
  const graceCutoff = new Date(Date.now() - UNPAID_GRACE_MINUTES * 60_000).toISOString();
  const cutoff = new Date(Date.now() - LIMITS.paidRetentionDays * 86400_000).toISOString();

  const unpaid: Row[] = await sanity.fetch(
    `*[_type == "pendingPersonalisation" && status in ["uploaded","styling","ready","failed"] && defined(expiresAt) && expiresAt < $graceCutoff]{_id, pid, status}`,
    { graceCutoff },
  );
  const printed: Row[] = await sanity.fetch(
    `*[_type == "pendingPersonalisation" && status == "printed" && defined(printedAt) && printedAt < $cutoff && !defined(purgedAt)]{_id, pid, status}`,
    { cutoff },
  );

  let blobs = 0;
  for (const r of unpaid) {
    if (!dry) {
      blobs += await deleteBlobs(r.pid);
      await sanity.patch(r._id).set({ status: 'expired', purgedAt: now }).unset(['photoKey', 'printKey', 'renders']).commit();
    }
  }
  for (const r of printed) {
    if (!dry) {
      blobs += await deleteBlobs(r.pid);
      await sanity.patch(r._id).set({ purgedAt: now }).unset(['photoKey', 'printKey', 'renders']).commit();
    }
  }

  // ── 3. Re-try failed triggers ──────────────────────────────────────────
  const flagged = await sanity.fetch(
    `*[_type == "pendingPersonalisation" && (defined(proofTriggerError) || defined(printTriggerError))]
      | order(_updatedAt asc){ _id, pid, status, proofTriggerError, printTriggerError, printBuiltAt, triggerRetries }`,
  );
  const retries = await retryFlagged(flagged, {
    dry,
    timeLeft: () => SWEEP_BUDGET_MS - (Date.now() - started),
    trigger: (path: string, pid: string) => triggerInternal(path, {
      body: { pid },
      headers: { [INTERNAL_HEADER]: internalKey() },
      ...TRIGGER_BUDGETS.sweepRetry,
    }),
    patch: async (id: string, { set, unset, inc }: { set?: object; unset?: string[]; inc?: Record<string, number> }) => {
      let p = sanity.patch(id);
      if (set) p = p.set(set);
      if (unset) p = p.unset(unset);
      if (inc) p = p.setIfMissing({ triggerRetries: 0 }).inc(inc);
      await p.commit();
    },
  });

  const summary = {
    ok: true, dry, expired: unpaid.length, purged: printed.length, blobsDeleted: blobs,
    flagged: flagged.length, retries, ms: Date.now() - started,
  };
  console.log('personalisation-sweep:', JSON.stringify(summary));
  return json(200, summary);
}

export const config = { schedule: '@hourly' };
