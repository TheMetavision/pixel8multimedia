import { SITE, canonicalUrl } from './url';

/* Describes the real trader: Pixel8 Multimedia is a trading name of The
   Metavision Multimedia Limited, at its registered office. */
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': canonicalUrl('/') + '#organization',
    name: 'Pixel8 Multimedia',
    legalName: 'The Metavision Multimedia Limited',
    url: canonicalUrl('/'),
    logo: SITE + '/web-app-manifest-512x512.png',
    description: 'Pop culture wall art and bespoke photo transformations. Poster prints, canvas and custom commissions, made to order. A trading name of The Metavision Multimedia Limited, registered in England & Wales.',
    email: 'hello@pixel8multimedia.co.uk',
    address: {
      '@type': 'PostalAddress',
      streetAddress: '167-169 Great Portland Street, 5th Floor',
      addressLocality: 'London',
      postalCode: 'W1W 5PF',
      addressCountry: 'GB',
    },
    vatID: 'GB503753017',
    identifier: {
      '@type': 'PropertyValue',
      propertyID: 'Companies House',
      value: '16282479',
    },
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
