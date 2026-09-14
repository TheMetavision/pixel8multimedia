// netlify/functions/personalisation-print-file.mts
//
// GET /admin/personalisation/print?pid=…[&kind=print|proof|original]
//
// Your download link for fulfilment. Sits under /admin/* so it's behind the
// same Basic Auth edge function as the rest of the admin area — do not move
// it out from under that prefix, it serves un-watermarked print files.
//
// The Studio "Ready to print" queue shows the pid; paste it here, or use the
// link the fulfilment note builds.

import { images, blobKey, getSession, isPid, bad } from './_shared/personalisation.mts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return bad('Method not allowed', 405);
  const url = new URL(req.url);
  const pid = url.searchParams.get('pid');
  const kind = url.searchParams.get('kind') || 'print';
  if (!isPid(pid)) return bad('Invalid pid.');

  const s = await getSession(pid);
  if (!s) return bad('Not found', 404);
  const doc = s as any;

  const map: Record<string, { key?: string; type: string; ext: string }> = {
    print: { key: doc.printKey, type: 'image/png', ext: 'png' },
    proof: { key: doc.proofKey, type: 'image/jpeg', ext: 'jpg' },
    original: { key: doc.photoKey, type: 'image/jpeg', ext: 'jpg' },
  };
  const want = map[kind];
  if (!want) return bad('Unknown kind.');
  if (!want.key) {
    return bad(
      kind === 'print'
        ? 'No print file yet — it is built when the customer approves their proof.'
        : 'Not available for this session.',
      404,
    );
  }

  const buf = await images().get(want.key, { type: 'arrayBuffer' });
  if (!buf) return bad('File has been purged.', 410);

  const name = [
    'pixel8',
    pid,
    s.selectedStyleKey || '',
    doc.format || '',
    doc.size || '',
    kind,
  ].filter(Boolean).join('-');

  return new Response(buf, {
    headers: {
      'Content-Type': want.type,
      'Content-Disposition': `attachment; filename="${name}.${want.ext}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const config = { path: '/admin/personalisation/print' };
