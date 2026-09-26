#!/usr/bin/env node
/**
 * tools/check-public-exposure.mjs
 *
 * Asks the PUBLIC Sanity query API — no token, exactly what anyone on the
 * internet can do — how many customer documents and customer-uploaded assets
 * it can see. Counts only; prints no document content.
 *
 *   node tools/check-public-exposure.mjs
 *
 * Exit code 1 if any customer DOCUMENT type is visible. Customer photo ASSETS
 * are reported as a warning: asset documents stay listable while the dataset
 * is public, whatever their ids — that needs moving them out of Sanity.
 */
const PROJECT = 'bqb4w421';
const DATASET = 'production';
const URL_BASE = `https://${PROJECT}.api.sanity.io/v2024-12-01/data/query/${DATASET}`;

const DOC_TYPES = ['order', 'commission', 'contactSubmission', 'grouponVoucher', 'newsletterSubscriber', 'pendingPersonalisation'];

const query = `{
  ${DOC_TYPES.map((t) => `"${t}": count(*[_type == "${t}"])`).join(',\n  ')},
  "customerUploads": count(*[_type in ["sanity.imageAsset", "sanity.fileAsset"] && label == "commission-upload"]),
  "allAssets": count(*[_type in ["sanity.imageAsset", "sanity.fileAsset"]])
}`;

// process.exitCode rather than process.exit(): exiting while fetch sockets
// are still closing trips a libuv assertion on Windows (Node 24).
const res = await fetch(`${URL_BASE}?query=${encodeURIComponent(query)}`); // deliberately anonymous
if (!res.ok) {
  console.error(`Query failed: HTTP ${res.status}`);
  process.exitCode = 2;
} else {
  report((await res.json()).result);
}

function report(result) {
  console.log(`\n  Anonymous (public API) visibility — ${new Date().toISOString()}\n`);
  let exposed = 0;
  for (const t of DOC_TYPES) {
    const n = result[t];
    if (n > 0) exposed++;
    console.log(`  ${n > 0 ? 'EXPOSED' : 'ok     '}  ${t.padEnd(24)} ${n}`);
  }
  console.log('');
  console.log(`  ${result.customerUploads > 0 ? 'WARN   ' : 'ok     '}  ${'customer-upload assets'.padEnd(24)} ${result.customerUploads}   (label "commission-upload")`);
  console.log(`  info     ${'all assets'.padEnd(24)} ${result.allAssets}`);
  console.log(exposed
    ? `\n  ${exposed} customer document type(s) readable without a token.\n`
    : '\n  No customer documents readable without a token.\n');
  process.exitCode = exposed ? 1 : 0;
}
