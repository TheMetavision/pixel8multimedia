import Stripe from 'stripe';
import { createClient } from '@sanity/client';
import { Resend } from 'resend';
import { createHash } from 'node:crypto';
import { FORMAT_LABELS, SIZE_LABELS } from './_shared/pricing.mjs';
import {
  itemsFromLineItems, itemsFromCartItemsBlob, orderLineFromItem, personalisedLinesByPid,
} from './_shared/order-lines.mjs';
import { triggerInternal, TRIGGER_BUDGETS } from './_shared/origin.mjs';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

const sanity = createClient({
  projectId: process.env.SANITY_PROJECT_ID || 'bqb4w421',
  dataset: process.env.SANITY_DATASET || 'production',
  apiVersion: '2026-04-14',
  token: process.env.SANITY_WRITE_TOKEN,
  useCdn: false,
});

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Rebuild the cart from Stripe's own line items. checkout.mjs puts every
 * field on each line's product metadata, so this works for any number of
 * lines. Sessions created before that change carry a `cartItems` JSON blob
 * in session metadata — fall back to it so in-flight orders still complete.
 */
async function cartFromSession(session) {
  try {
    const { data } = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ['data.price.product'],
    });
    const items = itemsFromLineItems(data);
    if (items.length) return items;
  } catch (err) {
    console.warn('webhook: listLineItems failed, falling back to metadata.cartItems', err?.message);
  }
  return itemsFromCartItemsBlob(session.metadata?.cartItems);
}

