// src/components/CommissionWorkflow.jsx
// Three-step commission wizard mounted on each /services/[slug] page.
//
// Stage 1: Brief — dynamically renders the service's briefingFields
// Stage 2: Format — Digital only / Digital + Print, with price calc
// Stage 3: Review & Pay — summary + redirect to Stripe checkout
//
// Replaces the legacy single-form CommissionForm.jsx. Backend at
// /.netlify/functions/commission-checkout is backwards compatible.

import { useState, useMemo, useRef, useEffect } from 'react';

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const CLIENT_RESIZE_MAX_PX = 3000;
const CLIENT_RESIZE_QUALITY = 0.9;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

// Option A-J colour swatches — mirrors the values in src/data/products.ts
// (kept inline so we don't pull a heavy import). Adjust if your palette differs.
const STYLE_SWATCHES = [
  { letter: 'A', label: 'Option A', color: '#FF00FF' },
  { letter: 'B', label: 'Option B', color: '#FFFFFF' },
  { letter: 'C', label: 'Option C', color: '#FF6B35' },
  { letter: 'D', label: 'Option D', color: '#00BCD4' },
  { letter: 'E', label: 'Option E', color: '#FFEB3B' },
  { letter: 'F', label: 'Option F', color: '#E91E7B' },
  { letter: 'G', label: 'Option G', color: '#76FF03' },
  { letter: 'H', label: 'Option H', color: '#9E9E9E' },
  { letter: 'I', label: 'Option I', color: '#7C4DFF' },
  { letter: 'J', label: 'Option J', color: '#FF5252' },
];

const SIZE_LABELS = { small: 'Small', medium: 'Medium', large: 'Large' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

function priceLabel(p) {
  if (p == null) return '—';
  return `£${Number(p).toFixed(2)}`;
}

// Resize an image client-side using a canvas. Keeps the long side at most
// CLIENT_RESIZE_MAX_PX, encodes to JPEG quality 0.9. Falls back to original
// blob on unsupported types (HEIC etc.).
async function resizeImage(file) {
  if (file.type === 'image/heic' || !file.type.startsWith('image/')) {
    return file; // can't resize, send original (still <10MB enforced upstream)
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const longSide = Math.max(width, height);
      if (longSide <= CLIENT_RESIZE_MAX_PX) {
        // Already small enough — just return original
        resolve(file);
        return;
      }
      const scale = CLIENT_RESIZE_MAX_PX / longSide;
      const newW = Math.round(width * scale);
      const newH = Math.round(height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = newW;
      canvas.height = newH;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, newW, newH);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file); // fallback
            return;
          }
          // Wrap blob as File so name + type carry through
          const resized = new File([blob], file.name.replace(/\.\w+$/, '.jpg'), {
            type: 'image/jpeg',
          });
          resolve(resized);
        },
        'image/jpeg',
        CLIENT_RESIZE_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

