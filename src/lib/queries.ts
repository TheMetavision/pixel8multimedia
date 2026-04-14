// GROQ queries for Pixel8 Multimedia
// Rewired: collection (reference) → category + style (string fields)

// ─── Categories ───────────────────────────────────────────

export const allCategoriesQuery = `
  *[_type == "category"] | order(sortOrder asc) {
    _id,
    name,
    "slug": slug.current,
    description,
    tagline,
    coverImage {
      asset-> { _id, url },
      hotspot
    },
    accentColor,
    sortOrder,
    "productCount": count(*[_type == "product" && category == ^.slug.current])
  }
`;

export const categoryBySlugQuery = `
  *[_type == "category" && slug.current == $slug][0] {
    _id,
    name,
    "slug": slug.current,
    description,
    tagline,
    coverImage {
      asset-> { _id, url },
      hotspot
    },
    accentColor,
    seo
  }
`;

// ─── Products ─────────────────────────────────────────────

export const allProductsQuery = `
  *[_type == "product"] | order(sortOrder asc, title asc) {
    _id,
    title,
    "slug": slug.current,
    category,
    style,
    prices,
    accentColor,
    description,
    images[] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    tags,
    featured,
    sortOrder,
    seo
  }
`;

export const productsByCategoryQuery = `
  *[_type == "product" && category == $category] | order(sortOrder asc, title asc) {
    _id,
    title,
    "slug": slug.current,
    category,
    style,
    prices,
    accentColor,
    images[] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
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
    category,
    style,
    description,
    images[] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    "printFileUrl": printFile.asset->url,
    prices,
    sizes,
    personalisationFee,
    stripePriceIds,
    accentColor,
    tags,
    featured,
    seo,
    "relatedProducts": *[_type == "product" && category == ^.category && slug.current != $slug][0..3] {
      _id,
      title,
      "slug": slug.current,
      category,
      style,
      prices,
      accentColor,
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
    category,
    style,
    prices,
    accentColor,
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

// ─── Services ─────────────────────────────────────────────

export const allServicesQuery = `
  *[_type == "service"] | order(sortOrder asc) {
    _id,
    title,
    "slug": slug.current,
    description,
    sortOrder
  }
`;

export const serviceBySlugQuery = `
  *[_type == "service" && slug.current == $slug][0] {
    _id,
    title,
    "slug": slug.current,
    description,
    extendedDescription,
    examples[] {
      label,
      images[] {
        image {
          asset-> { _id, url },
          "lqip": asset->metadata.lqip
        },
        tag
      },
      videos[] {
        youtubeId,
        tag,
        title
      },
      audioTracks[] {
        title,
        coverImage {
          asset-> { _id, url }
        },
        "audioUrl": audioFile.asset->url,
        duration
      }
    },
    steps[] { text },
    importantNote,
    hasDigitalDelivery,
    hasPrintOrder,
    hasFileUpload
  }
`;
