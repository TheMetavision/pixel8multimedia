// studio/components/PrintFiles.tsx
//
// Read-only panel on an order: one "Download print file" link per line.
// The link opens https://pixel8multimedia.co.uk/admin/print-file/<order>/<line>,
// which is behind the site's Basic Auth; the browser asks for the admin
// password there. Nothing secret is in the Studio bundle.
//
// Whether the source exists is what the Stripe webhook recorded when the order
// came in (printFileMissing). The Studio can't look into the private Blobs
// store itself, and shouldn't be able to. The print-file page checks again
// when it's opened.

import { useFormValue } from 'sanity';
import { Card, Stack, Text, Flex, Badge, Box } from '@sanity/ui';
import {
  FORMAT_LABELS, SIZE_LABELS, WRAP_INCHES,
} from '../../netlify/functions/_shared/print-spec.mjs';

const ADMIN_ORIGIN = 'https://pixel8multimedia.co.uk';

type Line = {
  _key: string;
  productTitle?: string;
  formatKey?: string;
  sizeKey?: string;
  productSlug?: string;
  personalisationId?: string;
  styleKey?: string;
  wrapColour?: string;
  printFileMissing?: boolean;
  quantity?: number;
};

const FORMATS = FORMAT_LABELS as Record<string, string>;
const SIZES = SIZE_LABELS as Record<string, string>;
const WRAPS = WRAP_INCHES as Record<string, Record<string, number>>;

export function PrintFiles() {
  const id = (useFormValue(['_id']) as string) || '';
  const lines = ((useFormValue(['lineItems']) as Line[]) || []);
  const orderId = id.replace(/^drafts\./, '');
  const isDraft = id.startsWith('drafts.');

  if (!lines.length) return <Text size={1} muted>No lines on this order.</Text>;

  return (
    <Stack space={3}>
      {isDraft && (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1}>Unpublished changes (e.g. a wrap colour) aren't used for print files until you publish.</Text>
        </Card>
      )}
      {lines.map((l) => {
        const keyed = Boolean(l.formatKey && l.sizeKey);
        if (!keyed) {
          return (
            <Card key={l._key} padding={3} radius={2} border>
              <Stack space={2}>
                <Text size={1} weight="semibold">{l.productTitle || 'Line'}</Text>
                <Text size={1} muted>Historic line — no print data</Text>
              </Stack>
            </Card>
          );
        }
        const wrap = WRAPS[l.formatKey!]?.[l.sizeKey!] ?? 0;
        const href = `${ADMIN_ORIGIN}/admin/print-file/${encodeURIComponent(orderId)}/${encodeURIComponent(l._key)}`;
        return (
          <Card key={l._key} padding={3} radius={2} border tone={l.printFileMissing ? 'critical' : 'default'}>
            <Stack space={3}>
              <Flex justify="space-between" align="center" gap={2} wrap="wrap">
                <Text size={1} weight="semibold">
                  {l.productTitle || l.productSlug || 'Line'}{l.quantity && l.quantity > 1 ? ` × ${l.quantity}` : ''}
                </Text>
                {l.printFileMissing
                  ? <Badge tone="critical">Source missing at order time</Badge>
                  : <Badge tone="positive">Source present at order time</Badge>}
              </Flex>
              <Text size={1} muted>
                {FORMATS[l.formatKey!] || l.formatKey} · {SIZES[l.sizeKey!] || l.sizeKey}
                {wrap ? ` · ${wrap}" wrap` : ' · no wrap'}
                {l.wrapColour ? ` · wrap colour ${l.wrapColour}` : ' · wrap colour from artwork'}
                {l.personalisationId ? ` · personalised ${l.styleKey || ''}` : ''}
              </Text>
              {l.printFileMissing && (
                <Text size={1}>
                  {l.personalisationId
                    ? 'The personalised render was missing when the order came in.'
                    : `No print master in Blobs for ${l.productSlug}. Upload it with tools/print-masters/upload-masters.mjs, then generate.`}
                </Text>
              )}
              <Box>
                <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
                  Download print file ↗
                </a>
              </Box>
            </Stack>
          </Card>
        );
      })}
    </Stack>
  );
}
