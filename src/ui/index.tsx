// Ported design-system primitives (design/handoff/components/core).
// Radius 0, one accent, 1px lines, 120ms transitions.
import React, { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';

type BtnVariant = 'default' | 'primary' | 'strong' | 'ghost';
export function Button({
  variant = 'default', size = 'md', disabled, onClick, children, style, active, title,
}: {
  variant?: BtnVariant; size?: 'sm' | 'md'; disabled?: boolean; onClick?: (e: React.MouseEvent) => void;
  children?: ReactNode; style?: CSSProperties; active?: boolean; title?: string;
}) {
  const [hover, setHover] = useState(false);
  const v = active ? 'strong' : variant;
  const base: CSSProperties = {
    font: size === 'sm' ? 'var(--type-small)' : 'var(--type-label)',
    fontWeight: v === 'primary' ? 800 : v === 'strong' ? 700 : 600,
    fontSize: size === 'sm' ? 11 : 12,
    padding: size === 'sm' ? '4px 8px' : v === 'primary' ? '6px 14px' : '5px 10px',
    border: '1px solid transparent', borderRadius: 0, cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1, lineHeight: 1.3, display: 'inline-flex', alignItems: 'center', gap: 6,
    whiteSpace: 'nowrap', transition: 'border-color var(--dur-fast), background var(--dur-fast)', flexShrink: 0,
  };
  const vs: Record<BtnVariant, CSSProperties> = {
    primary: { background: 'var(--accent)', color: 'var(--on-accent)' },
    strong: { background: 'var(--ink)', color: 'var(--bg0)', borderColor: 'var(--ink)' },
    default: { background: 'transparent', color: 'var(--ink)', borderColor: 'var(--line)' },
    ghost: { background: 'transparent', color: 'var(--mute)' },
  };
  const h: CSSProperties = hover && !disabled
    ? v === 'default' ? { borderColor: 'var(--ink)' } : v === 'ghost' ? { color: 'var(--ink)' } : { filter: 'brightness(1.08)' }
    : {};
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ ...base, ...vs[v], ...h, ...style }}>{children}</button>
  );
}

export function IconButton({ children, onClick, title, active, style }: {
  children: ReactNode; onClick?: (e: React.MouseEvent) => void; title?: string; active?: boolean; style?: CSSProperties;
}) {
  return (
    <button type="button" title={title} onClick={onClick} className="hov-ink"
      style={{ width: 28, height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: 0,
        background: active ? 'var(--bg2)' : 'transparent', color: active ? 'var(--ink)' : 'var(--mute)', cursor: 'pointer', padding: 0, flexShrink: 0, ...style }}>
      {children}
    </button>
  );
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div className="eyebrow" style={style}>{children}</div>;
}

export function Badge({ children, tone = 'mute' }: { children: ReactNode; tone?: 'mute' | 'positive' | 'negative' | 'accent' | 'info' }) {
  const c = { mute: 'var(--mute)', positive: 'var(--positive)', negative: 'var(--negative)', accent: 'var(--accent)', info: 'var(--info)' }[tone];
  return <span style={{ font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: c, whiteSpace: 'nowrap' }}>{children}</span>;
}

export function Banner({ children, actions, tone = 'accent' }: { children: ReactNode; actions?: ReactNode; tone?: 'accent' | 'info' }) {
  const c = tone === 'accent' ? 'var(--accent)' : 'var(--info)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 16px', borderBottom: '1px solid var(--line)', background: tone === 'accent' ? 'var(--sel)' : 'rgba(79,143,247,.1)', borderLeft: `2px solid ${c}`, flexShrink: 0 }}>
      <span style={{ width: 8, height: 8, background: c, flexShrink: 0 }} />
      <div style={{ flex: 1, font: 'var(--type-small)', minWidth: 0 }}>{children}</div>
      {actions}
    </div>
  );
}

