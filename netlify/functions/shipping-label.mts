// netlify/functions/shipping-label.mts
//
// GET /admin/shipping/label/<labelId>   the label PDF, to print
//
// The Studio's "Print label" links and the team's "Label ready" email point
// here. The PDF lives on the shipping service, which only hands a brand its
// own labels on a signed request -- so this proxies it, signing with
// SHIPPING_SECRET, which never reaches a browser.
//
// UNDER /admin ON PURPOSE: edge-functions/admin-auth.ts puts Basic Auth on
// /admin/*. A label is a customer's name and address. The function also
// refuses any path that did not come in under /admin/.

import { shippingEnabled, shippingRequest } from './_shared/shipping-client.mjs';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });
  const url = new URL(req.url);
  if (!/^\/admin\/shipping\/label\//.test(url.pathname)) return new Response('Not found', { status: 404 });
  if (!shippingEnabled()) return new Response('Shipping is not enabled', { status: 404 });

  const labelId = decodeURIComponent(url.pathname.split('/').pop() || '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(labelId)) return new Response('Bad label id', { status: 400 });
  try {
    const pdf = await shippingRequest(`label?labelId=${encodeURIComponent(labelId)}`, { method: 'GET' });
    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="label-${labelId}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (err: any) {
    const status = err?.code === 'not_found' ? 404 : 502;
    console.error(`shipping-label: ${labelId}: ${err?.code || ''} ${err?.message || err}`);
    return new Response(status === 404 ? 'No such label for this shop' : 'The shipping service did not return the label', { status });
  }
}

export const config = { path: '/admin/shipping/label/*' };
