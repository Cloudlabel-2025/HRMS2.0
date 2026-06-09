'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

const DEFAULT_SETTINGS = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  dateFormat: 'DD/MM/YYYY',
  language: 'English',
};

const SettingsContext = createContext({
  settings: DEFAULT_SETTINGS,
  updateSettings: () => {},
  formatDate: () => '',
  formatDateTime: () => '',
});

function toDate(value) {
  if (!value) return null;
  const normalized = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T00:00:00`
    : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function partsFor(value) {
  const date = toDate(value);
  if (!date) return null;
  return {
    date,
    dd: String(date.getDate()).padStart(2, '0'),
    mm: String(date.getMonth() + 1).padStart(2, '0'),
    yyyy: String(date.getFullYear()),
  };
}

function renderDate(value, format = DEFAULT_SETTINGS.dateFormat, { weekday = false } = {}) {
  const parts = partsFor(value);
  if (!parts) return '—';

  const formatted = format === 'MM/DD/YYYY'
    ? `${parts.mm}/${parts.dd}/${parts.yyyy}`
    : format === 'YYYY-MM-DD'
      ? `${parts.yyyy}-${parts.mm}-${parts.dd}`
      : `${parts.dd}/${parts.mm}/${parts.yyyy}`;

  if (!weekday) return formatted;
  return `${parts.date.toLocaleDateString('en-US', { weekday: 'long' })}, ${formatted}`;
}

function renderTime(value) {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function SettingsProvider({ children }) {
  const { user } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    if (!user) {
      setSettings(DEFAULT_SETTINGS);
      return;
    }

    api.get('/api/settings?type=config')
      .then((items) => {
        const globalConfig = Array.isArray(items) ? items.find(item => item.key === 'global_config') : null;
        if (globalConfig?.value) setSettings(prev => ({ ...prev, ...globalConfig.value }));
      })
      .catch(() => {});
  }, [user]);

  const value = useMemo(() => ({
    settings,
    updateSettings: (next) => setSettings(prev => ({ ...prev, ...next })),
    formatDate: (date, options) => renderDate(date, settings.dateFormat, options),
    formatDateTime: (date) => {
      const formattedDate = renderDate(date, settings.dateFormat);
      const formattedTime = renderTime(date);
      return formattedTime ? `${formattedDate} ${formattedTime}` : formattedDate;
    },
  }), [settings]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
