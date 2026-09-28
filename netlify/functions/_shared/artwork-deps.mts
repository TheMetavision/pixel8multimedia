// netlify/functions/_shared/artwork-deps.mts
//
// The real I/O behind _shared/commission-artwork.mjs. (The tests build their
// own fakes instead.)

import { getStore } from '@netlify/blobs';
import { createClient } from '@sanity/client';
import { ARTWORK_STORE } from './artwork-keys.mjs';
import { triggerInternal, TRIGGER_BUDGETS } from './origin.mjs';
import { INTERNAL_HEADER, internalKey } from './personalisation.mts';

// raw: drafts are visible, so a finished file is listed on the draft too
// (otherwise publishing an open draft would drop it from the commission).
const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  perspective: 'raw',
});

export const COMMISSION_BY_REF = `*[_type == "commission" && orderRef == $ref && !(_id in path("drafts.**"))][0]{
  _id, orderRef, status, deliveryType,
  "hasDraft": defined(*[_id == "drafts." + ^._id][0]._id),
  "artwork": finishedArtwork[]{ uploadId, filename, contentType, bytes, uploadedAt }
}`;

export function artworkDeps(req?: Request) {
  return {
    store: getStore({ name: ARTWORK_STORE, consistency: 'strong' }),
    now: () => Date.now(),
    findCommission: (orderRef: string) => sanity.fetch(COMMISSION_BY_REF, { ref: orderRef }),
    listArtwork: async (c: any, entry: any) => {
      const tx = sanity.transaction();
      for (const id of [c._id, ...(c.hasDraft ? [`drafts.${c._id}`] : [])]) {
        tx.patch(id, (p) => p
          .setIfMissing({ finishedArtwork: [] })
          .unset([`finishedArtwork[_key=="${entry._key}"]`])
          .append('finishedArtwork', [entry]));
      }
      await tx.commit({ visibility: 'sync' });
    },
    trigger: (body: object) => triggerInternal('/api/commission-artwork/verify-background', {
      req,
      body,
      headers: { [INTERNAL_HEADER]: internalKey() },
      ...TRIGGER_BUDGETS.approvePrint,
    }),
  };
}
