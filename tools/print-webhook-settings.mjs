#!/usr/bin/env node
/**
 * tools/print-webhook-settings.mjs — prints the Sanity "Netlify rebuild"
 * webhook settings from the code that checks them, so the dashboard and
 * _shared/content-build.mjs can't drift apart. Reads nothing, writes nothing.
 *
 *   node tools/print-webhook-settings.mjs
 */
import { BUILD_TYPES, NEVER_BUILD, WEBHOOK_FILTER, WEBHOOK_PROJECTION } from '../netlify/functions/_shared/content-build.mjs';

console.log(`
Sanity → API → Webhooks → "Netlify rebuild"

  URL          https://pixel8multimedia.co.uk/api/sanity/content-changed
  Dataset      production
  Trigger on   Create, Update, Delete
  Filter       ${WEBHOOK_FILTER}
  Projection   ${WEBHOOK_PROJECTION}
  Drafts       off        Versions  off
  HTTP method  POST       API version  v2021-03-25 (as the other two)
  Secret       the value of SANITY_WEBHOOK_SECRET

  Builds for:  ${BUILD_TYPES.join(', ')}
  Never:       ${NEVER_BUILD.join(', ')}
`);
