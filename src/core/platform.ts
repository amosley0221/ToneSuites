// Thin wrappers over Tauri APIs with browser fallbacks (so `npm run dev` works in a plain browser).

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let _os: string | null = null;
export async function osType(): Promise<'windows' | 'macos' | 'android' | 'linux' | 'ios' | 'web'> {
  if (!isTauri) return 'web';
  if (!_os) {
    const { type } = await import('@tauri-apps/plugin-os');
    _os = type();
  }
  return _os as any;
}

export async function osLabel(): Promise<string> {
  if (!isTauri) return 'Browser';
  const os = await import('@tauri-apps/plugin-os');
  const t = os.type();
  const v = os.version();
  const names: Record<string, string> = { windows: 'Windows', macos: 'macOS', android: 'Android', linux: 'Linux', ios: 'iOS' };
  return `${names[t] ?? t} ${v}`.trim();
}

export async function hostname(): Promise<string> {
  if (!isTauri) return 'Browser';
  const os = await import('@tauri-apps/plugin-os');
  return (await os.hostname()) || (await osLabel());
}

export async function appVersion(): Promise<string> {
  if (!isTauri) return __APP_VERSION__;
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/** fetch that bypasses CORS inside Tauri (needed for WebDAV / Google APIs). */
export async function httpFetch(input: string, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(input, init);
  }
  return fetch(input, init);
}

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else window.open(url, '_blank');
}

// ---------- Paths ----------

export async function appDataDir(): Promise<string> {
  const p = await import('@tauri-apps/api/path');
  return p.appDataDir();
}

export async function joinPath(...parts: string[]): Promise<string> {
  const p = await import('@tauri-apps/api/path');
  return p.join(...parts);
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i > 0 ? path.slice(0, i) : path;
}
export function extOf(name: string): string {
  const b = basename(name);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}
export function stripExt(name: string): string {
  const b = basename(name);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(0, i) : b;
}

/** Default folder for the local Tone workspace (synced folder). */
export async function defaultWorkspaceDir(): Promise<string> {
  const os = await osType();
  const p = await import('@tauri-apps/api/path');
  if (os === 'android' || os === 'ios') return p.join(await p.appDataDir(), 'Tone');
  return p.join(await p.documentDir(), 'Tone');
}

// ---------- File system ----------

export async function readFile(path: string): Promise<Uint8Array> {
  const fs = await import('@tauri-apps/plugin-fs');
  return fs.readFile(path);
}
export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs');
  await fs.mkdir(dirname(path), { recursive: true }).catch(() => {});
  await fs.writeFile(path, data);
}
export async function readText(path: string): Promise<string | null> {
  if (!isTauri) return null;
  const fs = await import('@tauri-apps/plugin-fs');
  try {
    if (!(await fs.exists(path))) return null;
    return await fs.readTextFile(path);
  } catch { return null; }
}
export async function writeText(path: string, text: string): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs');
  await fs.mkdir(dirname(path), { recursive: true }).catch(() => {});
  await fs.writeTextFile(path, text);
}
export async function exists(path: string): Promise<boolean> {
  const fs = await import('@tauri-apps/plugin-fs');
  return fs.exists(path);
}
export async function removePath(path: string): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs');
  await fs.remove(path, { recursive: true }).catch(() => {});
}
export async function mkdirp(path: string): Promise<void> {
  const fs = await import('@tauri-apps/plugin-fs');
  await fs.mkdir(path, { recursive: true }).catch(() => {});
}

/** Size and modification time (ms) of one file — same values listFilesRecursive reports. */
export async function statFile(path: string): Promise<{ size: number; mtime: number }> {
  const fs = await import('@tauri-apps/plugin-fs');
  const st = await fs.stat(path);
  return { size: st.size, mtime: st.mtime ? new Date(st.mtime).getTime() : 0 };
}

export interface LocalEntry { path: string; rel: string; size: number; mtime: number }

/** Recursively list files under `root`. Skips dot-folders except those in `keepDot`. */
export async function listFilesRecursive(root: string, keepDot: string[] = []): Promise<LocalEntry[]> {
  const fs = await import('@tauri-apps/plugin-fs');
  const out: LocalEntry[] = [];
  if (!(await fs.exists(root))) return out;
  const walk = async (dir: string, rel: string) => {
    const entries = await fs.readDir(dir);
    for (const e of entries) {
      if (e.name.startsWith('.') && !keepDot.includes(e.name)) continue;
      const full = await joinPath(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory) await walk(full, r);
      else if (e.isFile) {
        const st = await fs.stat(full);
        out.push({ path: full, rel: r, size: st.size, mtime: st.mtime ? new Date(st.mtime).getTime() : 0 });
      }
    }
  };
  await walk(root, '');
  return out;
}

export async function listDir(dir: string): Promise<{ name: string; isDir: boolean }[]> {
  const fs = await import('@tauri-apps/plugin-fs');
  const entries = await fs.readDir(dir);
  return entries.map((e) => ({ name: e.name, isDir: e.isDirectory }));
}

// ---------- Dialogs ----------

export async function pickOpenPaths(exts: string[], multiple = false, directory = false): Promise<string[]> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const res = await open({
    multiple,
    directory,
    filters: directory || !exts.length ? undefined : [{ name: 'Supported files', extensions: exts }],
  });
  if (!res) return [];
  return Array.isArray(res) ? res : [res];
}

export async function pickSavePath(defaultName: string, exts: string[], defaultDir?: string): Promise<string | null> {
  const { save } = await import('@tauri-apps/plugin-dialog');
  const defaultPath = defaultDir ? await joinPath(defaultDir, defaultName) : defaultName;
  return save({ defaultPath, filters: exts.length ? exts.map((e) => ({ name: e === 'tone' ? 'Tone document' : e.toUpperCase(), extensions: [e] })) : undefined });
}

/** Browser fallback: pick files via <input type=file>. */
export function browserPickFiles(exts: string[], multiple = false): Promise<{ name: string; bytes: Uint8Array }[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    input.accept = exts.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const files = Array.from(input.files ?? []);
      resolve(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
    };
    input.click();
  });
}

/** Browser fallback: download bytes. */
export function browserDownload(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ---------- Window ----------

export async function windowAction(action: 'close' | 'minimize' | 'maximize') {
  if (!isTauri) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const w = getCurrentWindow();
  if (action === 'close') await w.close();
  else if (action === 'minimize') await w.minimize();
  else await w.toggleMaximize();
}

export async function setFullscreen(on: boolean) {
  if (!isTauri) {
    if (on) await document.documentElement.requestFullscreen?.().catch(() => {});
    else if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setFullscreen(on);
}

export async function relaunch() {
  if (!isTauri) return location.reload();
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

// ---------- Hashing ----------

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function uid(): string {
  return crypto.randomUUID();
}
