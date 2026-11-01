/**
 * What one Sanity webhook delivery asks for.
 *
 * Sanity's plan allows two webhooks and Pixel8 uses both ("Netlify rebuild",
 * "Commission Delivery"). So "Commission Delivery" is edited in place into
 * "Pixel8 orders" -> /api/sanity-orders-webhook, and every order, commission
 * and return-request event comes here:
 *
 *   order, Dispatched by hand with a tracking number, email not yet sent
 *       -> dispatch-email          (always, SHIPPING_ENABLED or not)
 *   commission, Shipped, dispatchedAt unset
 *       -> dispatch-email          (always: what commission-deliver did)
 *   commission, Complete, deliveredAt unset
 *       -> commission-complete     (always: the download email, as before)
 *   order / commission, Shipment "Ready to ship", a planned parcel unlabelled
 *       -> shipping-dispatch       (SHIPPING_ENABLED only)
 *   returnRequest, Approved with no label sent / Rejected with no decline sent
 *       -> shipping-return         (SHIPPING_ENABLED only)
 *
 * TRANSITIONS. The webhook's projection carries
 *   "before": before(){ status, trackingNumber, "shipmentStatus": shipment.status }
 * so an action fires when the document MOVES into the state, not every time a
 * document already in it is saved. That matters twice:
 *   - orders dispatched by hand before this existed have no dispatch-email
 *     stamp, and must not all be emailed the next time someone edits them;
 *   - after a failed label or return, the server writes the error to the
 *     document; that write must not start the job again (a loop). Alan
 *     retries by moving the status away and back.
 * Without `before` in the body (projection not set yet) the safe defaults
 * apply: no retry after an exception, and no dispatch email for an order
 * created before DISPATCH_EMAIL_SINCE.
 *
 * This decides what to START. Each handler re-reads the document and claims it
 * with a conditional write; that claim, not this router, stops a double send.
 */
import { orderNotDue, commissionNotDue } from './dispatch-email.mjs';

/** Orders created before this never get an automatic dispatch email. */
export const DISPATCH_EMAIL_SINCE = '2026-11-01T00:00:00Z';

const hasBefore = (doc) => Object.prototype.hasOwnProperty.call(doc, 'before');
const beforeOf = (doc) => (hasBefore(doc) ? (doc.before || {}) : null);
const shippedStatus = (s) => ['dispatched', 'delivered'].includes(s);

/** Labels exist for every planned parcel: nothing left to buy. */
export function everyPlannedParcelLabelled(doc) {
  const plan = Array.isArray(doc.parcelPlan) ? doc.parcelPlan : [];
  if (!plan.length) return false;
  const labelled = new Set((doc.shipmentResult?.parcels || []).filter((p) => p?.labelId).map((p) => String(p.parcelRef)));
  return plan.every((p) => labelled.has(String(p?.parcelRef)));
}

function shippingDispatchDue(doc) {
  if (doc.shipment?.status !== 'ready_to_ship') return `shipment ${doc.shipment?.status || 'not ready'}`;
  if (everyPlannedParcelLabelled(doc)) return 'every planned parcel already has a label';
  if (doc.shipmentResult?.state === 'exception') {
    const b = beforeOf(doc);
    if (!b || b.shipmentStatus === 'ready_to_ship') return 'last attempt failed: set On hold, then Ready to ship, to retry';
  }
  return null;
}

/**
 * @param {object} doc  the webhook body
 * @param {{ since?: string }} [opts]
 * @returns {{ actions: string[], reason: string }}
 */
