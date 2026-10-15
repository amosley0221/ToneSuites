// Local-first sync engine.
// The local workspace folder is the source of truth for this device; each enabled provider holds a mirror.
// A per-provider index remembers, for every file, the local content hash and the remote revision at the
// last successful sync — so we can tell "changed here", "changed there" and "changed on both" (conflict).
import { appDataDir, isTauri, joinPath, listFilesRecursive, readFile, readText, removePath, sha256Hex, statFile, writeFile, writeText, appVersion } from '@/core/platform';
import { useSettings, type ProviderConfig } from '@/core/settings';
import { useApp, type RemoteDevice, type SyncConflict } from '@/core/store';
import { GDriveProvider } from './gdrive';
import type { StorageProvider } from './provider';
import { conflictCopyName, planFile } from './syncPlan';
import { normEtag, WebDavProvider } from './webdav';

const META_DIR = '.tone-sync';

interface IndexEntry { hash: string; rev: string; size: number; mtime: number }
interface SyncIndex { files: Record<string, IndexEntry> }

/** @param browseRoot whole NAS / whole My Drive (for opening files) instead of the sync folder */
export function makeProvider(cfg: ProviderConfig, browseRoot = false): StorageProvider {
  const sec = useSettings.getState().secrets[cfg.id] ?? {};
  if (cfg.kind === 'webdav') return new WebDavProvider(cfg, sec.password ?? '', browseRoot);
  return new GDriveProvider(cfg, browseRoot ? null : cfg.url || 'Tone');
}

async function indexPath(id: string) { return joinPath(await appDataDir(), `sync-index-${id}.json`); }
async function loadIndex(id: string): Promise<SyncIndex> {
  const raw = await readText(await indexPath(id));
  try { return raw ? JSON.parse(raw) : { files: {} }; } catch { return { files: {} }; }
}
async function saveIndex(id: string, idx: SyncIndex) { await writeText(await indexPath(id), JSON.stringify(idx)); }

/** Hooks the document layer registers so open tabs follow remote changes. */
export const syncHooks = {
  /** Called after a remote version replaced a local file. */
  onLocalReplaced: (_absPath: string) => {},
  /** Docs currently open (relative to the workspace), for device presence / handoff. */
  openDocs: (): RemoteDevice['openDocs'] => [],
  /** True if the file at absPath is open with unsaved edits. */
  isDirty: (_absPath: string) => false,
};

let running = false;
let again = false;
let loopTimer: ReturnType<typeof setTimeout> | undefined;
let soonTimer: ReturnType<typeof setTimeout> | undefined;
const pendingResolutions = new Map<string, 'local' | 'remote' | 'both'>();

/** Sync soon (after a save, a settings change, a conflict choice). Doesn't disturb the periodic loop. */
export function requestSync(delayMs = 2500) {
  clearTimeout(soonTimer);
  soonTimer = setTimeout(() => { if (running) again = true; else void syncAll(); }, delayMs);
}

export function startSyncLoop() {
  const tick = async () => {
    await syncAll().catch((e) => console.warn('sync', e));
    const sec = Math.max(15, useSettings.getState().s.syncIntervalSeconds || 60);
    loopTimer = setTimeout(tick, sec * 1000);
  };
  clearTimeout(loopTimer);
  loopTimer = setTimeout(tick, 1500);
}

export async function syncAll(): Promise<void> {
  if (!isTauri || running) return;
  const { s } = useSettings.getState();
  const providers = s.providers.filter((p) => p.enabled && p.sync);
  const app = useApp.getState();
  if (!providers.length || !s.workspaceDir) { app.setSync({ running: false, pending: 0 }); return; }
  running = true;
  app.setSync({ running: true });
  let pending = 0;
  const conflicts: SyncConflict[] = [];
  const devices = new Map<string, RemoteDevice>();
  for (const cfg of providers) {
    app.setProviderState(cfg.id, { status: 'syncing' });
    try {
      const p = makeProvider(cfg);
      const res = await syncProvider(p, s.workspaceDir);
      pending += res.pending;
      conflicts.push(...res.conflicts);
      for (const d of await readDevices(p)) {
        const prev = devices.get(d.id);
        if (!prev || prev.lastActive < d.lastActive) devices.set(d.id, d);
      }
      await writeDevice(p);
      const usage = await p.usage().catch(() => null);
      app.setProviderState(cfg.id, { status: 'online', message: undefined, usage: usage ?? undefined, files: res.files, lastSync: Date.now() });
    } catch (e: any) {
      const offline = /network|connect|refused|timed out|timeout|dns|unreachable|error sending request|fetch failed|failed to fetch|load failed/i.test(String(e?.message ?? e));
      app.setProviderState(cfg.id, { status: offline ? 'offline' : 'error', message: String(e?.message ?? e) });
      pending += 1;
    }
  }
  devices.delete(s.deviceId);
  useApp.getState().setSync({ running: false, pending, conflicts, lastSync: Date.now(), devices: [...devices.values()].sort((a, b) => b.lastActive - a.lastActive) });
  running = false;
  // A save or conflict choice arrived while we were busy: run once more.
  if (again) { again = false; requestSync(100); }
}

