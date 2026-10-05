import { SITE, canonicalUrl } from './url';

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': canonicalUrl('/') + '#organization',
    name: 'Pixel8 Multimedia',
    url: canonicalUrl('/'),
    logo: SITE + '/web-app-manifest-512x512.png',
    description: 'Pop culture wall art and bespoke photo transformations. Poster prints, canvas and custom commissions, made to order.',
    email: 'hello@pixel8multimedia.co.uk',
    contactPoint: {
      '@type': 'ContactPoint',
      email: 'hello@pixel8multimedia.co.uk',
      contactType: 'customer service',
    },
    sameAs: [
      'https://www.facebook.com/pixel8mm/',
      'https://www.instagram.com/pixel8mm',
      'https://x.com/pixel8mm',
      'https://www.tiktok.com/@pixel8multimedia',
    ],
  };
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Pixel8 Multimedia',
    url: canonicalUrl('/'),
    publisher: { '@id': canonicalUrl('/') + '#organization' },
  };
}
