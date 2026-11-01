// studio/components/ShipmentPanel.tsx
//
// The parcels on an order or commission, each with its "Print label" link.
//
// The link goes to /admin/shipping/label/<labelId> on the site, behind the
// admin Basic Auth, which proxies the PDF from the shipping service with a
// signed request -- the Studio never holds the shipping secret. Stores
// nothing; drawn from shipmentResult, which only the server writes.

import { Box, Button, Card, Flex, Stack, Text } from '@sanity/ui';
import { useFormValue } from 'sanity';

const ADMIN_ORIGIN = 'https://pixel8multimedia.co.uk';

type Parcel = {
  _key?: string; parcelRef?: string; band?: string; carrier?: string; option?: string;
  quotedPrice?: number; trackingNumber?: string; trackingUrl?: string; labelId?: string;
  status?: string; statusText?: string; test?: boolean;
};

const STATUS: Record<string, string> = {
  label_created: 'Label created',
  pre_transit: 'Label created',
  in_transit: 'In transit',
  ready_to_collect: 'Awaiting pickup',
  delivered: 'Delivered',
  exception: '⚠ Exception',
  returned_to_sender: '⚠ Returned to sender',
};

export function ShipmentPanel() {
  const result = (useFormValue(['shipmentResult']) as any) || {};
  const parcels: Parcel[] = Array.isArray(result.parcels) ? result.parcels : [];

  return (
    <Stack space={3}>
      {result.planProblem ? (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1} style={{ whiteSpace: 'pre-wrap' }}>Parcel plan needs a decision: {result.planProblem}</Text>
        </Card>
      ) : null}
      {result.state === 'exception' && result.error ? (
        <Card padding={3} radius={2} tone="critical">
          <Text size={1} style={{ whiteSpace: 'pre-wrap' }}>{result.error}</Text>
          <Box marginTop={2}><Text size={1} muted>Fix it, then set Shipment to “On hold” and back to “Ready to ship” to try again.</Text></Box>
        </Card>
      ) : null}
      {parcels.length === 0 ? (
        <Card padding={3} radius={2} tone="transparent">
          <Text size={1} muted>No labels yet. Check the parcel plan below, then set Shipment to “Ready to ship” and publish.</Text>
        </Card>
      ) : parcels.map((p, i) => (
        <Card key={p._key || i} padding={3} radius={2} shadow={1}>
          <Flex align="center" gap={3} wrap="wrap">
            <Box flex={1}>
              <Text size={2} weight="semibold">Parcel {p.parcelRef} · {p.band}{p.test ? ' · TEST' : ''}</Text>
              <Box marginTop={2}>
                <Text size={1} muted>
                  {[p.carrier, p.option, p.quotedPrice != null ? `£${Number(p.quotedPrice).toFixed(2)}` : null,
                    STATUS[p.status || ''] || p.statusText || p.status].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              {p.trackingNumber || p.trackingUrl ? (
                <Box marginTop={2}>
                  <Text size={1}>
                    {p.trackingUrl ? <a href={p.trackingUrl} target="_blank" rel="noreferrer">{p.trackingNumber || 'Tracking'}</a> : p.trackingNumber}
                  </Text>
                </Box>
              ) : null}
            </Box>
            {p.labelId ? (
              <Button
                as="a"
                href={`${ADMIN_ORIGIN}/admin/shipping/label/${encodeURIComponent(p.labelId)}`}
                target="_blank"
                rel="noreferrer"
                text="Print label"
                tone="primary"
                mode="ghost"
              />
            ) : null}
          </Flex>
        </Card>
      ))}
    </Stack>
  );
}
