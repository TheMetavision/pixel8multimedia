/**
 * GA4 client + session ids, checkout → Stripe metadata → Measurement Protocol.
 *
 *   node tools/builder/ga4-tests.mjs
 *
 * The browser sends gaClientId and (only with it) gaSessionId; the checkout
 * functions keep them as ga_client_id / ga_session_id when valid; the webhook
 * sends the purchase with session_id when valid. A missing or bad session id
 * must never stop the purchase being sent.
 */
import {
  gaClientIdMetadata, purchasePayload, sendPurchase,
} from '../../netlify/functions/_shared/ga4.mjs';

let pass = 0, fail = 0;
const ok = (c, l, e = '') => {
  if (c) { pass++; console.log(`  PASS  ${l}${e !== '' ? ' — ' + e : ''}`); }
  else { fail++; console.log(`  FAIL  ${l}${e !== '' ? ' — ' + e : ''}`); }
};
const say = console.log.bind(console);
const j = JSON.stringify;

const CID = '1234567890.1700000000';
const SID = '1700000123';
const items = [{ item_id: 'x', item_name: 'X', price: 10, quantity: 2 }];
const session = (metadata) => ({ id: 'cs_test_1', currency: 'gbp', amount_total: 2495, total_details: { amount_shipping: 495 }, metadata });
const params = (p) => p?.events?.[0]?.params;

say('\n1. CHECKOUT METADATA\n');
{
  ok(j(gaClientIdMetadata(CID, SID)) === j({ ga_client_id: CID, ga_session_id: SID }), 'both valid → both kept');
  ok(j(gaClientIdMetadata(CID)) === j({ ga_client_id: CID }), 'no session id → client id only');
  for (const bad of ['17000abc', '', '1700.000', ' 1700000123', '-1', '1'.repeat(21), 1700000123, null, {}]) {
    ok(j(gaClientIdMetadata(CID, bad)) === j({ ga_client_id: CID }), `bad session id ${j(bad)} dropped, client id kept`);
  }
  ok(j(gaClientIdMetadata(undefined, SID)) === '{}', 'session id without client id → nothing');
  ok(j(gaClientIdMetadata('nope', SID)) === '{}', 'session id with bad client id → nothing');
}

say('\n2. PURCHASE PAYLOAD\n');
{
  const p = purchasePayload(session({ ga_client_id: CID, ga_session_id: SID }), items);
  ok(params(p)?.session_id === SID, 'valid session id → session_id param', params(p)?.session_id);
  ok(params(p)?.engagement_time_msec === 1, 'engagement_time_msec: 1');
  ok(p.client_id === CID && params(p).transaction_id === 'cs_test_1' && params(p).value === 20 && params(p).shipping === 4.95,
    'the rest of the purchase is unchanged');

  const noSid = purchasePayload(session({ ga_client_id: CID }), items);
  ok(noSid && !('session_id' in params(noSid)) && params(noSid).engagement_time_msec === 1,
    'no session id → still sent, without session_id, with engagement_time_msec');

  const badSid = purchasePayload(session({ ga_client_id: CID, ga_session_id: 'abc' }), items);
  ok(badSid && !('session_id' in params(badSid)), 'bad session id in metadata → still sent, without session_id');

  ok(purchasePayload(session({ ga_session_id: SID }), items) === null, 'no client id → not sent');
}

say('\n3. sendPurchase\n');
{
  process.env.GA4_MEASUREMENT_ID = 'G-TEST';
  process.env.GA4_API_SECRET = 'secret';
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; };
  const quiet = console.log; console.log = () => {};
  try {
    await sendPurchase(session({ ga_client_id: CID, ga_session_id: SID }), items, { fetchImpl });
    await sendPurchase(session({ ga_client_id: CID, ga_session_id: 'not-digits' }), items, { fetchImpl });
    await sendPurchase(session({ ga_client_id: CID }), async () => items, { fetchImpl });
    await sendPurchase(session({ ga_session_id: SID }), items, { fetchImpl });
  } finally {
    console.log = quiet;
  }
  ok(calls.length === 3, 'three sent (valid, bad and missing session id); none without a client id', calls.length);
  ok(params(calls[0]?.body)?.session_id === SID, 'first carries session_id');
  ok(calls.slice(1).every((c) => !('session_id' in params(c.body)) && params(c.body).engagement_time_msec === 1),
    'the others have no session_id but do have engagement_time_msec');
}

say(`\n${pass} passed, ${fail} failed.`);
process.exitCode = fail ? 1 : 0;
