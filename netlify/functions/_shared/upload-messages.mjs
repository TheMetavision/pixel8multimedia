/**
 * netlify/functions/_shared/upload-messages.mjs
 *
 * Customer-facing upload messages shared by the browser (CommissionWorkflow)
 * and the functions (strip-metadata). The browser imports this file, so it
 * must stay plain JS: no Node globals (Buffer, process, fs) and no imports.
 */

export const FRIENDLY_HEIC =
  'HEIC photos (the iPhone default) can’t be uploaded here. Please choose "Most Compatible" in iPhone Settings › Camera › Formats, or export the photo as JPG, and try again.';
