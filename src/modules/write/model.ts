// Write document model: ProseMirror state + page setup + comments + UI state, with a tiny emitter.
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, type Command, type Transaction } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { buildPlugins } from './plugins';
import { schema } from './schema';
import { trackTransaction } from './track';

export type Paper = 'Letter' | 'A4' | 'Legal';
export const PAPER_PX: Record<Paper, { w: number; h: number; label: string }> = {
  Letter: { w: 816, h: 1056, label: '8.5 × 11 in' },
  A4: { w: 794, h: 1123, label: '210 × 297 mm' },
  Legal: { w: 816, h: 1344, label: '8.5 × 14 in' },
};

export interface PageSetup {
  paper: Paper;
  orientation: 'portrait' | 'landscape';
  /** inches */
  margins: { top: number; bottom: number; left: number; right: number };
  columns: 1 | 2;
  header: string;
  footer: string;
  pageNumbers: boolean;
  differentFirst: boolean;
}

export const defaultPage = (): PageSetup => ({
  paper: 'Letter', orientation: 'portrait', margins: { top: 1, bottom: 1, left: 1, right: 1 }, columns: 1,
  header: '', footer: '', pageNumbers: false, differentFirst: false,
});

/** Page size in CSS px (96 dpi), orientation applied. */
export function pageBox(p: PageSetup) {
  const base = PAPER_PX[p.paper] ?? PAPER_PX.Letter;
  const land = p.orientation === 'landscape';
  return {
    w: land ? base.h : base.w, h: land ? base.w : base.h,
    top: p.margins.top * 96, bottom: p.margins.bottom * 96, left: p.margins.left * 96, right: p.margins.right * 96,
  };
}

export type FootnoteNumbering = 'decimal' | 'roman' | 'alpha' | 'symbols';
export interface FootnoteSettings { numbering: FootnoteNumbering; position: 'page' | 'end' }

export interface Comment { id: string; author: string; time: number; text: string }

export type Markup = 'all' | 'none' | 'original';
export type WriteDialog = { kind: 'toc'; pos?: number } | { kind: 'footnote'; pos?: number } | { kind: 'pageSetup' } | null;

export interface WriteUI {
  review: boolean;
  outline: boolean;
  focus: boolean;
  zoom: number;
  find: null | 'find' | 'replace';
  markup: Markup;
  dialog: WriteDialog;
  /** Filled by the editor's pagination pass. */
  pages: number;
  currentPage: number;
  /** Page (1-based) of each top-level block, by index. */
  blockPages: number[];
}

export class WriteModel {
  state: EditorState;
  page: PageSetup;
  tracking = false;
  comments: Comment[] = [];
  footnotes: FootnoteSettings = { numbering: 'decimal', position: 'end' };
  ui: WriteUI = { review: false, outline: true, focus: false, zoom: 1, find: null, markup: 'all', dialog: null, pages: 1, currentPage: 1, blockPages: [] };
  /** Live view while the editor is mounted (not serialized). */
  view: EditorView | null = null;
  /** Set by the mounted editor to report document edits to the core. */
  onDocChange: (() => void) | null = null;
  author = 'You';
  version = 0;
  private listeners = new Set<() => void>();

  constructor(doc?: PMNode, page?: PageSetup) {
    this.state = EditorState.create({ schema, doc: doc ?? blankDoc(), plugins: buildPlugins() });
    this.page = page ?? defaultPage();
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  emit() { this.version++; for (const l of this.listeners) l(); }

  /** Single entry point for every transaction (view and commands). Applies track changes. */
  apply = (tr: Transaction) => {
    const tracked = this.tracking ? trackTransaction(this.state, tr, this.author) : null;
    const next = this.state.apply(tracked ?? tr);
    this.state = next;
    this.view?.updateState(next);
    if (tr.docChanged) this.onDocChange?.();
    this.emit();
  };

  /** Run a ProseMirror command against the current state. Returns whether it applied. */
  exec(cmd: Command, focus = true): boolean {
    const ok = cmd(this.state, this.apply, this.view ?? undefined);
    if (focus) this.view?.focus();
    return ok;
  }

  setUI(patch: Partial<WriteUI>) { this.ui = { ...this.ui, ...patch }; this.emit(); }
}

export function blankDoc(): PMNode {
  return schema.node('doc', null, [schema.node('paragraph')]);
}

// ---------- Native serialization ----------

export const FORMAT_VERSION = 1;

export function serializeModel(m: WriteModel): Record<string, string> {
  return {
    'document.json': JSON.stringify({ formatVersion: FORMAT_VERSION, doc: m.state.doc.toJSON() }),
    'settings.json': JSON.stringify({ formatVersion: FORMAT_VERSION, page: m.page, tracking: m.tracking, comments: m.comments, footnotes: m.footnotes }),
  };
}

export function deserializeModel(files: Record<string, Uint8Array | string>, formatVersion: number): WriteModel {
  if (formatVersion > FORMAT_VERSION) throw new Error(`This document was made by a newer Tone (format ${formatVersion}). Update Tone to open it.`);
  const text = (k: string) => { const v = files[k]; return v == null ? null : typeof v === 'string' ? v : new TextDecoder().decode(v); };
  const docRaw = text('document.json');
  if (!docRaw) throw new Error('document.json missing from Write file');
  const parsed = JSON.parse(docRaw);
  const doc = schema.nodeFromJSON(parsed.doc ?? parsed);
  doc.check();
  const settingsRaw = text('settings.json');
  const s = settingsRaw ? JSON.parse(settingsRaw) : {};
  const m = new WriteModel(doc, { ...defaultPage(), ...(s.page ?? {}), margins: { ...defaultPage().margins, ...(s.page?.margins ?? {}) } });
  m.tracking = !!s.tracking;
  m.comments = Array.isArray(s.comments) ? s.comments : [];
  if (s.footnotes) m.footnotes = { ...m.footnotes, ...s.footnotes };
  return m;
}
