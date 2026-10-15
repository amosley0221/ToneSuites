// Document lifecycle: new / open / save / close / autosave / convert.
import { createElement } from 'react';
import { FormatLoss, QuitWithUnsaved, SaveBeforeClose } from '@/shell/SaveBeforeClose';
import { loadModule, MODULE_META, modeForExt, ALL_OPENABLE } from '@/modules/meta';
import { makeProvider, requestSync, syncHooks } from '@/storage/sync';
import {
  basename, browserDownload, browserPickFiles, extOf, isTauri, joinPath, pickOpenPaths, pickSavePath, readFile, stripExt, uid, writeFile, listDir, appVersion, dirname,
} from './platform';
import { addRecent, useSettings, type RecentEntry } from './settings';
import { activeDoc, models, useApp } from './store';
import { packTone, peekToneMode, unpackTone } from './toneFile';
import type { Doc, DocLocation, Mode, ModuleApi } from './types';

const toast = (m: string, tone?: 'info' | 'error') => useApp.getState().toast(m, tone);

export function moduleApi(docId: string | null): ModuleApi {
  return {
    toast,
    openDialog: (render) => useApp.getState().pushDialog(render),
    markDirty: () => { if (docId) markDirty(docId); },
    pickFile: pickFiles,
    saveBytes: saveBytesAs,
    openNewDoc: (mode, model, title, convertedFrom, format = 'tone') => openModel(mode, model, title, null, format, convertedFrom),
    openBytesAsDoc: async (bytes, filename) => { await openConverted(bytes, filename, docId ?? undefined); },
    refreshChrome: () => useApp.getState().bump(),
    runCommand: (id) => { void import('./commands').then((c) => c.runCommand(id)); },
  };
}

// ---------- Creating & opening ----------

export async function newDocument(mode: Mode) {
  const mod = await loadModule(mode);
  const res = await mod.createBlank();
  if (!res) return;
  // Unsaved documents show a bare name in the tab; the extension is added on first save.
  openModel(mode, res.model, res.title.replace(/\.tone$/i, ''), null, 'tone');
}

export function openModel(mode: Mode, model: unknown, title: string, location: DocLocation | null, format: string, convertedFrom?: string, folderWorkspace?: Doc['folderWorkspace']) {
  const id = uid();
  models.set(id, model);
  const from = convertedFrom ? useApp.getState().docs.find((d) => d.id === convertedFrom) : undefined;
  const doc: Doc = {
    id, mode, title, location, format, dirty: !location, rev: 0,
    convertedFrom: from ? { docId: from.id, title: from.title } : undefined,
    folderWorkspace,
  };
  useApp.getState().addDoc(doc);
  return id;
}

async function decode(bytes: Uint8Array, filename: string): Promise<{ mode: Mode; model: unknown; title: string; format: string }> {
  const ext = extOf(filename);
  if (ext === 'tone') {
    const mode = await peekToneMode(bytes);
    if (!mode) throw new Error(`${filename} is not a valid Tone file`);
    const { manifest, files } = await unpackTone(bytes);
    const mod = await loadModule(mode);
    return { mode, model: await mod.deserialize(files, manifest.formatVersion), title: basename(filename), format: 'tone' };
  }
  const mode = modeForExt(ext);
  if (!mode) throw new Error(`Tone can't open .${ext} files yet`);
  const mod = await loadModule(mode);
  // An outline is an import format: the result is a new deck, saved as .tone.
  if (ext === 'toneoutline') return { mode, model: await mod.openFile(bytes, filename), title: stripExt(filename) + '.tone', format: 'tone' };
  return { mode, model: await mod.openFile(bytes, filename), title: basename(filename), format: ext };
}

export async function openBytes(bytes: Uint8Array, filename: string, location: DocLocation | null, folderWorkspace?: Doc['folderWorkspace']) {
  // Already open? just switch to it.
  if (location) {
    const existing = useApp.getState().docs.find((d) => d.location && d.location.kind === location.kind && d.location.path === location.path && d.location.providerId === location.providerId);
    if (existing) { useApp.getState().setActive(existing.id); return existing.id; }
  }
  const { mode, model, title, format } = await decode(bytes, filename);
  const id = openModel(mode, model, title, location, format, undefined, folderWorkspace);
  if (location) addRecent({ title, mode, format, location });
  // A file just opened has no unsaved changes, even when the browser build can't remember its path.
  else useApp.getState().updateDoc(id, { dirty: false });
  return id;
}

