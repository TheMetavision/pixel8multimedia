// netlify/functions/commission-download.mts
// Secure file download — validates HMAC-signed, time-limited URL parameters,
// fetches the finished file from Sanity CDN, and streams it to the customer.

import type { Context } from '@netlify/functions';
import { createClient } from '@sanity/client';
import crypto from 'crypto';

const sanity = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN!,
  useCdn: false,
});

const DOWNLOAD_SECRET = process.env.DOWNLOAD_LINK_SECRET!;

export default async function handler(req: Request, _context: Context) {
  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }

  const url = new URL(req.url);
  const commissionId = url.searchParams.get('id');
  const fileRef = url.searchParams.get('file');
  const expiry = url.searchParams.get('exp');
  const signature = url.searchParams.get('sig');

  // ── Validate params exist ──────────────
  if (!commissionId || !fileRef || !expiry || !signature) {
    return new Response(errorPage('Invalid download link', 'The link is missing required parameters.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // ── Check expiry ───────────────────────
  const expiryMs = parseInt(expiry, 10);
  if (isNaN(expiryMs) || Date.now() > expiryMs) {
    return new Response(errorPage('Link expired', 'This download link has expired. Please contact us at hello@pixel8multimedia.co.uk for a new link.'), {
      status: 410,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // ── Verify HMAC signature ──────────────
  const payload = `${commissionId}:${fileRef}:${expiry}`;
  const hmac = crypto.createHmac('sha256', DOWNLOAD_SECRET);
  hmac.update(payload);
  const expectedSig = hmac.digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    return new Response(errorPage('Invalid link', 'This download link is invalid or has been tampered with.'), {
      status: 403,
      headers: { 'Content-Type': 'text/html' },
    });
  }

  try {
    // ── Fetch commission to verify status ──
    const commission = await sanity.fetch(
      `*[_type == "commission" && _id == $id][0]{
        status, orderRef, customerName,
        "fileUrl": finishedFile.asset->url,
        "fileName": finishedFile.asset->originalFilename,
        "mimeType": finishedFile.asset->mimeType
      }`,
      { id: commissionId }
    );

    if (!commission || !commission.fileUrl) {
      return new Response(errorPage('File not found', 'The requested file could not be located.'), {
        status: 404,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // Only allow download for delivered/complete commissions
    if (!['complete', 'delivered'].includes(commission.status)) {
      return new Response(errorPage('Not available', 'This file is not yet available for download.'), {
        status: 403,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    // ── Stream file from Sanity CDN ──────
    const fileResponse = await fetch(`${commission.fileUrl}?dl=`);

    if (!fileResponse.ok) {
      throw new Error(`CDN returned ${fileResponse.status}`);
    }

    const filename = commission.fileName || `${commission.orderRef}-download`;
    const contentType = commission.mimeType || 'application/octet-stream';

    return new Response(fileResponse.body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err) {
    console.error('commission-download error:', err);
    return new Response(errorPage('Download failed', 'Something went wrong. Please try again or contact us.'), {
      status: 500,
      headers: { 'Content-Type': 'text/html' },
    });
  }
}

// ── Branded error page ───────────────────
function errorPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title} — Pixel8 Multimedia</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{min-height:100vh;display:flex;align-items:center;justify-content:center;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
      background:#f4f4f7;color:#1a1a2e;padding:2rem}
    .card{max-width:420px;background:#fff;border-radius:12px;padding:2.5rem;
      text-align:center;box-shadow:0 2px 12px rgba(0,0,0,0.06)}
    .card h1{font-size:1.5rem;margin-bottom:0.75rem;color:#dc2626}
    .card p{font-size:0.9375rem;line-height:1.6;color:#6b7280;margin-bottom:1.5rem}
    .card a{display:inline-block;padding:0.75rem 1.5rem;background:#7c3aed;
      color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:0.875rem}
    .card a:hover{background:#6d28d9}
    .brand{font-size:0.75rem;color:#9ca3af;margin-top:1.5rem}
  </style>
</head>
<body>
  <div class="card">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="/">Back to Pixel8 Multimedia</a>
    <p class="brand">hello@pixel8multimedia.co.uk</p>
  </div>
</body>
</html>`;
}

export const config = { path: '/.netlify/functions/commission-download' };