async function syncProvider(p: StorageProvider, root: string): Promise<{ pending: number; conflicts: SyncConflict[]; files: number }> {
  const { s } = useSettings.getState();
  const id = p.config.id;
  const idx = await loadIndex(id);
  const local = await listFilesRecursive(root);
  const remote = (await p.listAll()).filter((e) => !e.rel.startsWith(META_DIR + '/') && !e.rel.startsWith('.'));
  // Safety valve: an empty listing where we previously synced files usually means a wrong address or an
  // unmounted share — never treat that as "everything was deleted".
  const knownCount = Object.keys(idx.files).length;
  if (remote.length === 0 && knownCount > 3) throw new Error(`${p.config.name} looks empty — sync paused to protect your files. Check the folder address.`);
  if (local.length === 0 && knownCount > 3) throw new Error('Local workspace looks empty — sync paused to protect your files. Check Settings › General › Workspace folder.');
  const localMap = new Map(local.map((e) => [e.rel, e]));
  const remoteMap = new Map(remote.map((e) => [e.rel, e]));
  const all = new Set([...localMap.keys(), ...remoteMap.keys(), ...Object.keys(idx.files)]);
  const conflicts: SyncConflict[] = [];
  let pending = 0;

  const localHash = async (rel: string) => {
    const l = localMap.get(rel)!;
    const prev = idx.files[rel];
    if (prev && prev.size === l.size && prev.mtime === l.mtime) return prev.hash; // unchanged since last sync
    return sha256Hex(await readFile(l.path));
  };
  const download = async (rel: string) => {
    const bytes = await p.get(rel);
    const abs = await joinPath(root, ...rel.split('/'));
    const hash = await sha256Hex(bytes);
    const l = localMap.get(rel);
    // Same bytes already here (e.g. only the remote revision marker changed): don't rewrite the file
    // or reload the open tab.
    const same = !!l && (await localHash(rel).catch(() => '')) === hash;
    if (!same) await writeFile(abs, bytes);
    const st = same ? { size: l!.size, mtime: l!.mtime } : await statFile(abs).catch(() => null);
    idx.files[rel] = { hash, rev: remoteMap.get(rel)!.rev, size: st?.size ?? bytes.length, mtime: st?.mtime ?? 0 };
    if (!same) syncHooks.onLocalReplaced(abs);
  };
  const upload = async (rel: string) => {
    const l = localMap.get(rel)!;
    const bytes = await readFile(l.path);
    const rev = await p.put(rel, bytes);
    idx.files[rel] = { hash: await sha256Hex(bytes), rev, size: l.size, mtime: l.mtime };
  };

  const handleConflict = async (rel: string) => {
    const l = localMap.get(rel)!;
    const r = remoteMap.get(rel)!;
    const key = `${id}:${rel}`;
    const decision = pendingResolutions.get(key)
      ?? (s.conflictPolicy === 'newest' ? (l.mtime >= r.mtime ? 'local' : 'remote') : s.conflictPolicy === 'both' ? 'both' : null);
    if (!decision) {
      conflicts.push({ id: key, providerId: id, providerName: p.config.name, rel, localMtime: l.mtime, remoteMtime: r.mtime });
      return;
    }
    pendingResolutions.delete(key);
    if (decision === 'local') await upload(rel);
    else if (decision === 'remote') await download(rel);
    else {
      // Keep both: save the remote version next to ours, then make ours the synced one.
      const copyRel = conflictCopyName(rel, p.config.name, new Date(r.mtime || Date.now()));
      await writeFile(await joinPath(root, ...copyRel.split('/')), await p.get(rel));
      await upload(rel);
    }
  };

  for (const rel of all) {
    const l = localMap.get(rel);
    const r = remoteMap.get(rel);
    const known = idx.files[rel];
    try {
      if (l && syncHooks.isDirty(l.path)) { pending++; continue; } // wait until the open document is saved
      // Older indexes may hold a quoted / weak ETag; compare revisions bare.
      const action = planFile(l && { hash: await localHash(rel) }, r && { rev: normEtag(r.rev) }, known && { hash: known.hash, rev: normEtag(known.rev) });
      switch (action) {
        case 'none': break;
        case 'upload': await upload(rel); break;
        case 'download': await download(rel); break;
        case 'deleteLocal': await removePath(l!.path); delete idx.files[rel]; break;
        case 'deleteRemote': await p.remove(rel); delete idx.files[rel]; break;
        case 'forget': delete idx.files[rel]; break;
        case 'compare': {
          // Both sides have the file but we never synced it: identical content is not a conflict.
          const lh = await localHash(rel);
          if ((await sha256Hex(await p.get(rel))) === lh) { idx.files[rel] = { hash: lh, rev: r!.rev, size: l!.size, mtime: l!.mtime }; break; }
          await handleConflict(rel);
          break;
        }
        case 'conflict': await handleConflict(rel); break;
      }
    } catch (e) {
      console.warn('sync', rel, e);
      pending++;
    }
  }
  await saveIndex(id, idx);
  return { pending, conflicts, files: localMap.size };
}

export function resolveConflict(c: SyncConflict, choice: 'local' | 'remote' | 'both') {
  pendingResolutions.set(c.id, choice);
  const app = useApp.getState();
  app.setSync({ conflicts: app.sync.conflicts.filter((x) => x.id !== c.id) });
  requestSync(100);
}

// ---------- Device presence & session handoff ----------

async function readDevices(p: StorageProvider): Promise<RemoteDevice[]> {
  const entries = await p.list(`${META_DIR}/devices`).catch(() => []);
  const out: RemoteDevice[] = [];
  for (const e of entries) {
    if (e.isDir || !e.rel.endsWith('.json')) continue;
    try { out.push(JSON.parse(new TextDecoder().decode(await p.get(e.rel)))); } catch { /* skip */ }
  }
  return out;
}

async function writeDevice(p: StorageProvider) {
  const { s, osLabel } = useSettings.getState();
  const me: RemoteDevice = { id: s.deviceId, name: s.deviceName, os: osLabel, lastActive: Date.now(), openDocs: syncHooks.openDocs(), appVersion: await appVersion() };
  await p.put(`${META_DIR}/devices/${s.deviceId}.json`, new TextEncoder().encode(JSON.stringify(me)));
}