export function Input({ value, onChange, placeholder, mono, style, type = 'text', onKeyDown, autoFocus, onBlur }: {
  value: string | number; onChange: (v: string) => void; placeholder?: string; mono?: boolean; style?: CSSProperties; type?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; autoFocus?: boolean; onBlur?: () => void;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder} autoFocus={autoFocus} onKeyDown={onKeyDown} onBlur={onBlur}
      onChange={(e) => onChange(e.target.value)}
      style={{ padding: '6px 10px', background: 'var(--bg0)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 0, outline: 'none',
        font: mono ? 'var(--type-mono)' : 'var(--type-label)', minWidth: 0, ...style }} />
  );
}

export function Select<T extends string>({ value, options, onChange, width = 160, mono, style }: {
  value: T; options: readonly (T | { value: T; label: string })[]; onChange: (v: T) => void; width?: number | string; mono?: boolean; style?: CSSProperties;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as T)}
      style={{ width, padding: '5px 8px', background: 'var(--bg1)', color: 'var(--ink)', border: '1px solid var(--line)', borderRadius: 0,
        font: mono ? 'var(--type-mono)' : 'var(--type-label)', fontSize: 12, cursor: 'pointer', ...style }}>
      {options.map((o) => typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', font: 'var(--type-small)' }} onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
      <span style={{ width: 14, height: 14, border: `1px solid ${checked ? 'var(--accent)' : 'var(--line)'}`, background: checked ? 'var(--accent)' : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--on-accent)', fontSize: 10, fontWeight: 900 }}>{checked ? '✓' : ''}</span>
      {label}
    </label>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', font: 'var(--type-small)' }}>
      {label}
      <span onClick={() => onChange(!on)} style={{ width: 34, height: 18, background: on ? 'var(--accent)' : 'var(--bg3)', position: 'relative', display: 'inline-block', flexShrink: 0 }}>
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 14, height: 14, background: on ? 'var(--bg0)' : 'var(--mute)', transition: 'left var(--dur-fast) var(--ease)' }} />
      </span>
    </label>
  );
}

