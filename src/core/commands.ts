// Command registry: global (core) handlers + per-document module handlers, keyboard shortcuts, palette entries.
import { loadModule, MODULE_META } from '@/modules/meta';
import { closeDocument, moduleApi, newDocument, openDialog, openFolderWorkspace, revertDocument, saveDocument } from './documents';
import { activeDoc, models, useApp } from './store';
import { useSettings } from './settings';
import type { CommandHandler, Doc, MenuDef, MenuEntry, MenuItemDef, Mode } from './types';

const globalHandlers: Record<string, CommandHandler> = {};
const docHandlers = new Map<string, Record<string, CommandHandler>>();

/** Register core handlers (called once from the shell). */
export function registerGlobal(map: Record<string, CommandHandler>) {
  Object.assign(globalHandlers, map);
}

async function handlersFor(doc: Doc): Promise<Record<string, CommandHandler>> {
  let h = docHandlers.get(doc.id);
  if (!h) {
    const mod = await loadModule(doc.mode);
    h = mod.commands(() => models.get(doc.id) as any, moduleApi(doc.id));
    docHandlers.set(doc.id, h);
  }
  return h;
}

/** Drop cached handlers when a doc's mode changes or it closes. */
export function forgetDoc(docId: string) { docHandlers.delete(docId); }

export async function runCommand(id: string) {
  const doc = activeDoc();
  const ctx = { doc, model: doc ? models.get(doc.id) : null };
  try {
    if (doc) {
      const h = await handlersFor(doc);
      if (h[id]) return void (await h[id](ctx));
    }
    if (globalHandlers[id]) return void (await globalHandlers[id](ctx));
    useApp.getState().toast('Not available yet — this command is on the roadmap (see FEATURES.md).');
  } catch (e: any) {
    console.error(e);
    useApp.getState().toast(`${e?.message ?? e}`, 'error');
  }
}

export async function hasHandler(id: string): Promise<boolean> {
  const doc = activeDoc();
  if (globalHandlers[id]) return true;
  if (!doc) return false;
  return !!(await handlersFor(doc))[id];
}

// ---------- Shortcuts ----------

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** "Ctrl Shift S" → canonical string matching keyEvent(). */
export function normShortcut(s: string): string {
  const parts = s.split(/\s+/).filter(Boolean);
  const mods = new Set<string>();
  let key = '';
  for (const p of parts) {
    const l = p.toLowerCase();
    if (l === 'ctrl' || l === 'cmd') mods.add('ctrl');
    else if (l === 'shift') mods.add('shift');
    else if (l === 'alt' || l === 'option') mods.add('alt');
    else key = l === '+' ? '=' : l;
  }
  return [...['ctrl', 'alt', 'shift'].filter((m) => mods.has(m)), key].join('+');
}

export function keyEvent(e: KeyboardEvent): string {
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  let key = e.key.toLowerCase();
  if (e.code.startsWith('Key')) key = e.code.slice(3).toLowerCase();
  else if (e.code.startsWith('Digit')) key = e.code.slice(5);
  else if (key === 'escape') key = 'esc';
  else if (key === 'delete') key = 'del';
  else if (key === '+') key = '=';
  else if (key === 'arrowup') key = '↑';
  else if (key === 'arrowdown') key = '↓';
  return [...mods, key].join('+');
}

/** Display a shortcut for this OS (Ctrl → ⌘ on mac). */
export function displayShortcut(s?: string): string {
  if (!s) return '';
  return isMac ? s.replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥').replace(/\bShift\b/g, '⇧') : s;
}

export function flattenMenus(menus: MenuDef[]): (MenuItemDef & { path: string })[] {
  const out: (MenuItemDef & { path: string })[] = [];
  const walk = (entries: MenuEntry[], path: string) => {
    for (const e of entries) {
      if (e === '-') continue;
      if (e.children) walk(e.children, `${path} › ${e.label}`);
      else out.push({ ...e, path });
    }
  };
  for (const m of menus) walk(m.items, m.name);
  return out;
}

