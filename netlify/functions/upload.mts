// netlify/functions/upload.mts
//
// Accepts a single commission photo via multipart/form-data and stores it in
// the PRIVATE Netlify Blobs store "commission-uploads" (see
// _shared/commission-uploads.mjs). It used to become a Sanity image asset,
// which is public by URL and anonymously listable — customer photos must not be.
//
// Used by the commission wizard's PhotoDropzone — by uploading each file
// individually rather than as part of one giant checkout POST, we stay under
// Netlify's function request limit (6 MB buffered, and binary bodies are
// base64-encoded, so ~4.5 MB of file in practice; the browser re-encodes to
// JPEG under 4.5 MB before sending). A session can upload as many photos as
// needed; only one crosses the wire per request.
//
// Fields:
//   - 'file'      → the image file
//   - 'fieldKey'  → which briefingField the file belongs to (e.g. "sourcePhotos")
//   - 'uploadId'  → optional UUID grouping this visit's uploads (minted if absent)
//
// Returns:
//   { ok: true, uploadKey, uploadId, fieldKey, contentType, bytes, width, height }
//   { ok: false, error: '...' }
// Never the original filename: customers name files after people.

import type { Context } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { UPLOADS_STORE, storeUpload } from './_shared/commission-uploads.mjs';

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default async function handler(req: Request, _ctx: Context): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse(405, { ok: false, error: 'Method not allowed' });
  }

  try {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonResponse(400, { ok: false, error: 'Expected multipart/form-data.' });
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return jsonResponse(400, { ok: false, error: 'No file in request.' });
    }
    const f = file as File;

    const r = await storeUpload(
      {
        bytes: new Uint8Array(await f.arrayBuffer()),
        contentType: f.type,
        fieldKey: String(formData.get('fieldKey') || 'unknown'),
        uploadId: String(formData.get('uploadId') || ''),
      },
      {
        store: getStore({ name: UPLOADS_STORE, consistency: 'strong' }),
        uuid: randomUUID,
        imageSize: async (buf: Uint8Array) => {
          const m = await sharp(buf).metadata();
          return m.width && m.height ? { width: m.width, height: m.height } : null;
        },
      },
    );

    if (!r.ok) return jsonResponse(r.status, { ok: false, error: r.error });
    console.log(`upload: stored ${r.bytes} bytes (${r.contentType}, ${r.width ?? '?'}×${r.height ?? '?'}) for field ${r.fieldKey} as ${r.uploadKey}`);
    return jsonResponse(200, { ...r });
  } catch (err: any) {
    console.error('upload error:', err?.name, err?.message);
    return jsonResponse(500, { ok: false, error: 'Upload failed. Please try again.' });
  }
}

export const config = { path: '/.netlify/functions/upload' };
