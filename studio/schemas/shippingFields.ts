// studio/schemas/shippingFields.ts
//
// The Sendcloud fields an order and a commission share. Hidden unless the
// Studio was built with SANITY_STUDIO_SHIPPING_ENABLED=true (lib/shipping-flag).
//
// WHO OWNS WHAT (server-patch.mjs in the functions):
//   shipment.status, parcelPlan   Alan's. He edits them; the server never does
//                                 (bar writing a default plan into an empty one).
//   shipmentResult                The server's: labels, tracking, events,
//                                 errors. Read-only here. The server writes it
//                                 to the draft as well as the published
//                                 document, so publishing a draft never undoes it.

import { defineField } from 'sanity';
import { SHIPPING_UI } from '../lib/shipping-flag.mjs';
import { ALL_BANDS, BAND_TITLES } from '../../netlify/functions/_shared/parcel-bands.mjs';
import { ShipmentPanel } from '../components/ShipmentPanel';

const BAND_OPTIONS = (ALL_BANDS as string[]).map((b) => ({ title: (BAND_TITLES as Record<string, string>)[b] || b, value: b }));

export const SHIPMENT_SWITCH = [
  { title: 'Not ready', value: 'not_ready' },
  { title: 'Ready to ship (buys the labels)', value: 'ready_to_ship' },
  { title: 'On hold', value: 'on_hold' },
];

export const RESULT_STATES = [
  { title: 'Label created', value: 'label_created' },
  { title: 'In transit', value: 'in_transit' },
  { title: 'Delivered', value: 'delivered' },
  { title: 'Exception', value: 'exception' },
  { title: 'Returned to sender', value: 'returned_to_sender' },
];

