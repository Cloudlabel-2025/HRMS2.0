'use client';
import { useSettings } from '@/lib/settings';

export default function Time({ value, fallback = '—', className, style }) {
  const { formatTime } = useSettings();
  const text = formatTime(value);
  return <span className={className} style={style}>{text || fallback}</span>;
}
