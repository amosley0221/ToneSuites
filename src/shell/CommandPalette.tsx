import { useEffect, useMemo, useRef, useState } from 'react';
import { displayShortcut, flattenMenus, runCommand } from '@/core/commands';
import { openRecent } from '@/core/documents';
import { useSettings } from '@/core/settings';
import { activeDoc, useApp } from '@/core/store';
import type { Mode, ModuleDef } from '@/core/types';
import { loadModule, MODULE_META } from '@/modules/meta';

interface Row { icon: string; label: string; detail?: string; shortcut?: string; run: () => void; muted?: boolean }

export function CommandPalette() {
  const close = () => useApp.getState().setPalette(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [mod, setMod] = useState<ModuleDef | null>(null);
  const docs = useApp((s) => s.docs);
  const recents = useSettings((s) => s.s.recents);
  const inputRef = useRef<HTMLInputElement>(null);
  const doc = activeDoc();
  useEffect(() => { if (doc) void loadModule(doc.mode).then(setMod); }, [doc?.mode]);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const rows = useMemo<Row[]>(() => {
    const cmd = (id: string) => () => { close(); void runCommand(id); };
    const base: Row[] = [
      ...(Object.keys(MODULE_META) as Mode[]).map((m) => ({ icon: '+', label: `New ${MODULE_META[m].name} document`, run: cmd(`new.${m}`) })),
      { icon: '↗', label: 'Open file…', shortcut: 'Ctrl O', run: cmd('file.open') },
      { icon: '↗', label: 'Open from NAS / Google Drive…', run: cmd('file.openFromProvider') },
      { icon: '▤', label: 'Browse folder as workspace…', run: cmd('file.openFolder') },
      ...(doc ? [
        { icon: '↓', label: 'Save', shortcut: 'Ctrl S', run: cmd('file.save') },
        { icon: '⇄', label: 'Convert / export current document…', shortcut: 'Ctrl Shift E', run: cmd('file.export') },
      ] : []),
      { icon: '◐', label: 'Toggle theme', run: cmd('app.theme') },
      { icon: '⚙', label: 'Settings', shortcut: 'Ctrl ,', run: cmd('app.settings') },
      { icon: '⇅', label: 'Sync status & conflicts', run: cmd('app.sync') },
      { icon: '★', label: "What's new", run: cmd('app.whatsNew') },
      { icon: '↻', label: 'Check for updates…', run: cmd('app.checkUpdates') },
      { icon: '⌂', label: 'Go to Home', run: cmd('app.home') },
    ];
    const tabs: Row[] = docs.map((d) => ({ icon: MODULE_META[d.mode].mark, label: d.title, detail: 'Open tab', run: () => { useApp.getState().setActive(d.id); } }));
    const files: Row[] = recents.map((r) => ({ icon: MODULE_META[r.mode].mark, label: r.title, detail: 'Recent file', run: () => { close(); void openRecent(r); } }));
    const menu: Row[] = mod ? flattenMenus(mod.menus).filter((i) => !i.id.startsWith('file.') && !i.id.startsWith('app.')).map((i) => ({
      icon: '›', label: i.label.replace(/…$/, ''), detail: i.path, shortcut: i.shortcut, muted: i.status === 'planned', run: cmd(i.id),
    })) : [];
    return [...base, ...tabs, ...menu, ...files];
  }, [docs, recents, mod, doc?.id]);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows.slice(0, 60);
    const words = t.split(/\s+/);
    return rows.filter((r) => { const hay = `${r.label} ${r.detail ?? ''}`.toLowerCase(); return words.every((w) => hay.includes(w)); }).slice(0, 80);
  }, [q, rows]);
  useEffect(() => setSel(0), [q]);

  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run(); close(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  };

  return (
    <div onPointerDown={close} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 90 }}>
      <div onPointerDown={(e) => e.stopPropagation()}
        style={{ position: 'absolute', top: 'calc(120px + var(--safe-top))', left: '50%', transform: 'translateX(-50%)', width: 620, maxWidth: 'calc(100vw - 16px)', background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-modal)' }}>
        <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Type a command or file name…"
          style={{ width: '100%', padding: '14px 16px', background: 'transparent', border: 0, borderBottom: '1px solid var(--line)', outline: 'none', font: '600 16px var(--font-ui)', color: 'var(--ink)' }} />
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {filtered.map((r, i) => (
            <div key={i} onClick={() => { r.run(); close(); }} onMouseEnter={() => setSel(i)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', cursor: 'pointer', background: i === sel ? 'var(--sel)' : 'transparent', boxShadow: i === sel ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
              <span style={{ width: 18, textAlign: 'center', font: 'var(--type-mono)', color: 'var(--mute)' }}>{r.icon}</span>
              <span style={{ fontWeight: 600, color: r.muted ? 'var(--mute)' : 'var(--ink)' }}>{r.label}</span>
              {r.detail && <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.detail}</span>}
              <span style={{ flex: 1 }} />
              {r.shortcut && <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{displayShortcut(r.shortcut)}</span>}
            </div>
          ))}
          {!filtered.length && <div className="empty-hint" style={{ padding: 16 }}>No matching commands or files.</div>}
        </div>
      </div>
    </div>
  );
}