/** `group` is the form group to put them in (commissions use groups). */
export function shippingFields(group?: string) {
  const g = group ? { group } : {};
  return [
    defineField({
      name: 'shipmentLabels',
      title: 'Shipment — labels',
      type: 'string',
      readOnly: true,
      hidden: !SHIPPING_UI,
      components: { field: ShipmentPanel as any },
      ...g,
    }),
    defineField({
      name: 'shipment',
      title: 'Shipment (Sendcloud)',
      type: 'object',
      hidden: !SHIPPING_UI,
      ...g,
      fields: [
        {
          name: 'status',
          title: 'Shipment',
          type: 'string',
          options: { list: SHIPMENT_SWITCH, layout: 'radio' },
          initialValue: 'not_ready',
          description:
            'Set "Ready to ship" and publish to buy one label per parcel in the plan below. The team is emailed the print links; '
            + 'the customer is emailed when the carrier first scans it. After an exception, fix the cause, set "On hold", publish, '
            + 'then "Ready to ship" again: labels already bought are never bought twice.',
        },
      ],
    }),
    defineField({
      name: 'parcelPlan',
      title: 'Parcel plan',
      type: 'array',
      hidden: !SHIPPING_UI,
      ...g,
      description:
        'One parcel per item to start with. To send two posters in one tube, delete one parcel, raise the other parcel\'s quantity '
        + 'for that item (or add the item to it), and pick the band for the combined parcel. Edit before setting "Ready to ship".',
      of: [{
        type: 'object',
        name: 'plannedParcel',
        fields: [
          { name: 'parcelRef', type: 'string', title: 'Parcel ref', description: '1, 2, 3… unique here. Never reuse a ref that already has a label for a different box.' },
          { name: 'band', type: 'string', title: 'Band', options: { list: BAND_OPTIONS } },
          {
            name: 'items',
            title: 'Contents',
            type: 'array',
            of: [{
              type: 'object',
              name: 'plannedItem',
              fields: [
                { name: 'title', type: 'string', title: 'Item', readOnly: true },
                { name: 'lineKey', type: 'string', title: 'Line key', description: 'Which line / print. Copy an item from one parcel and paste it into another to combine them.' },
                { name: 'quantity', type: 'number', title: 'Quantity', initialValue: 1 },
              ],
              preview: {
                select: { title: 'title', line: 'lineKey', qty: 'quantity' },
                prepare: ({ title, line, qty }: any) => ({ title: `${title || line || '?'} × ${qty || 1}` }),
              },
            }],
          },
        ],
        preview: {
          select: { ref: 'parcelRef', band: 'band', items: 'items' },
          prepare: ({ ref, band, items }: any) => ({
            title: `Parcel ${ref || '?'} · ${band || '⚠ no band'}`,
            subtitle: (items || []).map((i: any) => `${i.title || i.lineKey} × ${i.quantity || 1}`).join(', '),
          }),
        },
      }],
    }),
    defineField({
      name: 'shipmentResult',
      title: 'Shipment result (written by the server)',
      type: 'object',
      readOnly: true,
      hidden: !SHIPPING_UI,
      options: { collapsible: true, collapsed: true },
      ...g,
      fields: [
        { name: 'state', title: 'State', type: 'string', options: { list: RESULT_STATES } },
        { name: 'planProblem', title: 'Plan problem', type: 'text', rows: 2 },
        { name: 'error', title: 'Last error', type: 'text', rows: 3 },
        { name: 'exceptionAt', title: 'Last exception', type: 'datetime' },
        { name: 'labelCreatedAt', title: 'Labels created', type: 'datetime' },
        { name: 'dispatchedAt', title: 'First carrier scan', type: 'datetime' },
        { name: 'deliveredAt', title: 'Delivered', type: 'datetime' },
        {
          name: 'parcels',
          title: 'Parcels',
          type: 'array',
          of: [{
            type: 'object',
            name: 'shipmentParcel',
            fields: [
              { name: 'parcelRef', type: 'string', title: 'Parcel' },
              { name: 'band', type: 'string', title: 'Band' },
              { name: 'parcelId', type: 'string', title: 'Sendcloud parcel id' },
              { name: 'shipmentId', type: 'string', title: 'Sendcloud shipment id' },
              { name: 'carrier', type: 'string', title: 'Carrier' },
              { name: 'option', type: 'string', title: 'Shipping option' },
              { name: 'quotedPrice', type: 'number', title: 'Quoted price (£)' },
              { name: 'trackingNumber', type: 'string', title: 'Tracking number' },
              { name: 'trackingUrl', type: 'url', title: 'Tracking link' },
              { name: 'labelId', type: 'string', title: 'Label id' },
              { name: 'status', type: 'string', title: 'Status' },
              { name: 'statusText', type: 'string', title: 'Carrier status' },
              { name: 'test', type: 'boolean', title: 'Test label' },
            ],
            preview: {
              select: { ref: 'parcelRef', band: 'band', carrier: 'carrier', status: 'status', tracking: 'trackingNumber' },
              prepare: ({ ref, band, carrier, status, tracking }: any) => ({
                title: `Parcel ${ref} · ${band || '?'}`,
                subtitle: [carrier, status, tracking].filter(Boolean).join(' · '),
              }),
            },
          }],
        },
        {
          name: 'events',
          title: 'Tracking events (newest 30)',
          type: 'array',
          of: [{
            type: 'object',
            name: 'shipmentEvent',
            fields: [
              { name: 'at', type: 'datetime', title: 'At' },
              { name: 'parcelRef', type: 'string', title: 'Parcel' },
              { name: 'status', type: 'string', title: 'Status' },
              { name: 'statusCode', type: 'number', title: 'Code' },
              { name: 'carrierStatus', type: 'string', title: 'Carrier says' },
              { name: 'kind', type: 'string', title: 'Meaning' },
              { name: 'test', type: 'boolean', title: 'Test' },
            ],
            preview: {
              select: { at: 'at', parcel: 'parcelRef', status: 'status', kind: 'kind' },
              prepare: ({ at, parcel, status, kind }: any) => ({
                title: `${status || kind || 'Event'}${parcel ? ` — parcel ${parcel}` : ''}`,
                subtitle: at ? new Date(at).toLocaleString('en-GB') : '',
              }),
            },
          }],
        },
        { name: 'dispatchClaimedAt', title: 'Dispatch claimed', type: 'datetime', hidden: true },
      ],
    }),
  ];
}
