'use client';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

const DEFAULT_SETTINGS = {
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  dateFormat: 'DD/MM/YYYY',
  language: 'English',
  timeFormat: '24h',
};

export function formatTime(timeStr, format = '24h') {
  if (!timeStr) return '';
  if (format === '24h') return timeStr;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return timeStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

export function parseTime(displayStr) {
  if (!displayStr) return '';
  if (/^\d{2}:\d{2}$/.test(displayStr)) return displayStr;
  const m = displayStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return displayStr;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = m[3].toUpperCase();
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

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

function renderTime(value, timeFormat = '24h') {
  const date = toDate(value);
  if (!date) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: timeFormat === '12h' });
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
      const formattedTime = renderTime(date, settings.timeFormat);
      return formattedTime ? `${formattedDate} ${formattedTime}` : formattedDate;
    },
    formatTime: (timeStr) => formatTime(timeStr, settings.timeFormat),
    parseTime,
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
