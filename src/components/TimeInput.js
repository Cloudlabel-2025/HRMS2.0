'use client';
import { useSettings, formatTime, parseTime } from '@/lib/settings';

export default function TimeInput({ value, onChange, className, style, disabled, placeholder, ...props }) {
  const { settings } = useSettings();
  if (settings.timeFormat === '12h') {
    return (
      <input
        type="text"
        className={className}
        value={formatTime(value, '12h')}
        onChange={e => onChange(e.target.value ? parseTime(e.target.value) : '')}
        disabled={disabled}
        style={style}
        placeholder={placeholder}
        {...props}
      />
    );
  }
  return (
    <input
      type="time"
      className={className}
      value={value || ''}
      onChange={onChange}
      disabled={disabled}
      style={style}
      {...props}
    />
  );
}
