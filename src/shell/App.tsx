import { useEffect, useState } from 'react';
import { coreHandlers, keyEvent, registerGlobal, runCommand, shortcutMap } from '@/core/commands';
import { openRecent } from '@/core/documents';
import { appVersion, isTauri } from '@/core/platform';
import { applyTheme, useSettings } from '@/core/settings';
import { activeDoc, useApp } from '@/core/store';
import { setSystemBarTheme, startInsets } from '@/core/insets';
import { checkForUpdate } from '@/core/updater';
import { UPDATE_CHECK_HOURS } from '@/config';
import { startSyncLoop } from '@/storage/sync';
import { CommandPalette } from './CommandPalette';
import { ConvertDialog } from './ConvertDialog';
import { About, FileInfo, NewPicker, ProviderBrowser, RecentDialog, UpdateDialog, WhatsNew } from './Dialogs';
import { DocView } from './DocView';
import { Home } from './Home';
import { SettingsDialog } from './SettingsDialog';
import { StatusBar } from './StatusBar';
import { SyncDialog } from './SyncDialog';
import { TitleBar } from './TitleBar';

const push = (r: (close: () => void) => React.ReactNode) => useApp.getState().pushDialog(r);

async function checkUpdates(manual: boolean) {
  try {
    const u = await checkForUpdate();
    if (u) {
      const silent = useSettings.getState().s.updateMode === 'silent' && u.kind === 'desktop' && !manual;
      if (silent) await u.install();
      else push((close) => <UpdateDialog update={u} close={close} />);
    } else if (manual) useApp.getState().toast(isTauri ? `You're on the latest version (${__APP_VERSION__}).` : 'Updates are delivered to the installed app.');
  } catch (e: any) {
    if (manual) useApp.getState().toast(`Update check failed: ${e?.message ?? e}`, 'error');
  }
}

registerGlobal(coreHandlers({
  palette: () => useApp.getState().setPalette(true),
  settings: (tab) => push((close) => <SettingsDialog close={close} initial={tab} />),
  sync: () => push((close) => <SyncDialog close={close} />),
  convert: () => { const d = activeDoc(); if (d) push((close) => <ConvertDialog doc={d} close={close} />); },
  newPicker: () => push((close) => <NewPicker close={close} />),
  recent: () => push((close) => <RecentDialog close={close} />),
  providerBrowser: () => push((close) => <ProviderBrowser close={close} />),
  fileInfo: () => { const d = activeDoc(); if (d) push((close) => <FileInfo doc={d} close={close} />); },
  about: () => push((close) => <About close={close} />),
  whatsNew: () => push((close) => <WhatsNew close={close} version={__APP_VERSION__} />),
  checkUpdates: () => void checkUpdates(true),
}));
registerGlobal({ 'app.settings.sync': () => push((close) => <SettingsDialog close={close} initial="Sync" />) });

function useCompact() {
  const [compact, setCompact] = useState(() => window.innerWidth < 900);
  useEffect(() => {
    const f = () => setCompact(window.innerWidth < 900);
    window.addEventListener('resize', f);
    return () => window.removeEventListener('resize', f);
  }, []);
  return compact;
}

