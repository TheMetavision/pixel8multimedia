/**
 * What a tracking event from the shipping service does.
 *
 * metavision-shipping forwards each Sendcloud status change for a Pixel8
 * parcel to /api/shipping-event (shipping-event.mts), signed with
 * SHIPPING_SECRET. It wants a 2xx within 4 seconds; anything else is queued
 * and retried hourly, so every step here is safe to repeat.
 *
 * Outbound parcel ("kind": "parcel"), matched by orderRef -- a shop order's
 * orderNumber (P8-…) or a commission's orderRef (PX-…) -- and parcelRef:
 *   - the event is appended to shipmentResult.events (newest 30; a repeat of
 *     the same parcel + status + time is recognised and not added twice);
 *   - first carrier scan: shipmentResult.dispatchedAt and state in_transit;
 *     the document's own status moves on (order -> Dispatched, commission ->
 *     Shipped) with the tracking number and carrier if Alan left them empty,
 *     so the existing Studio views read right; then the branded dispatch
 *     email, ONCE (dispatch-email.mjs claims the document first);
 *   - every parcel delivered: shipmentResult.deliveredAt (returns count their
 *     14 days from it), state delivered; an order -> Delivered;
 *   - exception / returned to sender: the team is emailed.
 *
 * Return ("kind": "return", matched by returnRef): the return request's
 * events, In transit, and Ready to collect when it reaches Alan's collection
 * point, with an email to the team saying which point.
 *
 * All writes go through server-patch.mjs (published + draft).
 */
import { createHash } from 'node:crypto';
import { classifyStatus, isCarrierScan } from './tracking-status.mjs';
import { mapCarrier } from './parcel-bands.mjs';
import { sendDispatchEmail } from './dispatch-email.mjs';
import { readDecideWrite } from './server-patch.mjs';
import { orderRefFor } from './order-ref.mjs';
import { sendEmail, parcelAlertEmail, returnReadyEmail, returnAlertEmail } from './shipping-emails.mjs';

const EVENT_CAP = 30;

/** The same event delivered twice has the same key. */
export const eventKey = (e) => createHash('sha256')
  .update([e.kind, e.parcelRef ?? e.returnRef ?? '', e.parcelId ?? '', e.statusCode ?? '', e.status ?? '', e.at ?? ''].join('|'))
  .digest('hex').slice(0, 16);

function eventRecord(e, kind) {
  return {
    _key: eventKey(e),
    _type: 'shipmentEvent',
    at: e.at || new Date().toISOString(),
    ...(e.parcelRef != null ? { parcelRef: String(e.parcelRef) } : {}),
    status: e.status || undefined,
    statusCode: e.statusCode != null ? Number(e.statusCode) : undefined,
    carrierStatus: e.carrierStatus || undefined,
    kind,
    ...(e.test ? { test: true } : {}),
  };
}

/** Newest EVENT_CAP, oldest first. */
const capped = (events) => [...events].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-EVENT_CAP);

/** Which document an outbound event belongs to. */
export async function findShipmentDoc(sanity, orderRef) {
  const ref = String(orderRef || '').trim();
  if (!ref) return null;
  if (/^PX-/i.test(ref)) {
    const id = await sanity.fetch('*[_type == "commission" && orderRef == $r && !(_id in path("drafts.**"))][0]._id', { r: ref });
    return id ? { id, kind: 'commission' } : null;
  }
  const id = await sanity.fetch('*[_type == "order" && orderNumber == $r && !(_id in path("drafts.**"))][0]._id', { r: ref });
  return id ? { id, kind: 'order' } : null;
}

/* ------------------------------------------------------------------ parcels */

