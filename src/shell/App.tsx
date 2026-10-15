import { useEffect, useState, useMemo } from 'react';
import { coreHandlers, keyEvent, registerGlobal, runCommand, shortcutMap } from '@/core/commands';
import { confirmQuit, openPath, openRecent } from '@/core/documents';
import { appVersion, isTauri } from '@/core/platform';
import { applyTheme, useSettings } from '@/core/settings';
import { activeDoc, useApp, type DialogEntry } from '@/core/store';
import { loadFonts } from '@/core/fonts';
import { setSystemBarTheme, startInsets } from '@/core/insets';
import { runUpdateCheck, updateAction, useUpdates } from '@/core/updater';
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

function showUpdate() {
  const u = useUpdates.getState().available;
  if (u) push((close) => <UpdateDialog update={u} close={close} />);
}

async function checkUpdates(manual: boolean, atLaunch = false) {
  try {
    const u = await runUpdateCheck(manual);
    const { s, update } = useSettings.getState();
    if (u) {
      const action = updateAction(u, s, { manual, atLaunch, hasUnsaved: useApp.getState().docs.some((d) => d.dirty) });
      if (action === 'install') { await u.install(); return; }
      if (action === 'popup') {
        update({ updatePromptedVersion: u.version });
        showUpdate();
      }
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
registerGlobal({
  'app.showUpdate': () => showUpdate(),
  'app.settings.updates': () => push((close) => <SettingsDialog close={close} initial="Updates" />),
});
registerGlobal({ 'app.settings.sync': () => push((close) => <SettingsDialog close={close} initial="Sync" />) });

/** Files the OS asked us to open ("Open with", double-click, a second launch). */
async function listenForOpenedFiles() {
  if (!isTauri) return;
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const drain = async () => {
    for (const path of await invoke<string[]>('take_open_files')) await openPath(path);
  };
  await listen('open-files', () => void drain());
  await drain();
}

/** Renders a pushed dialog once, so App re-renders (toasts, sync status…) don't hand it fresh props and reset its state. */
function DialogHost({ entry }: { entry: DialogEntry }) {
  const el = useMemo(() => entry.render(() => useApp.getState().popDialog(entry.id)), [entry.id]);
  return <div>{el}</div>;
}

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
      void loadFonts();
      void listenForOpenedFiles();
      startSyncLoop();
      void checkUpdates(false, true);
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

  // Closing the window with unsaved documents asks first (Save all / Close without saving / Cancel).
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => { if (useApp.getState().docs.some((d) => d.dirty)) { e.preventDefault(); } };
    window.addEventListener('beforeunload', f);
    let unlisten: (() => void) | undefined;
    let closing = false;
    if (isTauri) {
      void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
        const w = getCurrentWindow();
        unlisten = await w.onCloseRequested(async (ev) => {
          if (closing || !useApp.getState().docs.some((d) => d.dirty)) return;
          ev.preventDefault();
          if (await confirmQuit()) { closing = true; await w.destroy(); }
        });
      });
    }
    return () => { window.removeEventListener('beforeunload', f); unlisten?.(); };
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
      {dialogs.map((d) => <DialogHost key={d.id} entry={d} />)}
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
