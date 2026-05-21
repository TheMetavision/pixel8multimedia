import { createClient } from '@sanity/client';

const client = createClient({
  projectId: 'bqb4w421',
  dataset: 'production',
  apiVersion: '2024-01-01',
  token: process.env.SANITY_TOKEN,
  useCdn: false,
});

const result = await client.fetch(
  `*[_type == "service" && slug.current == "back-in-time"][0]{
    title,
    "styleOptions": styleOptions[]{ key, label },
    "styleOptionsSecondary": styleOptionsSecondary[]{ key, label },
    "exampleCount": count(examples),
    "examples": examples[]{
      title,
      "imageCount": count(images),
      "tags": images[].tag
    }
  }`
);

console.log(JSON.stringify(result, null, 2));