/** The decision for one event against one document. Pure, so the table is testable. */
export function parcelEventPatch(doc, event, { now = Date.now() } = {}) {
  const kind = classifyStatus(event.statusCode, event.status);
  const rec = eventRecord(event, kind);
  const result = doc.shipmentResult || {};
  const events = Array.isArray(result.events) ? result.events : [];
  const effects = { kind, duplicate: false, firstScan: false, alert: false, delivered: false, dispatched: Boolean(result.dispatchedAt), parcel: null };
  if (events.some((x) => x._key === rec._key)) return { effects: { ...effects, duplicate: true }, set: null };

  const parcels = (result.parcels || []).map((p) => ({ ...p }));
  const parcel = parcels.find((p) => String(p.parcelRef) === String(event.parcelRef))
    || parcels.find((p) => event.parcelId != null && String(p.parcelId) === String(event.parcelId));
  if (parcel) {
    parcel.status = kind;
    parcel.statusText = event.status || undefined;
    if (event.trackingNumber) parcel.trackingNumber = event.trackingNumber;
    if (event.trackingUrl) parcel.trackingUrl = event.trackingUrl;
  }
  effects.parcel = parcel || null;

  const iso = new Date(now).toISOString();
  const set = { 'shipmentResult.events': capped([...events, rec]), 'shipmentResult.parcels': parcels };
  const isCommission = doc._type === 'commission';

  if (isCarrierScan(kind) && !result.dispatchedAt) {
    effects.firstScan = true;
    effects.dispatched = true;
    set['shipmentResult.dispatchedAt'] = iso;
    if (!result.state || result.state === 'label_created') set['shipmentResult.state'] = 'in_transit';
    const tracked = parcel?.trackingNumber ? parcel : parcels.find((p) => p.trackingNumber);
    if (isCommission) {
      if (!['shipped', 'delivered', 'refunded'].includes(doc.status)) set.status = 'shipped';
    } else if (!['dispatched', 'delivered', 'refunded'].includes(doc.status)) {
      set.status = 'dispatched';
    }
    if (!String(doc.trackingNumber || '').trim() && tracked?.trackingNumber) set.trackingNumber = tracked.trackingNumber;
    if (!doc.carrier && (parcel || tracked)?.carrier) {
      const c = mapCarrier((parcel || tracked).carrier);
      set.carrier = c.carrier;
      if (c.carrierOther && !isCommission) set.carrierOther = c.carrierOther;
    }
  } else if (kind === 'in_transit' && result.state === 'label_created') {
    set['shipmentResult.state'] = 'in_transit';
  }

  if (kind === 'delivered') {
    const labelled = parcels.filter((p) => p.labelId);
    if (labelled.length && labelled.every((p) => p.status === 'delivered') && !result.deliveredAt) {
      effects.delivered = true;
      set['shipmentResult.deliveredAt'] = iso;
      set['shipmentResult.state'] = 'delivered';
      // Never the commission's own deliveredAt: that guards the digital
      // download email, which a "both" commission may still be owed.
      if (!isCommission && doc.status !== 'refunded') set.status = 'delivered';
      if (isCommission && doc.deliveryType === 'print' && doc.status !== 'refunded') set.status = 'delivered';
    }
  }
  if (kind === 'exception' || kind === 'returned_to_sender') {
    effects.alert = true;
    set['shipmentResult.state'] = kind;
  }
  return { effects, set };
}

export async function applyParcelEvent(event, deps) {
  const { sanity, getResend, now = () => Date.now(), log = console, sendDispatch = sendDispatchEmail } = deps;
  const found = await findShipmentDoc(sanity, event.orderRef);
  if (!found) {
    log.warn(`shipping-event: no order or commission ${event.orderRef} — ignored`);
    return { status: 200, body: 'Unknown order — ignored' };
  }
  let effects = null;
  const { doc } = await readDecideWrite(sanity, found.id, (d) => {
    const r = parcelEventPatch(d, event, { now: now() });
    effects = r.effects;
    return r.set ? { set: r.set } : null;
  });
  const ref = found.kind === 'commission' ? doc.orderRef : (orderRefFor(doc) || doc._id);
  if (!effects.parcel && !effects.duplicate) log.warn(`shipping-event: ${ref} has no parcel ${event.parcelRef} on record; event kept`);

  const resend = getResend();
  if (effects.alert) {
    const who = { ref, id: doc._id, type: doc._type, name: doc.customerName, email: doc.customerEmail, test: doc.test === true };
    const sent = await sendEmail(resend, parcelAlertEmail(who, effects.parcel, event, effects.kind));
    if (!sent.ok) log.error(`shipping-event: ${ref} alert email not sent: ${sent.error}`);
  }

  /* Due once a carrier has the parcel. Checked on EVERY event, not only the
     first scan, so an email that failed is sent by the next event to arrive;
     dispatch-email.mjs makes it once only. */
  let emailed = null;
  const alreadySent = found.kind === 'commission' ? doc.dispatchedAt : doc.dispatchEmailSentAt;
  if (effects.dispatched && !alreadySent) {
    emailed = await sendDispatch({ kind: found.kind, id: found.id, sanity, getResend, log });
  }
  log.log(`shipping-event: ${ref} parcel ${event.parcelRef} ${event.statusCode} ${effects.kind}`
    + `${effects.duplicate ? ' (repeat)' : ''}${effects.firstScan ? ' first scan' : ''}${effects.delivered ? ' all delivered' : ''}`
    + `${emailed ? ` dispatch email: ${emailed.reason}` : ''}`);
  // A failed email is retried by the service only if we say so.
  if (emailed && emailed.status >= 500) return { status: 503, body: `Dispatch email not sent: ${emailed.reason}`, effects, emailed };
  return { status: 200, body: 'OK', effects, emailed };
}

