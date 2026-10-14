import React from 'react';
export function ToolButton({ shortcut, name, active, hasGroup, onClick }) {
  const [hover, setHover] = React.useState(false);
  return <button type="button" title={name} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ width: 36, height: 30, position: 'relative', border: 0, borderRadius: 0, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: active ? 'var(--accent)' : hover ? 'var(--bg3)' : 'transparent', color: active ? 'var(--on-accent)' : 'var(--mute)', font: 'var(--type-mono)' }}>{shortcut}{hasGroup && <span style={{ position: 'absolute', right: 3, bottom: 3, width: 0, height: 0, borderLeft: '4px solid transparent', borderBottom: '4px solid ' + (active ? 'var(--on-accent)' : 'var(--mute)') }} />}</button>;
}
