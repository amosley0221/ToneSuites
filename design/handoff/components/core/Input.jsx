import React from 'react';
export function Input({ value, placeholder, mono, onChange, width = 200 }) {
  const [focus, setFocus] = React.useState(false);
  return <input value={value} placeholder={placeholder} onChange={e => onChange && onChange(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} style={{ width, padding: '6px 10px', background: 'var(--bg0)', color: 'var(--ink)', border: '1px solid ' + (focus ? 'var(--accent)' : 'var(--line)'), borderRadius: 0, outline: 0, font: mono ? 'var(--type-mono)' : 'var(--type-label)', boxSizing: 'border-box' }} />;
}
