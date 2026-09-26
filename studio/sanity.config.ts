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
            // "Your Photo" personalisations, worked as a queue: what needs
            // printing today comes first, then what's waiting on a customer.
            S.listItem()
              .title('Personalisation')
              .child(
                S.list()
                  .title('Personalisation')
                  .items([
                    // A trigger that couldn't start its function (print build
                    // or proof email). The hourly sweep retries each up to 3
                    // times; the list subtitle shows the count. Anything
                    // still here after 3 needs a person.
                    S.listItem()
                      .title('Needs attention')
                      .child(
                        S.documentList()
                          .title('Print build or proof email did not start (auto-retried hourly, 3×)')
                          .filter('_type == "pendingPersonalisation" && (defined(printTriggerError) || defined(proofTriggerError))')
                          .defaultOrdering([{ field: '_updatedAt', direction: 'desc' }])
                      ),
                    S.listItem()
                      .title('Ready to print')
                      .child(
                        S.documentList()
                          .title('Approved — ready to print')
                          .filter('_type == "pendingPersonalisation" && status == "approved"')
                          .defaultOrdering([{ field: 'approvedAt', direction: 'asc' }])
                      ),
                    S.listItem()
                      .title('Awaiting customer approval')
                      .child(
                        S.documentList()
                          .title('Proof sent — awaiting approval')
                          .filter('_type == "pendingPersonalisation" && status in ["paid", "proof-sent"]')
                          .defaultOrdering([{ field: 'proofSentAt', direction: 'asc' }])
                      ),
                    S.listItem()
                      .title('Failed')
                      .child(
                        S.documentList()
                          .title('Failed generations')
                          .filter('_type == "pendingPersonalisation" && status == "failed"')
                          .defaultOrdering([{ field: 'createdAt', direction: 'desc' }])
                      ),
                    S.divider(),
                    S.documentTypeListItem('pendingPersonalisation').title('All sessions'),
                    S.documentTypeListItem('personalisationStyle').title('Styles'),
                  ])
              ),
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
