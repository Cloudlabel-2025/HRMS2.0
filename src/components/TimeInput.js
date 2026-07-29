'use client';

export default function TimeInput({ value, onChange, className, style, disabled, placeholder, ...props }) {
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
