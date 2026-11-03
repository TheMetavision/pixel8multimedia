/**
 * Buying the labels for one order or commission.
 *
 * Alan sets Shipment -> "Ready to ship" in the Studio. The Sanity webhook
 * reaches sanity-orders-webhook, which starts shipping-dispatch-background,
 * which runs dispatchShipment(): one label per planned parcel from the
 * shipping service, the results in shipmentResult, and the team's "Label
 * ready" email with a print link per parcel. The CUSTOMER is not emailed
 * here: the dispatch email goes at the first carrier scan (shipping-event).
 *
 * Any failure -- a plan that does not add up, band_not_configured,
 * no_available_option, the service down -- sets shipmentResult.state to
 * "exception", records why, and emails the team. Alan retries by setting
 * Shipment to On hold and back to Ready to ship; a parcel that already has a
 * label is never bought twice (skipped here, and the service is idempotent on
 * orderRef + parcelRef anyway).
 *
 * Fields: Alan owns shipment.status and parcelPlan; this writes only
 * shipmentResult.* (and, when the plan was empty, the default parcelPlan and
 * an order's orderNumber), through server-patch.mjs.
 */
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { quotedPounds, testOrderFlag } from './shipping-client.mjs';
import {
  proposeParcelPlan, validateParcelPlan, parcelItems, recipientFor, commissionLines,
} from './parcel-bands.mjs';
import { commissionAddress } from './commission-address.mjs';
import { orderRefFor } from './order-ref.mjs';
import { sendEmail, labelReadyEmail, shipmentProblemEmail } from './shipping-emails.mjs';

export const CLAIM_TTL_MS = 10 * 60 * 1000;

/**
 * What a document ships as: its reference, its lines, who and where.
 * @returns {Promise<{ kind, ref, lines, name, email, address, refuse?: string }>}
 */
export async function shipmentSubject(doc, { sanity, retrieveSession }) {
  if (doc._type === 'order') {
    return {
      kind: 'order',
      ref: orderRefFor(doc) || doc._id,
      lines: Array.isArray(doc.lineItems) ? doc.lineItems : [],
      name: doc.customerName || '',
      email: doc.customerEmail || '',
      address: doc.shippingAddress || {},
    };
  }
  if (doc._type === 'commission') {
    const extra = await sanity.fetch(
      '*[_id == $id][0]{ "serviceTitle": service->title, "printSizeLabels": service->printSizeLabels, "hasService": defined(service->_id) }',
      { id: doc._id },
    ).catch(() => null);
    const service = extra?.hasService ? { printSizeLabels: extra.printSizeLabels || null } : null;
    const lines = commissionLines({ ...doc, serviceTitle: extra?.serviceTitle }, service);
    const subject = {
      kind: 'commission',
      ref: doc.orderRef || doc._id,
      lines,
      name: doc.customerName || '',
      email: doc.customerEmail || '',
      address: {},
    };
    if (doc.deliveryType === 'digital') return { ...subject, refuse: 'This commission is digital-only: there is nothing to post.' };
    if (doc.awaitingVoucherCheck === true) return { ...subject, refuse: 'The Groupon voucher on this commission has not been confirmed. Confirm it first.' };
    if (!lines.length) return { ...subject, refuse: 'This commission has no prints recorded, so there is nothing to plan. Ship it by hand.' };
    const a = await commissionAddress(doc, { retrieveSession });
    if (!a.address) return { ...subject, refuse: `No delivery address: ${a.error}. Ship it by hand.` };
    return { ...subject, name: a.address.name || subject.name, address: a.address };
  }
  return null;
}

/** What we keep about a parcel. */
export function parcelRecord(planned, res) {
  return {
    _key: `parcel-${planned.parcelRef}`,
    _type: 'shipmentParcel',
    parcelRef: String(planned.parcelRef),
    band: planned.band,
    parcelId: res.parcelId != null ? String(res.parcelId) : undefined,
    shipmentId: res.shipmentId != null ? String(res.shipmentId) : undefined,
    carrier: res.carrier || undefined,
    option: res.method || undefined,
    quotedPrice: quotedPounds(res) ?? undefined,
    trackingNumber: res.trackingNumber || undefined,
    trackingUrl: res.trackingUrl || undefined,
    labelId: res.labelId != null ? String(res.labelId) : undefined,
    status: 'label_created',
    ...(res.test ? { test: true } : {}),
  };
}

/**
 * The whole job for one document. Exported for the tests, which hand it fakes.
 *
 * @param {string} id
 * @param {{ sanity, shipping: (path, body) => Promise<object>, getResend, retrieveSession?, now?, log? }} deps
 */
