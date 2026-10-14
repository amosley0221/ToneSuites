// Paper document model: original PDF bytes (+ merged sources) and a non-destructive edit list.
// Everything here is pure (no DOM, no pdf.js) so it can be unit-tested in node.

export type Rot = 0 | 90 | 180 | 270;

/** Rect in PDF user space of the source page (unrotated, y-up). (x, y) is the lower-left corner. */
export interface Rect { x: number; y: number; w: number; h: number }

export interface SourceDoc { id: string; name: string; bytes: Uint8Array }

/** One output page. `src: null` = inserted blank page of `size` points. `rot` is rotation added on top of the page's own /Rotate. */
export interface PageRef { id: string; src: string | null; index: number; rot: Rot; size?: [number, number] }

interface EditBase { id: string; page: string; created: number; note?: string }
export type HighlightStyle = 'highlight' | 'strike';
export type Edit =
  | (EditBase & { kind: 'highlight'; rects: Rect[]; color: string; style: HighlightStyle; text?: string })
  | (EditBase & { kind: 'ink'; strokes: number[][]; color: string; width: number })
  | (EditBase & { kind: 'note'; x: number; y: number; text: string; color: string })
  | (EditBase & { kind: 'text'; rect: Rect; text: string; size: number; color: string })
  | (EditBase & { kind: 'stamp'; rect: Rect; text: string; color: string })
  | (EditBase & { kind: 'whiteout'; rect: Rect })
  | (EditBase & { kind: 'redact'; rect: Rect; applied: boolean })
  | (EditBase & { kind: 'signature'; rect: Rect; image: string });
export type EditKind = Edit['kind'];
export type RectEdit = Extract<Edit, { rect: Rect }>;

export type FieldType = 'text' | 'date' | 'number' | 'checkbox' | 'signature';
/** A form field added with the Form builder; written as a real AcroForm field on save. */
export interface NewField { id: string; page: string; rect: Rect; type: FieldType; name: string; required: boolean }

export interface PaperData {
  sources: SourceDoc[];
  pages: PageRef[];
  edits: Edit[];
  /** AcroForm values for fields of the original document (sources[0]), keyed by fully-qualified field name. */
  formValues: Record<string, string | boolean>;
  newFields: NewField[];
  flattenForm: boolean;
}

export type Tool = 'Annotate' | 'Highlight' | 'Sign' | 'Fill form' | 'Redact' | 'Edit' | 'Organize' | 'Convert';
export const TOOLS: Tool[] = ['Annotate', 'Highlight', 'Sign', 'Fill form', 'Redact', 'Edit', 'Organize', 'Convert'];
export type SubTool = 'pen' | 'note' | 'stamp' | 'hl-text' | 'hl-area' | 'strike' | 'place-sign' | 'redact' | 'text' | 'whiteout' | 'none';

export interface SearchHit { page: string; rects: Rect[] }
export interface PaperUi {
  tool: Tool;
  sub: SubTool;
  page: number;
  zoom: number;
  color: string;
  hlColor: string;
  penWidth: number;
  stampText: string;
  textSize: number;
  selected: string | null;
  signature: string | null;
  search: { open: boolean; query: string; hits: SearchHit[]; index: number; busy: boolean };
  thumbs: boolean;
  /** Bumped to ask the work area to scroll page `page` into view. */
  scrollReq: number;
  panels: boolean;
}

export const LETTER: [number, number] = [612, 792];

let seq = 0;
export const newId = (p = 'e') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function defaultUi(): PaperUi {
  return {
    tool: 'Annotate', sub: 'pen', page: 0, zoom: 1, color: '#e5484d', hlColor: '#ffd400', penWidth: 2, stampText: 'APPROVED', textSize: 12,
    selected: null, signature: null, search: { open: false, query: '', hits: [], index: 0, busy: false }, thumbs: true, scrollReq: 0, panels: false,
  };
}

type Snapshot = string;

