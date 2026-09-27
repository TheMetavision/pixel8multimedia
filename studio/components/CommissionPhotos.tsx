// studio/components/CommissionPhotos.tsx
//
// Read-only list of a commission's customer photos. They live in the private
// Netlify Blobs store, not in Sanity, so the Studio can't show thumbnails;
// each row links to https://pixel8multimedia.co.uk/admin/commission-photo/…,
// which is behind the site's Basic Auth (the browser asks for the admin
// password there). Nothing secret is in the Studio bundle.

import { useFormValue } from 'sanity';
import { Card, Stack, Text, Flex, Box } from '@sanity/ui';

const ADMIN_ORIGIN = 'https://pixel8multimedia.co.uk';
const PREFIX = 'commission-upload/';

type Photo = { _key: string; fieldKey?: string; key?: string; contentType?: string; bytes?: number; width?: number; height?: number };

export function CommissionPhotos() {
  const photos = ((useFormValue(['uploadedPhotos']) as Photo[]) || []);
  if (!photos.length) return <Text size={1} muted>No customer photos.</Text>;
  return (
    <Stack space={2}>
      {photos.map((p, i) => {
        const href = p.key?.startsWith(PREFIX) ? `${ADMIN_ORIGIN}/admin/commission-photo/${p.key.slice(PREFIX.length)}` : '';
        const size = [
          p.width && p.height ? `${p.width}×${p.height}px` : null,
          typeof p.bytes === 'number' ? `${(p.bytes / 1048576).toFixed(1)} MB` : null,
          p.contentType?.replace('image/', '').toUpperCase(),
        ].filter(Boolean).join(' · ');
        return (
          <Card key={p._key || i} padding={3} radius={2} border>
            <Flex justify="space-between" align="center" gap={3} wrap="wrap">
              <Box>
                <Text size={1} weight="semibold">{p.fieldKey || 'photo'} #{i + 1}</Text>
                <Box marginTop={2}><Text size={1} muted>{size || '—'}</Text></Box>
              </Box>
              {href
                ? <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>View photo ↗</a>
                : <Text size={1} muted>no key</Text>}
            </Flex>
          </Card>
        );
      })}
    </Stack>
  );
}
