import React from 'react';
export function MenuItem({ label, shortcut, hasSubmenu, divider, disabled, onClick }) {
  const [hover, setHover] = React.useState(false);
  return <div onClick={disabled ? undefined : onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 14px', cursor: disabled ? 'default' : 'pointer', font: 'var(--type-small)', color: disabled ? 'var(--mute)' : 'var(--ink)', background: hover && !disabled ? 'var(--bg2)' : 'transparent', borderTop: divider ? '1px solid var(--line)' : 0 }}><span>{label}</span><span style={{ font: 'var(--type-eyebrow)', color: 'var(--mute)' }}>{hasSubmenu ? '▸' : shortcut}</span></div>;
}