export function App() {
  const loaded = useSettings((s) => s.loaded);
  const theme = useSettings((s) => s.s.theme);
  const accent = useSettings((s) => s.s.accent);
  const docs = useApp((s) => s.docs);
  const activeId = useApp((s) => s.activeId);
  const palette = useApp((s) => s.palette);
  const dialogs = useApp((s) => s.dialogs);
  const toasts = useApp((s) => s.toasts);
  const compact = useCompact();

  // Boot: settings → theme → restore tabs → what's new → sync → updates
  useEffect(() => {
    void (async () => {
      await useSettings.getState().load();
      const { s, update } = useSettings.getState();
      if (s.restoreSession) for (const t of s.lastSession) await openRecent({ ...t, openedAt: 0 }).catch(() => {});
      const v = await appVersion();
      if (s.lastSeenVersion && s.lastSeenVersion !== v) push((close) => <WhatsNew close={close} version={v} />);
      if (s.lastSeenVersion !== v) update({ lastSeenVersion: v });
      startSyncLoop();
      void checkUpdates(false);
      setInterval(() => void checkUpdates(false), UPDATE_CHECK_HOURS * 3600 * 1000);
    })();
  }, []);

  useEffect(() => { applyTheme(theme, accent); setSystemBarTheme(theme); }, [theme, accent]);
  useEffect(() => { startInsets(); }, []);

  // Remember open tabs for session restore.
  useEffect(() => {
    if (!loaded) return;
    const lastSession = docs.filter((d) => d.location).map((d) => ({ mode: d.mode, title: d.title, format: d.format, location: d.location! }));
    useSettings.getState().update({ lastSession });
  }, [docs.map((d) => d.id + (d.location?.path ?? '')).join('|'), loaded]);

  // Warn before closing the window with unsaved documents.
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (useApp.getState().docs.some((d) => d.dirty)) { e.preventDefault(); } };
    window.addEventListener('beforeunload', f);
    return () => window.removeEventListener('beforeunload', f);
  }, []);

  // Global shortcuts (menu shortcuts of the active module + core).
  useEffect(() => {
    let map = new Map<string, string>();
    const doc = docs.find((d) => d.id === activeId);
    void shortcutMap(doc?.mode ?? null).then((m) => { map = m; });
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const st = useApp.getState();
      if (st.dialogs.length || st.palette) return; // dialogs handle their own keys (Esc)
      const k = keyEvent(e);
      // Tab switching
      if (k === 'ctrl+tab' || k === 'ctrl+shift+tab') { e.preventDefault(); void runCommand(k === 'ctrl+tab' ? 'app.nextTab' : 'app.prevTab'); return; }
      const digit = /^ctrl\+([1-9])$/.exec(k);
      if (digit) {
        const ids = ['home', ...st.docs.map((d) => d.id)];
        const id = ids[Number(digit[1]) - 1];
        if (id) { e.preventDefault(); st.setActive(id); }
        return;
      }
      const target = e.target as HTMLElement;
      const editing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      const hasMod = e.ctrlKey || e.metaKey || e.altKey || /^f\d+$/.test(k.split('+').pop()!);
      // Leave plain typing and native clipboard / undo inside text fields alone.
      if (editing && (!hasMod || /^ctrl\+(c|v|x|a|z|y|shift\+z)$/.test(k))) return;
      if (!editing && !hasMod && !map.has(k)) return;
      const id = map.get(k);
      if (id) { e.preventDefault(); void runCommand(id); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeId, docs.find((d) => d.id === activeId)?.mode]);

  if (!loaded) return <div style={{ height: '100%', background: 'var(--bg0)' }} />;

  return (
    <div className={compact ? 'app-root compact' : 'app-root'} style={{ height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg0)', color: 'var(--ink)', font: 'var(--type-body)', overflow: 'hidden' }}>
      <TitleBar compact={compact} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {activeId === 'home' && <Home compact={compact} />}
        {docs.map((d) => <DocView key={d.id} doc={d} active={d.id === activeId} compact={compact} />)}
      </div>
      <StatusBar />
      {palette && <CommandPalette />}
      {dialogs.map((d) => <div key={d.id}>{d.render(() => useApp.getState().popDialog(d.id))}</div>)}
      <div style={{ position: 'fixed', bottom: 'calc(40px + var(--safe-bottom))', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', gap: 6, zIndex: 200, pointerEvents: 'none' }}>
        {toasts.map((t) => (
          <div key={t.id} style={{ background: 'var(--bg1)', border: `1px solid ${t.tone === 'error' ? 'var(--negative)' : 'var(--line)'}`, boxShadow: 'var(--shadow-float)', padding: '9px 14px', font: 'var(--type-small)', animation: 'toast-in 120ms var(--ease)', maxWidth: 560 }}>
            {t.tone === 'error' && <span style={{ color: 'var(--negative)', marginRight: 8 }}>●</span>}{t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
