import React from 'react';
export function Slider({ label, value, min = 0, max = 100, display, onChange }) {
  const pct = ((value - min) / (max - min)) * 100;
  const ref = React.useRef();
  const set = e => { if (!onChange) return; const r = ref.current.getBoundingClientRect(); onChange(Math.round(min + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (max - min))); };
  return <div style={{ font: 'var(--type-small)' }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--ink)' }}>{label}</span><span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{display ?? value}</span></div><div ref={ref} onClick={set} style={{ height: 4, background: 'var(--bg3)', marginTop: 8, position: 'relative', cursor: 'pointer' }}><div style={{ height: 4, background: 'var(--accent)', width: pct + '%' }} /><div style={{ position: 'absolute', top: -5, left: pct + '%', width: 14, height: 14, marginLeft: -7, background: 'var(--ink)' }} /></div></div>;
}
