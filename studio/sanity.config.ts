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
            // Groupon vouchers are worked as a queue, not browsed as a list:
            // the only question most days is "is anything waiting on me?", so
            // that view comes first and the full list sits behind it.
            S.listItem()
              .title('Groupon')
              .child(
                S.list()
                  .title('Groupon')
                  .items([
                    S.listItem()
                      .title('Vouchers needing a check')
                      .child(
                        S.documentList()
                          .title('Vouchers needing a check')
                          .filter(
                            '_type == "grouponVoucher" && verificationStatus in ["unchecked", "mismatch"]'
                          )
                          .defaultOrdering([{ field: '_createdAt', direction: 'asc' }])
                      ),
                    S.listItem()
                      .title('Orders on hold')
                      .child(
                        S.documentList()
                          .title('Orders awaiting a voucher check')
                          .filter('_type == "commission" && awaitingVoucherCheck == true')
                          .defaultOrdering([{ field: '_createdAt', direction: 'asc' }])
                      ),
                    S.divider(),
                    S.documentTypeListItem('grouponVoucher').title('All vouchers'),
                  ])
              ),
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
