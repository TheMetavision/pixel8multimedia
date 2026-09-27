// netlify/functions/_shared/print-deps.mts
//
// The real I/O behind _shared/print-job.mjs, for the print-file functions.
// (The tests build their own fakes instead.)

import { getStore } from '@netlify/blobs';
import { createClient } from '@sanity/client';
import sharp from 'sharp';
import { FILES_STORE } from './print-keys.mjs';
import { loadSource, upscaleForPrint, MASTERS_STORE } from './print-sources.mjs';
import { renderPrint, lowMemorySharp } from './print-render.mjs';
import { printGeometry } from './print-spec.mjs';
import { triggerInternal, TRIGGER_BUDGETS } from './origin.mjs';
import { INTERNAL_HEADER, internalKey } from './personalisation.mts';

// Published perspective: a wrap-colour override only counts once it's
// published in Studio, never from an unpublished draft.
const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
  perspective: 'published',
});

const stores = (name: string) => getStore({ name, consistency: 'strong' });

// Stock products: what print-masters is keyed by (tools/print-masters uses the same filter).
const STOCK = '_type == "product" && category != "personalised" && defined(slug.current)';

export function printDeps(req?: Request) {
  return {
    files: stores(FILES_STORE),
    stores,
    now: () => Date.now(),
    fetchOrder: (id: string) => sanity.fetch(`*[_type == "order" && _id == $id][0]{ _id, lineItems }`, { id }),
    // Ad-hoc files (/admin/print-any)
    findProduct: (slug: string) => sanity.fetch(`*[${STOCK} && slug.current == $slug][0]{ "slug": slug.current, title }`, { slug }),
    listProducts: () => sanity.fetch(`*[${STOCK}] | order(title asc){ "slug": slug.current, title, "thumb": images[0].asset->url }`),
    listMasters: async () => (await stores(MASTERS_STORE).list()).blobs.map((b: any) => b.key),
    trigger: (body: object) => triggerInternal('/api/print-file/render-background', {
      req,
      body,
      headers: { [INTERNAL_HEADER]: internalKey() },
      // A background function answers 202 at once, and a second start of the
      // same render is harmless (same key), so timeouts may be retried.
      ...TRIGGER_BUDGETS.approvePrint,
    }),
    loadSource: (info: any) => loadSource(info, stores),
    // Personalised renders are 2048 px: bring them to face size first.
    prepare: async (buf: Buffer, spec: any) => {
      if (spec.kind !== 'personalised') return buf;
      const { facePx } = printGeometry(spec.sizeKey, spec.formatKey);
      const { buffer, method } = await upscaleForPrint(buf, facePx, { sharp });
      console.log(`print-file: upscaled ${spec.pid} via ${method}`);
      return buffer;
    },
    render: (opts: any) => { lowMemorySharp(); return renderPrint(opts); },
  };
}
