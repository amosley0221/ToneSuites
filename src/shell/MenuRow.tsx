import { useEffect, useRef, useState, type ReactNode } from 'react';
import { displayShortcut, runCommand } from '@/core/commands';
import type { MenuDef, MenuEntry } from '@/core/types';

function MenuList({ entries, onDone, style }: { entries: MenuEntry[]; onDone: () => void; style?: React.CSSProperties }) {
  const [sub, setSub] = useState<number | null>(null);
  return (
    <div style={{ position: 'absolute', minWidth: 260, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', padding: '4px 0', zIndex: 60, maxHeight: 'calc(100vh - 90px)', overflowY: 'auto', ...style }}>
      {entries.map((e, i) => {
        if (e === '-') return <div key={i} style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />;
        const planned = e.status === 'planned';
        return (
          <div key={e.id + i} style={{ position: 'relative' }} onMouseEnter={() => setSub(e.children ? i : null)}>
            <div onClick={(ev) => { ev.stopPropagation(); if (e.children) { setSub(i); return; } onDone(); void runCommand(e.id); }}
              className="hov-row"
              title={planned ? 'On the roadmap — not available yet' : undefined}
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 18, padding: '5px 14px', cursor: 'pointer', font: 'var(--type-small)',
                color: planned ? 'var(--mute)' : 'var(--ink)', background: sub === i ? 'var(--bg2)' : 'transparent', whiteSpace: 'nowrap' }}>
              <span>{e.label}</span>
              <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{e.children ? '▸' : displayShortcut(e.shortcut)}</span>
            </div>
            {e.children && sub === i && <MenuList entries={e.children} onDone={onDone} style={{ left: '100%', top: -5, minWidth: 240 }} />}
          </div>
        );
      })}
    </div>
  );
}

export function MenuRow({ menus, right }: { menus: MenuDef[]; right?: ReactNode }) {
  const [open, setOpen] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open == null) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menurow" ref={ref}>
      {menus.map((m, i) => (
        <div key={m.name} style={{ position: 'relative', display: 'flex' }}
          onMouseEnter={() => { if (open != null) setOpen(i); }}>
          <div onClick={() => setOpen(open === i ? null : i)} className="hov-ink"
            style={{ display: 'flex', alignItems: 'center', padding: '0 10px', cursor: 'pointer', font: 'var(--type-small)', fontWeight: 500,
              color: open === i ? 'var(--ink)' : 'var(--mute)', background: open === i ? 'var(--bg2)' : 'transparent' }}>
            {m.name}
          </div>
          {open === i && <MenuList entries={m.items} onDone={() => setOpen(null)} style={{ top: '100%', left: 0 }} />}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}
