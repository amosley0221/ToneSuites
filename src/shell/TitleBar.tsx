import { useEffect, useState } from 'react';
import { runCommand, displayShortcut } from '@/core/commands';
import { closeDocument } from '@/core/documents';
import { isTauri, osType, windowAction } from '@/core/platform';
import { useSettings } from '@/core/settings';
import { useApp } from '@/core/store';
import { useUpdates } from '@/core/updater';
import { MODULE_META } from '@/modules/meta';
import { Kbd, Mark } from '@/ui';

export function TitleBar({ compact }: { compact: boolean }) {
  const docs = useApp((s) => s.docs);
  const activeId = useApp((s) => s.activeId);
  const setActive = useApp((s) => s.setActive);
  const moveDoc = useApp((s) => s.moveDoc);
  const theme = useSettings((s) => s.s.theme);
  const update = useUpdates((u) => u.available);
  const [os, setOs] = useState<string>('web');
  const [drag, setDrag] = useState<number | null>(null);
  useEffect(() => { void osType().then(setOs); }, []);
  // macOS uses the native window frame (rounded corners, red/yellow/green buttons overlaid at top left — see
  // src-tauri/tauri.macos.conf.json); Windows/Linux get Tone's own minimise/maximise/close buttons.
  const isMac = isTauri && os === 'macos';
  const desktopChrome = isTauri && os !== 'android' && os !== 'ios' && !isMac;

  const tab = (id: string, mark: string, title: string, dirty = false, idx = -1) => {
    const on = id === activeId;
    return (
      <div key={id} onClick={() => setActive(id)}
        onAuxClick={(e) => { if (e.button === 1 && id !== 'home') void closeDocument(id); }}
        draggable={idx >= 0}
        onDragStart={() => setDrag(idx)}
        onDragOver={(e) => { e.preventDefault(); }}
        onDrop={() => { if (drag != null && idx >= 0 && drag !== idx) moveDoc(drag, idx); setDrag(null); }}
        className="tab"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 14px', cursor: 'pointer', flexShrink: 0,
          background: on ? 'var(--bg1)' : 'transparent', borderRight: '1px solid var(--line)', boxShadow: on ? 'inset 0 2px 0 var(--accent)' : 'none',
          color: on ? 'var(--ink)' : 'var(--mute)', fontWeight: 600, whiteSpace: 'nowrap', position: 'relative' }}>
        <Mark inverted={on}>{mark}</Mark>
        <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        {dirty && <span title="Unsaved changes" style={{ width: 6, height: 6, background: 'var(--accent)' }} />}
        {id !== 'home' && (
          <span className="tab-x hov-ink" title="Close (Ctrl W)" onClick={(e) => { e.stopPropagation(); void closeDocument(id); }}
            style={{ color: 'var(--mute)', fontSize: 11, marginLeft: 2, opacity: on ? 1 : 0.6 }}>✕</span>
        )}
      </div>
    );
  };

  return (
    <div data-tauri-drag-region style={{ height: 'var(--h-titlebar)', display: 'flex', alignItems: 'stretch', background: 'var(--bg0)', borderBottom: '1px solid var(--line)', flexShrink: 0 }}>
      {/* Room for the macOS window buttons (and somewhere to drag the window from). */}
      {isMac && <div data-tauri-drag-region style={{ width: 76, flexShrink: 0 }} />}
      <div onClick={() => setActive('home')} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: isMac ? '0 16px 0 4px' : '0 16px', cursor: 'pointer', flexShrink: 0 }}>
        <div style={{ width: 14, height: 14, background: 'var(--accent)' }} />
        {!compact && <div style={{ font: 'var(--type-wordmark)', letterSpacing: 'var(--ls-wordmark)' }}>TONE</div>}
      </div>
      <div data-tauri-drag-region style={{ display: 'flex', alignItems: 'stretch', flex: 1, overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}>
        {tab('home', '⌂', 'Home')}
        {docs.map((d, i) => tab(d.id, MODULE_META[d.mode].mark, d.title, d.dirty, i))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', flexShrink: 0 }}>
        {update && (
          <div onClick={() => void runCommand('app.showUpdate')} title={`Tone Suites ${update.version} is available — see what's new`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer', font: 'var(--type-mono)', fontWeight: 500, whiteSpace: 'nowrap' }}>
            ↑{compact ? '' : ` Update ${update.version}`}
          </div>
        )}
        <div onClick={() => void runCommand('app.palette')} className="hov-ink hov-border"
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', border: '1px solid var(--line)', color: 'var(--mute)', cursor: 'pointer', font: 'var(--type-mono)' }}>
          {compact ? '⌕' : <>Search or command <Kbd>{displayShortcut('Ctrl K')}</Kbd></>}
        </div>
        <div onClick={() => void runCommand('app.theme')} className="hov-ink" title="Toggle theme"
          style={{ padding: '6px 8px', cursor: 'pointer', color: 'var(--mute)', font: 'var(--type-mono)' }}>
          ◐{!compact && (theme === 'dark' ? ' Dark' : ' Light')}
        </div>
        <div onClick={() => void runCommand(update ? 'app.settings.updates' : 'app.settings')} className="hov-ink" title={update ? 'Settings — update available' : 'Settings'}
          style={{ padding: '6px 8px', cursor: 'pointer', color: 'var(--mute)', position: 'relative' }}>
          ⚙{update && <span style={{ position: 'absolute', top: 5, right: 4, width: 6, height: 6, background: 'var(--accent)' }} />}
        </div>
      </div>
      {desktopChrome && (
        <div style={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
          <WinBtn onClick={() => void windowAction('minimize')}>—</WinBtn>
          <WinBtn onClick={() => void windowAction('maximize')}>□</WinBtn>
          <WinBtn close onClick={() => void windowAction('close')}>✕</WinBtn>
        </div>
      )}
    </div>
  );
}

function WinBtn({ children, onClick, close }: { children: string; onClick: () => void; close?: boolean }) {
  const [h, setH] = useState(false);
  return (
    <div onClick={onClick} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: h && close ? '#fff' : 'var(--mute)', background: h ? (close ? '#e5484d' : 'var(--bg2)') : 'transparent', fontSize: 11 }}>
      {children}
    </div>
  );
}