/** Header the internal personalisation endpoints check (see _shared/personalisation.mts). */
const internalKey = () =>
  createHash('sha256').update(`internal:${process.env.PERSONALISATION_SALT || 'dev-salt'}`).digest('hex').slice(0, 40);

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const body = await req.text();
  const sig = req.headers.get('stripe-signature');

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    // Both webhooks are subscribed to checkout.session.completed, so every
    // commission checkout arrives here too. A commission session carries no
    // cartItems and no shipping name, so this handler used to build an empty
    // order addressed to "Customer" and email it to the buyer — a second,
    // contentless confirmation alongside the real one.
    // commission-checkout always sets commissionId; stripe-webhook-commission
    // owns those sessions entirely.
    if (session.metadata?.commissionId) {
      console.log(`webhook: ignoring commission session ${session.id} — handled by stripe-webhook-commission`);
      return new Response('OK \u2014 commission session, not a shop order', { status: 200 });
    }

    try {
      const shipping = session.shipping_details?.address || {};
      const customerName = session.shipping_details?.name || session.customer_details?.name || 'Customer';
      const customerEmail = session.customer_details?.email || '';
      const totalAmount = (session.amount_total || 0) / 100;
      const cartItems = await cartFromSession(session);

      // The order _id is derived from the Stripe session. The dot keeps the
      // doc out of anonymous API reads (customer name, email, address), and a
      // fixed id makes the webhook idempotent: Stripe retries a delivery that
      // times out or errors, and a retry must not create a second order or
      // resend the emails.
      const orderId = `order.${session.id}`;
      // Orders created before this change have random ids; match those by
      // stripeSessionId so a late retry of one is still recognised.
      const existingOrderId = await sanity.fetch(
        `*[_type == "order" && (_id == $orderId || stripeSessionId == $sessionId)][0]._id`,
        { orderId, sessionId: session.id }
      );
      if (existingOrderId) {
        console.log(`webhook: duplicate webhook, skipping — order ${existingOrderId} already exists for session ${session.id}`);
        return new Response('OK — duplicate, already processed', { status: 200 });
      }

      // Labels as before, plus keys (productRef, formatKey, sizeKey, …) on
      // lines from the server-priced checkout. See _shared/order-lines.mjs.
      const stamp = Date.now();
      const lineItems = cartItems.map((item, n) => orderLineFromItem(item, n, stamp));

      // Create order in Sanity. `create` with a fixed _id rather than
      // createIfNotExists: both refuse to overwrite, but createIfNotExists
      // fails silently, whereas `create` returns 409 if a concurrent retry
      // got here first. That is how we know not to send the emails twice.
      let order;
      try {
        order = await sanity.create({
          _id: orderId,
          _type: 'order',
          stripeSessionId: session.id,
          stripePaymentId: session.payment_intent,
          customerName,
          customerEmail,
          shippingAddress: {
            line1: shipping.line1 || '',
            line2: shipping.line2 || '',
            city: shipping.city || '',
            county: shipping.state || '',
            postcode: shipping.postal_code || '',
            country: shipping.country || '',
          },
          lineItems,
          totalAmount,
          status: 'received',
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        if (err?.statusCode === 409) {
          console.log(`webhook: duplicate webhook, skipping — order ${orderId} already exists`);
          return new Response('OK — duplicate, already processed', { status: 200 });
        }
        throw err;
      }

      console.log(`Order ${order._id} created in Sanity for session ${session.id}`);

      // Personalised lines: mark the session paid, link it to the order, and
      // clear expiresAt so the retention sweep leaves its images alone.
      //
      // One pid can be ordered on several lines (sizes/formats), or again in a
      // later order. Every ordered line is APPENDED to orderedLines, and the
      // single-value fields (order, format, size) are only set if missing, so
      // a later line never overwrites an earlier one. The print build still
      // reads format/size, i.e. the first line ordered — see orderedLines for
      // the rest. Status only moves ready → paid; a session already further
      // along (proof sent) stays where it is.
      const personalised = cartItems.filter((i) => i.personalisationId);
      const byPid = personalisedLinesByPid(cartItems, lineItems, order._id);
      const paidPids = [];
      for (const [pid, { styleKey, lines }] of byPid) {
        try {
          const docId = `pendingPersonalisation.${pid}`;
          const current = await sanity.fetch(`*[_id == $id][0]{ status, selectedStyleKey }`, { id: docId });
          const first = lines[0];
          let patch = sanity
            .patch(docId)
            .setIfMissing({
              order: { _type: 'reference', _ref: order._id },
              format: first.formatKey,
              size: first.sizeKey,
              orderedLines: [],
            })
            .append('orderedLines', lines)
            .unset(['expiresAt']);
          // First payment only: the style and email the proof is made from.
          // A later order must not change them under a proof already sent.
          if (!current?.status || current.status === 'ready') {
            patch = patch.set({ status: 'paid', customerEmail, selectedStyleKey: styleKey });
          } else if (current.selectedStyleKey && current.selectedStyleKey !== styleKey) {
            console.warn(`webhook: ${pid} re-ordered in ${styleKey} but its proof is ${current.selectedStyleKey} — see orderedLines on order ${order._id}`);
          }
          await patch.commit();
          paidPids.push(pid);
          console.log(`Personalisation ${pid} marked paid (${lines.length} line(s)) on order ${order._id}`);
        } catch (err) {
          console.error(`Failed to mark personalisation ${pid} paid on order ${order._id}:`, err?.message);
        }
      }
      const proofNote = personalised.length
        ? `<p style="color: #F5F5F0; line-height: 1.6; margin: 0 0 24px; padding: 12px 16px; background: #1A1A1E; border-left: 3px solid #76FF03; border-radius: 4px;">
             Your order includes a personalised design. We'll email you a proof to approve before it goes to print — nothing is printed until you've said yes.
           </p>`
        : '';

      // Build email content
      const itemRows = cartItems
        .map((item) =>
          `<tr>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #F5F5F0;">${item.title}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #999;">${FORMAT_LABELS[item.format] || item.format}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #999;">${SIZE_LABELS[item.size] || item.size}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; color: #999; text-align: center;">${item.quantity}</td>
            <td style="padding: 8px 12px; border-bottom: 1px solid #2A2A2E; text-align: right; color: #F07828; font-family: monospace;">£${(item.unitPrice * item.quantity).toFixed(2)}</td>
          </tr>`
        ).join('');

      const orderTable = `
        <table style="width: 100%; border-collapse: collapse; font-family: 'DM Sans', Arial, sans-serif; font-size: 14px;">
          <thead>
            <tr style="background: #1A1A1E;">
              <th style="padding: 10px 12px; text-align: left; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Product</th>
              <th style="padding: 10px 12px; text-align: left; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Format</th>
              <th style="padding: 10px 12px; text-align: left; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Size</th>
              <th style="padding: 10px 12px; text-align: center; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Qty</th>
              <th style="padding: 10px 12px; text-align: right; color: #F07828; font-family: 'Montserrat', Arial, sans-serif; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">Price</th>
            </tr>
          </thead>
          <tbody>${itemRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="4" style="padding: 10px 12px; text-align: right; font-weight: bold; color: #F5F5F0;">Total:</td>
              <td style="padding: 10px 12px; text-align: right; font-weight: bold; color: #F07828; font-family: monospace; font-size: 16px;">£${totalAmount.toFixed(2)}</td>
            </tr>
          </tfoot>
        </table>`;

      const shippingBlock = `
        <div style="background: #1A1A1E; padding: 16px; border-radius: 4px; margin: 16px 0; border-left: 3px solid #F07828;">
          <strong style="color: #F5F5F0;">Ship to:</strong><br/>
          <span style="color: #999;">${customerName}<br/>
          ${shipping.line1 || ''}${shipping.line2 ? '<br/>' + shipping.line2 : ''}<br/>
          ${shipping.city || ''}${shipping.state ? ', ' + shipping.state : ''}<br/>
          ${shipping.postal_code || ''}<br/>
          ${shipping.country || ''}</span>
        </div>`;

      // Customer confirmation email
      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Pixel8 Multimedia <orders@pixel8multimedia.co.uk>',
          to: [customerEmail],
          subject: `Order Confirmed — Pixel8 Multimedia`,
          html: `
            <div style="font-family: 'DM Sans', Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #F5F5F0; background: #0D0D0D;">
              <div style="background: #0D0D0D; padding: 24px; text-align: center; border-bottom: 2px solid #F07828;">
                <h1 style="color: #F5F5F0; margin: 0; font-size: 24px; font-family: 'Montserrat', Arial, sans-serif; letter-spacing: 0.05em;">PIXEL<span style="background: linear-gradient(135deg, #E91E7B, #6C63FF, #00BCD4); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">8</span></h1>
                <p style="color: #666; margin: 4px 0 0; font-size: 11px; letter-spacing: 0.15em; text-transform: uppercase;">Pop. Art. Motion.</p>
              </div>
              <div style="padding: 32px 24px; background: #0D0D0D;">
                <h2 style="margin: 0 0 8px; font-size: 22px; color: #F5F5F0; font-family: 'Montserrat', Arial, sans-serif;">Thanks for your order, ${customerName}!</h2>
                <p style="color: #999; line-height: 1.6; margin: 0 0 24px;">
                  Your order has been received and is being prepared. All our products are made to order in our UK studio — please allow 3-6 working days for dispatch.
                </p>
                ${proofNote}
                ${orderTable}
                ${shippingBlock}
                <p style="color: #999; line-height: 1.6; margin: 24px 0 0;">
                  We'll send you another email when your order has been dispatched with tracking details.
                </p>
                <p style="color: #666; margin-top: 32px; font-size: 12px; font-family: monospace;">
                  Payment ID: ${session.payment_intent}<br/>
                  Order placed: ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div style="background: #1A1A1E; padding: 16px; text-align: center; font-size: 11px; color: #666;">
                <p style="margin: 0;">&copy; 2026 Pixel8 Multimedia. All rights reserved.</p>
                <p style="margin: 4px 0 0;"><a href="https://pixel8multimedia.co.uk" style="color: #F07828;">pixel8multimedia.co.uk</a></p>
              </div>
            </div>
          `,
        });
        console.log(`Customer confirmation email sent for order ${order._id}`);
      } catch (emailErr) {
        console.error('Failed to send customer email:', emailErr);
      }

      // Team notification email
      const teamEmail = process.env.TEAM_EMAIL || process.env.EMAIL_FROM || 'orders@pixel8multimedia.co.uk';
      try {
        await resend.emails.send({
          from: process.env.EMAIL_FROM || 'Pixel8 Multimedia <orders@pixel8multimedia.co.uk>',
          to: [teamEmail],
          subject: `NEW ORDER — £${totalAmount.toFixed(2)} — ${customerName}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #1a1a1a;">
              <div style="background: #F07828; padding: 16px; text-align: center;">
                <h1 style="color: #000; margin: 0; font-size: 22px;">NEW ORDER RECEIVED</h1>
              </div>
              <div style="padding: 24px;">
                <h2 style="margin: 0 0 4px;">${customerName}</h2>
                <p style="color: #666; margin: 0 0 20px;">${customerEmail}</p>
                ${orderTable}
                ${shippingBlock}
                <div style="margin-top: 20px; padding: 16px; background: #FFF9E6; border-left: 4px solid #F07828; border-radius: 4px;">
                  <strong>Next steps:</strong><br/>
                  1. Open <a href="https://pixel8multimedia.sanity.studio" style="color: #E91E7B;">Sanity Studio</a> to view/manage this order<br/>
                  2. Prepare artwork for printing${personalised.length ? ' — <strong>personalised item: wait for proof approval (Personalisation → Ready to print)</strong>' : ''}<br/>
                  3. Update order status to "In Production" when started<br/>
                  4. Add tracking number and update to "Dispatched" when shipped
                </div>
                <p style="color: #999; margin-top: 20px; font-size: 12px;">
                  Stripe Session: ${session.id}<br/>
                  Payment Intent: ${session.payment_intent}
                </p>
              </div>
            </div>
          `,
        });
        console.log(`Team notification sent for order ${order._id}`);
      } catch (emailErr) {
        console.error('Failed to send team notification:', emailErr);
      }

      // Proofs last, after the order and both emails are safe. AWAITED: the
      // old fire-and-forget fetch could be frozen with the function once it
      // returned and never leave. Bounded to ~6 s per design
      // (TRIGGER_BUDGETS.webhookProof) because Stripe wants a prompt answer.
      // If it fails, the session is flagged; the hourly sweep retries it (up
      // to 3 times) and Studio lists it under "Needs attention". The webhook
      // still returns 200, so Stripe doesn't retry and nothing is duplicated.
      for (const pid of paidPids) {
        const r = await triggerInternal('/api/personalisation/proof', {
          req,
          body: { pid },
          headers: { 'x-personalisation-key': internalKey() },
          ...TRIGGER_BUDGETS.webhookProof,
        });
        if (r.ok) {
          console.log(`webhook: proof sent for ${pid} (order ${order._id})`);
          continue;
        }
        console.error(`webhook: proof trigger FAILED for ${pid} (order ${order._id}): ${r.error}`);
        await sanity
          .patch(`pendingPersonalisation.${pid}`)
          .set({ proofTriggerError: `${new Date().toISOString()} — ${String(r.error).slice(0, 200)}` })
          .commit()
          .catch((e) => console.error(`webhook: could not flag ${pid}:`, e?.message));
      }
    } catch (err) {
      console.error('Error processing checkout.session.completed:', err);
      return new Response('Webhook processing error (logged)', { status: 200 });
    }
  }

  return new Response('OK', { status: 200 });
};

export const config = {
  path: '/api/webhook',
};