/** Global shortcuts that exist in every mode (also listed in Settings › Shortcuts). */
export const GLOBAL_SHORTCUTS: { id: string; label: string; shortcut: string }[] = [
  { id: 'app.palette', label: 'Command palette', shortcut: 'Ctrl K' },
  { id: 'file.new', label: 'New document', shortcut: 'Ctrl N' },
  { id: 'file.open', label: 'Open', shortcut: 'Ctrl O' },
  { id: 'file.save', label: 'Save', shortcut: 'Ctrl S' },
  { id: 'file.saveAs', label: 'Save as', shortcut: 'Ctrl Shift S' },
  { id: 'file.export', label: 'Export / convert', shortcut: 'Ctrl Shift E' },
  { id: 'file.close', label: 'Close tab', shortcut: 'Ctrl W' },
  { id: 'app.nextTab', label: 'Switch tab', shortcut: 'Ctrl Tab' },
  { id: 'app.settings', label: 'Settings', shortcut: 'Ctrl ,' },
  { id: 'app.toggleInspector', label: 'Toggle inspector', shortcut: 'Ctrl \\' },
  { id: 'folder.next', label: 'Next file in folder', shortcut: 'Ctrl ↓' },
  { id: 'folder.prev', label: 'Previous file in folder', shortcut: 'Ctrl ↑' },
];

let menuCache: { mode: Mode; menus: MenuDef[] } | null = null;
export async function menusFor(mode: Mode): Promise<MenuDef[]> {
  if (menuCache?.mode === mode) return menuCache.menus;
  const mod = await loadModule(mode);
  menuCache = { mode, menus: mod.menus };
  return mod.menus;
}

export async function shortcutMap(mode: Mode | null): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (mode) for (const it of flattenMenus(await menusFor(mode))) if (it.shortcut) map.set(normShortcut(it.shortcut), it.id);
  // Global shortcuts take precedence over module menu duplicates of the same command.
  for (const g of GLOBAL_SHORTCUTS) map.set(normShortcut(g.shortcut), g.id);
  // Pixel uses Ctrl K for Preferences in Photoshop; Tone keeps Ctrl K as the palette everywhere.
  map.set('ctrl+k', 'app.palette');
  return map;
}

// ---------- Core command implementations ----------

export function coreHandlers(open: {
  palette: () => void; settings: (tab?: string) => void; sync: () => void; convert: () => void; newPicker: () => void;
  recent: () => void; providerBrowser: () => void; fileInfo: () => void; about: () => void; whatsNew: () => void; checkUpdates: () => void;
}): Record<string, CommandHandler> {
  return {
    'app.palette': () => open.palette(),
    'app.settings': () => open.settings(),
    'app.shortcuts': () => open.settings('Shortcuts'),
    'app.sync': () => open.sync(),
    'app.about': () => open.about(),
    'app.whatsNew': () => open.whatsNew(),
    'app.checkUpdates': () => open.checkUpdates(),
    'app.theme': () => {
      const { s, update } = useSettings.getState();
      update({ theme: s.theme === 'dark' ? 'light' : 'dark' });
    },
    'app.home': () => useApp.getState().setActive('home'),
    'app.nextTab': () => cycleTab(1),
    'app.prevTab': () => cycleTab(-1),
    'app.toggleInspector': () => useApp.setState({ inspectorOpen: !useApp.getState().inspectorOpen }),
    'file.new': ({ doc }) => (doc ? newDocument(doc.mode) : open.newPicker()),
    'file.open': () => openDialog(),
    'file.openRecent': () => open.recent(),
    'file.openFolder': ({ doc }) => openFolderWorkspace(doc?.mode),
    'file.openFromProvider': () => open.providerBrowser(),
    'file.save': ({ doc }) => { if (doc) void saveDocument(doc.id); },
    'file.saveAs': ({ doc }) => { if (doc) void saveDocument(doc.id, { saveAs: true }); },
    'file.saveCopy': ({ doc }) => { if (doc) void saveDocument(doc.id, { copy: true }); },
    'file.revert': ({ doc }) => { if (doc) void revertDocument(doc.id); },
    'file.export': () => open.convert(),
    'file.close': ({ doc }) => { if (doc) { forgetDoc(doc.id); void closeDocument(doc.id); } },
    'file.info': () => open.fileInfo(),
    'folder.next': ({ doc }) => { if (doc?.folderWorkspace) void import('./documents').then((d) => d.switchFolderFile(doc.id, doc.folderWorkspace!.index + 1)); },
    'folder.prev': ({ doc }) => { if (doc?.folderWorkspace) void import('./documents').then((d) => d.switchFolderFile(doc.id, doc.folderWorkspace!.index - 1)); },
    ...Object.fromEntries((Object.keys(MODULE_META) as Mode[]).map((m) => [`new.${m}`, () => newDocument(m)])),
  };
}

function cycleTab(dir: number) {
  const { docs, activeId, setActive } = useApp.getState();
  const ids = ['home', ...docs.map((d) => d.id)];
  const i = ids.indexOf(activeId);
  setActive(ids[(i + dir + ids.length) % ids.length]);
}