// ── Brief field renderer ─────────────────────────────────────────────────────
function BriefField({ field, value, onChange, files, onFilesChange }) {
  const { key, label, fieldType, helperText, required, options, minPhotos, maxPhotos } = field;
  const labelEl = (
    <span className="cw__label">
      {label}
      {required && <span className="cw__required-star"> *</span>}
    </span>
  );
  const helperEl = helperText ? <span className="cw__helper">{helperText}</span> : null;

  // Photo upload (single)
  if (fieldType === 'photo') {
    const photoFiles = files[key] || [];
    return (
      <div className="cw__field">
        {labelEl}
        {helperEl}
        <PhotoDropzone
          fieldKey={key}
          multiple={false}
          maxFiles={1}
          files={photoFiles}
          onChange={(f) => onFilesChange(key, f)}
        />
      </div>
    );
  }

  // Photos upload (multi)
  if (fieldType === 'photos') {
    const photoFiles = files[key] || [];
    return (
      <div className="cw__field">
        {labelEl}
        {helperEl}
        <PhotoDropzone
          fieldKey={key}
          multiple={true}
          minFiles={minPhotos || 1}
          maxFiles={maxPhotos || 10}
          files={photoFiles}
          onChange={(f) => onFilesChange(key, f)}
        />
      </div>
    );
  }

  // Select
  if (fieldType === 'select') {
    return (
      <label className="cw__field">
        {labelEl}
        {helperEl}
        <select
          className="cw__select"
          required={required}
          value={value || ''}
          onChange={(e) => onChange(key, e.target.value)}
        >
          <option value="">Select…</option>
          {(options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </label>
    );
  }

  // Style swatch — Option A-J picker
  if (fieldType === 'styleSwatch') {
    return (
      <div className="cw__field">
        {labelEl}
        {helperEl}
        <div className="cw__swatches">
          {STYLE_SWATCHES.map((s) => {
            const active = value === s.letter;
            return (
              <button
                type="button"
                key={s.letter}
                className={`cw__swatch${active ? ' cw__swatch--active' : ''}`}
                onClick={() => onChange(key, s.letter)}
                aria-pressed={active}
                title={s.label}
              >
                <span className="cw__swatch-dot" style={{ background: s.color }} />
                <span className="cw__swatch-letter">{s.letter}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Textarea
  if (fieldType === 'textarea') {
    return (
      <label className="cw__field">
        {labelEl}
        {helperEl}
        <textarea
          className="cw__textarea"
          required={required}
          rows={4}
          value={value || ''}
          onChange={(e) => onChange(key, e.target.value)}
        />
      </label>
    );
  }

  // Default: text / email / phone
  const inputType = fieldType === 'email' ? 'email' : fieldType === 'phone' ? 'tel' : 'text';
  return (
    <label className="cw__field">
      {labelEl}
      {helperEl}
      <input
        type={inputType}
        className="cw__input"
        required={required}
        value={value || ''}
        onChange={(e) => onChange(key, e.target.value)}
      />
    </label>
  );
}

// ── Photo dropzone ────────────────────────────────────────────────────────────
function PhotoDropzone({ fieldKey, multiple, minFiles, maxFiles, files, onChange }) {
  const inputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [resizingCount, setResizingCount] = useState(0);

  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  async function addFiles(incoming) {
    const accepted = [];
    for (const f of incoming) {
      if (!ALLOWED_TYPES.includes(f.type)) continue;
      if (f.size > MAX_FILE_SIZE) continue;
      accepted.push(f);
    }
    if (accepted.length === 0) return;

    setResizingCount(accepted.length);
    const resized = await Promise.all(accepted.map(resizeImage));
    setResizingCount(0);

    let combined = multiple ? [...files, ...resized] : [resized[0]];
    if (multiple && combined.length > maxFiles) combined = combined.slice(0, maxFiles);
    onChange(combined);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles([...e.dataTransfer.files]);
  }

  function handleInput(e) {
    if (e.target.files?.length) addFiles([...e.target.files]);
    e.target.value = '';
  }

  function removeAt(i) {
    onChange(files.filter((_, idx) => idx !== i));
  }

  return (
    <>
      <div
        className={`cw__dropzone${dragActive ? ' cw__dropzone--active' : ''}`}
        onDragEnter={handleDrag}
        onDragOver={handleDrag}
        onDragLeave={handleDrag}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          multiple={multiple}
          accept={ALLOWED_TYPES.join(',')}
          onChange={handleInput}
          className="cw__file-input"
          aria-label={`Upload photos for ${fieldKey}`}
        />
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="cw__upload-icon">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <p className="cw__dropzone-text">
          {resizingCount > 0
            ? `Optimising ${resizingCount} photo${resizingCount > 1 ? 's' : ''}…`
            : dragActive
              ? 'Drop here…'
              : multiple
                ? `Drag & drop ${minFiles}–${maxFiles} photos or click to browse`
                : 'Drag & drop a photo or click to browse'}
        </p>
        <p className="cw__dropzone-sub">JPG / PNG / WebP / HEIC — auto-resized to 3000px max</p>
      </div>
      {files.length > 0 && (
        <ul className="cw__file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="cw__file-item">
              <span className="cw__file-name">
                {f.name} <span className="cw__file-size">({formatBytes(f.size)})</span>
              </span>
              <button type="button" onClick={() => removeAt(i)} className="cw__file-remove" aria-label={`Remove ${f.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main wizard component
// ─────────────────────────────────────────────────────────────────────────────
export default function CommissionWorkflow({ service }) {
  const [step, setStep] = useState(1);
  const [briefValues, setBriefValues] = useState({}); // { fieldKey: stringValue }
  const [briefFiles, setBriefFiles] = useState({});   // { fieldKey: File[] }
  const [deliveryChoice, setDeliveryChoice] = useState('digital'); // 'digital' | 'both'
  const [printFormat, setPrintFormat] = useState('');
  const [printSize, setPrintSize] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const briefingFields = service.briefingFields || [];

  // Does this service offer print formats at all?
  const hasPrintOption = useMemo(() => {
    const u = service.printUpcharges;
    if (!u) return false;
    const anyPositive = (obj) =>
      obj && Object.values(obj).some((v) => Number(v) > 0);
    return anyPositive(u.poster) || anyPositive(u.canvasStandard) || anyPositive(u.canvasGallery);
  }, [service]);

  // Compute current total
  const computedPrice = useMemo(() => {
    const base = Number(service.price) || 0;
    if (deliveryChoice === 'digital') {
      return { digitalBase: base, upcharge: 0, total: base, formatLabel: 'Digital download only' };
    }
    if (printFormat && printSize) {
      const sanityKey =
        printFormat === 'poster' ? 'poster' :
        printFormat === 'canvas-standard' ? 'canvasStandard' :
        printFormat === 'canvas-gallery' ? 'canvasGallery' : null;
      const upcharge = Number(service.printUpcharges?.[sanityKey]?.[printSize]) || 0;
      const formatTitle =
        printFormat === 'poster' ? 'Poster Print' :
        printFormat === 'canvas-standard' ? 'Canvas Standard' :
        printFormat === 'canvas-gallery' ? 'Canvas Gallery' : printFormat;
      const sizeTitle = SIZE_LABELS[printSize] || printSize;
      return {
        digitalBase: base,
        upcharge,
        total: base + upcharge,
        formatLabel: `${formatTitle} — ${sizeTitle}`,
      };
    }
    return { digitalBase: base, upcharge: 0, total: base, formatLabel: 'Select print format & size' };
  }, [service, deliveryChoice, printFormat, printSize]);

  // ── Validation ─────────────────────────────────────────────────────────────
  function validateBriefStep() {
    for (const f of briefingFields) {
      if (!f.required) continue;
      if (f.fieldType === 'photo') {
        const arr = briefFiles[f.key] || [];
        if (arr.length === 0) return `Please upload "${f.label}".`;
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

  function validateFormatStep() {
    if (deliveryChoice === 'both' && (!printFormat || !printSize)) {
      return 'Please choose a print format and size.';
    }
    if (deliveryChoice === 'both' && !shippingAddress.trim()) {
      return 'Please enter your shipping address.';
    }
    return null;
  }

  function next() {
    setError('');
    if (step === 1) {
      const err = validateBriefStep();
      if (err) { setError(err); return; }
      // If the service has no print option, skip Stage 2
      setStep(hasPrintOption ? 2 : 3);
    } else if (step === 2) {
      const err = validateFormatStep();
      if (err) { setError(err); return; }
      setStep(3);
    }
  }

  function back() {
    setError('');
    if (step === 3 && !hasPrintOption) setStep(1);
    else setStep((s) => Math.max(1, s - 1));
  }

  // ── Submit to /.netlify/functions/commission-checkout ──────────────────────
  async function submit() {
    setError('');
    setSubmitting(true);

    try {
      const fd = new FormData();

      // Service identification
      fd.append('serviceSlug', service.slug);
      fd.append('serviceTitle', service.title);

      // Customer fields — pull from briefValues using the standard keys
      const name = briefValues.customerName || '';
      const email = briefValues.customerEmail || '';
      const phone = briefValues.customerPhone || '';
      fd.append('name', name);
      fd.append('email', email);
      if (phone) fd.append('phone', phone);

      // Free-text brief — concatenate non-customer, non-file fields as a single summary
      const briefSummary = briefingFields
        .filter((f) => !['photo', 'photos'].includes(f.fieldType))
        .filter((f) => !['customerName', 'customerEmail', 'customerPhone'].includes(f.key))
        .map((f) => `${f.label}: ${briefValues[f.key] || '(not provided)'}`)
        .join('\n');
      fd.append('brief', briefSummary);

      // Structured brief data (Phase 2 new field)
      const briefData = briefingFields
        .filter((f) => !['photo', 'photos'].includes(f.fieldType))
        .map((f) => ({
          key: f.key,
          label: f.label,
          value: briefValues[f.key] || '',
        }));
      fd.append('briefData', JSON.stringify(briefData));

      // Format choice
      const deliveryType = deliveryChoice === 'digital' ? 'digital' : 'both';
      fd.append('deliveryType', deliveryType);
      if (deliveryType === 'both') {
        fd.append('printFormat', printFormat);
        fd.append('printSize', printSize);
        fd.append('shippingAddress', shippingAddress);
      }

      // Append all uploaded photo files
      Object.values(briefFiles).forEach((arr) => {
        (arr || []).forEach((f) => fd.append('files', f));
      });

      const res = await fetch('/.netlify/functions/commission-checkout', {
        method: 'POST',
        body: fd,
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

  // ── Render ────────────────────────────────────────────────────────────────
  const totalSteps = hasPrintOption ? 3 : 2;
  const displayStep = step === 3 && !hasPrintOption ? 2 : step;

  return (
    <div className="cw">
      <header className="cw__header">
        <h2 className="cw__title">Start Your Commission</h2>
        <div className="cw__stepper" aria-label={`Step ${displayStep} of ${totalSteps}`}>
          {Array.from({ length: totalSteps }).map((_, i) => (
            <span
              key={i}
              className={`cw__stepper-dot${i + 1 === displayStep ? ' cw__stepper-dot--active' : ''}${i + 1 < displayStep ? ' cw__stepper-dot--done' : ''}`}
            />
          ))}
        </div>
      </header>

      {/* ── STEP 1: BRIEF ─────────────────────────────────────────────────── */}
      {step === 1 && (
        <section className="cw__section">
          <p className="cw__step-intro">Tell us about your commission. The more detail, the better we can match what you've imagined.</p>
          {briefingFields.map((field) => (
            <BriefField
              key={field._key || field.key}
              field={field}
              value={briefValues[field.key]}
              onChange={(k, v) => setBriefValues((p) => ({ ...p, [k]: v }))}
              files={briefFiles}
              onFilesChange={(k, arr) => setBriefFiles((p) => ({ ...p, [k]: arr }))}
            />
          ))}
          {briefingFields.length === 0 && (
            <p className="cw__empty">This service doesn't have a briefing form configured yet. Please contact us directly to commission.</p>
          )}
        </section>
      )}

      {/* ── STEP 2: FORMAT ────────────────────────────────────────────────── */}
      {step === 2 && hasPrintOption && (
        <section className="cw__section">
          <p className="cw__step-intro">How would you like your finished commission delivered?</p>

          <div className="cw__delivery-cards">
            <label className={`cw__delivery-card${deliveryChoice === 'digital' ? ' cw__delivery-card--selected' : ''}`}>
              <input
                type="radio"
                name="deliveryChoice"
                value="digital"
                checked={deliveryChoice === 'digital'}
                onChange={() => setDeliveryChoice('digital')}
              />
              <span className="cw__delivery-title">Digital download only</span>
              <span className="cw__delivery-desc">High-res file emailed via a secure link.</span>
              <span className="cw__delivery-price">{priceLabel(service.price)}</span>
            </label>

            <label className={`cw__delivery-card${deliveryChoice === 'both' ? ' cw__delivery-card--selected' : ''}`}>
              <input
                type="radio"
                name="deliveryChoice"
                value="both"
                checked={deliveryChoice === 'both'}
                onChange={() => setDeliveryChoice('both')}
              />
              <span className="cw__delivery-title">Digital + Print</span>
              <span className="cw__delivery-desc">Digital file plus a physical print delivered to your door.</span>
              <span className="cw__delivery-price">From {priceLabel(service.price + (Number(service.printUpcharges?.poster?.small) || 0))}</span>
            </label>
          </div>

          {deliveryChoice === 'both' && (
            <div className="cw__print-options">
              <div className="cw__row">
                <label className="cw__field">
                  <span className="cw__label">Print Format <span className="cw__required-star">*</span></span>
                  <select
                    className="cw__select"
                    value={printFormat}
                    onChange={(e) => { setPrintFormat(e.target.value); setPrintSize(''); }}
                    required
                  >
                    <option value="">Select format…</option>
                    <option value="poster">Poster Print</option>
                    <option value="canvas-standard">Canvas Standard</option>
                    <option value="canvas-gallery">Canvas Gallery</option>
                  </select>
                </label>
                <label className="cw__field">
                  <span className="cw__label">Size <span className="cw__required-star">*</span></span>
                  <select
                    className="cw__select"
                    value={printSize}
                    onChange={(e) => setPrintSize(e.target.value)}
                    required
                    disabled={!printFormat}
                  >
                    <option value="">Select size…</option>
                    <option value="small">Small</option>
                    <option value="medium">Medium</option>
                    <option value="large">Large</option>
                  </select>
                </label>
              </div>
              <label className="cw__field">
                <span className="cw__label">Shipping Address <span className="cw__required-star">*</span></span>
                <textarea
                  className="cw__textarea"
                  rows={3}
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  required
                  placeholder="Full delivery address including postcode"
                />
              </label>
            </div>
          )}

          <div className="cw__price-preview">
            <span>Running total:</span>
            <strong>{priceLabel(computedPrice.total)}</strong>
          </div>
        </section>
      )}

      {/* ── STEP 3: REVIEW ────────────────────────────────────────────────── */}
      {step === 3 && (
        <section className="cw__section">
          <p className="cw__step-intro">Quick check before payment.</p>

          <dl className="cw__summary">
            <div className="cw__summary-row">
              <dt>Service</dt>
              <dd>{service.title}</dd>
            </div>

            {briefingFields
              .filter((f) => !['photo', 'photos'].includes(f.fieldType))
              .map((f) => (
                <div className="cw__summary-row" key={f.key}>
                  <dt>{f.label}</dt>
                  <dd>{briefValues[f.key] || <em>(not provided)</em>}</dd>
                </div>
              ))}

            {/* Photo upload summaries */}
            {briefingFields
              .filter((f) => ['photo', 'photos'].includes(f.fieldType))
              .map((f) => {
                const arr = briefFiles[f.key] || [];
                return (
                  <div className="cw__summary-row" key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>
                      {arr.length === 0 ? <em>(none uploaded)</em> :
                        `${arr.length} photo${arr.length > 1 ? 's' : ''} ready to upload`}
                    </dd>
                  </div>
                );
              })}

            <div className="cw__summary-row">
              <dt>Format</dt>
              <dd>{computedPrice.formatLabel}</dd>
            </div>

            {deliveryChoice === 'both' && shippingAddress && (
              <div className="cw__summary-row">
                <dt>Shipping to</dt>
                <dd style={{ whiteSpace: 'pre-line' }}>{shippingAddress}</dd>
              </div>
            )}
          </dl>

          <div className="cw__total-row">
            <span>Total</span>
            <strong>{priceLabel(computedPrice.total)}</strong>
          </div>
        </section>
      )}

      {/* ── ERROR + NAV ───────────────────────────────────────────────────── */}
      {error && <div className="cw__error" role="alert">{error}</div>}

      <div className="cw__nav">
        {step > 1 && (
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
