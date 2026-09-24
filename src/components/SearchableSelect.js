'use client';
import { useState, useEffect, useRef, useMemo } from 'react';

// Visible, typable searchable dropdown that looks like a native .form-select.
// Props: value, onChange({target:{value}}), options ([{value,label,disabled?}] or string[]), placeholder, disabled, className, style, emptyLabel, id, ariaLabel
export default function SearchableSelect({
  value = '',
  onChange,
  options = [],
  placeholder = 'Select...',
  disabled = false,
  className = 'form-select',
  style,
  emptyLabel,
  id,
  ariaLabel,
  ...rest
}) {
  const normalized = useMemo(() => {
    return (options || []).map((o) => {
      if (typeof o === 'string') return { value: o, label: o };
      return { value: String(o.value ?? ''), label: String(o.label ?? o.value ?? ''), disabled: !!o.disabled };
    });
  }, [options]);

  const selectedLabel = useMemo(() => {
    const v = String(value ?? '');
    const hit = normalized.find((o) => String(o.value) === v);
    return hit ? hit.label : '';
  }, [normalized, value]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return normalized;
    const q = query.trim().toLowerCase();
    return normalized.filter((o) => o.label.toLowerCase().includes(q));
  }, [normalized, query]);

  // Keep selected label visible when closed; clear query when closed
  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(-1);
    } else {
      // when opening, focus input and select text
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 0);
    }
  }, [open]);

  // close on outside click / escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // keep activeIndex in bounds
  useEffect(() => {
    if (filtered.length === 0) setActiveIndex(-1);
    else if (activeIndex >= filtered.length) setActiveIndex(filtered.length - 1);
  }, [filtered, activeIndex]);

  const commit = (val) => {
    setOpen(false);
    onChange?.({ target: { value: String(val) } });
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setActiveIndex((p) => Math.min(filtered.length - 1, p + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((p) => Math.max(0, p - 1));
    } else if (e.key === 'Enter') {
      if (open && activeIndex >= 0 && filtered[activeIndex]) {
        if (!filtered[activeIndex].disabled) commit(filtered[activeIndex].value);
      } else if (open && filtered.length === 1 && !filtered[0].disabled) {
        commit(filtered[0].value);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const displayValue = open ? query : selectedLabel;

  return (
    <div ref={wrapRef} style={{ position: 'relative', ...(disabled ? { opacity: 0.6 } : null) }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          id={id}
          className={`${className} ss-input`}
          value={displayValue}
          placeholder={open ? (placeholder || 'Search...') : placeholder}
          disabled={disabled}
          readOnly={!open}
          onFocus={() => { if (!disabled) setOpen(true); }}
          onClick={() => { if (!disabled) setOpen(true); }}
          onChange={(e) => {
            if (!open) setOpen(true);
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          style={{
            paddingRight: 34,
            cursor: disabled ? 'not-allowed' : open ? 'text' : 'pointer',
            background: open ? '#fff' : undefined,
            ...(style || {}),
          }}
          {...rest}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          style={{
            position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)',
            border: 'none', background: 'transparent', color: '#64748b', cursor: disabled ? 'not-allowed' : 'pointer',
            padding: 4, lineHeight: 1, display: 'flex', alignItems: 'center',
          }}
        >
          <i className={`bi ${open ? 'bi-chevron-up' : 'bi-chevron-down'}`} style={{ fontSize: 12 }} />
        </button>
      </div>

      {open && !disabled && (
        <div
          role="listbox"
          className="ss-popup"
          style={{
            position: 'absolute', left: 0, right: 0, top: 'calc(100% + 6px)',
            background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10,
            boxShadow: '0 10px 28px rgba(15,23,42,0.12)', zIndex: 40,
            maxHeight: 220, overflowY: 'auto', padding: 4,
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '10px 12px', fontSize: 13, color: '#94a3b8' }}>{emptyLabel || 'No results'}</div>
          ) : (
            filtered.map((opt, idx) => {
              const isSelected = String(opt.value) === String(value ?? '');
              const isActive = idx === activeIndex;
              return (
                <button
                  key={`${opt.value}-${idx}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={!!opt.disabled}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onClick={() => { if (!opt.disabled) commit(opt.value); }}
                  style={{
                    display: 'flex', width: '100%', textAlign: 'left', alignItems: 'center',
                    gap: 8, padding: '8px 10px', borderRadius: 8, border: 'none',
                    background: isActive ? '#f1f5f9' : isSelected ? '#eff6ff' : '#fff',
                    color: opt.disabled ? '#94a3b8' : isSelected ? '#1d4ed8' : '#0f172a',
                    fontSize: 13, fontWeight: isSelected ? 600 : 500, cursor: opt.disabled ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{opt.label}</span>
                  {isSelected && <i className="bi bi-check-lg" style={{ color: '#2563eb', fontSize: 14 }} />}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
