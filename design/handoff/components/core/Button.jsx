import React from 'react';
export function Button({ variant = 'default', size = 'md', disabled, onClick, children, style }) {
  const base = { font: size === 'sm' ? 'var(--type-small)' : 'var(--type-label)', fontWeight: variant === 'primary' ? 800 : variant === 'strong' ? 700 : 600, padding: size === 'sm' ? '4px 8px' : variant === 'primary' ? '8px 16px' : '6px 12px', border: '1px solid transparent', borderRadius: 0, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .4 : 1, lineHeight: 1.3, display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', transition: 'border-color var(--dur-fast), background var(--dur-fast)' };
  const v = { primary: { background: 'var(--accent)', color: 'var(--on-accent)' }, strong: { background: 'var(--ink)', color: 'var(--bg0)' }, default: { background: 'transparent', color: 'var(--ink)', borderColor: 'var(--line)' }, ghost: { background: 'transparent', color: 'var(--mute)' } }[variant];
  const [hover, setHover] = React.useState(false);
  const h = hover && !disabled ? (variant === 'default' ? { borderColor: 'var(--ink)' } : variant === 'ghost' ? { color: 'var(--ink)' } : { filter: 'brightness(1.08)' }) : {};
  return <button type="button" disabled={disabled} onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} style={{ ...base, ...v, ...h, ...style }}>{children}</button>;
}