/* ------------------------------------------------------------------ returns */

export function returnEventPatch(ret, event, { now = Date.now() } = {}) {
  const kind = classifyStatus(event.statusCode, event.status);
  const rec = eventRecord(event, kind);
  const events = Array.isArray(ret.events) ? ret.events : [];
  const effects = { kind, becameReady: false, alert: false };
  if (events.some((x) => x._key === rec._key)) return { effects, set: null };
  const iso = new Date(now).toISOString();
  const set = { events: capped([...events, rec]) };
  if (event.trackingNumber) set.trackingNumber = event.trackingNumber;
  if (event.trackingUrl) set.trackingUrl = event.trackingUrl;
  const s = ret.status;
  const before = ['approved', 'label_sent', 'in_transit'].includes(s);
  if (kind === 'in_transit' && ['approved', 'label_sent'].includes(s)) set.status = 'in_transit';
  if (kind === 'ready_to_collect' && before) set.status = 'ready_to_collect';
  if (kind === 'delivered') {
    // Delivered to the point (some carriers say "delivered" on arrival), or
    // collected from it after "awaiting pickup".
    if (before) set.status = 'ready_to_collect';
    else if (s === 'ready_to_collect') { set.status = 'received'; set.receivedAt = iso; }
  }
  if (set.status === 'ready_to_collect') { set.readyToCollectAt = iso; effects.becameReady = true; }
  if (kind === 'exception' || kind === 'returned_to_sender') effects.alert = true;
  return { effects, set };
}

export async function applyReturnEvent(event, { sanity, getResend, now = () => Date.now(), log = console }) {
  const retId = await sanity.fetch('*[_type == "returnRequest" && returnRef == $r && !(_id in path("drafts.**"))][0]._id', { r: String(event.returnRef || '') });
  if (!retId) {
    log.warn(`shipping-event: no return ${event.returnRef} — ignored`);
    return { status: 200, body: 'Unknown return — ignored' };
  }
  let effects = null;
  let set = null;
  const { doc } = await readDecideWrite(sanity, retId, (d) => {
    const r = returnEventPatch(d, event, { now: now() });
    effects = r.effects;
    set = r.set;
    return r.set ? { set: r.set } : null;
  });
  const ret = { ...doc, ...(set || {}) };
  const resend = getResend();
  if (effects.becameReady) {
    const sent = await sendEmail(resend, returnReadyEmail(ret, event));
    if (!sent.ok) log.error(`shipping-event: return ${ret.returnNumber} ready email not sent: ${sent.error}`);
  }
  if (effects.alert) {
    const sent = await sendEmail(resend, returnAlertEmail(ret, event, effects.kind));
    if (!sent.ok) log.error(`shipping-event: return ${ret.returnNumber} alert email not sent: ${sent.error}`);
  }
  log.log(`shipping-event: return ${ret.returnNumber} ${event.statusCode} ${effects.kind} -> ${ret.status}`);
  return { status: 200, body: 'OK', effects };
}
