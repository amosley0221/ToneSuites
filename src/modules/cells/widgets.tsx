// Small UI pieces shared by the Cells editor and dialogs.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Stop Ctrl/Cmd text-editing shortcuts from reaching the app-level shortcut handler. */
export function stopEditKeys(e: React.KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x', 'z', 'y'].includes(e.key.toLowerCase())) e.stopPropagation();
}

/** Mono uppercase section label used in dialogs (FIELDS, ROWS, TYPE, …). */
export function Label({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', textTransform: 'uppercase', color: 'var(--mute)', ...style }}>{children}</div>;
}

/** Toolbar button matching the Cells format bar (5px 9px, 1px line border). */
export function TB({ children, onClick, active, title, style, disabled }: {
  children: ReactNode; onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void; active?: boolean; title?: string; style?: CSSProperties; disabled?: boolean;
}) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled} className={active ? '' : 'hov-border'}
      onPointerDown={(e) => e.preventDefault()}
      style={{
        padding: '5px 9px', border: '1px solid ' + (active ? 'var(--ink)' : 'var(--line)'), background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--bg0)' : 'var(--ink)', font: 'var(--type-label)', fontSize: 12, lineHeight: 1.3, cursor: disabled ? 'default' : 'pointer',
        whiteSpace: 'nowrap', flexShrink: 0, opacity: disabled ? 0.4 : 1, transition: 'border-color var(--dur-fast), background var(--dur-fast)', borderRadius: 0, ...style,
      }}>{children}</button>
  );
}

/** Fixed-position popover anchored under an element; closes on outside press / Esc. */
export function Popover({ anchor, onClose, children, width = 220 }: { anchor: HTMLElement; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - width - 8)), top: r.bottom + 2 });
  }, [anchor, width]);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [anchor, onClose]);
  return (
    <div ref={ref} onPointerDown={(e) => { if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault(); }}
      style={{ position: 'fixed', ...pos, width, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 70, padding: '4px 0', font: 'var(--type-small)' }}>
      {children}
    </div>
  );
}

export function PopItem({ children, onClick, active, right }: { children: ReactNode; onClick: () => void; active?: boolean; right?: ReactNode }) {
  return (
    <div onClick={onClick} className="hov-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 14px', cursor: 'pointer', alignItems: 'center' }}>
      <span>{active && <span style={{ color: 'var(--accent)', marginRight: 6 }}>✓</span>}{children}</span>
      {right && <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{right}</span>}
    </div>
  );
}

/** Static palette for fills / text colours (feature data, not document data). */
export const PALETTE = [
  '#ffffff', '#f2f1ee', '#d6d4cd', '#8d8d96', '#2b2b32', '#0c0c0e',
  '#ffe1d6', '#ffb59a', '#ff5a1f', '#c2410c', '#e5484d', '#7f1d1d',
  '#fff3c4', '#f5c542', '#e8ff47', '#d9f99d', '#2fb98a', '#14532d',
  '#dbeafe', '#93c5fd', '#4f8ff7', '#1e3a8a', '#e9d5ff', '#b58cff',
];

export function Swatches({ value, onPick, allowNone = true, noneLabel = 'None' }: { value?: string; onPick: (c: string | undefined) => void; allowNone?: boolean; noneLabel?: string }) {
  return (
    <div style={{ padding: '6px 10px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 22px)', gap: 4 }}>
        {PALETTE.map((c) => (
          <div key={c} title={c} onClick={() => onPick(c)}
            style={{ width: 22, height: 22, background: c, cursor: 'pointer', border: '1px solid ' + (value === c ? 'var(--accent)' : 'var(--line)'), boxShadow: value === c ? 'inset 0 0 0 1px var(--bg0)' : 'none' }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
        {allowNone && <button type="button" onClick={() => onPick(undefined)} className="hov-border" style={{ padding: '3px 8px', border: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', fontSize: 11 }}>{noneLabel}</button>}
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--mute)', cursor: 'pointer' }}>
          Custom
          <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#ff5a1f'} onChange={(e) => onPick(e.target.value)}
            style={{ width: 26, height: 20, padding: 0, border: '1px solid var(--line)', background: 'transparent', cursor: 'pointer' }} />
        </label>
      </div>
    </div>
  );
}

/** A colour well that opens a swatch popover. */
export function ColorWell({ value, onChange, title }: { value?: string; onChange: (c: string | undefined) => void; title?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <div ref={ref} title={title} onClick={() => setOpen((o) => !o)}
        style={{ width: 28, height: 28, border: '1px solid var(--line)', background: value ?? 'transparent', cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
        {!value && <span style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, transparent 46%, var(--mute) 46%, var(--mute) 54%, transparent 54%)' }} />}
      </div>
      {open && ref.current && <Popover anchor={ref.current} onClose={() => setOpen(false)} width={180}><Swatches value={value} onPick={(c) => { onChange(c); setOpen(false); }} /></Popover>}
    </>
  );
}

/** Square check used in dialogs (filled accent when on). */
export function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <div onClick={() => onChange(!on)} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: 'var(--mute)', font: 'var(--type-small)', userSelect: 'none' }}>
      <div style={{ width: 14, height: 14, background: on ? 'var(--accent)' : 'transparent', border: on ? '0' : '1px solid var(--line)', flexShrink: 0 }} />
      {children}
    </div>
  );
}

export const monoInput: CSSProperties = {
  padding: '7px 10px', border: '1px solid var(--line)', background: 'var(--bg0)', color: 'var(--ink)', font: 'var(--type-mono)', outline: 'none', width: '100%', minWidth: 0,
};
