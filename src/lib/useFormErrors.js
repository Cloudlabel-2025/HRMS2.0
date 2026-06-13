'use client';
import { useState, useCallback, useRef } from 'react';

/**
 * Shared form errors hook used across all HRMS forms.
 * - setErrors(obj)   — set multiple field errors, each auto-clears after 10s
 * - setError(k, msg) — set a single field error
 * - clearError(k)    — clear one field error immediately
 * - clearAll()       — clear all errors
 * - Err({ f })       — inline component renders red error below a field
 */
export function useFormErrors() {
  const [errors, setErrorsState] = useState({});
  const timers = useRef({});

  const clearError = useCallback((key) => {
    if (timers.current[key]) { clearTimeout(timers.current[key]); delete timers.current[key]; }
    setErrorsState(p => { const n = { ...p }; delete n[key]; return n; });
  }, []);

  const scheduleAutoClears = useCallback((keys) => {
    keys.forEach(key => {
      if (timers.current[key]) clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(() => {
        setErrorsState(p => { const n = { ...p }; delete n[key]; return n; });
        delete timers.current[key];
      }, 10000);
    });
  }, []);

  const setErrors = useCallback((obj) => {
    setErrorsState(obj);
    scheduleAutoClears(Object.keys(obj));
  }, [scheduleAutoClears]);

  const setError = useCallback((key, msg) => {
    setErrorsState(p => ({ ...p, [key]: msg }));
    scheduleAutoClears([key]);
  }, [scheduleAutoClears]);

  const clearAll = useCallback(() => {
    Object.values(timers.current).forEach(clearTimeout);
    timers.current = {};
    setErrorsState({});
  }, []);

  const Err = useCallback(({ f }) => {
    if (!errors[f]) return null;
    return (
      <div style={{ color: '#ef4444', fontSize: 11, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className="bi bi-exclamation-circle-fill" style={{ fontSize: 10 }} />
        {errors[f]}
      </div>
    );
  }, [errors]);

  return { errors, setErrors, setError, clearError, clearAll, Err };
}