/** Open a conversion result in a new tab; `.toneoutline` goes to Deck. */
export async function openConverted(bytes: Uint8Array, filename: string, fromDocId?: string, forceMode?: Mode) {
  const ext = extOf(filename);
  const mode = forceMode ?? (ext === 'toneoutline' ? 'deck' : modeForExt(ext));
  if (!mode) throw new Error(`No module opens .${ext}`);
  const mod = await loadModule(mode);
  const model = await mod.openFile(bytes, filename);
  const title = ext === 'toneoutline' ? stripExt(filename) + '.tone' : filename;
  return openModel(mode, model, title, null, ext === 'toneoutline' ? 'tone' : ext, fromDocId);
}

export async function openPath(path: string, folderWorkspace?: Doc['folderWorkspace']) {
  try {
    const bytes = await readFile(path);
    return await openBytes(bytes, basename(path), { kind: 'local', path }, folderWorkspace);
  } catch (e: any) {
    toast(`Couldn't open ${basename(path)}: ${e?.message ?? e}`, 'error');
  }
}

// Files opened from the whole NAS / Drive (not the sync folder) are stored with this path prefix.
const ROOT = '@root/';
const fromRoot = (path: string) => (path.startsWith(ROOT) ? path.slice(ROOT.length) : path.startsWith('@drive/') ? path.slice(7) : null);

export async function openFromProvider(providerId: string, rel: string, browseRoot = false) {
  const cfg = useSettings.getState().s.providers.find((p) => p.id === providerId);
  if (!cfg) return;
  try {
    const p = makeProvider(cfg, browseRoot);
    const bytes = await p.get(rel);
    return await openBytes(bytes, basename(rel), { kind: 'provider', providerId, path: (browseRoot ? ROOT : '') + rel });
  } catch (e: any) {
    toast(`Couldn't open ${basename(rel)}: ${e?.message ?? e}`, 'error');
  }
}

export async function openRecent(r: RecentEntry) {
  if (r.location.kind === 'local') return openPath(r.location.path);
  const rootRel = fromRoot(r.location.path);
  return openFromProvider(r.location.providerId!, rootRel ?? r.location.path, rootRel != null);
}

export async function openDialog() {
  if (!isTauri) {
    const files = await browserPickFiles(ALL_OPENABLE, true);
    for (const f of files) await openBytes(f.bytes, f.name, null).catch((e) => toast(String(e?.message ?? e), 'error'));
    return;
  }
  const paths = await pickOpenPaths(ALL_OPENABLE, true);
  for (const p of paths) await openPath(p);
}

/** Open a folder as one tab with a file switcher. */
export async function openFolderWorkspace(mode?: Mode) {
  if (!isTauri) { toast('Folder workspaces need the desktop or Android app', 'error'); return; }
  const [folder] = await pickOpenPaths([], false, true);
  if (!folder) return;
  const exts = mode ? ['tone', ...MODULE_META[mode].opens] : ALL_OPENABLE;
  const files = (await listDir(folder)).filter((e) => !e.isDir && exts.includes(extOf(e.name))).map((e) => e.name).sort((a, b) => a.localeCompare(b));
  if (!files.length) { toast('No supported files in that folder', 'error'); return; }
  await openPath(await joinPath(folder, files[0]), { folder, files, index: 0 });
}

