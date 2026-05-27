// src/components/CommissionWorkflow.jsx
// Commission wizard — supports multiple order types per service:
//
//   Cartoonify Me (digital + print + bundle):
//     - digital              → all styles, £14.99 flat
//     - singlePrint          → one print, artwork fee applies
//     - bundle               → digital + N prints, artwork fee waived per print
//
//   The Missing Moment (digital + print + animation):
//     - digital              → digital still, £19.99
//     - singlePrint          → one print, +£19.99 artwork fee
//     - bundle               → digital still + N prints, artwork fee waived
//     - animation-music      → animation + music + digital still (£79.99)
//     - animation-vo         → animation + music + voiceover + digital still (£99.99)
//     + optional prints can be added to either animation path with artwork fee waived
//
// All variation is driven by service config:
//   - digitalPrice         → enables digital path
//   - styleOptions[]       → enables style picker (Cartoonify-style services)
//   - printUpcharges       → enables print paths
//   - animationMusicPrice  → enables animation-music path
//   - animationVoPrice     → enables animation-vo path
//   - artworkFee           → per-service artwork fee (Cartoonify £5, Missing Moment £19.99)
//   - printSizeLabels      → per-service size labels (defaults to square sizes)
//   - briefingFields[].showFor → conditional fields per orderType
//
// Stages:
//   0 — Path picker (skipped if only one path available)
//   1 — Brief fields (filtered by orderType via showFor)
//   2 — Prints config (skipped if path is pure digital or animation-only without prints)
//   3 — Review & Pay

import { useState, useMemo, useRef, useEffect } from 'react';

// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024;
// Cap on cumulative bytes queued for a single field, applied AFTER client-side
// resize. Each file uploads independently via /api/upload so there's no
// hard Netlify limit, but we still want to keep the customer's total payload
// reasonable. Set generously — the resize step typically shrinks 5MB phone
// photos to ~1MB, so 32MB easily covers 12+ photos.
const MAX_TOTAL_UPLOAD_SIZE = 32 * 1024 * 1024;
const CLIENT_RESIZE_MAX_PX = 3000;
const CLIENT_RESIZE_QUALITY = 0.9;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

// POST a single file to /.netlify/functions/upload, returning the Sanity
// asset metadata. Surfaces server-side validation errors so the dropzone
// can show them to the customer.
async function uploadFileToSanity(file, fieldKey) {
  const fd = new FormData();
  fd.append('file', file, file.name);
  fd.append('fieldKey', fieldKey);
  let res;
  try {
    res = await fetch('/.netlify/functions/upload', { method: 'POST', body: fd });
  } catch (e) {
    throw new Error('Network error while uploading. Please check your connection and try again.');
  }
  let body;
  try { body = await res.json(); } catch { body = {}; }
  if (!res.ok || !body.ok) {
    throw new Error(body.error || `Upload failed (status ${res.status}).`);
  }
  return {
    assetId: body.assetId,
    url: body.url,
    originalName: body.originalName || file.name,
    name: body.originalName || file.name,
    size: file.size,
    type: file.type,
  };
}

const LEGACY_AJ_SWATCHES = [
  { key: 'A', color: '#FF00FF' }, { key: 'B', color: '#FFFFFF' },
  { key: 'C', color: '#FF6B35' }, { key: 'D', color: '#00BCD4' },
  { key: 'E', color: '#FFEB3B' }, { key: 'F', color: '#E91E7B' },
  { key: 'G', color: '#76FF03' }, { key: 'H', color: '#9E9E9E' },
  { key: 'I', color: '#7C4DFF' }, { key: 'J', color: '#FF5252' },
];

// Default size labels (Cartoonify uses these — square 1:1 sizes)
const DEFAULT_SIZE_LABELS = {
  small: 'Small (12×12")',
  medium: 'Medium (16×16")',
  large: 'Large (20×20")',
};

const FORMAT_LABELS = {
  poster: 'Poster Print',
  'canvas-standard': 'Canvas Standard',
  'canvas-gallery': 'Canvas Gallery',
};

const ORDER_TYPE_LABELS = {
  digital: 'Digital',
  singlePrint: 'Single Print',
  bundle: 'Bundle (2+ prints)',
  'animation-music': 'Animation (Music)',
  'animation-vo': 'Animation (Music + Voiceover)',
};

// ─── Helpers ────────────────────────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function priceLabel(p) {
  if (p == null || isNaN(p)) return '—';
  return `£${Number(p).toFixed(2)}`;
}

function formatToSanityKey(f) {
  if (f === 'canvas-standard') return 'canvasStandard';
  if (f === 'canvas-gallery') return 'canvasGallery';
  return 'poster';
}

async function resizeImage(file) {
  if (file.type === 'image/heic' || !file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const longSide = Math.max(width, height);
      if (longSide <= CLIENT_RESIZE_MAX_PX) { resolve(file); return; }
      const scale = CLIENT_RESIZE_MAX_PX / longSide;
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = newW; canvas.height = newH;
      canvas.getContext('2d').drawImage(img, 0, 0, newW, newH);
      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }));
        },
        'image/jpeg', CLIENT_RESIZE_QUALITY
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