export function Slider({ label, value, min = 0, max = 100, step = 1, display, onChange }: {
  label?: ReactNode; value: number; min?: number; max?: number; step?: number; display?: ReactNode; onChange: (v: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pct = ((value - min) / (max - min)) * 100;
  const set = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const raw = min + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * (max - min);
    onChange(Math.round(raw / step) * step);
  };
  const down = (e: React.PointerEvent) => {
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <div style={{ font: 'var(--type-small)' }}>
      {label !== undefined && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>{label}</span><span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{display ?? value}</span>
        </div>
      )}
      <div ref={ref} onPointerDown={down} style={{ height: 4, background: 'var(--bg3)', marginTop: 8, marginBottom: 6, position: 'relative', cursor: 'pointer', touchAction: 'none' }}>
        <div style={{ height: 4, background: 'var(--accent)', width: pct + '%' }} />
        <div style={{ position: 'absolute', top: -5, left: pct + '%', width: 14, height: 14, marginLeft: -7, background: 'var(--ink)' }} />
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
      {options.map((o) => (
        <div key={o} onClick={() => onChange(o)} style={{ padding: '4px 8px', cursor: 'pointer', font: 'var(--type-small)', fontWeight: 700, fontSize: 11,
          color: o === value ? 'var(--ink)' : 'var(--mute)', boxShadow: o === value ? 'inset 0 -2px 0 var(--accent)' : 'none' }}>{o}</div>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map((o) => <Button key={o} size="sm" active={o === value} onClick={() => onChange(o)}>{o}</Button>)}
    </div>
  );
}

export function ToolButton({ label, shortcut, active, onClick, hasFlyout, title }: {
  label: ReactNode; shortcut?: string; active?: boolean; onClick?: (e: React.MouseEvent) => void; hasFlyout?: boolean; title?: string;
}) {
  return (
    <div onClick={onClick} title={title} className={active ? '' : 'tool-cell'}
      style={{ width: 36, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', flexShrink: 0,
        background: active ? 'var(--accent)' : 'transparent', color: active ? 'var(--on-accent)' : 'var(--mute)', font: '500 11px var(--font-mono)' }}>
      {label}
      {shortcut && <span style={{ display: 'none' }}>{shortcut}</span>}
      {hasFlyout && <span style={{ position: 'absolute', right: 3, bottom: 3, width: 0, height: 0, borderLeft: '3px solid transparent', borderBottom: `3px solid ${active ? 'var(--on-accent)' : 'var(--mute)'}` }} />}
    </div>
  );
}

export function Dialog({ title, subtitle, width = 720, height = 480, onClose, children, footer }: {
  title: ReactNode; subtitle?: ReactNode; width?: number | string; height?: number | string; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, [onClose]);
  return (
    <div onPointerDown={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <div onPointerDown={(e) => e.stopPropagation()}
        style={{ width, height, maxWidth: 'calc(100vw - 16px)', maxHeight: 'calc(100vh - 16px)', background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-modal)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
          <span style={{ width: 10, height: 10, background: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ font: 'var(--type-subtitle)', letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>{title}</span>
          {subtitle && <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} className="hov-ink" style={{ border: 0, background: 'transparent', color: 'var(--mute)', cursor: 'pointer', padding: '4px 8px' }}>✕</button>
        </div>
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>{children}</div>
        {footer && <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--line)', flexShrink: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

/** Left list column used by most dialogs (220–320px). */
export function DialogNav<T extends string>({ items, value, onChange, width = 220 }: {
  items: readonly (T | { value: T; label: ReactNode; hint?: ReactNode })[]; value: T; onChange: (v: T) => void; width?: number;
}) {
  return (
    <div style={{ width, borderRight: '1px solid var(--line)', padding: '10px 0', overflowY: 'auto', flexShrink: 0 }}>
      {items.map((it) => {
        const v = typeof it === 'string' ? it : it.value;
        const label = typeof it === 'string' ? it : it.label;
        const hint = typeof it === 'string' ? undefined : it.hint;
        const on = v === value;
        return (
          <div key={v} onClick={() => onChange(v)} className={on ? '' : 'hov-row'}
            style={{ padding: '8px 16px', cursor: 'pointer', font: 'var(--type-label)', fontSize: 12, background: on ? 'var(--bg0)' : 'transparent', color: on ? 'var(--ink)' : 'var(--mute)', boxShadow: on ? 'inset 2px 0 0 var(--accent)' : 'none', display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span>{label}</span>{hint && <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{hint}</span>}
          </div>
        );
      })}
    </div>
  );
}

export function FormRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '6px 0', font: 'var(--type-small)' }}>
      <span style={{ color: 'var(--mute)' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
    </div>
  );
}

export function MenuItem({ label, shortcut, hasSubmenu, disabled, onClick, onMouseEnter, active, checked }: {
  label: ReactNode; shortcut?: string; hasSubmenu?: boolean; disabled?: boolean; onClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void; active?: boolean; checked?: boolean;
}) {
  return (
    <div onClick={disabled ? undefined : onClick} onMouseEnter={onMouseEnter} className={disabled ? '' : 'hov-row'}
      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, padding: '5px 14px', cursor: disabled ? 'default' : 'pointer',
        font: 'var(--type-small)', color: disabled ? 'var(--mute)' : 'var(--ink)', background: active ? 'var(--bg2)' : 'transparent', whiteSpace: 'nowrap' }}>
      <span>{checked && <span style={{ color: 'var(--accent)', marginRight: 6 }}>✓</span>}{label}</span>
      <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{hasSubmenu ? '▸' : shortcut}</span>
    </div>
  );
}

/** Small mono key-cap. */
export function Kbd({ children }: { children: ReactNode }) {
  return <span style={{ border: '1px solid var(--line)', padding: '0 4px', font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{children}</span>;
}

/** Module mark square (Px, Cl, Dk, Wr, Pp). */
export function Mark({ children, size = 18, inverted }: { children: ReactNode; size?: number; inverted?: boolean }) {
  return (
    <span style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--line)', flexShrink: 0,
      font: `500 ${Math.round(size / 2)}px var(--font-mono)`, background: inverted ? 'var(--ink)' : 'transparent', color: inverted ? 'var(--bg0)' : 'var(--mute)' }}>{children}</span>
  );
}

/** Usage bar used for storage providers. */
export function UsageBar({ used, total }: { used: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (used / total) * 100) : 0;
  return <div style={{ height: 3, background: 'var(--bg3)', marginTop: 8 }}><div style={{ height: 3, width: pct + '%', background: 'var(--accent)' }} /></div>;
}
