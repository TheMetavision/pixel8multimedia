// src/components/CommissionWorkflow.jsx
// Commission wizard — supports three order types with dynamic pricing:
//
//   Stage 0: Path picker — Digital Bundle / Single Print / Bundle + Prints
//            (skipped if only one path is available)
//   Stage 1: Brief — dynamically renders service.briefingFields
//            (style picker hidden for digital and singlePrint paths; style is
//             chosen per-print for those, or implicitly "all" for the bundle)
//   Stage 2: Prints config — only for singlePrint and bundle paths
//            (multi-print rows for bundle, single row for singlePrint)
//   Stage 3: Review & Pay — summary, line-item breakdown, redirect to Stripe
//
// Pricing logic:
//   Digital path:       service.digitalPrice (e.g. £14.99 for all styles)
//   Single print:       service.printUpcharges[format][size] (= shop + £5)
//   Bundle + prints:    service.digitalPrice + Σ(shop price per print)
//                       (i.e. £5 artwork fee waived because digital pays for it)
//
// Backwards compatible: if a service has no digitalPrice and no styleOptions,
// it falls back to the legacy single-style single-print flow.

import { useState, useMemo, useRef } from 'react';

// ─── Constants ──────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const CLIENT_RESIZE_MAX_PX = 3000;
const CLIENT_RESIZE_QUALITY = 0.9;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

const LEGACY_AJ_SWATCHES = [
  { key: 'A', color: '#FF00FF' },
  { key: 'B', color: '#FFFFFF' },
  { key: 'C', color: '#FF6B35' },
  { key: 'D', color: '#00BCD4' },
  { key: 'E', color: '#FFEB3B' },
  { key: 'F', color: '#E91E7B' },
  { key: 'G', color: '#76FF03' },
  { key: 'H', color: '#9E9E9E' },
  { key: 'I', color: '#7C4DFF' },
  { key: 'J', color: '#FF5252' },
];