// ─── Brief field renderer ───────────────────────────────────────────────────
function BriefField({ field, value, onChange, files, onFilesChange, styleOptions }) {
  const { key, label, fieldType, helperText, required, options, minPhotos, maxPhotos, acceptedFileTypes, maxFileSizeMb } = field;
  const labelEl = (
    <span className="cw__label">
      {label}
      {required && <span className="cw__required-star"> *</span>}
    </span>
  );
  const helperEl = helperText ? <span className="cw__helper">{helperText}</span> : null;

  if (fieldType === 'photo') {
    return (
      <div className="cw__field">{labelEl}{helperEl}
        <PhotoDropzone fieldKey={key} multiple={false} maxFiles={1}
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          files={files[key] || []} onChange={(f) => onFilesChange(key, f)} />
      </div>
    );
  }

  if (fieldType === 'photos') {
    return (
      <div className="cw__field">{labelEl}{helperEl}
        <PhotoDropzone fieldKey={key} multiple minFiles={minPhotos || 1} maxFiles={maxPhotos || 10}
          accept={ALLOWED_IMAGE_TYPES.join(',')}
          files={files[key] || []} onChange={(f) => onFilesChange(key, f)} />
      </div>
    );
  }

  if (fieldType === 'file') {
    const maxMb = Number(maxFileSizeMb) || 10;
    return (
      <div className="cw__field">{labelEl}{helperEl}
        <FileDropzone fieldKey={key}
          accept={acceptedFileTypes || ''}
          maxSizeBytes={maxMb * 1024 * 1024}
          files={files[key] || []}
          onChange={(f) => onFilesChange(key, f)} />
      </div>
    );
  }

  if (fieldType === 'select') {
    return (
      <label className="cw__field">{labelEl}{helperEl}
        <select className="cw__select" required={required} value={value || ''}
          onChange={(e) => onChange(key, e.target.value)}>
          <option value="">Select…</option>
          {(options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </label>
    );
  }

  if (fieldType === 'styleSwatch') {
    const useNamed = Array.isArray(styleOptions) && styleOptions.length > 0;
    return (
      <div className="cw__field">{labelEl}{helperEl}
        {useNamed ? (
          <div className="cw__style-grid">
            {styleOptions.map((s) => {
              const active = value === s.key;
              return (
                <button type="button" key={s.key}
                  className={`cw__style-card${active ? ' cw__style-card--active' : ''}`}
                  onClick={() => onChange(key, s.key)}
                  aria-pressed={active}>
                  <span className="cw__style-label">{s.label}</span>
                  {s.helperText && <span className="cw__style-helper">{s.helperText}</span>}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="cw__swatches">
            {LEGACY_AJ_SWATCHES.map((s) => {
              const active = value === s.key;
              return (
                <button type="button" key={s.key}
                  className={`cw__swatch${active ? ' cw__swatch--active' : ''}`}
                  onClick={() => onChange(key, s.key)}
                  aria-pressed={active}>
                  <span className="cw__swatch-dot" style={{ background: s.color }} />
                  <span className="cw__swatch-letter">{s.key}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (fieldType === 'textarea') {
    return (
      <label className="cw__field">{labelEl}{helperEl}
        <textarea className="cw__textarea" required={required} rows={4}
          value={value || ''} onChange={(e) => onChange(key, e.target.value)} />
      </label>
    );
  }

  if (fieldType === 'checkbox') {
    // Consent/confirmation checkbox. Required=true means user must tick it
    // to proceed. The label text is the consent statement itself, so we
    // render it inline next to the checkbox (not above) for natural reading.
    const checked = value === true;
    return (
      <div className="cw__field">
        <label className="cw__checkbox-row">
          <input
            type="checkbox"
            className="cw__checkbox"
            checked={checked}
            required={required}
            onChange={(e) => onChange(key, e.target.checked)}
          />
          <span className="cw__checkbox-label">
            {label}
            {required && <span className="cw__required-star"> *</span>}
          </span>
        </label>
        {helperEl}
      </div>
    );
  }

  const inputType = fieldType === 'email' ? 'email' : fieldType === 'phone' ? 'tel' : 'text';
  return (
    <label className="cw__field">{labelEl}{helperEl}
      <input type={inputType} className="cw__input" required={required}
        value={value || ''} onChange={(e) => onChange(key, e.target.value)} />
    </label>
  );
}

// ─── Photo dropzone (used for fieldType=photo and photos) ───────────────────
// Files are uploaded to Sanity via /.netlify/functions/upload as soon as
// they're added. `files` is an array of metadata objects:
//   { assetId, url, originalName, name, size, type }
// The submit handler then sends just these references (small JSON) to
// commission-checkout, avoiding the Netlify Function payload limit.
function PhotoDropzone({ fieldKey, multiple, minFiles, maxFiles, accept, files, onChange }) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [error, setError] = useState('');

  function handleDrag(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  async function addFiles(incoming) {
    setError('');

    // ── Categorise incoming files by reason ─────────────────────────────
    const wrongType = [];
    const tooLarge = [];
    const candidates = [];
    for (const f of incoming) {
      if (!ALLOWED_IMAGE_TYPES.includes(f.type)) { wrongType.push(f); continue; }
      if (f.size > MAX_FILE_SIZE) { tooLarge.push(f); continue; }
      candidates.push(f);
    }

    // Cumulative cap is enforced against the bytes already accepted on this
    // field so adding more later still respects MAX_TOTAL_UPLOAD_SIZE.
    const currentTotal = files.reduce((s, f) => s + (f.size || 0), 0);
    const overTotal = [];
    const accepted = [];
    let runningTotal = currentTotal;
    for (const f of candidates) {
      if (runningTotal + f.size > MAX_TOTAL_UPLOAD_SIZE) { overTotal.push(f); continue; }
      accepted.push(f);
      runningTotal += f.size;
    }

    // Enforce max-files cap before uploading (no point uploading photo 11
    // when the field caps at 10)
    let toUpload = accepted;
    if (multiple) {
      const slotsLeft = Math.max(0, (maxFiles || Infinity) - files.length);
      if (toUpload.length > slotsLeft) toUpload = toUpload.slice(0, slotsLeft);
    } else {
      toUpload = toUpload.slice(0, 1);
    }

    // Build a single error string from all reject reasons
    const errors = [];
    if (wrongType.length) {
      errors.push(
        `${wrongType.length === 1 ? 'This file isn\u2019t' : 'These files aren\u2019t'} a supported format: ${wrongType.map((f) => f.name).join(', ')}. Use JPG, PNG, WebP, or HEIC.`
      );
    }
    if (tooLarge.length) {
      const names = tooLarge.map((f) => `${f.name} (${formatBytes(f.size)})`).join(', ');
      errors.push(
        `${tooLarge.length === 1 ? 'This file is' : 'These files are'} larger than the ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB single-file limit: ${names}. Try compressing or resizing before uploading.`
      );
    }
    if (overTotal.length) {
      const names = overTotal.map((f) => f.name).join(', ');
      errors.push(
        `Adding ${overTotal.length === 1 ? 'this file' : 'these files'} would exceed the ${Math.round(MAX_TOTAL_UPLOAD_SIZE / 1024 / 1024)}MB total upload limit: ${names}. Remove or shrink existing files to make room.`
      );
    }
    if (errors.length) setError(errors.join(' '));

    if (toUpload.length === 0) return;

    // ── Resize then upload, one at a time, with progress ────────────────
    setBusyCount(toUpload.length);
    const uploaded = [];
    for (let i = 0; i < toUpload.length; i++) {
      const original = toUpload[i];
      setProgressLabel(`Processing photo ${i + 1} of ${toUpload.length}…`);
      let resized;
      try {
        resized = await resizeImage(original);
      } catch {
        resized = original; // fall back to original on any resize hiccup
      }
      setProgressLabel(`Uploading photo ${i + 1} of ${toUpload.length}…`);
      try {
        const meta = await uploadFileToSanity(resized, fieldKey);
        uploaded.push(meta);
      } catch (uploadErr) {
        setError(`Couldn\u2019t upload ${original.name}: ${uploadErr.message}`);
        // Stop processing further files in this batch — let the customer
        // see what failed and retry rather than silently uploading some
        // and skipping others.
        break;
      }
    }
    setBusyCount(0);
    setProgressLabel('');

    if (uploaded.length === 0) return;

    let combined = multiple ? [...files, ...uploaded] : [uploaded[0]];
    if (multiple && combined.length > (maxFiles || Infinity)) {
      combined = combined.slice(0, maxFiles);
    }
    onChange(combined);
  }

  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles([...e.dataTransfer.files]);
  }

  function handleInput(e) {
    if (e.target.files?.length) addFiles([...e.target.files]);
    e.target.value = '';
  }

  // Live total so the user can see how much room is left
  const totalBytes = files.reduce((s, f) => s + (f.size || 0), 0);
  const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
  const limitMb = Math.round(MAX_TOTAL_UPLOAD_SIZE / 1024 / 1024);
  const isBusy = busyCount > 0;

  return (
    <>
      <div className={`cw__dropzone${dragActive ? ' cw__dropzone--active' : ''}${isBusy ? ' cw__dropzone--busy' : ''}`}
        onDragEnter={isBusy ? undefined : handleDrag}
        onDragOver={isBusy ? undefined : handleDrag}
        onDragLeave={isBusy ? undefined : handleDrag}
        onDrop={isBusy ? undefined : handleDrop}
        onClick={() => !isBusy && inputRef.current?.click()}
        role="button" tabIndex={0} aria-disabled={isBusy}
        onKeyDown={(e) => !isBusy && e.key === 'Enter' && inputRef.current?.click()}>
        <input ref={inputRef} type="file" multiple={multiple} disabled={isBusy}
          accept={accept || ALLOWED_IMAGE_TYPES.join(',')} onChange={handleInput}
          className="cw__file-input" aria-label={`Upload photos for ${fieldKey}`} />
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cw__upload-icon">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="cw__dropzone-text">
          {isBusy ? progressLabel
            : dragActive ? 'Drop here…'
            : multiple ? `Drag & drop ${minFiles}–${maxFiles} photos or click to browse`
            : 'Drag & drop a photo or click to browse'}
        </p>
        <p className="cw__dropzone-sub">
          JPG / PNG / WebP / HEIC — auto-resized to 3000px max ·{' '}
          {files.length > 0
            ? `${totalMb}MB of ${limitMb}MB used`
            : `Max ${limitMb}MB total`}
        </p>
      </div>
      {error && <p className="cw__error" style={{ marginTop: '0.5rem' }}>{error}</p>}
      {files.length > 0 && (
        <ul className="cw__file-list">
          {files.map((f, i) => (
            <li key={`${f.assetId || f.name}-${f.size}-${i}`} className="cw__file-item">
              <span className="cw__file-name">
                {f.name} <span className="cw__file-size">({formatBytes(f.size)})</span>
                {f.assetId && <span className="cw__file-status" aria-label="Uploaded"> ✓</span>}
              </span>
              <button type="button"
                onClick={() => { setError(''); onChange(files.filter((_, idx) => idx !== i)); }}
                className="cw__file-remove" aria-label={`Remove ${f.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─── Generic file dropzone (for audio, video, document uploads) ─────────────
// NOTE: This dropzone still stores raw File objects rather than uploading
// them via /api/upload. No live service currently uses fieldType='file', so
// this hasn't been migrated. If you ever add a service with non-image file
// uploads, swap the addFiles() body to call uploadFileToSanity() the way
// PhotoDropzone does — commission-checkout already expects asset references,
// not files in the request body.
function FileDropzone({ fieldKey, accept, maxSizeBytes, files, onChange }) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState('');

  function handleDrag(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  function addFiles(incoming) {
    setError('');
    const f = incoming[0];
    if (!f) return;
    if (maxSizeBytes && f.size > maxSizeBytes) {
      setError(`File too large. Max ${Math.round(maxSizeBytes / 1024 / 1024)}MB.`);
      return;
    }
    onChange([f]);
  }

  function handleDrop(e) {
    e.preventDefault(); e.stopPropagation(); setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles([...e.dataTransfer.files]);
  }

  function handleInput(e) {
    if (e.target.files?.length) addFiles([...e.target.files]);
    e.target.value = '';
  }

  return (
    <>
      <div className={`cw__dropzone${dragActive ? ' cw__dropzone--active' : ''}`}
        onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag}
        onDrop={handleDrop} onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}>
        <input ref={inputRef} type="file"
          accept={accept || undefined} onChange={handleInput}
          className="cw__file-input" aria-label={`Upload file for ${fieldKey}`} />
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cw__upload-icon">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <p className="cw__dropzone-text">
          {dragActive ? 'Drop here…' : 'Drag & drop a file or click to browse'}
        </p>
        <p className="cw__dropzone-sub">
          {accept ? `Accepted: ${accept}` : 'Any file type'}
          {maxSizeBytes ? ` · Max ${Math.round(maxSizeBytes / 1024 / 1024)}MB` : ''}
        </p>
      </div>
      {error && <p className="cw__error" style={{ marginTop: '0.5rem' }}>{error}</p>}
      {files.length > 0 && (
        <ul className="cw__file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="cw__file-item">
              <span className="cw__file-name">{f.name} <span className="cw__file-size">({formatBytes(f.size)})</span></span>
              <button type="button" onClick={() => onChange([])}
                className="cw__file-remove" aria-label={`Remove ${f.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─── Main wizard ────────────────────────────────────────────────────────────
export default function CommissionWorkflow({ service }) {
  const styleOptions = service.styleOptions || [];
  // SECONDARY COLLECTION (e.g. Back In Time's Historical Periods alongside Modern Decades)
  const styleOptionsSecondary = service.styleOptionsSecondary || [];
  const collectionLabel = service.collectionLabel || 'Collection 1';
  const collectionLabelSecondary = service.collectionLabelSecondary || 'Collection 2';
  const digitalPrice = Number(service.digitalPrice) || 0;
  const digitalPriceSecondary = Number(service.digitalPriceSecondary) || 0;
  const digitalPriceBoth = Number(service.digitalPriceBoth) || 0;
  const animationMusicPrice = Number(service.animationMusicPrice) || 0;
  const animationVoPrice = Number(service.animationVoPrice) || 0;
  const artworkFee = service.artworkFee != null ? Number(service.artworkFee) : 5.0; // default £5 (Cartoonify)
  // Whether the artwork fee is bundled into the digital base.
  // TRUE (default) = Cartoonify / Missing Moment — print artwork fee waived when digital is in same checkout.
  // FALSE = Your Song Your Story — digital song and lyrics print are SEPARATE products, artwork always applies.
  const artworkBundledWithDigital = service.artworkBundledWithDigital !== false; // default true
  // Whether the artwork fee is charged once per ORDER (true) or once per PRINT (false).
  // FALSE (default) = artwork × print count (Cartoonify/Missing Moment standalone behaviour).
  // TRUE = artwork charged once regardless of print count (Your Song Your Story — one lyrics layout reused for any number of print sizes).
  const artworkFeePerOrder = service.artworkFeePerOrder === true; // default false
  const sizeLabels = service.printSizeLabels || DEFAULT_SIZE_LABELS;

  const hasDigitalOption = digitalPrice > 0;
  const hasSecondaryCollection = styleOptionsSecondary.length > 0 && digitalPriceSecondary > 0;
  const hasBothCollectionsPrice = digitalPriceBoth > 0 && hasSecondaryCollection;
  const hasAnimationMusic = animationMusicPrice > 0;
  const hasAnimationVo = animationVoPrice > 0;
  const hasAnimation = hasAnimationMusic || hasAnimationVo;

  // All available styles across both collections (for single-print picker — customer can pick any era)
  const allStyleOptions = useMemo(() => {
    if (!hasSecondaryCollection) return styleOptions;
    return [...styleOptions, ...styleOptionsSecondary];
  }, [styleOptions, styleOptionsSecondary, hasSecondaryCollection]);

  const hasPrintOption = useMemo(() => {
    const u = service.printUpcharges;
    if (!u) return false;
    const anyPositive = (obj) => obj && Object.values(obj).some((v) => Number(v) > 0);
    return anyPositive(u.poster) || anyPositive(u.canvasStandard) || anyPositive(u.canvasGallery);
  }, [service]);

  // Available paths in display order
  const availablePaths = useMemo(() => {
    const paths = [];
    if (hasDigitalOption) paths.push('digital');
    if (hasSecondaryCollection) paths.push('digital-secondary');
    if (hasBothCollectionsPrice) paths.push('digital-both');
    if (hasPrintOption) paths.push('singlePrint');
    if (hasDigitalOption && hasPrintOption) paths.push('bundle');
    if (hasAnimationMusic) paths.push('animation-music');
    if (hasAnimationVo) paths.push('animation-vo');
    return paths;
  }, [hasDigitalOption, hasSecondaryCollection, hasBothCollectionsPrice, hasPrintOption, hasAnimationMusic, hasAnimationVo]);

  const startStep = availablePaths.length > 1 ? 0 : 1;
  const [step, setStep] = useState(startStep);
  const [orderType, setOrderType] = useState(availablePaths[0] || 'digital');
  const [includePrintsWithAnimation, setIncludePrintsWithAnimation] = useState(false);
  // For bundle path: which digital collection is the customer bundling with prints?
  // 'primary' = main collection, 'secondary' = secondary, 'both' = both collections.
  // Only meaningful when hasSecondaryCollection is true.
  const [bundleCollection, setBundleCollection] = useState('primary');
  const [briefValues, setBriefValues] = useState({});
  const [briefFiles, setBriefFiles] = useState({});
  const [prints, setPrints] = useState([{ styleKey: '', format: '', size: '' }]);
  // Shipping address is collected by Stripe Checkout via
  // shipping_address_collection. It arrives on the webhook in
  // session.shipping_details and is patched onto the commission doc there.
  // Nothing to track in wizard state.
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Ref + effect: when the step changes, scroll the wizard's top into view.
  // Without this, mobile users carry over their scroll position from the
  // (tall) prints step into the (shorter) review step and land at the bottom
  // of the new content. Smooth scroll keeps the transition feeling fluid.
  // Skip on the very first render so customers who deep-link to the wizard
  // don't get yanked around when the page first loads.
  const wizardRef = useRef(null);
  const isFirstRenderRef = useRef(true);
  useEffect(() => {
    if (isFirstRenderRef.current) {
      isFirstRenderRef.current = false;
      return;
    }
    if (!wizardRef.current) return;
    // Use requestAnimationFrame to ensure the new step has rendered before
    // measuring — avoids scrolling to a stale layout.
    requestAnimationFrame(() => {
      wizardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [step]);

  const briefingFields = service.briefingFields || [];

  // ─── Filter briefing fields by orderType using showFor ────────────────────
  const filteredBriefingFields = useMemo(() => {
    return briefingFields
      .filter((f) => {
        // Style picker hidden for ALL digital paths (digital includes everything)
        // and singlePrint (where style is chosen per-print in the prints step)
        if (f.fieldType === 'styleSwatch' && (
          orderType === 'digital' ||
          orderType === 'digital-secondary' ||
          orderType === 'digital-both' ||
          orderType === 'singlePrint'
        )) {
          return false;
        }
        // Honour showFor — if set, only show when orderType matches
        if (Array.isArray(f.showFor) && f.showFor.length > 0) {
          return f.showFor.includes(orderType);
        }
        return true;
      });
  }, [briefingFields, orderType]);

  // Whether the print configuration step is needed
  const orderInvolvesPrints =
    orderType === 'singlePrint' ||
    orderType === 'bundle' ||
    ((orderType === 'animation-music' || orderType === 'animation-vo') && includePrintsWithAnimation);

  // ─── Pricing helpers ──────────────────────────────────────────────────────
  function lookupBasePrintPrice(format, size) {
    const upcharges = service.printUpcharges;
    const key = formatToSanityKey(format);
    return Number(upcharges?.[key]?.[size]) || 0;
  }
  function lookupStandalonePrintPrice(format, size) {
    return lookupBasePrintPrice(format, size) + artworkFee;
  }

  // Helper — which style options are available given the current context?
  // For singlePrint: all styles across both collections (customer picks any).
  // For bundle: depends on bundleCollection state.
  function getStylesForPrintRow() {
    if (orderType === 'singlePrint') return allStyleOptions;
    if (orderType === 'bundle') {
      if (bundleCollection === 'primary') return styleOptions;
      if (bundleCollection === 'secondary') return styleOptionsSecondary;
      if (bundleCollection === 'both') return allStyleOptions;
    }
    return allStyleOptions;
  }

  // Helper — for any style key, find its label across both collections
  function findStyleLabel(styleKey) {
    if (!styleKey) return null;
    const match = allStyleOptions.find((s) => s.key === styleKey);
    return match?.label || null;
  }

  // ─── Pricing breakdown ────────────────────────────────────────────────────
  const pricing = useMemo(() => {
    // Digital-only path (primary collection)
    if (orderType === 'digital') {
      const label = hasSecondaryCollection
        ? `Digital — ${collectionLabel} (all ${styleOptions.length} styles)`
        : styleOptions.length > 0
          ? `Digital bundle (all ${styleOptions.length} styles)`
          : 'Digital download';
      return {
        lines: [{ label, amount: digitalPrice }],
        total: digitalPrice,
        artworkFeeWaived: false,
      };
    }

    // Digital-only path (secondary collection)
    if (orderType === 'digital-secondary') {
      const label = `Digital — ${collectionLabelSecondary} (all ${styleOptionsSecondary.length} styles)`;
      return {
        lines: [{ label, amount: digitalPriceSecondary }],
        total: digitalPriceSecondary,
        artworkFeeWaived: false,
      };
    }

    // Both collections — combined digital
    if (orderType === 'digital-both') {
      const totalStyles = styleOptions.length + styleOptionsSecondary.length;
      const label = `Both Collections — Digital (${totalStyles} styles total)`;
      return {
        lines: [{ label, amount: digitalPriceBoth }],
        total: digitalPriceBoth,
        artworkFeeWaived: false,
      };
    }

    // Single print only
    if (orderType === 'singlePrint') {
      const p = prints[0];
      if (!p?.format || !p?.size) return { lines: [], total: 0, artworkFeeWaived: false };
      const total = lookupStandalonePrintPrice(p.format, p.size);
      const styleLabel = findStyleLabel(p.styleKey);
      return {
        lines: [{
          label: `${FORMAT_LABELS[p.format]} — ${sizeLabels[p.size] || p.size}${styleLabel ? ` (${styleLabel})` : ''}`,
          note: `Includes £${artworkFee.toFixed(2)} artwork fee`,
          amount: total,
        }],
        total,
        artworkFeeWaived: false,
      };
    }

    // Bundle: digital + N prints. For two-collection services the bundle includes
    // a digital tier (primary, secondary, or both) chosen via bundleCollection state.
    if (orderType === 'bundle') {
      const validPrints = prints.filter((p) => p.format && p.size);

      // Determine the digital component of the bundle
      let digitalLine;
      let digitalAmount;
      if (hasSecondaryCollection && bundleCollection === 'secondary') {
        digitalLine = `Digital — ${collectionLabelSecondary} (all ${styleOptionsSecondary.length} styles)`;
        digitalAmount = digitalPriceSecondary;
      } else if (hasSecondaryCollection && bundleCollection === 'both') {
        const totalStyles = styleOptions.length + styleOptionsSecondary.length;
        digitalLine = `Both Collections — Digital (${totalStyles} styles total)`;
        digitalAmount = digitalPriceBoth;
      } else {
        // primary collection (default)
        digitalLine = hasSecondaryCollection
          ? `Digital — ${collectionLabel} (all ${styleOptions.length} styles)`
          : styleOptions.length > 0
            ? `Digital bundle (all ${styleOptions.length} styles)`
            : 'Digital download';
        digitalAmount = digitalPrice;
      }

      const lines = [{ label: digitalLine, amount: digitalAmount }];
      let total = digitalAmount;
      let saved = 0;

      const waiveArtwork = artworkBundledWithDigital;

      validPrints.forEach((p) => {
        const base = lookupBasePrintPrice(p.format, p.size);
        const styleLabel = findStyleLabel(p.styleKey);
        lines.push({
          label: `${FORMAT_LABELS[p.format]} — ${sizeLabels[p.size] || p.size}${styleLabel ? ` (${styleLabel})` : ''}`,
          note: waiveArtwork ? `£${artworkFee.toFixed(2)} artwork fee waived` : undefined,
          amount: base,
        });
        total += base;
        if (waiveArtwork) saved += artworkFee;
      });

      // If artwork still applies (YSYS-style), add it as a separate line
      if (!waiveArtwork && validPrints.length > 0) {
        if (artworkFeePerOrder) {
          lines.push({
            label: 'Artwork fee',
            note: 'One-time charge per order',
            amount: artworkFee,
          });
          total += artworkFee;
        } else {
          for (let i = 0; i < validPrints.length; i++) {
            lines.push({
              label: `Artwork fee (print ${i + 1})`,
              amount: artworkFee,
            });
            total += artworkFee;
          }
        }
      }

      return {
        lines, total,
        artworkFeeWaived: waiveArtwork && validPrints.length > 0,
        savedAmount: saved,
      };
    }

    // Animation paths
    if (orderType === 'animation-music' || orderType === 'animation-vo') {
      const animPrice = orderType === 'animation-music' ? animationMusicPrice : animationVoPrice;
      const animLabel = orderType === 'animation-music'
        ? 'Animation (30s with music) + digital still'
        : 'Animation (30s with music + voiceover) + digital still';
      const lines = [{ label: animLabel, amount: animPrice }];
      let total = animPrice;

      if (includePrintsWithAnimation) {
        const validPrints = prints.filter((p) => p.format && p.size);
        validPrints.forEach((p) => {
          const base = lookupBasePrintPrice(p.format, p.size);
          const styleLabel = p.styleKey && styleOptions.length > 0
            ? styleOptions.find((s) => s.key === p.styleKey)?.label : null;
          lines.push({
            label: `${FORMAT_LABELS[p.format]} — ${sizeLabels[p.size] || p.size}${styleLabel ? ` (${styleLabel})` : ''}`,
            note: `£${artworkFee.toFixed(2)} artwork fee waived`,
            amount: base,
          });
          total += base;
        });
        return {
          lines, total,
          artworkFeeWaived: validPrints.length > 0,
          savedAmount: validPrints.length * artworkFee,
        };
      }

      return { lines, total, artworkFeeWaived: false };
    }

    return { lines: [], total: 0, artworkFeeWaived: false };
  }, [orderType, prints, digitalPrice, digitalPriceSecondary, digitalPriceBoth, bundleCollection, hasSecondaryCollection, collectionLabel, collectionLabelSecondary, animationMusicPrice, animationVoPrice, includePrintsWithAnimation, artworkFee, sizeLabels, service, styleOptions, styleOptionsSecondary]);

  // ─── Validation ────────────────────────────────────────────────────────────
  function validateBriefStep() {
    for (const f of filteredBriefingFields) {
      if (!f.required) continue;
      if (f.fieldType === 'photo') {
        if ((briefFiles[f.key] || []).length === 0) return `Please upload "${f.label}".`;
      } else if (f.fieldType === 'photos') {
        const arr = briefFiles[f.key] || [];
        const min = f.minPhotos || 1;
        if (arr.length < min) return `Please upload at least ${min} photo${min > 1 ? 's' : ''} for "${f.label}".`;
      } else if (f.fieldType === 'file') {
        if ((briefFiles[f.key] || []).length === 0) return `Please upload a file for "${f.label}".`;
      } else if (f.fieldType === 'checkbox') {
        if (briefValues[f.key] !== true) return `Please confirm: "${f.label}"`;
      } else {
        const v = (briefValues[f.key] || '').trim();
        if (!v) return `Please fill in "${f.label}".`;
        if (f.fieldType === 'email' && !/^\S+@\S+\.\S+$/.test(v)) {
          return `"${f.label}" needs to be a valid email address.`;
        }
      }
    }
    return null;
  }

  function validatePrintsStep() {
    if (!orderInvolvesPrints) return null;
    const requireStyle = styleOptions.length > 0 || styleOptionsSecondary.length > 0;
    const printsToValidate = orderType === 'singlePrint' ? prints.slice(0, 1) : prints;
    for (const [i, p] of printsToValidate.entries()) {
      if (!p.format || !p.size) return `Please choose a format and size for print #${i + 1}.`;
      if (requireStyle && !p.styleKey) return `Please choose a style for print #${i + 1}.`;
    }
    // Bundle is framed as "2+ prints" — enforce a minimum of two completed print
    // rows. Customers wanting just one print should use the Single Print path.
    if (orderType === 'bundle') {
      const completed = prints.filter((p) => p.format && p.size && (!requireStyle || p.styleKey));
      if (completed.length < 2) {
        return 'The Bundle path requires at least 2 prints. Add another print, or switch to Single Print.';
      }
    }
    return null;
  }

  function next() {
    setError('');
    if (step === 0) { setStep(1); return; }
    if (step === 1) {
      const err = validateBriefStep();
      if (err) { setError(err); return; }
      if (orderInvolvesPrints) setStep(2);
      else setStep(3);
    } else if (step === 2) {
      const err = validatePrintsStep();
      if (err) { setError(err); return; }
      setStep(3);
    }
  }

  function back() {
    setError('');
    if (step === 3 && !orderInvolvesPrints) { setStep(1); return; }
    if (step === 1 && availablePaths.length > 1) { setStep(0); return; }
    setStep((s) => Math.max(0, s - 1));
  }

  function selectPath(path) {
    setOrderType(path);
    setIncludePrintsWithAnimation(false);
    if (path === 'singlePrint') {
      setPrints((p) => [p[0] || { styleKey: '', format: '', size: '' }]);
    } else if (path === 'bundle') {
      // Bundle is framed as "2+ prints" — start with two empty print rows so
      // the customer immediately sees the multi-print structure.
      setPrints([
        { styleKey: '', format: '', size: '' },
        { styleKey: '', format: '', size: '' },
      ]);
    } else {
      setPrints([{ styleKey: '', format: '', size: '' }]);
    }
  }

  function addPrint() {
    setPrints((p) => [...p, { styleKey: '', format: '', size: '' }]);
  }
  function removePrint(i) {
    setPrints((p) => (p.length > 1 ? p.filter((_, idx) => idx !== i) : p));
  }
  function updatePrint(i, patch) {
    setPrints((p) => p.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  // ─── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    setError('');
    setSubmitting(true);
    try {
      // Photos uploaded to Sanity already (by PhotoDropzone via /api/upload).
      // Each entry in briefFiles[fieldKey] now holds asset metadata, not a
      // raw File. We collect them into a flat array for the checkout function
      // to attach as references on the commission doc.
      const uploadedAssets = [];
      Object.entries(briefFiles).forEach(([fieldKey, arr]) => {
        (arr || []).forEach((meta) => {
          if (meta?.assetId) {
            uploadedAssets.push({
              fieldKey,
              assetId: meta.assetId,
              originalName: meta.originalName || meta.name || 'upload',
            });
          }
        });
      });

      const name = briefValues.customerName || '';
      const email = briefValues.customerEmail || '';
      const phone = briefValues.customerPhone || '';

      const briefSummary = filteredBriefingFields
        .filter((f) => !['photo', 'photos', 'file'].includes(f.fieldType))
        .filter((f) => !['customerName', 'customerEmail', 'customerPhone'].includes(f.key))
        .map((f) => {
          const raw = briefValues[f.key];
          let display;
          if (f.fieldType === 'checkbox') {
            display = raw === true ? 'Yes' : 'No';
          } else {
            display = raw || '(not provided)';
          }
          return `${f.label}: ${display}`;
        })
        .join('\n');

      const briefData = filteredBriefingFields
        .filter((f) => !['photo', 'photos', 'file'].includes(f.fieldType))
        .map((f) => {
          const raw = briefValues[f.key];
          let v;
          if (f.fieldType === 'checkbox') v = raw === true ? 'Yes' : 'No';
          else v = raw || '';
          return { key: f.key, label: f.label, value: v };
        });

      const validPrints = orderInvolvesPrints
        ? (orderType === 'singlePrint' ? prints.slice(0, 1) : prints)
            .filter((p) => p.format && p.size)
        : [];

      const payload = {
        serviceSlug: service.slug,
        serviceTitle: service.title,
        orderType,
        includePrintsWithAnimation: !!includePrintsWithAnimation,
        bundleCollection,
        name, email, phone,
        brief: briefSummary,
        briefData,
        prints: validPrints,
        uploadedAssets,
      };

      const res = await fetch('/.netlify/functions/commission-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Something went wrong. Please try again.');
      }
      const { url } = await res.json();
      if (!url) throw new Error('Checkout URL missing from response.');
      window.location.href = url;
    } catch (err) {
      setError(err.message || 'Something went wrong.');
      setSubmitting(false);
    }
  }

  // ─── Render helpers ────────────────────────────────────────────────────────
  const totalSteps =
    (availablePaths.length > 1 ? 1 : 0) +
    1 +
    (orderInvolvesPrints ? 1 : 0) +
    1;
  const displayStepIndex =
    step === 0 ? 0
    : step === 1 ? (availablePaths.length > 1 ? 1 : 0)
    : step === 2 ? (availablePaths.length > 1 ? 2 : 1)
    : totalSteps - 1;

  // Cheapest standalone-print price (for the Single Print card)
  const cheapestStandalonePrint = useMemo(() => {
    const u = service.printUpcharges;
    if (!u) return null;
    const all = [];
    ['poster', 'canvasStandard', 'canvasGallery'].forEach((fmt) => {
      ['small', 'medium', 'large'].forEach((size) => {
        const p = Number(u?.[fmt]?.[size]);
        if (p > 0) all.push(p + artworkFee);
      });
    });
    return all.length > 0 ? Math.min(...all) : null;
  }, [service, artworkFee]);

  const cheapestBundle = useMemo(() => {
    if (!hasDigitalOption || !cheapestStandalonePrint) return null;
    // Bundle is framed as "2+ prints + digital." Starting price = digital + 2× print
    // base, with artwork fee handling per service config:
    //   - artworkBundledWithDigital (default): one artwork already included in
    //     digital price; both prints' bases stand alone with no per-print fee
    //   - !artworkBundledWithDigital (YSYS): artwork charged once for the order
    const printBaseOnly = Math.max(0, cheapestStandalonePrint - artworkFee);
    if (artworkBundledWithDigital) {
      return digitalPrice + printBaseOnly * 2;
    } else {
      return digitalPrice + printBaseOnly * 2 + artworkFee;
    }
  }, [digitalPrice, cheapestStandalonePrint, hasDigitalOption, artworkFee, artworkBundledWithDigital]);

  return (
    <div className="cw" ref={wizardRef}>
      <header className="cw__header">
        <h2 className="cw__title">Start Your Commission</h2>
        <div className="cw__stepper" aria-label={`Step ${displayStepIndex + 1} of ${totalSteps}`}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span key={i}
              className={`cw__stepper-dot${i === displayStepIndex ? ' cw__stepper-dot--active' : ''}${i < displayStepIndex ? ' cw__stepper-dot--done' : ''}`} />
          ))}
        </div>
      </header>

      {/* STEP 0 — Path picker */}
      {step === 0 && (
        <section className="cw__section">
          <p className="cw__step-intro">How would you like to order?</p>
          <div className="cw__path-cards">
            {hasDigitalOption && (
              <button type="button"
                className={`cw__path-card${orderType === 'digital' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('digital')}>
                <span className="cw__path-title">
                  {hasSecondaryCollection
                    ? `Digital — ${collectionLabel}`
                    : `Digital ${styleOptions.length > 0 ? 'Bundle' : 'Download'}`}
                </span>
                <span className="cw__path-price">{priceLabel(digitalPrice)}</span>
                <span className="cw__path-desc">
                  {hasSecondaryCollection
                    ? `All ${styleOptions.length} ${collectionLabel.toLowerCase()} styles as digital files. No physical print.`
                    : styleOptions.length > 0
                      ? `All ${styleOptions.length} styles as digital files. No physical print.`
                      : 'Digital file delivered to your inbox. No physical print.'}
                </span>
              </button>
            )}
            {hasSecondaryCollection && (
              <button type="button"
                className={`cw__path-card${orderType === 'digital-secondary' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('digital-secondary')}>
                <span className="cw__path-title">Digital — {collectionLabelSecondary}</span>
                <span className="cw__path-price">{priceLabel(digitalPriceSecondary)}</span>
                <span className="cw__path-desc">
                  All {styleOptionsSecondary.length} {collectionLabelSecondary.toLowerCase()} styles as digital files. No physical print.
                </span>
              </button>
            )}
            {hasBothCollectionsPrice && (
              <button type="button"
                className={`cw__path-card${orderType === 'digital-both' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('digital-both')}>
                <span className="cw__path-badge">Best Value Digital</span>
                <span className="cw__path-title">Both Collections</span>
                <span className="cw__path-price">{priceLabel(digitalPriceBoth)}</span>
                <span className="cw__path-desc">
                  All {styleOptions.length + styleOptionsSecondary.length} styles across both collections — save £{(digitalPrice + digitalPriceSecondary - digitalPriceBoth).toFixed(2)} vs buying separately.
                </span>
              </button>
            )}
            {hasPrintOption && (
              <button type="button"
                className={`cw__path-card${orderType === 'singlePrint' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('singlePrint')}>
                <span className="cw__path-title">Single Print</span>
                <span className="cw__path-price">from {priceLabel(cheapestStandalonePrint)}</span>
                <span className="cw__path-desc">
                  <strong className="cw__path-use-case">Best for: one-off gift.</strong>
                  {hasSecondaryCollection
                    ? ` One print of any style from either collection. Includes the digital file. £${artworkFee.toFixed(2)} artwork fee.`
                    : ` One print + your digital file. Includes £${artworkFee.toFixed(2)} artwork fee.`}
                </span>
              </button>
            )}
            {hasDigitalOption && hasPrintOption && (
              <button type="button"
                className={`cw__path-card cw__path-card--best${orderType === 'bundle' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('bundle')}>
                <span className="cw__path-badge">Best Value</span>
                <span className="cw__path-title">Bundle (2+ prints)</span>
                <span className="cw__path-price">from {priceLabel(cheapestBundle)}</span>
                <span className="cw__path-desc">
                  <strong className="cw__path-use-case">Best for: decorating a wall.</strong>
                  {hasSecondaryCollection
                    ? ` Two or more prints + a digital collection. One artwork fee total — save £${artworkFee.toFixed(2)} on every extra print.`
                    : ` Two or more prints + your digital${styleOptions.length > 0 ? ' bundle' : ' file'}.${
                        artworkBundledWithDigital
                          ? ` One artwork fee total — save £${artworkFee.toFixed(2)} on every extra print.`
                          : artworkFeePerOrder
                            ? ` £${artworkFee.toFixed(2)} artwork fee charged once per order.`
                            : ` £${artworkFee.toFixed(2)} artwork fee applies per print.`
                      }`}
                </span>
              </button>
            )}
            {hasAnimationMusic && (
              <button type="button"
                className={`cw__path-card${orderType === 'animation-music' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('animation-music')}>
                <span className="cw__path-title">Animation (Music)</span>
                <span className="cw__path-price">{priceLabel(animationMusicPrice)}</span>
                <span className="cw__path-desc">
                  30-second animated short with a custom soundtrack.
                </span>
              </button>
            )}
            {hasAnimationVo && (
              <button type="button"
                className={`cw__path-card${orderType === 'animation-vo' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('animation-vo')}>
                <span className="cw__path-title">Animation + Voiceover</span>
                <span className="cw__path-price">{priceLabel(animationVoPrice)}</span>
                <span className="cw__path-desc">
                  30-second animated short with soundtrack AND AI voiceover.
                </span>
              </button>
            )}
          </div>

          {/* Add-prints checkbox for animation paths */}
          {(orderType === 'animation-music' || orderType === 'animation-vo') && hasPrintOption && (
            <label className="cw__inline-toggle">
              <input type="checkbox" checked={includePrintsWithAnimation}
                onChange={(e) => setIncludePrintsWithAnimation(e.target.checked)} />
              <span>
                Also add prints to this order — £{artworkFee.toFixed(2)} artwork fee waived per print
              </span>
            </label>
          )}
        </section>
      )}

      {/* STEP 1 — Brief */}
      {step === 1 && (
        <section className="cw__section">
          <p className="cw__step-intro">Tell us about your commission. The more detail, the better we can match what you've imagined.</p>
          {filteredBriefingFields.map((field) => (
            <BriefField key={field._key || field.key} field={field}
              value={briefValues[field.key]}
              onChange={(k, v) => setBriefValues((p) => ({ ...p, [k]: v }))}
              files={briefFiles}
              onFilesChange={(k, arr) => setBriefFiles((p) => ({ ...p, [k]: arr }))}
              styleOptions={styleOptions} />
          ))}
          {filteredBriefingFields.length === 0 && (
            <p className="cw__empty">This service doesn't have a briefing form configured yet. Please contact us directly.</p>
          )}
        </section>
      )}

      {/* STEP 2 — Prints */}
      {step === 2 && orderInvolvesPrints && (
        <section className="cw__section">
          <p className="cw__step-intro">
            {orderType === 'singlePrint'
              ? 'Configure your print.'
              : artworkBundledWithDigital
                ? `Add as many prints as you like — the £${artworkFee.toFixed(2)} artwork fee is waived on every one.`
                : artworkFeePerOrder
                  ? `Add as many prints as you like — the £${artworkFee.toFixed(2)} artwork fee is charged once per order regardless of how many prints.`
                  : `Add as many prints as you like — the £${artworkFee.toFixed(2)} artwork fee applies per print.`}
          </p>

          {/* Bundle path + secondary collection: pick which digital tier */}
          {orderType === 'bundle' && hasSecondaryCollection && (
            <div className="cw__field">
              <span className="cw__label">Which digital collection? <span className="cw__required-star">*</span></span>
              <div className="cw__collection-toggle">
                <button type="button"
                  className={`cw__collection-btn${bundleCollection === 'primary' ? ' cw__collection-btn--active' : ''}`}
                  onClick={() => setBundleCollection('primary')}>
                  <span className="cw__collection-name">{collectionLabel}</span>
                  <span className="cw__collection-price">{priceLabel(digitalPrice)}</span>
                </button>
                <button type="button"
                  className={`cw__collection-btn${bundleCollection === 'secondary' ? ' cw__collection-btn--active' : ''}`}
                  onClick={() => setBundleCollection('secondary')}>
                  <span className="cw__collection-name">{collectionLabelSecondary}</span>
                  <span className="cw__collection-price">{priceLabel(digitalPriceSecondary)}</span>
                </button>
                {hasBothCollectionsPrice && (
                  <button type="button"
                    className={`cw__collection-btn${bundleCollection === 'both' ? ' cw__collection-btn--active' : ''}`}
                    onClick={() => setBundleCollection('both')}>
                    <span className="cw__collection-name">Both Collections</span>
                    <span className="cw__collection-price">{priceLabel(digitalPriceBoth)}</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {(orderType === 'singlePrint' ? prints.slice(0, 1) : prints).map((p, i) => (
            <div key={i} className="cw__print-row">
              <div className="cw__print-header">
                <strong>Print {i + 1}</strong>
                {orderType !== 'singlePrint' && prints.length > 1 && (
                  <button type="button" className="cw__print-remove" onClick={() => removePrint(i)}>
                    Remove
                  </button>
                )}
              </div>

              {(styleOptions.length > 0 || styleOptionsSecondary.length > 0) && (
                <label className="cw__field">
                  <span className="cw__label">Style <span className="cw__required-star">*</span></span>
                  <select className="cw__select" value={p.styleKey}
                    onChange={(e) => updatePrint(i, { styleKey: e.target.value })} required>
                    <option value="">Choose a style…</option>
                    {hasSecondaryCollection ? (
                      <>
                        <optgroup label={collectionLabel}>
                          {/* For bundle/secondary the customer can only pick from secondary;
                              for bundle/primary only from primary; for both/singlePrint they can pick anything. */}
                          {((orderType === 'bundle' && bundleCollection === 'secondary') ? [] : styleOptions).map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                          ))}
                        </optgroup>
                        <optgroup label={collectionLabelSecondary}>
                          {((orderType === 'bundle' && bundleCollection === 'primary') ? [] : styleOptionsSecondary).map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                          ))}
                        </optgroup>
                      </>
                    ) : (
                      styleOptions.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))
                    )}
                  </select>
                </label>
              )}

              <div className="cw__row">
                <label className="cw__field">
                  <span className="cw__label">Format <span className="cw__required-star">*</span></span>
                  <select className="cw__select" value={p.format}
                    onChange={(e) => updatePrint(i, { format: e.target.value, size: '' })} required>
                    <option value="">Format…</option>
                    <option value="poster">Poster Print</option>
                    <option value="canvas-standard">Canvas Standard</option>
                    <option value="canvas-gallery">Canvas Gallery</option>
                  </select>
                </label>
                <label className="cw__field">
                  <span className="cw__label">Size <span className="cw__required-star">*</span></span>
                  <select className="cw__select" value={p.size} disabled={!p.format}
                    onChange={(e) => updatePrint(i, { size: e.target.value })} required>
                    <option value="">Size…</option>
                    <option value="small">{sizeLabels.small || 'Small'}</option>
                    <option value="medium">{sizeLabels.medium || 'Medium'}</option>
                    <option value="large">{sizeLabels.large || 'Large'}</option>
                  </select>
                </label>
              </div>

              {p.format && p.size && (
                <p className="cw__print-price">
                  {orderType === 'singlePrint' ? (
                    <>{priceLabel(lookupStandalonePrintPrice(p.format, p.size))}</>
                  ) : artworkBundledWithDigital ? (
                    <>
                      {priceLabel(lookupBasePrintPrice(p.format, p.size))}
                      <span className="cw__print-savings"> · £{artworkFee.toFixed(2)} artwork fee waived</span>
                    </>
                  ) : (
                    <>
                      {priceLabel(lookupBasePrintPrice(p.format, p.size))}
                      <span className="cw__print-savings"> · print only (artwork fee shown below)</span>
                    </>
                  )}
                </p>
              )}
            </div>
          ))}

          {orderType !== 'singlePrint' && (
            <button type="button" className="cw__btn cw__btn--add" onClick={addPrint}>
              + Add another print
            </button>
          )}

          <div className="cw__shipping-note">
            <p className="cw__shipping-note__heading">📦 Shipping</p>
            <p className="cw__shipping-note__body">
              You'll enter your delivery address on the secure payment page in the
              next step. We ship to UK addresses only.
              {pricing.total >= 50 ? (
                <> <strong>FREE UK P&amp;P on this order.</strong></>
              ) : (
                <> UK P&amp;P is £4.95 standard, <strong>FREE on orders over £50</strong> (add {priceLabel(50 - pricing.total)} more to qualify).</>
              )}
            </p>
          </div>

          <div className="cw__price-preview">
            <span>Running total:</span>
            <strong>{priceLabel(pricing.total)}</strong>
          </div>
        </section>
      )}

      {/* STEP 3 — Review */}
      {step === 3 && (
        <section className="cw__section">
          <p className="cw__step-intro">Quick check before payment.</p>

          <dl className="cw__summary">
            <div className="cw__summary-row"><dt>Service</dt><dd>{service.title}</dd></div>
            <div className="cw__summary-row">
              <dt>Order type</dt>
              <dd>
                {ORDER_TYPE_LABELS[orderType] || orderType}
                {(orderType === 'animation-music' || orderType === 'animation-vo') && includePrintsWithAnimation && (
                  <> + {prints.filter((p) => p.format && p.size).length} print(s)</>
                )}
              </dd>
            </div>
            {filteredBriefingFields
              .filter((f) => !['photo', 'photos', 'file'].includes(f.fieldType))
              .map((f) => {
                const raw = briefValues[f.key];
                let display;
                if (f.fieldType === 'checkbox') {
                  display = raw === true ? 'Yes' : <em>No</em>;
                } else {
                  display = raw || <em>(not provided)</em>;
                }
                return (
                  <div className="cw__summary-row" key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{display}</dd>
                  </div>
                );
              })}
            {filteredBriefingFields.filter((f) => ['photo', 'photos', 'file'].includes(f.fieldType)).map((f) => {
              const arr = briefFiles[f.key] || [];
              return (
                <div className="cw__summary-row" key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{arr.length === 0 ? <em>(none uploaded)</em>
                    : f.fieldType === 'file'
                      ? `${arr[0].name} (${formatBytes(arr[0].size)})`
                      : `${arr.length} photo${arr.length > 1 ? 's' : ''} ready`}</dd>
                </div>
              );
            })}
            {orderInvolvesPrints && (
              <div className="cw__summary-row">
                <dt>Shipping to</dt>
                <dd className="cw__summary-muted">Entered on secure payment page (UK only)</dd>
              </div>
            )}
          </dl>

          <div className="cw__line-items">
            {pricing.lines.map((line, i) => (
              <div className="cw__line-item" key={i}>
                <span className="cw__line-label">
                  {line.label}
                  {line.note && <em className="cw__line-note"> · {line.note}</em>}
                </span>
                <span className="cw__line-amount">{priceLabel(line.amount)}</span>
              </div>
            ))}
            {pricing.artworkFeeWaived && pricing.savedAmount > 0 && (
              <div className="cw__line-item cw__line-item--savings">
                <span className="cw__line-label">
                  Bundle saving (£{artworkFee.toFixed(2)} × {prints.filter((p) => p.format && p.size).length} prints)
                </span>
                <span className="cw__line-amount">−{priceLabel(pricing.savedAmount)}</span>
              </div>
            )}
          </div>

          <div className="cw__total-row">
            <span>Total</span>
            <strong>{priceLabel(pricing.total)}</strong>
          </div>
        </section>
      )}

      {error && <div className="cw__error" role="alert">{error}</div>}

      <div className="cw__nav">
        {step > startStep && (
          <button type="button" className="cw__btn cw__btn--secondary" onClick={back} disabled={submitting}>
            ← Back
          </button>
        )}
        {step < 3 && (
          <button type="button" className="cw__btn cw__btn--primary" onClick={next}>
            Continue →
          </button>
        )}
        {step === 3 && (
          <button type="button" className="cw__btn cw__btn--primary" onClick={submit} disabled={submitting}>
            {submitting ? 'Creating order…' : 'Continue to payment →'}
          </button>
        )}
      </div>

      <p className="cw__terms">
        Payment is handled securely via Stripe. By submitting, you agree to our{' '}
        <a href="/terms-and-conditions" target="_blank" rel="noopener noreferrer">Terms</a>.
      </p>
    </div>
  );
}
