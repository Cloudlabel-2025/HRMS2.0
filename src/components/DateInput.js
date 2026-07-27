'use client';
import { useCallback, useState, useEffect, useRef } from 'react';
import { useSettings } from '@/lib/settings';

function toISO(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function display(value, format) {
  if (!value) return '';
  if (format === 'YYYY-MM-DD') return value;
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) return value;
  if (format === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  return `${d}/${m}/${y}`;
}

function toIsoFromDisplay(value, format) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const sep = value.includes('/') ? '/' : '-';
  const parts = value.split(sep);
  if (parts.length !== 3) return '';
  const [a, b, c] = parts;
  if (!a || !b || !c || c.length < 4) return '';
  if (format === 'MM/DD/YYYY')
    return `${c}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
  if (format === 'DD/MM/YYYY')
    return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
}

function formatDigits(raw, format) {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';

  if (format === 'YYYY-MM-DD') {
    let r = digits.slice(0, 4);
    if (digits.length > 4) r += '/' + digits.slice(4, 6);
    if (digits.length > 6) r += '/' + digits.slice(6, 8);
    return r.replace(/\/$/, '');
  }

  let r = digits.slice(0, 2);
  if (digits.length > 2) r += '/' + digits.slice(2, 4);
  if (digits.length > 4) r += '/' + digits.slice(4, 8);
  return r.replace(/\/$/, '');
}

function parseDisplayParts(value, format) {
  if (!value) return null;
  const sep = value.includes('/') ? '/' : '-';
  const parts = value.split(sep);
  if (parts.length !== 3) return null;
  if (format === 'MM/DD/YYYY') return { month: parts[0], day: parts[1], year: parts[2] };
  if (format === 'DD/MM/YYYY') return { day: parts[0], month: parts[1], year: parts[2] };
  return { year: parts[0], month: parts[1], day: parts[2] };
}

function validateDraft(value, format, minDate, maxDate) {
  const parts = parseDisplayParts(value, format);
  if (!parts) return '';
  const { day, month, year } = parts;
  if (day && day.length < 2) return '';
  if (month && month.length < 2) return '';
  if (year && year.length < 4) return '';
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (!d || !m || !y) return '';
  if (m < 1 || m > 12) return `Invalid month: ${m} (must be 01-12)`;
  const daysInMonth = new Date(y, m, 0).getDate();
  if (d < 1 || d > daysInMonth) return `Invalid day: ${d} (must be 01-${daysInMonth})`;
  if (y < 1900 || y > 9999) return `Invalid year: ${y}`;
  if (minDate) {
    const iso = toIsoFromDisplay(value, format);
    if (iso && iso < minDate) return `Date must be on or after ${minDate}`;
  }
  if (maxDate) {
    const iso = toIsoFromDisplay(value, format);
    if (iso && iso > maxDate) return `Date must be on or before ${maxDate}`;
  }
  return '';
}

export default function DateInput({ value, onChange, min, max, className = 'form-control', style: styleProp, showHint = true, ...props }) {
  const { settings } = useSettings();
  const fmt = settings.dateFormat || 'DD/MM/YYYY';
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState('');
  const hiddenNode = useRef(null);

  useEffect(() => {
    if (!value && draft) setDraft('');
  }, [value]);

  const handleChange = useCallback((e) => {
    const raw = e.target.value;
    if (!raw) {
      setDraft('');
      setError('');
      onChange({ target: { value: '' } });
      return;
    }
    const formatted = formatDigits(raw, fmt);
    setDraft(formatted);
    setError('');
    const iso = toIsoFromDisplay(formatted, fmt);
    if (iso) {
      setError(validateDraft(formatted, fmt, min, max));
      onChange({ target: { value: iso } });
      setDraft('');
    }
  }, [fmt, onChange, min, max]);

  const handleBlur = useCallback(() => {
    setFocused(false);
    if (draft) {
      const validationErr = validateDraft(draft, fmt, min, max);
      setError(validationErr);
      const iso = toIsoFromDisplay(draft, fmt);
      if (iso && !validationErr) {
        onChange({ target: { value: iso } });
      } else if (!validationErr) {
        onChange({ target: { value: '' } });
      }
      setDraft('');
    }
  }, [draft, fmt, onChange, min, max]);

  const handleFocus = useCallback(() => {
    setFocused(true);
    setError('');
  }, []);

  const openPicker = useCallback(() => {
    const hidden = hiddenNode.current;
    if (!hidden) return;
    hidden.value = toISO(value) || '';
    hidden.showPicker?.();
  }, [value]);

  const hasError = !!error;
  const displayValue = draft || display(value, fmt);
  const showHintText = showHint && (focused || displayValue) && !value;
  const hint = fmt === 'MM/DD/YYYY'
    ? 'Enter: month (01-12) / day (01-31) / year (1900-9999)'
    : fmt === 'YYYY-MM-DD'
    ? 'Enter: year (1900-9999) / month (01-12) / day (01-31)'
    : 'Enter: day (01-31) / month (01-12) / year (1900-9999)';

  return (
    <div>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          type="text"
          className={className}
          value={displayValue}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          placeholder={fmt}
          autoComplete="off"
          inputMode="numeric"
          style={{ paddingRight: 32, borderColor: hasError ? '#ef4444' : undefined, ...(styleProp || {}) }}
          {...props}
        />
        <button type="button" onClick={openPicker} tabIndex={-1}
          style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
          <i className="bi bi-calendar3" style={{ color: '#64748b', fontSize: 14 }} />
        </button>
        <input ref={hiddenNode} type="date" tabIndex={-1} min={min} max={max}
          style={{ position: 'absolute', left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none', border: 'none', padding: 0 }}
          onChange={(e) => { setDraft(''); setError(''); onChange({ target: { value: e.target.value } }); }} />
      </div>
      {showHintText && !hasError && (
        <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{hint}</div>
      )}
      {hasError && (
        <div style={{ color: '#ef4444', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="bi bi-exclamation-circle-fill" style={{ fontSize: 10 }} />{error}
        </div>
      )}
    </div>
  );
}
