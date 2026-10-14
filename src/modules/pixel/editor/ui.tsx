// Small Pixel-specific UI atoms built on the design tokens.
import React, { CSSProperties, ReactNode, useEffect, useRef, useState } from 'react';

/** Bordered chip button used throughout the prototype (6/12 padding, 1px line). */
export function Chip({ children, onClick, active, title, style, disabled, mono }: {
  children: ReactNode; onClick?: (e: React.MouseEvent) => void; active?: boolean; title?: string; style?: CSSProperties; disabled?: boolean; mono?: boolean;
}) {
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick} className={disabled || active ? '' : 'hov-border'}
      style={{
        padding: '5px 8px', border: '1px solid var(--line)', background: active ? 'var(--ink)' : 'transparent', color: active ? 'var(--bg0)' : disabled ? 'var(--mute)' : 'var(--ink)',
        font: mono ? 'var(--type-mono)' : 'var(--type-small)', fontSize: mono ? 11 : 12, fontWeight: active ? 700 : 500, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
        borderRadius: 0, whiteSpace: 'nowrap', transition: 'border-color var(--dur-fast)', ...style,
      }}>{children}</button>
  );
}

/** Numeric field: label + editable mono value; commits on Enter/blur; drag-scrub on the label. */
export function NumField({ label, value, onChange, min = -Infinity, max = Infinity, step = 1, unit, width = 56, style, title }: {
  label?: ReactNode; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; unit?: string; width?: number; style?: CSSProperties; title?: string;
}) {
  const [text, setText] = useState(fmt(value, step));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(fmt(value, step)); }, [value, step]);
  const commit = () => {
    const v = parseFloat(text);
    if (Number.isFinite(v)) onChange(clampN(v, min, max));
    else setText(fmt(value, step));
  };
  const scrub = (e: React.PointerEvent) => {
    const x0 = e.clientX, v0 = value;
    const mv = (ev: PointerEvent) => onChange(clampN(Math.round((v0 + ((ev.clientX - x0) / 2) * step) / step) * step, min, max));
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  return (
    <label title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--mute)', font: 'var(--type-small)', flexShrink: 0, ...style }}>
      {label !== undefined && <span onPointerDown={scrub} style={{ cursor: 'ew-resize' }}>{label}</span>}
      <span style={{ display: 'inline-flex', alignItems: 'center', border: '1px solid var(--line)', padding: '3px 8px', color: 'var(--ink)', font: 'var(--type-mono)', minWidth: width }}>
        <input value={text} onChange={(e) => setText(e.target.value)} onFocus={(e) => { focused.current = true; e.target.select(); }}
          onBlur={() => { focused.current = false; commit(); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); onChange(clampN(value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1), min, max)); }
          }}
          style={{ width: Math.max(24, width - (unit ? 22 : 8)), background: 'transparent', border: 0, outline: 0, color: 'inherit', font: 'inherit', padding: 0 }} />
        {unit && <span style={{ color: 'var(--mute)', marginLeft: 2 }}>{unit}</span>}
      </span>
    </label>
  );
}

const fmt = (v: number, step: number) => (step < 1 ? String(Math.round(v * 100) / 100) : String(Math.round(v)));
const clampN = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Color swatch that opens the native color picker. */
export function ColorSwatch({ value, onChange, size = 22, title }: { value: string; onChange: (hex: string) => void; size?: number; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span title={title} onClick={() => ref.current?.click()} style={{ width: size, height: size, background: value, border: '1px solid var(--line)', display: 'inline-block', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
      <input ref={ref} type="color" value={toHex6(value)} onChange={(e) => onChange(e.target.value.toUpperCase())}
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, border: 0, padding: 0, pointerEvents: 'none' }} />
    </span>
  );
}

export function toHex6(c: string) {
  const h = c.replace('#', '');
  return '#' + (h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6)).toLowerCase();
}

/** Mono eyebrow section label as used in the inspector. */
export function Label({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div style={{ font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--mute)' }}>{children}</div>
      {right}
    </div>
  );
}

/** Checkbox styled like the prototype (14px square, accent when on). */
export function Check({ on, onChange, label, disabled, title }: { on: boolean; onChange?: (v: boolean) => void; label: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <span title={title} onClick={() => !disabled && onChange?.(!on)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: disabled ? 'var(--mute)' : 'var(--ink)', font: 'var(--type-small)', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      <span style={{ width: 14, height: 14, flexShrink: 0, background: on ? 'var(--accent)' : 'transparent', border: on ? '1px solid var(--accent)' : '1px solid var(--line)' }} />
      {label}
    </span>
  );
}

export function Planned({ children = 'planned' }: { children?: ReactNode }) {
  return <span style={{ font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--mute)', border: '1px solid var(--line)', padding: '0 4px' }}>{children}</span>;
}

/** Draws any canvas scaled into a small preview box. */
export function CanvasThumb({ source, width, height, version, checker = true, style }: {
  source: HTMLCanvasElement | null | (() => HTMLCanvasElement | null); width: number; height: number; version?: unknown; checker?: boolean; style?: CSSProperties;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    const x = c.getContext('2d')!;
    x.clearRect(0, 0, c.width, c.height);
    const src = typeof source === 'function' ? source() : source;
    if (!src) return;
    const k = Math.min(c.width / src.width, c.height / src.height);
    const w = src.width * k, h = src.height * k;
    x.imageSmoothingQuality = 'high';
    x.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
  }, [source, width, height, version]);
  return (
    <canvas ref={ref} style={{
      width, height, display: 'block', flexShrink: 0, border: '1px solid var(--line)',
      backgroundColor: checker ? 'var(--check2)' : 'var(--bg0)',
      backgroundImage: checker ? 'linear-gradient(45deg,var(--check) 25%,transparent 25%,transparent 75%,var(--check) 75%),linear-gradient(45deg,var(--check) 25%,transparent 25%,transparent 75%,var(--check) 75%)' : undefined,
      backgroundSize: '8px 8px', backgroundPosition: '0 0,4px 4px', ...style,
    }} />
  );
}

/** Dropdown menu anchored under a trigger. */
export function DropMenu({ label, items, style, align = 'left' }: {
  label: ReactNode; items: { label: ReactNode; onClick: () => void; disabled?: boolean; hint?: ReactNode }[]; style?: CSSProperties; align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div ref={ref} style={{ position: 'relative', flexShrink: 0 }}>
      <Chip onClick={() => setOpen(!open)} style={style}>{label}</Chip>
      {open && (
        <div style={{ position: 'absolute', top: '100%', [align]: 0, marginTop: 2, minWidth: 200, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', padding: '4px 0', zIndex: 50 }}>
          {items.map((it, i) => (
            <div key={i} className={it.disabled ? '' : 'hov-row'} onClick={() => { if (it.disabled) return; setOpen(false); it.onClick(); }}
              style={{ padding: '6px 14px', font: 'var(--type-small)', color: it.disabled ? 'var(--mute)' : 'var(--ink)', cursor: it.disabled ? 'default' : 'pointer', display: 'flex', justifyContent: 'space-between', gap: 12, whiteSpace: 'nowrap' }}>
              <span>{it.label}</span>{it.hint && <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{it.hint}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
