'use client';
import { useRef, useCallback } from 'react';
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
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) return value;
  if (format === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
  if (format === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
  return `${d}/${m}/${y}`;
}

function toIsoFromDisplay(value, format) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const sep = value.includes('/') ? '/' : '-';
  const parts = value.split(sep);
  if (parts.length !== 3) return value;
  if (format === 'MM/DD/YYYY')
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  if (format === 'DD/MM/YYYY')
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
}

export default function DateInput({ value, onChange, min, max, className = 'form-control', ...props }) {
  const { settings } = useSettings();
  const fmt = settings.dateFormat || 'DD/MM/YYYY';
  const hiddenRef = useRef(null);

  const handleTextChange = useCallback((e) => {
    const raw = e.target.value;
    if (!raw) { onChange({ target: { value: '' } }); return; }
    const iso = toIsoFromDisplay(raw, fmt);
    onChange({ target: { value: iso } });
  }, [fmt, onChange]);

  const handleNativeChange = useCallback((e) => {
    onChange(e);
  }, [onChange]);

  const openPicker = useCallback(() => {
    hiddenRef.current?.showPicker();
  }, []);

  return (
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <input
        ref={hiddenRef}
        type="date"
        value={toISO(value)}
        onChange={handleNativeChange}
        min={min}
        max={max}
        style={{ position: 'absolute', width: 0, height: 0, padding: 0, border: 'none', opacity: 0, pointerEvents: 'none' }}
      />
      <input
        type="text"
        className={className}
        value={display(value, fmt)}
        onChange={handleTextChange}
        placeholder={fmt}
        autoComplete="off"
        {...props}
      />
      <button type="button" onClick={openPicker} tabIndex={-1}
        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'none', cursor: 'pointer', padding: 0, lineHeight: 1 }}>
        <i className="bi bi-calendar3" style={{ color: '#64748b', fontSize: 14 }} />
      </button>
    </div>
  );
}
