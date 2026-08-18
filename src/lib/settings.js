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

function parseTime(displayStr) {
  if (!displayStr) return '';
  if (/^\d{2}:\d{2}$/.test(displayStr)) return displayStr;
  const match = displayStr.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return displayStr;
  let hour = parseInt(match[1], 10);
  const minute = match[2];
  const meridiem = match[3].toUpperCase();
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${minute}`;
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
  const { user, bootstrapSettings } = useAuth();
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  useEffect(() => {
    if (!user || user.portalAccess === 'alumni') {
      setSettings(DEFAULT_SETTINGS);
      return;
    }

    if (bootstrapSettings !== undefined) {
      setSettings({ ...DEFAULT_SETTINGS, ...(bootstrapSettings || {}) });
      return;
    }

    api.get('/api/settings?type=config')
      .then((items) => {
        const globalConfig = Array.isArray(items) ? items.find(item => item.key === 'global_config') : null;
        if (globalConfig?.value) setSettings(prev => ({ ...prev, ...globalConfig.value }));
      })
      .catch(() => {});
  }, [user, bootstrapSettings]);

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
