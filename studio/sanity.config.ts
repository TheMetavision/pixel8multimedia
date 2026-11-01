import { defineConfig } from 'sanity'
import { structureTool } from 'sanity/structure'
import { schemaTypes } from './schemas'
import { SHIPPING_UI } from './lib/shipping-flag.mjs'
import { CreateReturnAction } from './actions/CreateReturnAction'

// One shipping queue: orders and commissions by Sendcloud state, newest first.
const shippingQueue = (S: any, title: string, filter: string) =>
  S.listItem().title(title).child(
    S.documentList()
      .title(title)
      .filter(`_type in ["order", "commission"] && (${filter})`)
      .defaultOrdering([{ field: '_updatedAt', direction: 'desc' }])
  )

// One returns queue. No "create" here: a return is made by the /returns page
// or an order's Create return button, at a private dotted id.
const returnsQueue = (S: any, title: string, filter: string) =>
  S.listItem().title(title).child(
    S.documentTypeList('returnRequest')
      .title(title)
      .filter(`_type == "returnRequest" && (${filter})`)
      .defaultOrdering([{ field: 'requestedAt', direction: 'desc' }])
      .initialValueTemplates([])
  )

/* Sendcloud dispatch and returns. Only in a Studio built with
   SANITY_STUDIO_SHIPPING_ENABLED=true (see lib/shipping-flag.mjs). */
const shippingItems = (S: any) => (SHIPPING_UI ? [
  S.listItem()
    .id('shipping')
    .title('Shipping')
    .child(
      S.list().title('Shipping').items([
        shippingQueue(S, 'Plan needs a decision', 'defined(shipmentResult.planProblem) && !defined(shipmentResult.labelCreatedAt)'),
        shippingQueue(S, 'Ready to ship (labels being bought)', 'shipment.status == "ready_to_ship" && !defined(shipmentResult.state)'),
        shippingQueue(S, 'Label created — to drop off', 'shipmentResult.state == "label_created"'),
        shippingQueue(S, 'In transit', 'shipmentResult.state == "in_transit"'),
        shippingQueue(S, 'Exceptions', 'shipmentResult.state in ["exception", "returned_to_sender"]'),
        shippingQueue(S, 'Delivered', 'shipmentResult.state == "delivered"'),
      ])
    ),
  S.listItem()
    .id('returns')
    .title('Returns')
    .child(
      S.list().title('Returns').items([
        returnsQueue(S, 'Requested', 'status == "requested"'),
        returnsQueue(S, 'Approved — label pending', 'status == "approved"'),
        returnsQueue(S, 'Problems', 'defined(error) && !(status in ["received", "refunded"])'),
        returnsQueue(S, 'Label sent', 'status == "label_sent"'),
        returnsQueue(S, 'In transit', 'status == "in_transit"'),
        returnsQueue(S, 'Ready to collect', 'status == "ready_to_collect"'),
        returnsQueue(S, 'Received — refund due', 'status == "received"'),
        S.divider(),
        returnsQueue(S, 'Refunded', 'status == "refunded"'),
        returnsQueue(S, 'Rejected', 'status == "rejected"'),
        returnsQueue(S, 'All returns', 'true'),
      ])
    ),
  S.divider(),
] : [])

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
            ...shippingItems(S),
            S.documentTypeListItem('commission').title('Commissions'),
            S.listItem()
              .title('Orders')
              .schemaType('order')
              .child(
                S.list()
                  .title('Orders')
                  .items([
                    // An order line whose print source (master or personalised
                    // render) was missing when the order came in. The sale went
                    // through; the file can't be made until the source exists.
                    S.listItem()
                      .title('Needs attention')
                      .child(
                        S.documentList()
                          .title('Print file missing')
                          .filter('_type == "order" && count(lineItems[printFileMissing == true]) > 0')
                          .defaultOrdering([{ field: '_createdAt', direction: 'desc' }])
                      ),
                    S.divider(),
                    S.documentTypeListItem('order').title('All orders'),
                  ])
              ),
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
    /* Never "new return request" from the create menu: it would get a random,
       publicly readable id. Returns are made at returnRequest.<ref> by the
       returns page or the order's Create return button. */
    templates: (prev) => prev.filter((t) => t.schemaType !== 'returnRequest'),
  },

  document: {
    actions: (prev, context) =>
      SHIPPING_UI && context.schemaType === 'order' ? [...prev, CreateReturnAction] : prev,
  },
})