export class PaperModel implements PaperData {
  sources: SourceDoc[] = [];
  pages: PageRef[] = [];
  edits: Edit[] = [];
  formValues: Record<string, string | boolean> = {};
  newFields: NewField[] = [];
  flattenForm = false;
  fileName: string;
  ui: PaperUi = defaultUi();
  version = 0;
  private listeners = new Set<() => void>();
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];

  constructor(fileName: string, data?: Partial<PaperData>) {
    this.fileName = fileName;
    if (data) Object.assign(this, data);
  }

  /** Build a model for a freshly opened PDF with `pageCount` pages. */
  static fromPdf(bytes: Uint8Array, fileName: string, pageCount: number): PaperModel {
    const src: SourceDoc = { id: 'src0', name: fileName, bytes };
    const pages = Array.from({ length: pageCount }, (_, i): PageRef => ({ id: newId('p'), src: src.id, index: i, rot: 0 }));
    return new PaperModel(fileName, { sources: [src], pages });
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  emit() { this.version++; for (const l of [...this.listeners]) l(); }

  /** UI-only change (no undo entry, not dirty). */
  setUi(patch: Partial<PaperUi>) { this.ui = { ...this.ui, ...patch }; this.emit(); }

  private snapshot(): Snapshot {
    return JSON.stringify({ s: this.sources.map((s) => s.id), p: this.pages, e: this.edits, f: this.formValues, n: this.newFields, fl: this.flattenForm });
  }
  private restore(snap: Snapshot) {
    const o = JSON.parse(snap);
    // Sources only ever grow; keep bytes of any still referenced.
    this.sources = this.sources.filter((s) => o.s.includes(s.id));
    this.pages = o.p; this.edits = o.e; this.formValues = o.f; this.newFields = o.n; this.flattenForm = o.fl;
  }

  /** Document change with an undo entry. Caller is responsible for marking the doc dirty. */
  mutate(fn: (m: PaperModel) => void) {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
    fn(this);
    this.clampPage();
    this.emit();
  }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() {
    const s = this.undoStack.pop();
    if (!s) return false;
    this.redoStack.push(this.snapshot());
    this.restore(s);
    this.ui = { ...this.ui, selected: null };
    this.clampPage(); this.emit();
    return true;
  }
  redo() {
    const s = this.redoStack.pop();
    if (!s) return false;
    this.undoStack.push(this.snapshot());
    this.restore(s);
    this.clampPage(); this.emit();
    return true;
  }
  private clampPage() {
    if (this.ui.page >= this.pages.length) this.ui = { ...this.ui, page: Math.max(0, this.pages.length - 1) };
  }

  source(id: string | null): SourceDoc | undefined { return id ? this.sources.find((s) => s.id === id) : undefined; }
  pageIndex(pageId: string) { return this.pages.findIndex((p) => p.id === pageId); }
  /** Edits whose page still exists, in page order. */
  liveEdits(): Edit[] {
    const order = new Map(this.pages.map((p, i) => [p.id, i]));
    return this.edits.filter((e) => order.has(e.page)).sort((a, b) => order.get(a.page)! - order.get(b.page)! || a.created - b.created);
  }
  data(): PaperData {
    return { sources: this.sources, pages: this.pages, edits: this.edits, formValues: this.formValues, newFields: this.newFields, flattenForm: this.flattenForm };
  }
}

/** Human label for an edit (inspector list). */
export function editLabel(e: Edit): string {
  switch (e.kind) {
    case 'highlight': return e.style === 'strike' ? 'Strikethrough' : 'Highlight';
    case 'ink': return 'Ink';
    case 'note': return 'Note';
    case 'text': return 'Text box';
    case 'stamp': return 'Stamp';
    case 'whiteout': return 'Whiteout';
    case 'redact': return e.applied ? 'Redaction' : 'Redaction (marked)';
    case 'signature': return 'Signature';
  }
}
export function editDetail(e: Edit): string {
  const t = e.note || (e.kind === 'note' || e.kind === 'text' || e.kind === 'stamp' ? e.text : e.kind === 'highlight' ? e.text ?? '' : '');
  return t.length > 28 ? t.slice(0, 27) + '…' : t;
}

/** Bounding rect of any edit (user space). */
export function editBounds(e: Edit): Rect {
  switch (e.kind) {
    case 'highlight': return unionRects(e.rects);
    case 'ink': {
      const xs: number[] = [], ys: number[] = [];
      for (const s of e.strokes) for (let i = 0; i < s.length; i += 2) { xs.push(s[i]); ys.push(s[i + 1]); }
      if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 };
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case 'note': return { x: e.x, y: e.y - 18, w: 18, h: 18 };
    default: return e.rect;
  }
}

export function unionRects(rs: Rect[]): Rect {
  if (!rs.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x0 = Math.min(...rs.map((r) => r.x)), y0 = Math.min(...rs.map((r) => r.y));
  const x1 = Math.max(...rs.map((r) => r.x + r.w)), y1 = Math.max(...rs.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
}

/** Move an edit by (dx, dy) in user space; returns a new edit. */
export function translateEdit(e: Edit, dx: number, dy: number): Edit {
  const mv = (r: Rect): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });
  switch (e.kind) {
    case 'highlight': return { ...e, rects: e.rects.map(mv) };
    case 'ink': return { ...e, strokes: e.strokes.map((s) => s.map((v, i) => v + (i % 2 ? dy : dx))) };
    case 'note': return { ...e, x: e.x + dx, y: e.y + dy };
    default: return { ...e, rect: mv(e.rect) } as Edit;
  }
}
