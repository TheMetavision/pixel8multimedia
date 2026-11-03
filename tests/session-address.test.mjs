// Where a Checkout Session's delivery address lives (order P8-5TMdlih8 was
// saved with none because the shop webhook only read shipping_details).
import test from 'node:test';
import assert from 'node:assert/strict';
import { shippingDetailsOf, addressFromStripe, commissionAddress } from '../netlify/functions/_shared/commission-address.mjs';
import { shipToHtml } from '../netlify/functions/_shared/ship-to.mjs';

const UK = { line1: '1 High St', line2: 'Flat 2', city: 'Southend', state: 'Essex', postal_code: 'SS1 1AA', country: 'GB' };
const BILL = { line1: '9 Bill Rd', line2: null, city: 'Leeds', state: null, postal_code: 'LS1 1AA', country: 'GB' };

test('API 2025-03-31+: collected_information.shipping_details is read', () => {
  const s = { collected_information: { shipping_details: { name: 'Ship Name', address: UK } }, customer_details: { name: 'Bill Name', address: BILL } };
  assert.deepEqual(shippingDetailsOf(s), { name: 'Ship Name', address: UK });
});

test('older API: top-level shipping_details is read', () => {
  const s = { shipping_details: { name: 'Ship Name', address: UK }, customer_details: { name: 'Bill Name', address: BILL } };
  assert.deepEqual(shippingDetailsOf(s), { name: 'Ship Name', address: UK });
});

test('collected_information wins over shipping_details', () => {
  const s = { collected_information: { shipping_details: { name: 'New', address: UK } }, shipping_details: { name: 'Old', address: BILL } };
  assert.equal(shippingDetailsOf(s).name, 'New');
});

test('null / empty collected_information falls through to shipping_details', () => {
  const s = { collected_information: { shipping_details: null }, shipping_details: { name: 'Old', address: UK } };
  assert.equal(shippingDetailsOf(s).address, UK);
  const blank = { collected_information: { shipping_details: { name: 'X', address: { line1: '', postal_code: '', country: 'GB' } } }, shipping_details: { name: 'Old', address: UK } };
  assert.equal(shippingDetailsOf(blank).name, 'Old');
});

test('no shipping collected: customer_details name + address are used', () => {
  const s = { collected_information: null, customer_details: { name: 'Bill Name', email: 'a@b.c', address: BILL } };
  assert.deepEqual(shippingDetailsOf(s), { name: 'Bill Name', address: BILL });
});

test('shipping address without a name takes customer_details.name', () => {
  const s = { collected_information: { shipping_details: { name: null, address: UK } }, customer_details: { name: 'Bill Name' } };
  assert.equal(shippingDetailsOf(s).name, 'Bill Name');
});

test('no address anywhere -> null (country-only billing address is not enough)', () => {
  assert.equal(shippingDetailsOf({}), null);
  assert.equal(shippingDetailsOf(null), null);
  assert.equal(shippingDetailsOf({ customer_details: { name: 'A', address: { country: 'GB', postal_code: null, line1: null } } }), null);
});

test('addressFromStripe maps each location to label fields', () => {
  for (const s of [
    { collected_information: { shipping_details: { name: 'N', address: UK } } },
    { shipping_details: { name: 'N', address: UK } },
    { customer_details: { name: 'N', address: UK } },
  ]) {
    assert.deepEqual(addressFromStripe(shippingDetailsOf(s)), {
      name: 'N', line1: '1 High St', line2: 'Flat 2', city: 'Southend', county: 'Essex', postcode: 'SS1 1AA', country: 'GB',
    });
  }
});

test('commissionAddress reads a basil-shaped Stripe session at dispatch', async () => {
  const retrieveSession = async () => ({ collected_information: { shipping_details: { name: 'Grace H', address: UK } } });
  const r = await commissionAddress({ stripeSessionId: 'cs_x' }, { retrieveSession });
  assert.equal(r.source, 'stripe');
  assert.equal(r.address.country, 'GB');
});

test('shipToHtml prints the lines present, escaped', () => {
  const html = shipToHtml('Alan <C>', UK);
  assert.equal(html, 'Alan &lt;C&gt;<br/>1 High St<br/>Flat 2<br/>Southend, Essex<br/>SS1 1AA<br/>GB');
  assert.equal(shipToHtml('A', BILL), 'A<br/>9 Bill Rd<br/>Leeds<br/>LS1 1AA<br/>GB');
});

test('shipToHtml warns when there is no address', () => {
  const html = shipToHtml('Alan Christie', {});
  assert.match(html, /^Alan Christie<br\/>/);
  assert.match(html, /No delivery address/);
});
