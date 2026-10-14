// Small UI pieces used across the Deck editor.
import React, { ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button, MenuItem } from '@/ui';
import type { DeckDoc } from './doc';

/** Re-render when the DeckDoc emits. */
export function useDeck(doc: DeckDoc): number {
  return useSyncExternalStore((cb) => doc.subscribe(cb), () => doc.version);
}

/** Track an element's size. */
export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const n = ref.current;
    if (!n) return;
    const ro = new ResizeObserver(() => setSize({ w: n.clientWidth, h: n.clientHeight }));
    ro.observe(n);
    setSize({ w: n.clientWidth, h: n.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export interface PopItem { label: ReactNode; onClick: () => void; checked?: boolean; hint?: string; disabled?: boolean }

/** Floating menu anchored at a point; closes on outside pointer-down or Escape. */
export function PopMenu({ x, y, items, onClose, width = 200 }: { x: number; y: number; items: (PopItem | '-')[]; onClose: () => void; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key, true); };
  }, [onClose]);
  const left = Math.min(x, window.innerWidth - width - 8);
  return (
    <div ref={ref} style={{ position: 'fixed', left, top: y, width, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 200, padding: '4px 0' }}>
      {items.map((it, i) => it === '-'
        ? <div key={i} style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        : <MenuItem key={i} label={it.label} shortcut={it.hint} checked={it.checked} disabled={it.disabled} onClick={() => { onClose(); it.onClick(); }} />)}
    </div>
  );
}

/** Toolbar button with a ▾ dropdown. */
export function DropButton({ label, items, title, width }: { label: ReactNode; items: () => (PopItem | '-')[]; title?: string; width?: number }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <Button title={title} active={!!at} onClick={(e) => {
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setAt(at ? null : { x: r.left, y: r.bottom + 2 });
      }}>{label} <span style={{ fontSize: 9 }}>▾</span></Button>
      {at && <PopMenu x={at.x} y={at.y} items={items()} onClose={() => setAt(null)} width={width} />}
    </>
  );
}

/** Numeric field in the inspector style (mono, label prefix). */
export function NumField({ label, value, onChange, step = 1, min, width = 60 }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; width?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft);
    if (!Number.isNaN(v)) onChange(min !== undefined ? Math.max(min, v) : v);
    setDraft(null);
  };
  return (
    <label className="field" style={{ width, padding: '4px 6px' }}>
      <span style={{ color: 'var(--mute)', flexShrink: 0 }}>{label}</span>
      <input value={draft ?? String(Math.round(value * 100) / 100)} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = (min !== undefined ? Math.max(min, value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1)) : value + (e.key === 'ArrowUp' ? step : -step) * (e.shiftKey ? 10 : 1));
            onChange(Math.round(v * 100) / 100);
          }
        }} />
    </label>
  );
}

/** Color swatch input (native picker). */
export function ColorField({ value, onChange, title, allowNone }: { value: string; onChange: (v: string) => void; title?: string; allowNone?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <label title={title} style={{ width: 22, height: 22, border: '1px solid var(--line)', position: 'relative', cursor: 'pointer', flexShrink: 0,
        background: value || 'repeating-linear-gradient(135deg,var(--bg3) 0 3px,transparent 3px 6px)' }}>
        <input type="color" value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => onChange(e.target.value)}
          style={{ opacity: 0, position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: 'pointer', border: 0, padding: 0 }} />
      </label>
      {allowNone && value && <span className="hov-ink" title="None" onClick={() => onChange('')} style={{ cursor: 'pointer', color: 'var(--mute)', fontSize: 11 }}>✕</span>}
    </span>
  );
}

export const isMod = (e: { ctrlKey: boolean; metaKey: boolean }) => e.ctrlKey || e.metaKey;
