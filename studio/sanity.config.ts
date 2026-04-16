import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './schemas';

export default defineConfig({
  name: 'pixel8-multimedia',
  title: 'Pixel8 Multimedia',
  projectId: 'bqb4w421',
  dataset: 'production',
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Pixel8 CMS')
          .items([
            S.listItem().title('Site Settings')
              .child(S.document().schemaType('siteSettings').documentId('siteSettings')),
            S.divider(),
            S.listItem().title('Services')
              .child(S.documentTypeList('service').title('Services')),
            S.divider(),
            S.listItem().title('Products')
              .child(S.documentTypeList('product').title('Products')),
            S.listItem().title('Categories')
              .child(S.documentTypeList('category').title('Categories')),
            S.divider(),
            S.listItem().title('Blog Posts')
              .child(S.documentTypeList('blogPost').title('Blog Posts')),
            S.listItem().title('FAQs')
              .child(S.documentTypeList('faq').title('FAQs')),
            S.listItem().title('Testimonials')
              .child(S.documentTypeList('testimonial').title('Testimonials')),
            S.divider(),
            S.listItem().title('Commissions')
              .child(S.documentTypeList('commission').title('Commissions')),
            S.listItem().title('Orders')
              .child(S.documentTypeList('order').title('Orders')),
          ]),
    }),
  ],
  schema: {
    types: schemaTypes,
  },
});
