// Font registry shared by every module: fonts bundled with Tone, fonts the user added, and fonts installed on
// the device. Added fonts live in the workspace's Fonts folder, so they sync to the user's other devices.
import { create } from 'zustand';
import { basename, extOf, isTauri, joinPath, listDir, mkdirp, readFile, stripExt, writeFile } from './platform';
import { useSettings } from './settings';

/** Fonts that ship inside the app (always available, also embedded in PDF exports). */
export const BUNDLED_FONTS = ['Archivo', 'JetBrains Mono'];

/** Used when the device can't list its fonts (plain browser): common families most systems have. */
const FALLBACK_SYSTEM = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Garamond', 'Georgia', 'Helvetica', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];

export const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'];

export interface CustomFont { family: string; file: string }

interface FontState {
  loaded: boolean;
  system: string[];
  custom: CustomFont[];
}

export const useFonts = create<FontState>(() => ({ loaded: false, system: [], custom: [] }));

/** All families for pickers: added fonts, then bundled, then the device's, without duplicates. */
export function allFontFamilies(s: FontState = useFonts.getState()): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...s.custom.map((c) => c.family), ...BUNDLED_FONTS, ...s.system]) {
    const k = f.toLowerCase();
    if (!seen.has(k)) { seen.add(k); out.push(f); }
  }
  return out;
}

/** CSS font-family value with a sensible fallback. */
export function cssFontFamily(family: string, fallback = 'sans-serif'): string {
  return `"${family.replace(/"/g, '')}", ${fallback}`;
}

async function fontsDir(): Promise<string | null> {
  const ws = useSettings.getState().s.workspaceDir;
  return ws ? joinPath(ws, 'Fonts') : null;
}

/** Read the family name from a font file (falls back to the file name). */
export async function familyOf(bytes: Uint8Array, filename: string): Promise<string> {
  try {
    const fontkit = (await import('@pdf-lib/fontkit')).default as any;
    const font = fontkit.create(bytes);
    const name = font.familyName || font.fullName;
    if (name) return String(name);
  } catch { /* unreadable: use the file name */ }
  return stripExt(filename).replace(/[-_](Regular|Bold|Italic|Light|Medium)$/i, '');
}

const registered = new Set<string>();
async function register(family: string, bytes: Uint8Array, key: string) {
  if (registered.has(key)) return;
  const face = new FontFace(family, bytes.slice().buffer);
  await face.load();
  document.fonts.add(face);
  registered.add(key);
}

/** Load the font lists (call once at startup, and again after the workspace changes). */
export async function loadFonts(): Promise<void> {
  const custom: CustomFont[] = [];
  let system: string[] = [];
  if (isTauri) {
    const { invoke } = await import('@tauri-apps/api/core');
    system = await invoke<string[]>('system_fonts').catch(() => []);
    const dir = await fontsDir();
    if (dir) {
      const files = await listDir(dir).catch(() => []);
      for (const f of files) {
        if (f.isDir || !FONT_EXTS.includes(extOf(f.name))) continue;
        try {
          const path = await joinPath(dir, f.name);
          const bytes = await readFile(path);
          const family = await familyOf(bytes, f.name);
          await register(family, bytes, path);
          custom.push({ family, file: f.name });
        } catch (e) { console.warn('font', f.name, e); }
      }
    }
  } else {
    // Chromium can list local fonts (with permission); otherwise offer common families.
    try {
      const q = (window as any).queryLocalFonts as undefined | (() => Promise<{ family: string }[]>);
      if (q) system = [...new Set((await q()).map((f) => f.family))];
    } catch { /* permission denied */ }
    if (!system.length) system = FALLBACK_SYSTEM;
    custom.push(...useFonts.getState().custom);
  }
  system.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  useFonts.setState({ loaded: true, system, custom });
}

/** Pick font files and add them (copied into the synced workspace Fonts folder). Returns the added families. */
export async function addFonts(): Promise<string[]> {
  const { pickFiles } = await import('./documents');
  const picked = await pickFiles(FONT_EXTS, true);
  const added: CustomFont[] = [];
  const dir = isTauri ? await fontsDir() : null;
  if (dir) await mkdirp(dir);
  for (const f of picked) {
    const family = await familyOf(f.bytes, f.name);
    if (dir) {
      const path = await joinPath(dir, basename(f.name));
      await writeFile(path, f.bytes);
      await register(family, f.bytes, path);
    } else {
      await register(family, f.bytes, 'mem:' + f.name);
    }
    added.push({ family, file: basename(f.name) });
  }
  if (added.length) {
    const cur = useFonts.getState().custom.filter((c) => !added.some((a) => a.file === c.file));
    useFonts.setState({ custom: [...cur, ...added] });
    if (dir) void import('@/storage/sync').then((s) => s.requestSync());
  }
  return added.map((a) => a.family);
}

export async function removeFont(file: string): Promise<void> {
  const dir = isTauri ? await fontsDir() : null;
  if (dir) {
    const { removePath } = await import('./platform');
    await removePath(await joinPath(dir, file));
    void import('@/storage/sync').then((s) => s.requestSync());
  }
  useFonts.setState({ custom: useFonts.getState().custom.filter((c) => c.file !== file) });
}

/**
 * Font file bytes for embedding in exports (PDF). Added fonts come from the workspace; installed fonts from the
 * system (closest weight/style). Returns null when the font can't be embedded (the exporter then falls back).
 */
export async function fontData(family: string, bold = false, italic = false): Promise<Uint8Array | null> {
  const c = useFonts.getState().custom.find((f) => f.family.toLowerCase() === family.toLowerCase());
  const dir = isTauri ? await fontsDir() : null;
  if (c && dir) {
    try { return await readFile(await joinPath(dir, c.file)); } catch { /* fall through */ }
  }
  if (!isTauri) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const buf = await invoke<ArrayBuffer>('system_font_data', { family, bold, italic });
    return new Uint8Array(buf);
  } catch { return null; }
}
