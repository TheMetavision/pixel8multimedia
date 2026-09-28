// studio/components/CommissionArtwork.tsx
//
// The commission's finished artwork. The files live in the private Netlify
// Blobs store "commission-artwork", not in Sanity: each row links to
// https://pixel8multimedia.co.uk/admin/api/commission-artwork/download…, and
// "Upload finished artwork" opens /admin/commission-artwork/<orderRef>. Both
// are behind the site's Basic Auth (the browser asks for the admin password
// there). The list is written by the upload's server-side check; it is
// read-only here. Nothing secret is in the Studio bundle.

import { useFormValue } from 'sanity';
import { Card, Stack, Text, Flex, Box } from '@sanity/ui';

const ADMIN_ORIGIN = 'https://pixel8multimedia.co.uk';

type Artwork = { _key: string; uploadId?: string; filename?: string; contentType?: string; bytes?: number; uploadedAt?: string };

export function CommissionArtwork() {
  const orderRef = useFormValue(['orderRef']) as string | undefined;
  const files = ((useFormValue(['finishedArtwork']) as Artwork[]) || []);
  const uploadHref = orderRef ? `${ADMIN_ORIGIN}/admin/commission-artwork/${encodeURIComponent(orderRef)}` : '';
  return (
    <Stack gap={2}>
      {files.length === 0 && <Text size={1} muted>No finished artwork uploaded yet.</Text>}
      {files.map((f, i) => {
        const href = orderRef && f.uploadId
          ? `${ADMIN_ORIGIN}/admin/api/commission-artwork/download?order=${encodeURIComponent(orderRef)}&upload=${f.uploadId}`
          : '';
        const info = [
          typeof f.bytes === 'number' ? `${(f.bytes / 1048576).toFixed(1)} MB` : null,
          f.contentType,
          f.uploadedAt ? new Date(f.uploadedAt).toLocaleString('en-GB') : null,
        ].filter(Boolean).join(' · ');
        return (
          <Card key={f._key || i} padding={3} radius={2} border>
            <Flex justify="space-between" align="center" gap={3} wrap="wrap">
              <Box>
                <Text size={1} weight="semibold">{f.filename || `file ${i + 1}`}</Text>
                <Box marginTop={2}><Text size={1} muted>{info || '—'}</Text></Box>
              </Box>
              {href
                ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>Download ↗</a>
                : <Text size={1} muted>no id</Text>}
            </Flex>
          </Card>
        );
      })}
      {uploadHref
        ? <a href={uploadHref} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>Upload finished artwork ↗</a>
        : <Text size={1} muted>No order reference yet.</Text>}
    </Stack>
  );
}
