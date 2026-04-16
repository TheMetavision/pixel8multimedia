// src/components/CommissionForm.jsx
// Commission order form — mounts on each /services/[slug] page
// Handles file upload, brief, delivery type selection, and Stripe checkout redirect

import { useState, useRef } from 'react';

const MAX_FILES = 5;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'];

export default function CommissionForm({ service }) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    brief: '',
    deliveryType: 'digital',
    printSize: '',
    printFormat: '',
    shippingAddress: '',
  });
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const showPrintFields =
    form.deliveryType === 'print' || form.deliveryType === 'both';
  const showFileUpload = service.hasFileUpload !== false;

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function validateFile(file) {
    if (!ALLOWED_TYPES.includes(file.type)) {
      return `${file.name}: unsupported format. Use JPG, PNG, WebP, HEIC, or PDF.`;
    }
    if (file.size > MAX_FILE_SIZE) {
      return `${file.name}: too large (max 10 MB).`;
    }
    return null;
  }

  function addFiles(incoming) {
    const newFiles = [...files];
    for (const file of incoming) {
      if (newFiles.length >= MAX_FILES) {
        setError(`Maximum ${MAX_FILES} files allowed.`);
        break;
      }
      const err = validateFile(file);
      if (err) {
        setError(err);
        continue;
      }
      // Prevent duplicates by name+size
      if (!newFiles.some((f) => f.name === file.name && f.size === file.size)) {
        newFiles.push(file);
      }
    }
    setFiles(newFiles);
  }

  function removeFile(index) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleDrag(e) {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') setDragActive(true);
    else if (e.type === 'dragleave') setDragActive(false);
  }

  function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.length) addFiles([...e.dataTransfer.files]);
  }

  function handleFileInput(e) {
    if (e.target.files?.length) addFiles([...e.target.files]);
    e.target.value = ''; // allow re-selecting same file
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // Build multipart form data
      const fd = new FormData();
      fd.append('serviceSlug', service.slug);
      fd.append('serviceTitle', service.title);
      fd.append('name', form.name.trim());
      fd.append('email', form.email.trim());
      fd.append('brief', form.brief.trim());
      fd.append('deliveryType', form.deliveryType);

      if (showPrintFields) {
        fd.append('printSize', form.printSize);
        fd.append('printFormat', form.printFormat);
        fd.append('shippingAddress', form.shippingAddress.trim());
      }

      files.forEach((file) => fd.append('files', file));

      // POST to Netlify Function → creates Stripe Checkout Session
      const res = await fetch('/.netlify/functions/commission-checkout', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Something went wrong. Please try again.');
      }

      const { url } = await res.json();
      // Redirect to Stripe Checkout
      window.location.href = url;
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="commission-form"
      encType="multipart/form-data"
    >
      <h3 className="commission-form__heading">Start Your Commission</h3>

      {/* ── Name & Email ──────────────────────── */}
      <div className="commission-form__row">
        <label className="commission-form__field">
          <span className="commission-form__label">Your Name</span>
          <input
            type="text"
            name="name"
            required
            value={form.name}
            onChange={handleChange}
            className="commission-form__input"
            placeholder="Full name"
          />
        </label>
        <label className="commission-form__field">
          <span className="commission-form__label">Email</span>
          <input
            type="email"
            name="email"
            required
            value={form.email}
            onChange={handleChange}
            className="commission-form__input"
            placeholder="you@email.com"
          />
        </label>
      </div>

      {/* ── Brief ─────────────────────────────── */}
      <label className="commission-form__field">
        <span className="commission-form__label">Your Brief</span>
        <textarea
          name="brief"
          required
          rows={5}
          value={form.brief}
          onChange={handleChange}
          className="commission-form__textarea"
          placeholder="Describe what you'd like — the more detail, the better the result. Include any style preferences, references, or specific instructions."
        />
      </label>

      {/* ── File Upload ───────────────────────── */}
      {showFileUpload && (
        <div className="commission-form__field">
          <span className="commission-form__label">
            Upload Reference Images{' '}
            <span className="commission-form__hint">
              (max {MAX_FILES} files, 10 MB each — JPG, PNG, WebP, HEIC, PDF)
            </span>
          </span>
          <div
            className={`commission-form__dropzone${dragActive ? ' commission-form__dropzone--active' : ''}`}
            onDragEnter={handleDrag}
            onDragOver={handleDrag}
            onDragLeave={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_TYPES.join(',')}
              onChange={handleFileInput}
              className="commission-form__file-input"
              aria-label="Upload files"
            />
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="commission-form__upload-icon">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="commission-form__dropzone-text">
              {dragActive
                ? 'Drop files here…'
                : 'Drag & drop files or click to browse'}
            </p>
          </div>

          {files.length > 0 && (
            <ul className="commission-form__file-list">
              {files.map((file, i) => (
                <li key={`${file.name}-${file.size}`} className="commission-form__file-item">
                  <span className="commission-form__file-name">
                    {file.name}
                    <span className="commission-form__file-size">
                      ({formatBytes(file.size)})
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="commission-form__file-remove"
                    aria-label={`Remove ${file.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ── Delivery Type ─────────────────────── */}
      <fieldset className="commission-form__fieldset">
        <legend className="commission-form__label">Delivery</legend>
        <div className="commission-form__radio-group">
          {service.hasDigitalDelivery !== false && (
            <label className={`commission-form__radio-card${form.deliveryType === 'digital' ? ' commission-form__radio-card--selected' : ''}`}>
              <input
                type="radio"
                name="deliveryType"
                value="digital"
                checked={form.deliveryType === 'digital'}
                onChange={handleChange}
              />
              <span className="commission-form__radio-icon">🖥️</span>
              <span className="commission-form__radio-title">Digital Download</span>
              <span className="commission-form__radio-desc">
                High-res file via secure link
              </span>
            </label>
          )}
          {service.hasPrintOrder !== false && (
            <label className={`commission-form__radio-card${form.deliveryType === 'print' ? ' commission-form__radio-card--selected' : ''}`}>
              <input
                type="radio"
                name="deliveryType"
                value="print"
                checked={form.deliveryType === 'print'}
                onChange={handleChange}
              />
              <span className="commission-form__radio-icon">🖨️</span>
              <span className="commission-form__radio-title">Print / Canvas</span>
              <span className="commission-form__radio-desc">
                Delivered to your door
              </span>
            </label>
          )}
          {service.hasDigitalDelivery !== false && service.hasPrintOrder !== false && (
            <label className={`commission-form__radio-card${form.deliveryType === 'both' ? ' commission-form__radio-card--selected' : ''}`}>
              <input
                type="radio"
                name="deliveryType"
                value="both"
                checked={form.deliveryType === 'both'}
                onChange={handleChange}
              />
              <span className="commission-form__radio-icon">✨</span>
              <span className="commission-form__radio-title">Digital + Print</span>
              <span className="commission-form__radio-desc">
                Get both formats
              </span>
            </label>
          )}
        </div>
      </fieldset>

      {/* ── Print Options (conditional) ────────── */}
      {showPrintFields && (
        <div className="commission-form__print-options">
          <div className="commission-form__row">
            <label className="commission-form__field">
              <span className="commission-form__label">Print Format</span>
              <select
                name="printFormat"
                required={showPrintFields}
                value={form.printFormat}
                onChange={handleChange}
                className="commission-form__select"
              >
                <option value="">Select format…</option>
                <option value="poster">Poster</option>
                <option value="canvas-standard">Standard Canvas</option>
                <option value="canvas-gallery">Gallery Canvas</option>
              </select>
            </label>
            <label className="commission-form__field">
              <span className="commission-form__label">Size</span>
              <select
                name="printSize"
                required={showPrintFields}
                value={form.printSize}
                onChange={handleChange}
                className="commission-form__select"
              >
                <option value="">Select size…</option>
                <option value="12x8">Small (12×8″)</option>
                <option value="16x12">Medium (16×12″)</option>
                <option value="24x16">Large (24×16″)</option>
              </select>
            </label>
          </div>
          <label className="commission-form__field">
            <span className="commission-form__label">Shipping Address</span>
            <textarea
              name="shippingAddress"
              required={showPrintFields}
              rows={3}
              value={form.shippingAddress}
              onChange={handleChange}
              className="commission-form__textarea"
              placeholder="Full delivery address including postcode"
            />
          </label>
        </div>
      )}

      {/* ── Error / Submit ────────────────────── */}
      {error && (
        <div className="commission-form__error" role="alert">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="commission-form__submit"
      >
        {submitting ? (
          <span className="commission-form__spinner" />
        ) : (
          <>Proceed to Payment</>
        )}
      </button>

      <p className="commission-form__terms">
        By submitting, you agree to our{' '}
        <a href="/terms" target="_blank" rel="noopener noreferrer">
          Terms of Service
        </a>
        . Payment is handled securely via Stripe.
      </p>
    </form>
  );
}