export async function switchFolderFile(docId: string, index: number) {
  const doc = useApp.getState().docs.find((d) => d.id === docId);
  if (!doc?.folderWorkspace) return;
  const ws = doc.folderWorkspace;
  const i = (index + ws.files.length) % ws.files.length;
  if (doc.dirty) await saveDocument(docId);
  const path = await joinPath(ws.folder, ws.files[i]);
  try {
    const bytes = await readFile(path);
    const { mode, model, format } = await decode(bytes, ws.files[i]);
    models.set(docId, model);
    // A folder can mix file types: drop command handlers bound to the previous module.
    if (mode !== doc.mode) (await import('./commands')).forgetDoc(docId);
    useApp.getState().updateDoc(docId, { mode, title: ws.files[i], format, location: { kind: 'local', path }, dirty: false, rev: doc.rev + 1, folderWorkspace: { ...ws, index: i } });
    addRecent({ title: ws.files[i], mode, format, location: { kind: 'local', path } });
  } catch (e: any) { toast(`Couldn't open ${ws.files[i]}: ${e?.message ?? e}`, 'error'); }
}

// ---------- Saving ----------

export function markDirty(docId: string) {
  const d = useApp.getState().docs.find((x) => x.id === docId);
  if (!d) return;
  useApp.getState().updateDoc(docId, { dirty: true, rev: d.rev + 1 });
  scheduleAutosave(docId);
}

const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleAutosave(docId: string) {
  const sec = useSettings.getState().s.autosaveSeconds;
  if (!sec) return;
  clearTimeout(autosaveTimers.get(docId));
  autosaveTimers.set(docId, setTimeout(() => {
    const d = useApp.getState().docs.find((x) => x.id === docId);
    // Autosave only Tone documents that already have a home. Files opened from elsewhere (csv, xlsx, docx, pdf…)
    // are never overwritten behind your back — they save when you press Save. Never pop dialogs on autosave.
    if (d?.dirty && d.location && d.format === 'tone') void saveDocument(docId, { silent: true });
  }, sec * 1000));
}

async function encode(doc: Doc, asFormat: string): Promise<Uint8Array> {
  const mod = await loadModule(doc.mode);
  const model = models.get(doc.id);
  if (asFormat !== 'tone' && mod.saveForeign) {
    const b = await mod.saveForeign(model, asFormat);
    if (b) return b;
  }
  const files = await mod.serialize(model);
  const now = new Date().toISOString();
  return packTone({ mode: doc.mode, title: doc.title, created: now, modified: now, appVersion: await appVersion(), deviceId: useSettings.getState().s.deviceId, convertedFrom: doc.convertedFrom?.title }, files);
}

async function canSaveForeign(doc: Doc): Promise<boolean> {
  if (doc.format === 'tone') return true;
  const mod = await loadModule(doc.mode);
  return !!mod.saveForeign;
}

export async function saveDocument(docId: string, opts: { saveAs?: boolean; copy?: boolean; silent?: boolean } = {}): Promise<boolean> {
  const doc = useApp.getState().docs.find((d) => d.id === docId);
  if (!doc) return false;
  try {
    let format = doc.format;
    let location = doc.location;
    if (!(await canSaveForeign(doc))) format = 'tone';
    if (!location || opts.saveAs || opts.copy || format !== doc.format) {
      if (opts.silent) return false;
      const name = stripExt(doc.title) + '.' + format;
      if (!isTauri) {
        browserDownload(await encode(doc, format), name);
        if (!opts.copy) useApp.getState().updateDoc(docId, { dirty: false, savedAt: Date.now(), title: name, format });
        return true;
      }
      // Save as / copy can also keep a foreign file (xlsx, pdf…) as a .tone document: the chosen extension decides.
      const exts = opts.saveAs || opts.copy ? [...new Set([format, 'tone'])] : [format];
      const path = await pickSavePath(name, exts, useSettings.getState().s.workspaceDir || undefined);
      if (!path) return false;
      if (extOf(path) === 'tone') format = 'tone';
      location = { kind: 'local', path };
    }
    if (format !== 'tone' && !opts.silent) {
      const mod = await loadModule(doc.mode);
      const losses = mod.foreignLosses?.(models.get(doc.id), format) ?? [];
      const ackKey = `${docId}:${format}:${losses.join('|')}`;
      if (losses.length && !lossAcknowledged.has(ackKey)) {
        const choice = await askFormatLoss(doc.title, format, losses);
        if (choice === 'cancel') return false;
        if (choice === 'tone') return saveAsTone(docId);
        lossAcknowledged.add(ackKey);
      }
    }
    const bytes = await encode(doc, format);
    if (location.kind === 'local') await writeFile(location.path, bytes);
    else {
      const cfg = useSettings.getState().s.providers.find((p) => p.id === location!.providerId);
      if (!cfg) throw new Error('Storage provider was removed');
      const rootRel = fromRoot(location.path);
      await makeProvider(cfg, rootRel != null).put(rootRel ?? location.path, bytes);
    }
    if (!opts.copy) {
      const title = basename(location.path);
      useApp.getState().updateDoc(docId, { dirty: false, savedAt: Date.now(), location, format, title });
      addRecent({ title, mode: doc.mode, format, location });
    }
    if (!opts.silent) toast(`Saved ${basename(location.path)}`);
    requestSync();
    return true;
  } catch (e: any) {
    toast(saveErrorMessage(doc.title, e), 'error');
    return false;
  }
}