export function routeFor(doc, { since = DISPATCH_EMAIL_SINCE } = {}) {
  if (!doc || typeof doc._id !== 'string' || typeof doc._type !== 'string') return { actions: [], reason: 'no document in the body' };
  if (doc._id.startsWith('drafts.') || doc._id.startsWith('versions.')) return { actions: [], reason: 'a draft or version' };
  const b = beforeOf(doc);
  const actions = [];
  const why = [];

  if (doc._type === 'order') {
    const notDue = orderNotDue(doc);
    if (notDue) why.push(`dispatch email: ${notDue}`);
    else if (b && shippedStatus(b.status) && String(b.trackingNumber || '').trim()) why.push('dispatch email: already dispatched before this edit');
    else if (!b && doc.createdAt && doc.createdAt < since) why.push('dispatch email: order predates dispatch emails');
    else actions.push('dispatch-email');

    const ship = shippingDispatchDue(doc);
    if (ship) why.push(ship); else actions.push('shipping-dispatch');
    return { actions, reason: actions.length ? actions.join(' + ') : why.join('; ') };
  }

  if (doc._type === 'commission') {
    const notDue = commissionNotDue(doc);
    if (notDue) why.push(`dispatch email: ${notDue}`);
    else actions.push('dispatch-email');

    if (doc.status === 'complete' && !doc.deliveredAt && !(b && b.status === 'complete')) actions.push('commission-complete');
    else if (doc.status === 'complete') why.push(doc.deliveredAt ? 'already delivered' : 'was already complete');

    const ship = shippingDispatchDue(doc);
    if (ship) why.push(ship); else actions.push('shipping-dispatch');
    return { actions, reason: actions.length ? actions.join(' + ') : why.join('; ') };
  }

  if (doc._type === 'returnRequest') {
    const retry = (s) => !doc.error || (b && b.status !== s);
    if (doc.status === 'approved' && !doc.labelSentAt) {
      return retry('approved') ? { actions: ['shipping-return'], reason: 'return approved' } : { actions: [], reason: 'last attempt failed: set Requested, then Approved, to retry' };
    }
    if (doc.status === 'rejected' && !doc.rejectionEmailSentAt) {
      return retry('rejected') ? { actions: ['shipping-return'], reason: 'return rejected' } : { actions: [], reason: 'last attempt failed: set Requested, then Rejected, to retry' };
    }
    return { actions: [], reason: `return ${doc.status || 'unset'}${doc.labelSentAt || doc.rejectionEmailSentAt ? ', already actioned' : ''}` };
  }

  return { actions: [], reason: `type ${doc._type}` };
}

/** Where each background job lives (config.path on the function). */
export const BACKGROUND_PATHS = {
  'shipping-dispatch': '/api/shipping/dispatch-background',
  'shipping-return': '/api/shipping/return-background',
};

const SHIPPING_ONLY = new Set(['shipping-dispatch', 'shipping-return']);

/**
 * Run the route for one verified body. Exported for the tests.
 *
 * @param {object} doc
 * @param {object} deps
 * @param {boolean} deps.shippingOn
 * @param {(kind: string, id: string) => Promise<{status:number, reason:string}>} deps.sendDispatch
 * @param {(id: string) => Promise<{status:number, body:string}>} deps.completeCommission
 * @param {(action: string, doc: object) => Promise<{ok:boolean, status?:number, error?:string}>} deps.start
 */
export async function runRoute(doc, deps) {
  const log = deps.log || console;
  const { actions, reason } = routeFor(doc, deps.routeOpts);
  const name = doc?.orderNumber || doc?.orderRef || doc?.returnNumber || doc?._id || '?';
  if (!actions.length) {
    log.log(`sanity-orders-webhook: ${name}: no action (${reason})`);
    return { status: 200, body: `No action — ${reason}` };
  }
  const results = [];
  let status = 200;
  for (const action of actions) {
    if (SHIPPING_ONLY.has(action) && !deps.shippingOn) {
      results.push(`${action}: shipping is not enabled`);
      continue;
    }
    try {
      if (action === 'dispatch-email') {
        const r = await deps.sendDispatch(doc._type, doc._id);
        results.push(`dispatch-email: ${r.reason}`);
        if (r.status >= 500) status = Math.max(status, r.status);
      } else if (action === 'commission-complete') {
        const r = await deps.completeCommission(doc._id);
        results.push(`commission-complete: ${r.body}`);
        if (r.status >= 500) status = Math.max(status, r.status);
      } else {
        const r = await deps.start(action, doc);
        if (r.ok) results.push(`${action}: started`);
        else {
          // 502, so Sanity retries; the handler's claim makes a retry harmless.
          log.error(`sanity-orders-webhook: ${name}: ${action} did not start: ${r.error}`);
          results.push(`${action}: not started (${r.error})`);
          status = Math.max(status, 502);
        }
      }
    } catch (err) {
      log.error(`sanity-orders-webhook: ${name}: ${action} failed:`, err?.message || err);
      results.push(`${action}: failed`);
      status = Math.max(status, 500);
    }
  }
  log.log(`sanity-orders-webhook: ${name}: ${results.join(' | ')}`);
  return { status, body: results.join('\n') };
}
