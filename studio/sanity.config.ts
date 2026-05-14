import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes } from './schemas'

export default defineConfig({
  name: 'default',
  title: 'Pixel8 Multimedia',

  projectId: 'bqb4w421',
  dataset: 'production',

  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Content')
          .items([
            S.listItem()
              .title('Site Settings')
              .child(
                S.document()
                  .schemaType('siteSettings')
                  .documentId('siteSettings')
              ),
            S.divider(),
            S.documentTypeListItem('product').title('Products'),
            S.documentTypeListItem('category').title('Categories'),
            S.divider(),
            S.documentTypeListItem('blogPost').title('Blog Posts'),
            S.documentTypeListItem('faq').title('FAQs'),
            S.documentTypeListItem('testimonial').title('Testimonials'),
            S.documentTypeListItem('service').title('Services'),
            S.divider(),
            S.documentTypeListItem('commission').title('Commissions'),
            S.documentTypeListItem('order').title('Orders'),
            S.divider(),
            S.documentTypeListItem('contactSubmission').title('Contact Submissions'),
            S.documentTypeListItem('newsletterSubscriber').title('Newsletter Subscribers'),
          ]),
    }),
  ],

  schema: {
    types: schemaTypes,
  },
})
