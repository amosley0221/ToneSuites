import React from 'react';
export function IconButton({ label, glyph, active, onClick, size = 36 }) {
  const [hover, setHover] = React.useState(false);
  return <button type="button" title={label} aria-label={label} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0, borderRadius: 0, cursor: 'pointer', background: active ? 'var(--accent)' : hover ? 'var(--bg3)' : 'transparent', color: active ? 'var(--on-accent)' : 'var(--mute)', font: 'var(--type-mono)' }}>{glyph}</button>;
}
