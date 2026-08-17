'use client';
import { useState, useCallback } from 'react';
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

export default function DateInput({ value, onChange, min, max, className = 'form-control', style: styleProp, showHint, ...props }) {
  const [error, setError] = useState('');
  const { settings, formatDate } = useSettings();

  const handleChange = useCallback((e) => {
    const iso = e.target.value;
    setError(validateDate(iso, min, max));
    onChange(e);
  }, [min, max, onChange]);

  const hasError = !!error;

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