/** Plain-language save errors (the OS ones are cryptic). */
export function saveErrorMessage(title: string, e: unknown): string {
  const msg = String((e as any)?.message ?? e);
  if (/os error 32|being used by another process|EBUSY|resource busy/i.test(msg)) {
    return `Couldn't save ${title}: it's open in another app (Excel, for example). Close it there and save again — or use Save as.`;
  }
  if (/os error 5\b|access is denied|EACCES|EPERM|permission denied/i.test(msg)) {
    return `Couldn't save ${title}: Tone isn't allowed to write there. Use Save as to pick another folder.`;
  }
  return `Save failed: ${msg}`;
}

// "Save CSV anyway" is remembered per document + format + what would be lost, so Ctrl S doesn't ask every time.
const lossAcknowledged = new Set<string>();

function askFormatLoss(title: string, format: string, losses: string[]): Promise<'keep' | 'tone' | 'cancel'> {
  return new Promise((resolve) => {
    useApp.getState().pushDialog((close) =>
      createElement(FormatLoss, { title, format, losses, onPick: (c: 'keep' | 'tone' | 'cancel') => { close(); resolve(c); } }),
    );
  });
}

/** Save the document as a new .tone file next to the original (the original file is left as it was). */
async function saveAsTone(docId: string): Promise<boolean> {
  const doc = useApp.getState().docs.find((d) => d.id === docId);
  if (!doc) return false;
  const name = stripExt(doc.title) + '.tone';
  if (!isTauri) {
    browserDownload(await encode(doc, 'tone'), name);
    useApp.getState().updateDoc(docId, { dirty: false, savedAt: Date.now(), title: name, format: 'tone', location: null });
    return true;
  }
  const near = doc.location?.kind === 'local' ? dirname(doc.location.path) : useSettings.getState().s.workspaceDir || undefined;
  const path = await pickSavePath(name, ['tone'], near);
  if (!path) return false;
  try {
    await writeFile(path, await encode(doc, 'tone'));
  } catch (e) {
    toast(saveErrorMessage(name, e), 'error');
    return false;
  }
  const location = { kind: 'local' as const, path };
  useApp.getState().updateDoc(docId, { dirty: false, savedAt: Date.now(), location, format: 'tone', title: basename(path) });
  addRecent({ title: basename(path), mode: doc.mode, format: 'tone', location });
  toast(`Saved ${basename(path)}`);
  requestSync();
  return true;
}

/** Closing the app window: ask about unsaved documents. Resolves true when it's OK to close. */
export async function confirmQuit(): Promise<boolean> {
  const dirty = useApp.getState().docs.filter((d) => d.dirty);
  if (!dirty.length) return true;
  const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
    useApp.getState().pushDialog((close) =>
      createElement(QuitWithUnsaved, { titles: dirty.map((d) => d.title), onPick: (c: 'save' | 'discard' | 'cancel') => { close(); resolve(c); } }),
    );
  });
  if (choice === 'cancel') return false;
  if (choice === 'discard') return true;
  for (const d of dirty) {
    useApp.getState().setActive(d.id);
    if (!(await saveDocument(d.id))) return false;
  }
  return true;
}

