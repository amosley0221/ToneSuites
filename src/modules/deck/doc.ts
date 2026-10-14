// DeckDoc: the live model object shared by the Editor and command handlers.
// `data` is the serializable deck; `media` holds image bytes (kept out of undo snapshots);
// `ui` is view state (current slide, selection, panels) that is not saved.
import { emptyDeck, type DeckData, type El, type Slide } from './model';

export interface MediaItem { mime: string; bytes: Uint8Array; url: string }

export type PresentMode = 'present' | 'presenter' | 'rehearse';

export interface DeckUi {
  current: number;
  selection: string[];
  timeline: boolean;
  zoomFit: boolean;
  mastersOpen: boolean;
  presenting: PresentMode | null;
  presentFrom: number;
  /** Element id currently in inline text editing. */
  editing: string | null;
  panelsOpen: boolean;
  showNotes: boolean;
  /** Bumped to (re)start the animation preview in the timeline. */
  previewToken?: number;
}

const MAX_UNDO = 100;

export class DeckDoc {
  data: DeckData;
  media = new Map<string, MediaItem>();
  ui: DeckUi = {
    current: 0, selection: [], timeline: false, zoomFit: false, mastersOpen: false, presenting: null, presentFrom: 0,
    editing: null, panelsOpen: false, showNotes: true,
  };
  version = 0;
  /** Tab title, kept in sync by the Editor (used for export file names). */
  title = '';
  clipboard: El[] = [];
  private listeners = new Set<() => void>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private snapshot: string;
  private lastKey: string | null = null;
  private lastAt = 0;
  /** Set by the Editor so edits made inside it mark the tab dirty. */
  onEdit: (() => void) | null = null;

  constructor(data?: DeckData) {
    this.data = data ?? emptyDeck();
    this.snapshot = JSON.stringify(this.data);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  /** Re-render without recording history (UI state changes). */
  emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /**
   * Record an undo step after a data mutation and notify listeners.
   * Consecutive commits with the same `coalesceKey` within 1.2s merge into one step (typing, nudging).
   */
  commit(coalesceKey?: string) {
    const now = Date.now();
    const merge = coalesceKey && coalesceKey === this.lastKey && now - this.lastAt < 1200;
    if (!merge) {
      this.undoStack.push(this.snapshot);
      if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    }
    this.redoStack = [];
    this.lastKey = coalesceKey ?? null;
    this.lastAt = now;
    this.snapshot = JSON.stringify(this.data);
    this.clampUi();
    this.emit();
    this.onEdit?.();
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.snapshot);
    this.restore(prev);
    return true;
  }
  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.snapshot);
    this.restore(next);
    return true;
  }
  private restore(s: string) {
    this.snapshot = s;
    this.data = JSON.parse(s);
    this.lastKey = null;
    this.ui.editing = null;
    this.clampUi();
    this.emit();
    this.onEdit?.();
  }

  private clampUi() {
    const n = this.data.slides.length;
    this.ui.current = Math.max(0, Math.min(this.ui.current, n - 1));
    const ids = new Set(this.slide()?.elements.map((e) => e.id) ?? []);
    this.ui.selection = this.ui.selection.filter((id) => ids.has(id));
  }

  slide(i = this.ui.current): Slide | undefined { return this.data.slides[i]; }
  selected(): El[] {
    const s = this.slide();
    if (!s) return [];
    return s.elements.filter((e) => this.ui.selection.includes(e.id));
  }
  select(ids: string[]) { this.ui.selection = ids; this.ui.editing = null; this.emit(); }
  goTo(i: number) {
    this.ui.current = Math.max(0, Math.min(i, this.data.slides.length - 1));
    this.ui.selection = [];
    this.ui.editing = null;
    this.emit();
  }

  addMedia(bytes: Uint8Array, declaredMime: string): string {
    const mime = sniffMime(bytes) ?? declaredMime;
    const ext = mimeExt(mime);
    const path = `media/${Math.random().toString(36).slice(2, 10)}.${ext}`;
    this.media.set(path, { mime, bytes, url: toDataUrl(bytes, mime) });
    return path;
  }
  mediaUrl(path: string): string { return this.media.get(path)?.url ?? ''; }
}

/** Detect common image formats from magic bytes (file extensions lie). */
export function sniffMime(b: Uint8Array): string | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) return 'image/bmp';
  return null;
}

export function mimeExt(mime: string): string {
  return ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' } as Record<string, string>)[mime] ?? 'bin';
}
export function extMime(ext: string): string {
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp' } as Record<string, string>)[ext.toLowerCase()] ?? 'application/octet-stream';
}

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(bin)}`;
}
