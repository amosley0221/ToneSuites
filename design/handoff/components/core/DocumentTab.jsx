import React from 'react';
export function DocumentTab({ mark, title, active, onClick }) {
  return <div onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, height: 44, padding: '0 14px', cursor: 'pointer', background: active ? 'var(--bg1)' : 'transparent', borderRight: '1px solid var(--line)', boxShadow: active ? 'inset 0 2px 0 var(--accent)' : 'none', color: active ? 'var(--ink)' : 'var(--mute)', font: 'var(--type-label)', whiteSpace: 'nowrap' }}><span style={{ width: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', font: '500 9px var(--font-mono)', background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--bg0)' : 'var(--mute)' }}>{mark}</span>{title}</div>;
}
