'use client';
import { useState, useCallback } from 'react';

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

  const handleChange = useCallback((e) => {
    const iso = e.target.value;
    setError(validateDate(iso, min, max));
    onChange(e);
  }, [min, max, onChange]);

  const hasError = !!error;

  return (
    <div>
      <input type="date" className={className} value={value || ''}
        onChange={handleChange} min={min} max={max}
        style={{ borderColor: hasError ? '#ef4444' : undefined, ...(styleProp || {}) }}
        {...props} />
      {hasError && (
        <div style={{ color: '#ef4444', fontSize: 11, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
          <i className="bi bi-exclamation-circle-fill" style={{ fontSize: 10 }} />{error}
        </div>
      )}
    </div>
  );
}