export async function dispatchShipment(id, deps) {
  const { sanity, shipping, getResend, now = () => Date.now(), log = console } = deps;

  /* Claim first: Sanity delivers at least once, and Alan can flip the switch
     twice. Only the caller whose conditional write lands goes on. */
  let ignored = null;
  const claim = await readDecideWrite(sanity, id, (doc) => {
    if (!doc || !['order', 'commission'].includes(doc._type)) { ignored = 'not an order or commission'; return null; }
    if (doc.shipment?.status !== 'ready_to_ship') { ignored = `shipment is ${doc.shipment?.status || 'not ready'}`; return null; }
    const claimedAt = Date.parse(doc.shipmentResult?.dispatchClaimedAt || '');
    if (Number.isFinite(claimedAt) && now() - claimedAt < CLAIM_TTL_MS) { ignored = 'already being dispatched'; return null; }
    return { set: { 'shipmentResult.dispatchClaimedAt': new Date(now()).toISOString() } };
  });
  if (!claim.written) return { outcome: 'ignored', reason: ignored || 'the document kept changing; the next webhook will retry' };
  const doc = claim.doc;

  const resend = getResend();
  const subject = await shipmentSubject(doc, deps);
  const who = { ref: subject.ref, id: doc._id, type: doc._type, name: subject.name, email: subject.email, address: subject.address, test: doc.test === true };

  const fail = async (reason, extra = {}) => {
    await serverPatch(sanity, id, {
      set: { 'shipmentResult.state': 'exception', 'shipmentResult.error': reason, 'shipmentResult.exceptionAt': new Date(now()).toISOString(), ...extra },
      unset: ['shipmentResult.dispatchClaimedAt'],
    });
    log.error(`shipping-dispatch: ${subject.ref} -> exception: ${reason}`);
    const sent = await sendEmail(resend, shipmentProblemEmail(who, reason));
    if (!sent.ok) log.error(`shipping-dispatch: ${subject.ref} problem email not sent: ${sent.error}`);
    return { outcome: 'exception', reason };
  };

  if (subject.refuse) return fail(subject.refuse);

  /* The plan: Alan's, as edited in the Studio, or the default (one parcel per
     item), which is written back so he can edit it. */
  let plan = Array.isArray(doc.parcelPlan) && doc.parcelPlan.length ? doc.parcelPlan : null;
  const defaulted = !plan;
  const proposal = defaulted ? proposeParcelPlan(subject.lines) : null;
  if (proposal) plan = proposal.plan;
  const planSet = defaulted ? { parcelPlan: plan } : {};
  const problems = [...new Set([...(proposal?.problems || []), ...validateParcelPlan(plan, subject.lines)])];
  if (problems.length) {
    return fail(`The parcel plan needs fixing before a label can be bought:\n- ${problems.join('\n- ')}`, planSet);
  }
  const country = String(subject.address?.country || '').toUpperCase();
  if (country !== 'GB') {
    return fail(`The delivery address is in ${country || 'an unknown country'}. Sendcloud shipping is UK-only for now: ship this one by hand.`, planSet);
  }

  const already = new Map((doc.shipmentResult?.parcels || []).filter((p) => p?.labelId).map((p) => [String(p.parcelRef), p]));
  const made = [];
  let error = null;
  for (const planned of plan) {
    const ref = String(planned.parcelRef);
    if (already.has(ref)) { made.push(already.get(ref)); continue; }
    try {
      const res = await shipping('create-parcel', {
        orderRef: subject.ref,
        parcelRef: ref,
        band: planned.band,
        recipient: recipientFor(subject.name, subject.address),
        items: parcelItems(planned, subject.lines),
        // A Stripe test-mode order or commission: the free void label (shipping-client.mjs).
        ...testOrderFlag(doc),
      });
      made.push(parcelRecord(planned, res));
    } catch (err) {
      const details = err?.details ? `\n${JSON.stringify(err.details).slice(0, 800)}` : '';
      error = `Parcel ${ref} (${planned.band}): ${err?.code || 'error'} — ${err?.message || err}${details}`;
      break;
    }
  }
  // Labels bought earlier but no longer in the plan stay on record: they exist.
  const inPlan = new Set(plan.map((p) => String(p.parcelRef)));
  const parcels = [...made, ...[...already.values()].filter((p) => !inPlan.has(String(p.parcelRef)))];

  if (error) {
    const bought = made.filter((p) => p.labelId).length;
    return fail(bought ? `${error}\n\n${bought} label(s) were bought before this and are kept.` : error,
      { ...planSet, 'shipmentResult.parcels': parcels });
  }

  const set = {
    ...planSet,
    'shipmentResult.state': 'label_created',
    'shipmentResult.parcels': parcels,
    'shipmentResult.labelCreatedAt': new Date(now()).toISOString(),
  };
  if (doc._type === 'order' && !doc.orderNumber) set.orderNumber = subject.ref;
  await serverPatch(sanity, id, { set, unset: ['shipmentResult.dispatchClaimedAt', 'shipmentResult.error', 'shipmentResult.planProblem'] });
  log.log(`shipping-dispatch: ${subject.ref} -> label_created (${parcels.length} parcel(s))`);

  const sent = await sendEmail(resend, labelReadyEmail(who, parcels.filter((p) => inPlan.has(String(p.parcelRef)))));
  if (!sent.ok) log.error(`shipping-dispatch: ${subject.ref} "label ready" email not sent: ${sent.error}`);
  return { outcome: 'label_created', parcels };
}
