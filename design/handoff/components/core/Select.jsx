import React from 'react';
export function Select({ value, options, onChange, width = 160, mono }) {
  return <select value={value} onChange={e => onChange && onChange(e.target.value)} style={{ width, padding: '6px 10px', background: 'var(--bg1)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 0, font: mono ? 'var(--type-mono)' : 'var(--type-label)', cursor: 'pointer' }}>{options.map(o => <option key={o} value={o}>{o}</option>)}</select>;
}
