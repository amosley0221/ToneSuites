// Searchable font menu shared by all modules: each family is previewed in its own face.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { addFonts, BUNDLED_FONTS, cssFontFamily, useFonts } from '@/core/fonts';

const MAX_ROWS = 400; // keep the menu light on devices with thousands of families (type to narrow)

export function FontPicker({ value, onChange, width = 160, placeholder = 'Font', allowEmpty, emptyLabel = 'Default', style, className }: {
  value: string;
  onChange: (family: string) => void;
  width?: number | string;
  placeholder?: string;
  /** Offer an empty choice (e.g. "Theme" font in Deck). */
  allowEmpty?: boolean;
  emptyLabel?: string;
  style?: CSSProperties;
  className?: string;
}) {
  const fonts = useFonts();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean }>({ left: 0, top: 0, up: false });
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const t = q.trim().toLowerCase();
    const match = (f: string) => !t || f.toLowerCase().includes(t);
    const custom = fonts.custom.map((c) => c.family).filter(match);
    const bundled = BUNDLED_FONTS.filter((f) => match(f) && !custom.includes(f));
    const taken = new Set([...custom, ...bundled].map((f) => f.toLowerCase()));
    const system = fonts.system.filter((f) => match(f) && !taken.has(f.toLowerCase()));
    return { custom, bundled, system: system.slice(0, MAX_ROWS), more: Math.max(0, system.length - MAX_ROWS) };
  }, [q, fonts]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', esc, true);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', esc, true); };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btn.current!.getBoundingClientRect();
    const up = r.bottom + 360 > window.innerHeight && r.top > 360;
    setPos({ left: Math.max(4, Math.min(r.left, window.innerWidth - 284)), top: up ? r.top - 4 : r.bottom + 4, up });
    setQ('');
    setOpen(true);
  };
  const pick = (f: string) => { onChange(f); setOpen(false); };

  const row = (f: string) => (
    <div key={f} onClick={() => pick(f)} className="hov-row" title={f}
      style={{ padding: '6px 12px', cursor: 'pointer', fontFamily: cssFontFamily(f), fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        background: f === value ? 'var(--sel)' : 'transparent', boxShadow: f === value ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
      {f}
    </div>
  );
  const head = (t: string) => <div className="eyebrow" style={{ padding: '8px 12px 4px' }}>{t}</div>;

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} title="Font" className={className}
        style={{ width, display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, padding: '5px 8px', background: 'var(--bg1)', color: 'var(--ink)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--line)'}`, borderRadius: 0, cursor: 'pointer', fontSize: 12, flexShrink: 0, ...style }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: value ? cssFontFamily(value) : undefined }}>{value || (allowEmpty ? emptyLabel : placeholder)}</span>
        <span style={{ color: 'var(--mute)', fontSize: 9 }}>▾</span>
      </button>
      {/* Portal: a transformed ancestor (e.g. the phone bottom sheet) would otherwise clip a fixed menu. */}
      {open && createPortal(
        <div ref={menu} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: pos.left, top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, width: 280, maxHeight: 360,
            display: 'flex', flexDirection: 'column', background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 300 }}>
          <div style={{ padding: 8, borderBottom: '1px solid var(--line)' }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search fonts…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const first = sections.custom[0] ?? sections.bundled[0] ?? sections.system[0];
                  if (first) pick(first);
                }
              }}
              style={{ width: '100%', padding: '5px 8px', background: 'var(--bg0)', border: '1px solid var(--line)', color: 'var(--ink)', font: 'var(--type-mono)', outline: 'none' }} />
          </div>
          <div style={{ overflowY: 'auto', flex: 1 }}>
            {allowEmpty && !q && <div onClick={() => pick('')} className="hov-row" style={{ padding: '6px 12px', cursor: 'pointer', color: 'var(--mute)', background: !value ? 'var(--sel)' : 'transparent' }}>{emptyLabel}</div>}
            {sections.custom.length > 0 && <>{head('Your fonts')}{sections.custom.map(row)}</>}
            {sections.bundled.length > 0 && <>{head('Tone')}{sections.bundled.map(row)}</>}
            {sections.system.length > 0 && <>{head('On this device')}{sections.system.map(row)}</>}
            {sections.more > 0 && <div className="empty-hint" style={{ padding: '6px 12px' }}>{sections.more.toLocaleString()} more — type to search</div>}
            {!sections.custom.length && !sections.bundled.length && !sections.system.length && <div className="empty-hint" style={{ padding: '8px 12px' }}>No fonts match "{q}".</div>}
            {!fonts.loaded && <div className="empty-hint" style={{ padding: '6px 12px' }}>Loading installed fonts…</div>}
          </div>
          <div onClick={() => { setOpen(false); void addFonts().then((fams) => { if (fams[0]) onChange(fams[0]); }); }} className="hov-row"
            style={{ padding: '8px 12px', cursor: 'pointer', borderTop: '1px solid var(--line)', fontWeight: 700, fontSize: 12 }}>
            + Add fonts…
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
