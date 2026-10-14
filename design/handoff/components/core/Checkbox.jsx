import React from 'react';
export function Checkbox({ checked, label, onChange }) {
  return <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', font: 'var(--type-small)', color: 'var(--mute)' }}><span onClick={() => onChange && onChange(!checked)} style={{ width: 14, height: 14, background: checked ? 'var(--accent)' : 'transparent', border: checked ? 0 : '1px solid var(--line)', boxSizing: 'border-box' }} />{label}</label>;
}
