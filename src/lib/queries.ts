// GROQ queries for Pixel8 Multimedia
// Rewired: collection (reference) â†’ category + style (string fields)

// â”€â”€â”€ Categories â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Products â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    images[0...1] {
      asset-> { _id, url },
      alt
    }
  }
`;

// â”€â”€â”€ Blog â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Testimonials â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ FAQs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const faqsByPageQuery = `
  *[_type == "faq" && (page == $page || page == "both")] | order(sortOrder asc) {
    _id,
    question,
    answer,
    sortOrder
  }
`;

// â”€â”€â”€ Site Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Services â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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


// --- Character variants (one character ? all style variants) ----------------

// Returns every product whose slug starts with `<characterSlug>-style-`.
// Used by the character-driven PDP at /store/[character] to load
// all 10 style options for a single character in one shot.
export const productsByCharacterQuery = `
  *[_type == "product" && slug.current match $pattern] | order(style asc) {
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
    sortOrder,
    seo
  }
`;

// Distinct character slugs (the prefix before "-style-x") across the catalogue.
// Used by getStaticPaths to know which character pages to build.
export const allCharacterSlugsQuery = `
  array::unique(
    *[_type == "product" && defined(slug.current) && slug.current match "*-style-?"].slug.current
  )
`;

// Related characters in the same category (excluding the current character).
// Used for the "You Might Also Like" rail on the PDP.
export const relatedCharactersQuery = `
  *[
    _type == "product"
    && category == $category
    && !(slug.current match $excludePattern)
    && style == "style-a"
  ] | order(sortOrder asc, title asc)[0..3] {
    _id,
    title,
    "slug": slug.current,
    category,
    style,
    prices,
    accentColor,
    images[0...1] {
      asset-> { _id, url },
      alt
    }
  }
`;

// â”€â”€â”€ Shop listing (one row per character) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Returns one row per character with all 10 variants grouped in.
// Each row uses the Option A variant as the canonical title/price/image,
// and includes a `variants[]` array of thumbnail data for hover preview
// and filter swapping.
export const allCharactersForListingQuery = `
  *[
    _type == "product"
    && defined(slug.current)
    && style == "style-a"
  ] | order(category asc, title asc) {
    _id,
    title,
    "slug": slug.current,
    "characterSlug": string::split(slug.current, "-style-")[0],
    category,
    style,
    prices,
    accentColor,
    images[0...1] {
      asset-> { _id, url },
      alt,
      "lqip": asset->metadata.lqip
    },
    "variants": *[
      _type == "product"
      && string::split(slug.current, "-style-")[0] == string::split(^.slug.current, "-style-")[0]
    ] | order(style asc) {
      style,
      "slug": slug.current,
      images[0] {
        asset-> { _id, url },
        alt
      }
    }
  }
`;
