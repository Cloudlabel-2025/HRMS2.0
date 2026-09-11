'use client';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useSettings } from '@/lib/settings';

const MIN_YEAR = 1900;
const MAX_YEAR = 2100;

function validateDate(iso, min, max) {
  if (!iso) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'Invalid date format';
  const [y, m, d] = iso.split('-').map(Number);
  if (y < MIN_YEAR || y > MAX_YEAR) return `Year ${y} is out of range (${MIN_YEAR}-${MAX_YEAR})`;
  if (m < 1 || m > 12) return `Month ${m} is invalid (must be 01-12)`;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return `Day ${d} is invalid (max ${daysInMonth} for month ${m})`;
  if (min && iso < min) return `Must be on or after ${min}`;
  if (max && iso > max) return `Must be on or before ${max}`;
  return '';
}

// Parse a typed display string (in the configured settings.dateFormat)
// back to ISO YYYY-MM-DD. Returns '' for empty, null for unparseable.
function parseDisplayToISO(display, dateFormat) {
  const trimmed = String(display || '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/[/\-.]/).map(s => s.trim());
  if (parts.length !== 3) return null;
  let dd, mm, yyyy;
  if (dateFormat === 'MM/DD/YYYY') {
    [mm, dd, yyyy] = parts;
  } else if (dateFormat === 'YYYY-MM-DD') {
    [yyyy, mm, dd] = parts;
  } else {
    // Default DD/MM/YYYY
    [dd, mm, yyyy] = parts;
  }
  if (!/^\d{1,2}$/.test(dd || '') || !/^\d{1,2}$/.test(mm || '') || !/^\d{4}$/.test(yyyy || '')) return null;
  const iso = `${yyyy.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  return iso;
}

export default function DateInput({ value, onChange, min, max, className = 'form-control', style: styleProp, showHint, allowTyping = false, onErrorChange, ...props }) {
  const [error, setError] = useState('');
  const { settings, formatDate } = useSettings();
  const [display, setDisplay] = useState(value ? formatDate(value) : '');
  const textRef = useRef(null);
  const pickerRef = useRef(null);

  useEffect(() => {
    if (typeof onErrorChange === 'function') onErrorChange(error);
  }, [error, onErrorChange]);

  // Re-validate when bounds change (e.g. data range or cross-field min/max).
  useEffect(() => {
    if (!value) return;
    setError(validateDate(value, min, max));
  }, [min, max, value]);

  // Keep typed text in sync when the ISO value changes externally
  // (e.g. picked from calendar, cleared). Don't clobber while focused.
  useEffect(() => {
    if (document.activeElement === textRef.current) return;
    setDisplay(value ? formatDate(value) : '');
  }, [value, formatDate]);

  const handleChange = useCallback((e) => {
    const iso = e.target.value;
    const nextError = validateDate(iso, min, max);
    setError(nextError);
    onChange(e);
  }, [min, max, onChange]);

  const handleTextChange = useCallback((e) => {
    const next = e.target.value;
    setDisplay(next);
    if (!next.trim()) {
      setError('');
      onChange({ target: { value: '' } });
      return;
    }
    const iso = parseDisplayToISO(next, settings.dateFormat);
    if (iso === null) {
      setError(`Invalid date format. Use ${settings.dateFormat}`);
      return;
    }
    const nextError = validateDate(iso, min, max);
    setError(nextError);
    // Only commit valid dates so parent state always stays a real ISO date.
    if (!nextError) onChange({ target: { value: iso } });
  }, [min, max, onChange, settings.dateFormat]);

  const handleBlur = useCallback(() => {
    if (!display.trim()) {
      setDisplay('');
      setError('');
      return;
    }
    const iso = parseDisplayToISO(display, settings.dateFormat);
    if (iso === null) {
      setError(`Invalid date format. Use ${settings.dateFormat}`);
      return;
    }
    const nextError = validateDate(iso, min, max);
    setError(nextError);
    if (!nextError) {
      // Normalize e.g. 1/2/2026 -> 01/02/2026
      setDisplay(formatDate(iso));
      if (iso !== value) onChange({ target: { value: iso } });
    }
  }, [display, settings.dateFormat, min, max, formatDate, value, onChange]);

  const openPicker = useCallback(() => {
    try {
      if (pickerRef.current?.showPicker) pickerRef.current.showPicker();
      else pickerRef.current?.focus();
    } catch {
      pickerRef.current?.focus();
    }
  }, []);

  const hasError = !!error;

  if (!allowTyping) {
    return (
      <div>
        <div style={{ position: 'relative' }}>
          <input
            type="text"
            className={className}
            value={value ? formatDate(value) : ''}
            placeholder={settings.dateFormat}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
            style={{
              borderColor: hasError ? '#ef4444' : undefined,
              paddingRight: 38,
              ...(styleProp || {}),
            }}
          />
          <i className="bi bi-calendar3" aria-hidden="true" style={{
            position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
            color: '#64748b', pointerEvents: 'none',
          }} />
          {/* Keep the native picker for selection and ISO submission, but let the
              configured-format text field control what the user sees. */}
          <input
            type="date"
            value={value || ''}
            onChange={handleChange}
            min={min}
            max={max}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: props.disabled ? 'not-allowed' : 'pointer' }}
            {...props}
          />
        </div>
        {showHint && !hasError && (
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>Format: {settings.dateFormat}</div>
        )}
        {hasError && (
          <div style={{ color: '#ef4444', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
            <i className="bi bi-exclamation-circle-fill" style={{ fontSize: 10 }} />{error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ position: 'relative' }}>
        <input
          ref={textRef}
          type="text"
          className={className}
          value={display}
          placeholder={settings.dateFormat}
          onChange={handleTextChange}
          onBlur={handleBlur}
          disabled={props.disabled}
          aria-invalid={hasError}
          style={{
            borderColor: hasError ? '#ef4444' : undefined,
            paddingRight: 38,
            ...(styleProp || {}),
          }}
        />
        <button
          type="button"
          onClick={openPicker}
          disabled={props.disabled}
          aria-label="Open calendar picker"
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', color: '#64748b', cursor: 'pointer', padding: 4,
          }}
        >
          <i className="bi bi-calendar3" aria-hidden="true" />
        </button>
        {/* Hidden native picker for calendar selection; typing happens in the text field above. */}
        <input
          ref={pickerRef}
          type="date"
          value={value || ''}
          onChange={handleChange}
          min={min}
          max={max}
          tabIndex={-1}
          aria-hidden="true"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, pointerEvents: 'none' }}
          {...props}
        />
      </div>
      {showHint && !hasError && (
        <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>Format: {settings.dateFormat} · type or pick</div>
      )}
      {hasError && (
        <div style={{ color: '#ef4444', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="bi bi-exclamation-circle-fill" style={{ fontSize: 10 }} />{error}
        </div>
      )}
    </div>
  );
}