const SIZE_LABELS = {
  small: 'Small (12×12")',
  medium: 'Medium (16×16")',
  large: 'Large (20×20")',
};
const FORMAT_LABELS = {
  poster: 'Poster Print',
  'canvas-standard': 'Canvas Standard',
  'canvas-gallery': 'Canvas Gallery',
};
const ARTWORK_FEE = 5.0;

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
  const { key, label, fieldType, helperText, required, options, minPhotos, maxPhotos } = field;
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
          files={files[key] || []} onChange={(f) => onFilesChange(key, f)} />
      </div>
    );
  }

  if (fieldType === 'photos') {
    return (
      <div className="cw__field">{labelEl}{helperEl}
        <PhotoDropzone fieldKey={key} multiple minFiles={minPhotos || 1} maxFiles={maxPhotos || 10}
          files={files[key] || []} onChange={(f) => onFilesChange(key, f)} />
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

  // Style picker — uses service.styleOptions if available, falls back to A-J
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

  const inputType = fieldType === 'email' ? 'email' : fieldType === 'phone' ? 'tel' : 'text';
  return (
    <label className="cw__field">{labelEl}{helperEl}
      <input type={inputType} className="cw__input" required={required}
        value={value || ''} onChange={(e) => onChange(key, e.target.value)} />
    </label>
  );
}

// ─── Photo dropzone ────────────────────────────────────────────────────────
function PhotoDropzone({ fieldKey, multiple, minFiles, maxFiles, files, onChange }) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [resizingCount, setResizingCount] = useState(0);

  function handleDrag(e) {
    e.preventDefault(); e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  async function addFiles(incoming) {
    const accepted = incoming.filter((f) => ALLOWED_TYPES.includes(f.type) && f.size <= MAX_FILE_SIZE);
    if (accepted.length === 0) return;
    setResizingCount(accepted.length);
    const resized = await Promise.all(accepted.map(resizeImage));
    setResizingCount(0);
    let combined = multiple ? [...files, ...resized] : [resized[0]];
    if (multiple && combined.length > maxFiles) combined = combined.slice(0, maxFiles);
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

  return (
    <>
      <div className={`cw__dropzone${dragActive ? ' cw__dropzone--active' : ''}`}
        onDragEnter={handleDrag} onDragOver={handleDrag} onDragLeave={handleDrag}
        onDrop={handleDrop} onClick={() => inputRef.current?.click()}
        role="button" tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}>
        <input ref={inputRef} type="file" multiple={multiple}
          accept={ALLOWED_TYPES.join(',')} onChange={handleInput}
          className="cw__file-input" aria-label={`Upload photos for ${fieldKey}`} />
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cw__upload-icon">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="cw__dropzone-text">
          {resizingCount > 0 ? `Optimising ${resizingCount} photo${resizingCount > 1 ? 's' : ''}…`
            : dragActive ? 'Drop here…'
            : multiple ? `Drag & drop ${minFiles}–${maxFiles} photos or click to browse`
            : 'Drag & drop a photo or click to browse'}
        </p>
        <p className="cw__dropzone-sub">JPG / PNG / WebP / HEIC — auto-resized to 3000px max</p>
      </div>
      {files.length > 0 && (
        <ul className="cw__file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="cw__file-item">
              <span className="cw__file-name">{f.name} <span className="cw__file-size">({formatBytes(f.size)})</span></span>
              <button type="button" onClick={() => onChange(files.filter((_, idx) => idx !== i))}
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
  const digitalPrice = Number(service.digitalPrice) || 0;
  const legacyPrice = Number(service.price) || 0;
  const hasDigitalOption = digitalPrice > 0;

  const hasPrintOption = useMemo(() => {
    const u = service.printUpcharges;
    if (!u) return false;
    const anyPositive = (obj) => obj && Object.values(obj).some((v) => Number(v) > 0);
    return anyPositive(u.poster) || anyPositive(u.canvasStandard) || anyPositive(u.canvasGallery);
  }, [service]);

  // Determine available paths
  const availablePaths = useMemo(() => {
    const paths = [];
    if (hasDigitalOption) paths.push('digital');
    if (hasPrintOption) paths.push('singlePrint');
    if (hasDigitalOption && hasPrintOption) paths.push('bundle');
    return paths;
  }, [hasDigitalOption, hasPrintOption]);

  const startStep = availablePaths.length > 1 ? 0 : 1;
  const [step, setStep] = useState(startStep);
  const [orderType, setOrderType] = useState(availablePaths[0] || 'digital');
  const [briefValues, setBriefValues] = useState({});
  const [briefFiles, setBriefFiles] = useState({});
  const [prints, setPrints] = useState([{ styleKey: '', format: '', size: '' }]);
  const [shippingAddress, setShippingAddress] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const briefingFields = service.briefingFields || [];

  // Hide style picker in brief for digital and singlePrint paths
  // (digital includes all styles; singlePrint chooses per-print)
  const filteredBriefingFields = useMemo(() => {
    if (orderType === 'digital' || orderType === 'singlePrint') {
      return briefingFields.filter((f) => f.fieldType !== 'styleSwatch');
    }
    return briefingFields;
  }, [briefingFields, orderType]);

  // Lookup standalone print price (= shop price + £5 artwork fee)
  function lookupStandalonePrintPrice(format, size) {
    const upcharges = service.printUpcharges;
    const key = formatToSanityKey(format);
    return Number(upcharges?.[key]?.[size]) || 0;
  }

  // Lookup shop-only price (= standalone print price - £5)
  // Used for bundle path where the £5 artwork fee is waived.
  function lookupShopPrice(format, size) {
    const standalone = lookupStandalonePrintPrice(format, size);
    return Math.max(0, standalone - ARTWORK_FEE);
  }

  // Compute pricing breakdown for display + checkout
  const pricing = useMemo(() => {
    if (orderType === 'digital') {
      return {
        lines: [{
          label: `Digital bundle (all ${styleOptions.length || ''} styles)`.replace('  ', ' '),
          amount: digitalPrice,
        }],
        total: digitalPrice,
        artworkFeeWaived: false,
      };
    }

    if (orderType === 'singlePrint') {
      const p = prints[0];
      if (!p?.format || !p?.size) {
        return { lines: [], total: 0, artworkFeeWaived: false };
      }
      const total = lookupStandalonePrintPrice(p.format, p.size);
      const styleLabel = p.styleKey && styleOptions.length > 0
        ? styleOptions.find((s) => s.key === p.styleKey)?.label
        : null;
      return {
        lines: [{
          label: `${FORMAT_LABELS[p.format]} — ${SIZE_LABELS[p.size]}${styleLabel ? ` (${styleLabel})` : ''}`,
          note: `Includes £${ARTWORK_FEE.toFixed(2)} artwork fee`,
          amount: total,
        }],
        total,
        artworkFeeWaived: false,
      };
    }

    // bundle
    const validPrints = prints.filter((p) => p.format && p.size);
    const lines = [
      {
        label: `Digital bundle (all ${styleOptions.length || ''} styles)`.replace('  ', ' '),
        amount: digitalPrice,
      },
    ];
    let runningTotal = digitalPrice;
    validPrints.forEach((p) => {
      const shop = lookupShopPrice(p.format, p.size);
      const styleLabel = p.styleKey && styleOptions.length > 0
        ? styleOptions.find((s) => s.key === p.styleKey)?.label
        : null;
      lines.push({
        label: `${FORMAT_LABELS[p.format]} — ${SIZE_LABELS[p.size]}${styleLabel ? ` (${styleLabel})` : ''}`,
        note: '£5 artwork fee waived',
        amount: shop,
      });
      runningTotal += shop;
    });
    return {
      lines,
      total: runningTotal,
      artworkFeeWaived: validPrints.length > 0,
      savedAmount: validPrints.length * ARTWORK_FEE,
    };
  }, [orderType, prints, digitalPrice, service, styleOptions]);

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
    if (orderType === 'digital') return null;
    const requireStyle = styleOptions.length > 0;
    const validatePrints = orderType === 'singlePrint' ? prints.slice(0, 1) : prints;
    for (const [i, p] of validatePrints.entries()) {
      if (!p.format || !p.size) return `Please choose a format and size for print #${i + 1}.`;
      if (requireStyle && !p.styleKey) return `Please choose a style for print #${i + 1}.`;
    }
    if (!shippingAddress.trim()) return 'Please enter your shipping address.';
    return null;
  }

  function next() {
    setError('');
    if (step === 0) { setStep(1); return; }
    if (step === 1) {
      const err = validateBriefStep();
      if (err) { setError(err); return; }
      if (orderType === 'digital') { setStep(3); return; }
      setStep(2);
    } else if (step === 2) {
      const err = validatePrintsStep();
      if (err) { setError(err); return; }
      setStep(3);
    }
  }

  function back() {
    setError('');
    if (step === 3 && orderType === 'digital') { setStep(1); return; }
    if (step === 1 && availablePaths.length > 1) { setStep(0); return; }
    setStep((s) => Math.max(0, s - 1));
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

  // Reset prints array when changing path
  function selectPath(path) {
    setOrderType(path);
    if (path === 'digital') {
      setPrints([{ styleKey: '', format: '', size: '' }]);
    } else if (path === 'singlePrint') {
      setPrints((p) => [p[0] || { styleKey: '', format: '', size: '' }]);
    }
  }

  // ─── Submit ────────────────────────────────────────────────────────────────
  async function submit() {
    setError('');
    setSubmitting(true);

    try {
      const fd = new FormData();
      fd.append('serviceSlug', service.slug);
      fd.append('serviceTitle', service.title);
      fd.append('orderType', orderType);

      const name = briefValues.customerName || '';
      const email = briefValues.customerEmail || '';
      const phone = briefValues.customerPhone || '';
      fd.append('name', name);
      fd.append('email', email);
      if (phone) fd.append('phone', phone);

      const briefSummary = briefingFields
        .filter((f) => !['photo', 'photos'].includes(f.fieldType))
        .filter((f) => !['customerName', 'customerEmail', 'customerPhone'].includes(f.key))
        .map((f) => `${f.label}: ${briefValues[f.key] || '(not provided)'}`)
        .join('\n');
      fd.append('brief', briefSummary);

      const briefData = briefingFields
        .filter((f) => !['photo', 'photos'].includes(f.fieldType))
        .map((f) => ({ key: f.key, label: f.label, value: briefValues[f.key] || '' }));
      fd.append('briefData', JSON.stringify(briefData));

      if (orderType !== 'digital') {
        const validPrints = (orderType === 'singlePrint' ? prints.slice(0, 1) : prints)
          .filter((p) => p.format && p.size);
        fd.append('prints', JSON.stringify(validPrints));
        fd.append('shippingAddress', shippingAddress);
      }

      Object.values(briefFiles).forEach((arr) => {
        (arr || []).forEach((f) => fd.append('files', f));
      });

      const res = await fetch('/.netlify/functions/commission-checkout', { method: 'POST', body: fd });
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

  // ─── Render ────────────────────────────────────────────────────────────────
  // Stepper math: count visible steps based on path
  const totalSteps =
    (availablePaths.length > 1 ? 1 : 0) +    // step 0 if multi-path
    1 +                                       // step 1 brief
    (orderType !== 'digital' ? 1 : 0) +       // step 2 prints
    1;                                        // step 3 review

  const displayStepIndex =
    step === 0 ? 0 :
    step === 1 ? (availablePaths.length > 1 ? 1 : 0) :
    step === 2 ? (availablePaths.length > 1 ? 2 : 1) :
    /* step === 3 */ totalSteps - 1;

  // Cheapest single-print starting price (for path card display)
  const cheapestSinglePrintPrice = useMemo(() => {
    const u = service.printUpcharges;
    if (!u) return null;
    const all = [];
    ['poster', 'canvasStandard', 'canvasGallery'].forEach((fmt) => {
      ['small', 'medium', 'large'].forEach((size) => {
        const p = Number(u?.[fmt]?.[size]);
        if (p > 0) all.push(p);
      });
    });
    return all.length > 0 ? Math.min(...all) : null;
  }, [service]);

  const cheapestBundlePrice = useMemo(() => {
    if (!hasDigitalOption || !cheapestSinglePrintPrice) return null;
    return digitalPrice + Math.max(0, cheapestSinglePrintPrice - ARTWORK_FEE);
  }, [digitalPrice, cheapestSinglePrintPrice, hasDigitalOption]);

  return (
    <div className="cw">
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
                <span className="cw__path-title">Digital Bundle</span>
                <span className="cw__path-price">{priceLabel(digitalPrice)}</span>
                <span className="cw__path-desc">
                  All {styleOptions.length || 'available'} styles delivered as digital files. No physical print.
                </span>
              </button>
            )}
            {hasPrintOption && (
              <button type="button"
                className={`cw__path-card${orderType === 'singlePrint' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('singlePrint')}>
                <span className="cw__path-title">Single Print</span>
                <span className="cw__path-price">from {priceLabel(cheapestSinglePrintPrice)}</span>
                <span className="cw__path-desc">
                  One physical print in your chosen style. Includes the digital file for that style.
                </span>
              </button>
            )}
            {hasDigitalOption && hasPrintOption && (
              <button type="button"
                className={`cw__path-card cw__path-card--best${orderType === 'bundle' ? ' cw__path-card--selected' : ''}`}
                onClick={() => selectPath('bundle')}>
                <span className="cw__path-badge">Best Value</span>
                <span className="cw__path-title">Bundle + Prints</span>
                <span className="cw__path-price">from {priceLabel(cheapestBundlePrice)}</span>
                <span className="cw__path-desc">
                  Digital bundle plus any number of prints. £5 artwork fee waived on every print.
                </span>
              </button>
            )}
          </div>
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
            <p className="cw__empty">This service doesn't have a briefing form configured yet. Please contact us directly to commission.</p>
          )}
        </section>
      )}

      {/* STEP 2 — Prints */}
      {step === 2 && orderType !== 'digital' && (
        <section className="cw__section">
          <p className="cw__step-intro">
            {orderType === 'singlePrint'
              ? 'Configure your print.'
              : 'Add as many prints as you like — the £5 artwork fee is waived on every one because the digital bundle covers it.'}
          </p>

          {(orderType === 'singlePrint' ? prints.slice(0, 1) : prints).map((p, i) => (
            <div key={i} className="cw__print-row">
              <div className="cw__print-header">
                <strong>Print {i + 1}</strong>
                {orderType === 'bundle' && prints.length > 1 && (
                  <button type="button" className="cw__print-remove" onClick={() => removePrint(i)}>
                    Remove
                  </button>
                )}
              </div>

              {styleOptions.length > 0 && (
                <label className="cw__field">
                  <span className="cw__label">Style <span className="cw__required-star">*</span></span>
                  <select className="cw__select" value={p.styleKey}
                    onChange={(e) => updatePrint(i, { styleKey: e.target.value })} required>
                    <option value="">Choose a style…</option>
                    {styleOptions.map((s) => (
                      <option key={s.key} value={s.key}>{s.label}</option>
                    ))}
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
                    <option value="small">Small (12×12")</option>
                    <option value="medium">Medium (16×16")</option>
                    <option value="large">Large (20×20")</option>
                  </select>
                </label>
              </div>

              {p.format && p.size && (
                <p className="cw__print-price">
                  {orderType === 'bundle' ? (
                    <>
                      {priceLabel(lookupShopPrice(p.format, p.size))}
                      <span className="cw__print-savings"> · £5 artwork fee waived</span>
                    </>
                  ) : (
                    <>{priceLabel(lookupStandalonePrintPrice(p.format, p.size))}</>
                  )}
                </p>
              )}
            </div>
          ))}

          {orderType === 'bundle' && (
            <button type="button" className="cw__btn cw__btn--add" onClick={addPrint}>
              + Add another print
            </button>
          )}

          <label className="cw__field">
            <span className="cw__label">Shipping Address <span className="cw__required-star">*</span></span>
            <textarea className="cw__textarea" rows={3} value={shippingAddress}
              onChange={(e) => setShippingAddress(e.target.value)} required
              placeholder="Full delivery address including postcode" />
          </label>

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
                {orderType === 'digital' && 'Digital bundle'}
                {orderType === 'singlePrint' && 'Single print'}
                {orderType === 'bundle' && `Bundle + ${prints.filter((p) => p.format && p.size).length} print(s)`}
              </dd>
            </div>
            {briefingFields
              .filter((f) => !['photo', 'photos'].includes(f.fieldType))
              .filter((f) => f.fieldType !== 'styleSwatch' || orderType === 'bundle')
              .map((f) => (
                <div className="cw__summary-row" key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{briefValues[f.key] || <em>(not provided)</em>}</dd>
                </div>
              ))}
            {briefingFields.filter((f) => ['photo', 'photos'].includes(f.fieldType)).map((f) => {
              const arr = briefFiles[f.key] || [];
              return (
                <div className="cw__summary-row" key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{arr.length === 0 ? <em>(none uploaded)</em> : `${arr.length} photo${arr.length > 1 ? 's' : ''} ready`}</dd>
                </div>
              );
            })}
            {orderType !== 'digital' && shippingAddress && (
              <div className="cw__summary-row">
                <dt>Shipping to</dt>
                <dd style={{ whiteSpace: 'pre-line' }}>{shippingAddress}</dd>
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
                <span className="cw__line-label">Bundle saving (£5 × {prints.filter((p) => p.format && p.size).length} prints)</span>
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
