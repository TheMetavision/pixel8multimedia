// GROQ queries for Pixel8 Multimedia

// ─── Collections ──────────────────────────────────────────

export const allCollectionsQuery = `
  *[_type == "collection"] | order(displayOrder asc) {
    _id,
    name,
    "slug": slug.current,
    description,
    tagline,
    coverImage {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    accentColor,
    displayOrder,
    "productCount": count(*[_type == "product" && references(^._id)])
  }
`;

export const collectionBySlugQuery = `
  *[_type == "collection" && slug.current == $slug][0] {
    _id,
    name,
    "slug": slug.current,
    description,
    tagline,
    coverImage {
      asset-> { _id, url },
      alt
    },
    accentColor,
    "productCount": count(*[_type == "product" && references(^._id)])
  }
`;

// ─── Products ─────────────────────────────────────────────

export const allProductsQuery = `
  *[_type == "product"] | order(sortOrder asc) {
    _id,
    title,
    "slug": slug.current,
    "collection": collection->slug.current,
    "collectionName": collection->name,
    "accentColor": collection->accentColor,
    description,
    images[] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    orientation,
    tags,
    featured,
    sortOrder,
    seo
  }
`;

export const productsByCollectionQuery = `
  *[_type == "product" && collection->slug.current == $collection] | order(sortOrder asc) {
    _id,
    title,
    "slug": slug.current,
    "collection": collection->slug.current,
    "collectionName": collection->name,
    "accentColor": collection->accentColor,
    description,
    images[] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    orientation,
    tags,
    featured,
    sortOrder
  }
`;

export const productBySlugQuery = `
  *[_type == "product" && slug.current == $slug][0] {
    _id,
    title,
    "slug": slug.current,
    "collection": collection->slug.current,
    "collectionName": collection->name,
    "accentColor": collection->accentColor,
    description,
    images[] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    "printFileUrl": printFile.asset->url,
    orientation,
    tags,
    featured,
    seo,
    "relatedProducts": *[_type == "product" && collection->slug.current == ^.collection->slug.current && slug.current != $slug][0..3] {
      _id,
      title,
      "slug": slug.current,
      "collection": collection->slug.current,
      "accentColor": collection->accentColor,
      "images": images[0..0] {
        asset-> { _id, url },
        alt
      }
    }
  }
`;

export const featuredProductsQuery = `
  *[_type == "product" && featured == true] | order(sortOrder asc)[0..7] {
    _id,
    title,
    "slug": slug.current,
    "collection": collection->slug.current,
    "collectionName": collection->name,
    "accentColor": collection->accentColor,
    images[0] {
      asset-> { _id, url },
      alt
    }
  }
`;

// ─── Blog ─────────────────────────────────────────────────

export const allBlogPostsQuery = `
  *[_type == "blogPost"] | order(publishedAt desc) {
    _id,
    title,
    "slug": slug.current,
    author,
    publishedAt,
    category,
    excerpt,
    mainImage {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    }
  }
`;

export const blogPostBySlugQuery = `
  *[_type == "blogPost" && slug.current == $slug][0] {
    _id,
    title,
    "slug": slug.current,
    author,
    publishedAt,
    category,
    excerpt,
    mainImage {
      asset-> { _id, url },
      alt
    },
    body[] {
      ...,
      _type == "image" => {
        asset-> { _id, url },
        alt,
        caption
      }
    },
    seo,
    "relatedPosts": *[_type == "blogPost" && slug.current != $slug] | order(publishedAt desc)[0..2] {
      _id,
      title,
      "slug": slug.current,
      publishedAt,
      excerpt,
      mainImage {
        asset-> { _id, url },
        alt
      }
    }
  }
`;

// ─── Testimonials ─────────────────────────────────────────

export const testimonialsQuery = `
  *[_type == "testimonial" && featured == true] | order(_createdAt desc) {
    _id,
    customerName,
    location,
    rating,
    quote,
    product
  }
`;

// ─── FAQs ─────────────────────────────────────────────────

export const faqsByPageQuery = `
  *[_type == "faq" && (page == $page || page == "both")] | order(sortOrder asc) {
    _id,
    question,
    answer,
    sortOrder
  }
`;

// ─── Site Settings ────────────────────────────────────────

export const siteSettingsQuery = `
  *[_type == "siteSettings"][0] {
    siteName,
    tagline,
    contactEmail,
    socialLinks,
    announcementBar,
    newsletterHeading
  }
`;

// ─── Commissions ──────────────────────────────────────────

export const commissionsByStatusQuery = `
  *[_type == "commission" && status == $status] | order(_createdAt desc) {
    _id,
    customerName,
    customerEmail,
    serviceType,
    status,
    brief,
    _createdAt
  }
`;