/** Bytes of a document's file as last saved (local file, NAS or Drive). */
async function readLocation(loc: DocLocation): Promise<Uint8Array> {
  if (loc.kind === 'local') return readFile(loc.path);
  const cfg = useSettings.getState().s.providers.find((p) => p.id === loc.providerId);
  if (!cfg) throw new Error('Storage provider was removed');
  const rootRel = fromRoot(loc.path);
  return makeProvider(cfg, rootRel != null).get(rootRel ?? loc.path);
}

export async function revertDocument(docId: string) {
  const doc = useApp.getState().docs.find((d) => d.id === docId);
  if (!doc) return;
  if (!doc.location) { toast('Nothing to revert to — this document has not been saved yet'); return; }
  const bytes = await readLocation(doc.location);
  const { model } = await decode(bytes, doc.title);
  models.set(docId, model);
  useApp.getState().updateDoc(docId, { dirty: false, rev: doc.rev + 1 });
}

export async function closeDocument(docId: string) {
  const doc = useApp.getState().docs.find((d) => d.id === docId);
  if (!doc) return;
  if (doc.dirty) {
    const choice = await askSaveBeforeClose(doc.title);
    if (choice === 'cancel') return;
    if (choice === 'save' && !(await saveDocument(docId))) return;
  }
  clearTimeout(autosaveTimers.get(docId));
  models.delete(docId);
  useApp.getState().removeDoc(docId);
  void import('./commands').then((c) => c.forgetDoc(docId));
}

function askSaveBeforeClose(title: string): Promise<'save' | 'discard' | 'cancel'> {
  return new Promise((resolve) => {
    useApp.getState().pushDialog((close) =>
      createElement(SaveBeforeClose, { title, onPick: (c: 'save' | 'discard' | 'cancel') => { close(); resolve(c); } }),
    );
  });
}

// ---------- Generic file helpers for modules ----------

export async function pickFiles(exts: string[], multiple = false): Promise<{ name: string; bytes: Uint8Array }[]> {
  if (!isTauri) return browserPickFiles(exts, multiple);
  const paths = await pickOpenPaths(exts, multiple);
  return Promise.all(paths.map(async (p) => ({ name: basename(p), bytes: await readFile(p) })));
}

export async function saveBytesAs(bytes: Uint8Array, filename: string, exts: string[]): Promise<boolean> {
  if (!isTauri) { browserDownload(bytes, filename); return true; }
  const path = await pickSavePath(filename, exts, useSettings.getState().s.workspaceDir || undefined);
  if (!path) return false;
  await writeFile(path, bytes);
  toast(`Exported ${basename(path)}`);
  requestSync();
  return true;
}

/** Upload exported bytes to the first connected Google Drive (Convert dialog option). */
export async function alsoSaveToDrive(bytes: Uint8Array, filename: string) {
  const cfg = useSettings.getState().s.providers.find((p) => p.kind === 'gdrive' && p.enabled);
  if (!cfg) { toast('Connect Google Drive in Settings › Sync first', 'error'); return; }
  await makeProvider(cfg).put(`Exports/${filename}`, bytes);
  toast(`Saved a copy to ${cfg.name}/Exports`);
}

// ---------- Sync integration ----------

syncHooks.isDirty = (abs) => useApp.getState().docs.some((d) => d.dirty && d.location?.kind === 'local' && d.location.path === abs);
syncHooks.onLocalReplaced = (abs) => {
  const doc = useApp.getState().docs.find((d) => d.location?.kind === 'local' && d.location.path === abs);
  if (doc && !doc.dirty) void revertDocument(doc.id).then(() => toast(`${doc.title} updated from another device`), (e) => console.warn('reload after sync', e));
};
syncHooks.openDocs = () => {
  const ws = useSettings.getState().s.workspaceDir;
  if (!ws) return [];
  const norm = (p: string) => p.replace(/\\/g, '/');
  return useApp.getState().docs
    .filter((d) => d.location?.kind === 'local' && norm(d.location.path).startsWith(norm(ws) + '/'))
    .map((d) => ({ title: d.title, mode: d.mode, rel: norm(d.location!.path).slice(norm(ws).length + 1) }));
};

export async function openWorkspaceRel(rel: string) {
  const ws = useSettings.getState().s.workspaceDir;
  if (!ws) return;
  return openPath(await joinPath(ws, ...rel.split('/')));
}

export { activeDoc };
