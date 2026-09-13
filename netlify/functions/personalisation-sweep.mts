// netlify/functions/personalisation-sweep.mts
//
// Scheduled daily. Two jobs:
//
//   1. Unpaid sessions past expiresAt → delete every blob under
//      personalisation/<pid>/, mark the doc 'expired' (kept for stats, no
//      image data remains).
//   2. Paid sessions printed more than LIMITS.paidRetentionDays ago → delete
//      blobs, keep the doc. (Printed work is on the customer's wall; we don't
//      need to hold their photo any longer than the returns window plus
//      margin.)
//
// Scheduled functions have no public URL. To test locally:
//   netlify dev            (in one terminal)
//   netlify functions:invoke personalisation-sweep --querystring "dry=1"

import { LIMITS, sanity, images, blobKey, nowIso, json } from './_shared/personalisation.mts';

type Row = { _id: string; pid: string; status: string };

async function deleteBlobs(pid: string): Promise<number> {
  const store = images();
  const { blobs } = await store.list({ prefix: blobKey.prefix(pid) });
  await Promise.all(blobs.map((b) => store.delete(b.key)));
  return blobs.length;
}

export default async function handler(req: Request): Promise<Response> {
  const dry = new URL(req.url).searchParams.get('dry') === '1';

  const now = nowIso();
  const cutoff = new Date(Date.now() - LIMITS.paidRetentionDays * 86400_000).toISOString();

  const unpaid: Row[] = await sanity.fetch(
    `*[_type == "pendingPersonalisation" && status in ["uploaded","styling","ready","failed"] && defined(expiresAt) && expiresAt < $now]{_id, pid, status}`,
    { now },
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

  const summary = { ok: true, dry, expired: unpaid.length, purged: printed.length, blobsDeleted: blobs };
  console.log('personalisation-sweep:', JSON.stringify(summary));
  return json(200, summary);
}

export const config = { schedule: '@daily' };
