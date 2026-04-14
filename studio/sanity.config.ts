import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './schemas';

export default defineConfig({
  name: 'pixel8-multimedia',
  title: 'Pixel8 Multimedia',
  projectId: 'YOUR_PROJECT_ID',
  dataset: 'production',

  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Pixel8 CMS')
          .items([
            S.listItem().title('Site Settings').icon(() => '⚙️')
              .child(S.document().schemaType('siteSettings').documentId('siteSettings')),
            S.divider(),
            S.listItem().title('Products').icon(() => '🎨')
              .child(S.documentTypeList('product').title('Products')),
            S.listItem().title('Collections').icon(() => '📁')
              .child(S.documentTypeList('collection').title('Collections')),
            S.listItem().title('Services').icon(() => '🛠️')
              .child(S.documentTypeList('service').title('Services')),
            S.divider(),
            S.listItem().title('Blog Posts').icon(() => '📝')
              .child(S.documentTypeList('blogPost').title('Blog Posts')),
            S.listItem().title('FAQs').icon(() => '❓')
              .child(S.documentTypeList('faq').title('FAQs')),
            S.listItem().title('Testimonials').icon(() => '⭐')
              .child(S.documentTypeList('testimonial').title('Testimonials')),
            S.divider(),
            S.listItem().title('Orders').icon(() => '📦')
              .child(S.documentTypeList('order').title('Orders')),
            S.listItem().title('Commissions').icon(() => '✏️')
              .child(S.documentTypeList('commission').title('Commissions')),
          ]),
    }),
  ],

  schema: {
    types: schemaTypes,
  },
});
