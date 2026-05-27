// netlify/functions/upload.mts
//
// Accepts a single image upload via multipart/form-data, pushes it to
// Sanity's asset CDN, and returns the asset _id + URL.
//
// Used by the commission wizard's PhotoDropzone — by uploading each file
// individually rather than as part of one giant checkout POST, we sidestep
// Netlify Function's ~6-10MB payload ceiling. A session can upload as many
// photos as needed; only one image at a time crosses the wire to this
// function, so total order size is effectively unbounded.
//
// Field name convention (matching commission-checkout's expectation):
//   - 'file'      → the image file
//   - 'fieldKey'  → which briefingField the file belongs to (e.g. "sourcePhotos")
//
// Returns:
//   { ok: true, assetId, url, originalName }
//   { ok: false, error: '...' }

import type { Context } from '@netlify/functions';
import { createClient } from '@sanity/client';

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN!,
  useCdn: false,
});

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per single file
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

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
    if (!process.env.SANITY_TOKEN) {
      console.error('upload: SANITY_TOKEN not configured');
      return jsonResponse(500, { ok: false, error: 'Server misconfigured.' });
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonResponse(400, { ok: false, error: 'Expected multipart/form-data.' });
    }

    const file = formData.get('file');
    const fieldKey = String(formData.get('fieldKey') || 'unknown');

    if (!file || typeof file === 'string') {
      return jsonResponse(400, { ok: false, error: 'No file in request.' });
    }

    const f = file as File;

    if (!ALLOWED_TYPES.has(f.type)) {
      return jsonResponse(400, {
        ok: false,
        error: `Unsupported file type: ${f.type || 'unknown'}. Use JPG, PNG, WebP, or HEIC.`,
      });
    }

    if (f.size > MAX_FILE_SIZE) {
      const mb = (f.size / 1024 / 1024).toFixed(1);
      return jsonResponse(413, {
        ok: false,
        error: `File too large (${mb}MB). The single-file limit is ${MAX_FILE_SIZE / 1024 / 1024}MB.`,
      });
    }

    console.log(`upload: receiving ${f.name} (${f.size} bytes, ${f.type}) for field ${fieldKey}`);

    // Sanity's @sanity/client uses `get-it` under the hood, which expects
    // the body to be a Node Buffer, Readable stream, Blob, or string —
    // NOT Uint8Array (it gets treated as a plain object and rejected with
    // "Request body must be a string, buffer or stream, got object").
    // Netlify Functions run on Node Lambda where Buffer is a global, so
    // this is the right path.
    if (typeof Buffer === 'undefined') {
      throw new Error('Buffer is not available in this runtime — cannot upload to Sanity.');
    }
    const arrayBuffer = await f.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    console.log(`upload: uploading to Sanity assets API…`);
    const asset = await sanity.assets.upload('image', buffer, {
      filename: f.name,
      contentType: f.type,
      // Tag uploads so the orphan-cleanup script can find them. Sanity stores
      // these on the asset doc as `label` and `title` — both queryable via
      // GROQ. The fieldKey helps the cleanup script and ops team trace which
      // briefing field an asset belonged to.
      label: `commission-upload`,
      title: `${fieldKey}: ${f.name}`,
    });

    console.log(`upload: success, assetId=${asset._id}`);

    return jsonResponse(200, {
      ok: true,
      assetId: asset._id,
      url: asset.url,
      originalName: f.name,
      fieldKey,
    });
  } catch (err: any) {
    // Log liberally so we can diagnose from function logs. Different
    // runtimes surface errors differently; we want at least one of these
    // to appear in the dashboard.
    console.error('upload error message:', err?.message);
    console.error('upload error name:', err?.name);
    console.error('upload error stack:', err?.stack);
    console.error('upload error full:', JSON.stringify(err, Object.getOwnPropertyNames(err || {})));
    return jsonResponse(500, {
      ok: false,
      error: err?.message || 'Upload failed. Please try again.',
    });
  }
}

export const config = { path: '/.netlify/functions/upload' };
