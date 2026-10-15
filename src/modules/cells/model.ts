// Workbook model: raw cell inputs + formats per sheet (serializable), with a HyperFormula
// instance mirrored from it for evaluation. The HF instance is rebuilt on load.
import { HyperFormula, DetailedCellError, type RawCellContent } from 'hyperformula';
import {
  cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS, normRange, parseA1, parseRange, toA1, rangeToA1, shiftFormula, shiftRangeDelete, shiftRangeInsert,
  type Range,
} from './address';
import { formatNumber, type NumFmt, type NumKind } from './numfmt';

// ---------- Types ----------

export interface Borders { t?: boolean; r?: boolean; b?: boolean; l?: boolean }
export interface CellFormat {
  b?: boolean; i?: boolean; u?: boolean; s?: boolean;
  nf?: NumFmt; dp?: number; cur?: string;
  al?: 'left' | 'center' | 'right';
  wrap?: boolean;
  fill?: string; color?: string;
  bd?: Borders;
}
export interface CellData { v: string; f?: CellFormat }

export type ChartType = 'column' | 'bar' | 'line' | 'area' | 'pie' | 'scatter' | 'stacked' | 'combo';
export interface ChartDef {
  id: string;
  type: ChartType;
  /** Sheet id + A1 range of the source data. */
  sheetId: string;
  range: string;
  title: string;
  switchRC: boolean;
  legend: boolean;
  gridlines: boolean;
  labels: boolean;
  showTitle: boolean;
  /** Indexes of series hidden by the user. */
  hidden: number[];
  /** Floating position in grid content pixels. */
  x: number; y: number; w: number; h: number;
}

export type CondKind = 'gt' | 'lt' | 'between' | 'eq' | 'contains' | 'topN' | 'scale';
export interface CondRule {
  id: string;
  range: string;
  kind: CondKind;
  a?: string;
  b?: string;
  style: { b?: boolean; i?: boolean; color?: string; fill?: string };
  scale?: { min: string; max: string };
}

export interface AutoFilter {
  range: Range;
  /** Absolute column → display values that are filtered out. */
  hidden: Record<number, string[]>;
  /** Absolute column → "contains" text typed in the filter search (rows that don't match are hidden). */
  contains?: Record<number, string>;
}

/** Normalise text for filter search: case-insensitive, ignoring spaces and thousands separators. */
export function filterKey(s: string): string {
  return s.toLowerCase().replace(/[\s,]/g, '');
}

export interface Selection { r: number; c: number; range: Range }

export interface Sheet {
  id: string;
  name: string;
  cells: Map<number, CellData>;
  colWidths: Map<number, number>;
  rowHeights: Map<number, number>;
  merges: Range[];
  freeze: { rows: number; cols: number };
  charts: ChartDef[];
  condFormats: CondRule[];
  filter: AutoFilter | null;
  showGrid: boolean;
  // transient (not serialized)
  sel: Selection;
  scroll: { x: number; y: number };
  _bounds?: { rows: number; cols: number };
  _hidden?: Set<number>;
}

export interface EditState {
  sheetId: string;
  r: number; c: number;
  text: string;
  /** 'enter' = started by typing (arrows commit); 'edit' = F2 / double-click (arrows move the caret). */
  mode: 'enter' | 'edit';
  source: 'cell' | 'bar';
}

export interface ClipState {
  sheetId: string;
  range: Range;
  cut: boolean;
  tsv: string;
  cells: (CellData | undefined)[][];
  /** Source row of each block row, when filtered-out rows were skipped by the copy. */
  rows?: number[];
}

export interface Display {
  text: string;
  kind: 'empty' | 'num' | 'text' | 'bool' | 'err';
  num?: number;
}

type UndoEntry =
  | { kind: 'cells'; sheetId: string; before: [number, CellData | undefined][]; after: [number, CellData | undefined][] }
  | { kind: 'snap'; before: string; after?: string }
  | { kind: 'group'; entries: UndoEntry[] };

export const DEFAULT_COL_W = 140;
export const DEFAULT_ROW_H = 28;

export const uid = () => Math.random().toString(36).slice(2, 10);

export function newSheet(name: string): Sheet {
  return {
    id: uid(), name, cells: new Map(), colWidths: new Map(), rowHeights: new Map(), merges: [], freeze: { rows: 0, cols: 0 },
    charts: [], condFormats: [], filter: null, showGrid: true,
    sel: { r: 0, c: 0, range: { r0: 0, c0: 0, r1: 0, c1: 0 } }, scroll: { x: 0, y: 0 },
  };
}

/**
 * Slash dates follow the device's locale order: "03/04/2024" is 4 March in the US and 3 April elsewhere.
 * (Mixing both orders would turn half of a US date column into dates and leave the rest as text.)
 */
export function localeDateFormats(locale?: string): string[] {
  let monthFirst = false;
  try {
    const parts = new Intl.DateTimeFormat(locale).formatToParts(new Date(2000, 11, 31));
    const order = parts.filter((p) => p.type === 'day' || p.type === 'month').map((p) => p.type);
    monthFirst = order[0] === 'month';
  } catch { /* no Intl: day first */ }
  return monthFirst ? ['YYYY-MM-DD', 'YYYY/MM/DD', 'MM/DD/YYYY', 'MM/DD/YY'] : ['YYYY-MM-DD', 'YYYY/MM/DD', 'DD/MM/YYYY', 'DD/MM/YY'];
}

const HF_CONFIG = {
  licenseKey: 'gpl-v3',
  maxRows: MAX_ROWS,
  maxColumns: MAX_COLS,
  dateFormats: localeDateFormats(),
  useArrayArithmetic: true,
};

/** Convert a raw user input into HyperFormula content. */
export function toHF(cell: CellData | undefined): RawCellContent {
  if (!cell) return null;
  const v = cell.v;
  if (v === '') return null;
  // A formula keeps calculating when its cell is later formatted as Text (as in Excel).
  if (v.length > 1 && v.startsWith('=')) return v;
  if (cell.f?.nf === 'text' && !v.startsWith("'")) return "'" + v;
  const t = v.trim();
  // Thousands separators: "1,234.50" / "-$1,234" / "12,000%" → strip commas so HF parses a number.
  if (/^[-+]?[$€£]?\d{1,3}(,\d{3})+(\.\d+)?%?$/.test(t)) return t.replace(/,/g, '');
  return v;
}

function kindOf(t: string): NumKind {
  switch (t) {
    case 'NUMBER_DATE': return 'date';
    case 'NUMBER_DATETIME': return 'datetime';
    case 'NUMBER_TIME': return 'time';
    case 'NUMBER_PERCENT': return 'percent';
    case 'NUMBER_CURRENCY': return 'currency';
    default: return 'raw';
  }
}

// ---------- Workbook ----------

export class Workbook {
  sheets: Sheet[] = [];
  active = 0;
  hf!: HyperFormula;
  /** Bumped on every change (data or view) — React subscribes to this. */
  version = 0;
  /** Bumped on data changes only (values, formats, structure). */
  dataVersion = 0;
  ui = {
    edit: null as EditState | null,
    clip: null as ClipState | null,
    showFormulas: false,
    zoom: 1,
    selectedChart: null as string | null,
    /** Set when the active cell should be scrolled into view by the grid. */
    reveal: false,
    /** Incremented to ask the editor to focus the grid / name box. */
    focusGrid: 0,
    focusNameBox: 0,
  };
  private listeners = new Set<(data: boolean) => void>();
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private grouping: UndoEntry[] | null = null;

  constructor(sheets?: Sheet[]) {
    this.sheets = sheets && sheets.length ? sheets : [newSheet('Sheet 1')];
    this.rebuildEngine();
  }

  // ----- events -----
  subscribe(fn: (data: boolean) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }
  /** Notify listeners. `data` = the document changed (marks dirty). */
  emit(data = false) {
    this.version++;
    if (data) {
      this.dataVersion++;
      for (const s of this.sheets) { s._bounds = undefined; s._hidden = undefined; }
    }
    for (const l of [...this.listeners]) l(data);
  }

  get sheet(): Sheet { return this.sheets[this.active]; }
  sheetById(id: string): Sheet | undefined { return this.sheets.find((s) => s.id === id); }
  sheetByName(name: string): Sheet | undefined {
    const n = name.toLowerCase();
    return this.sheets.find((s) => s.name.toLowerCase() === n);
  }

  // ----- engine -----
  rebuildEngine() {
    const data: Record<string, RawCellContent[][]> = {};
    for (const s of this.sheets) {
      const arr: RawCellContent[][] = [];
      for (const [k, cell] of s.cells) {
        const content = toHF(cell);
        if (content == null) continue;
        const r = keyRow(k);
        const c = keyCol(k);
        (arr[r] ??= [])[c] = content;
      }
      for (let i = 0; i < arr.length; i++) if (!arr[i]) arr[i] = [];
      data[s.name] = arr;
    }
    this.hf?.destroy();
    this.hf = HyperFormula.buildFromSheets(data as any, HF_CONFIG as any);
  }

  hfId(s: Sheet): number {
    const id = this.hf.getSheetId(s.name);
    if (id === undefined) throw new Error(`Sheet ${s.name} missing in engine`);
    return id;
  }

  // ----- reading -----
  getCell(s: Sheet, r: number, c: number): CellData | undefined {
    return s.cells.get(cellKey(r, c));
  }

  value(s: Sheet, r: number, c: number): unknown {
    const cell = s.cells.get(cellKey(r, c));
    if (!cell || cell.v === '') return null;
    return this.hf.getCellValue({ sheet: this.hfId(s), row: r, col: c });
  }

  /** Numeric value of a cell or null. */
  num(s: Sheet, r: number, c: number): number | null {
    const v = this.value(s, r, c);
    return typeof v === 'number' ? v : null;
  }

  display(s: Sheet, r: number, c: number): Display {
    const cell = s.cells.get(cellKey(r, c));
    if (!cell || cell.v === '') return { text: '', kind: 'empty' };
    if (this.ui.showFormulas && cell.v.startsWith('=')) return { text: cell.v, kind: 'text' };
    const addr = { sheet: this.hfId(s), row: r, col: c };
    const v = this.hf.getCellValue(addr);
    if (v === null || v === undefined) return { text: '', kind: 'empty' };
    if (v instanceof DetailedCellError) return { text: v.value, kind: 'err' };
    if (typeof v === 'number') {
      const kind = kindOf(String(this.hf.getCellValueDetailedType(addr)));
      return { text: formatNumber(v, cell.f?.nf, cell.f?.dp, kind, cell.f?.cur), kind: 'num', num: v };
    }
    if (typeof v === 'boolean') return { text: v ? 'TRUE' : 'FALSE', kind: 'bool' };
    return { text: String(v), kind: 'text' };
  }

  /** Used size (rows/cols counts, i.e. last used index + 1). */
  bounds(s: Sheet): { rows: number; cols: number } {
    if (!s._bounds) {
      let rows = 0;
      let cols = 0;
      for (const [k, cell] of s.cells) {
        if (cell.v === '' && !cell.f) continue;
        const r = keyRow(k) + 1;
        const c = keyCol(k) + 1;
        if (r > rows) rows = r;
        if (c > cols) cols = c;
      }
      for (const m of s.merges) { rows = Math.max(rows, m.r1 + 1); cols = Math.max(cols, m.c1 + 1); }
      s._bounds = { rows, cols };
    }
    return s._bounds;
  }

  /** Does the cell's shown text or raw input contain the (normalised) query? */
  matchesQuery(s: Sheet, r: number, c: number, q: string): boolean {
    if (filterKey(this.display(s, r, c).text).includes(q)) return true;
    const raw = s.cells.get(cellKey(r, c))?.v ?? '';
    return filterKey(raw).includes(q);
  }

  /** Rows hidden by the sheet's AutoFilter. */
  hiddenRows(s: Sheet): Set<number> {
    if (!s._hidden) {
      const set = new Set<number>();
      const f = s.filter;
      if (f) {
        const cols = Object.entries(f.hidden).filter(([, v]) => v.length).map(([c, v]) => [+c, new Set(v)] as const);
        const queries = Object.entries(f.contains ?? {}).filter(([, q]) => filterKey(q)).map(([c, q]) => [+c, filterKey(q)] as const);
        if (cols.length || queries.length) {
          for (let r = f.range.r0 + 1; r <= f.range.r1; r++) {
            if (cols.some(([c, vals]) => vals.has(this.display(s, r, c).text))) { set.add(r); continue; }
            if (queries.some(([c, q]) => !this.matchesQuery(s, r, c, q))) set.add(r);
          }
        }
      }
      s._hidden = set;
    }
    return s._hidden;
  }

  isEmpty(s: Sheet, r: number, c: number): boolean {
    const cell = s.cells.get(cellKey(r, c));
    return !cell || cell.v === '';
  }

  mergeAt(s: Sheet, r: number, c: number): Range | undefined {
    for (const m of s.merges) if (r >= m.r0 && r <= m.r1 && c >= m.c0 && c <= m.c1) return m;
    return undefined;
  }

  /** The contiguous block of non-empty cells around (r, c) — Excel's "current region". */
  currentRegion(s: Sheet, r: number, c: number): Range {
    let g: Range = { r0: r, c0: c, r1: r, c1: c };
    const filled = (rr: number, cc: number) => rr >= 0 && cc >= 0 && !this.isEmpty(s, rr, cc);
    const b = this.bounds(s);
    const rowHas = (rr: number) => { for (let cc = g.c0 - 1; cc <= g.c1 + 1; cc++) if (filled(rr, cc)) return true; return false; };
    const colHas = (cc: number) => { for (let rr = g.r0 - 1; rr <= g.r1 + 1; rr++) if (filled(rr, cc)) return true; return false; };
    // Grow each edge as far as it goes before re-checking the others (a 50,000-row list takes one pass down).
    let grew = true;
    while (grew) {
      grew = false;
      while (g.r0 > 0 && rowHas(g.r0 - 1)) { g = { ...g, r0: g.r0 - 1 }; grew = true; }
      while (g.r1 + 1 < b.rows && rowHas(g.r1 + 1)) { g = { ...g, r1: g.r1 + 1 }; grew = true; }
      while (g.c0 > 0 && colHas(g.c0 - 1)) { g = { ...g, c0: g.c0 - 1 }; grew = true; }
      while (g.c1 + 1 < b.cols && colHas(g.c1 + 1)) { g = { ...g, c1: g.c1 + 1 }; grew = true; }
    }
    return g;
  }

  /** Ctrl+Arrow target from (r,c) in direction (dr,dc). */
  dataEdge(s: Sheet, r: number, c: number, dr: number, dc: number): { r: number; c: number } {
    const b = this.bounds(s);
    const maxR = Math.max(b.rows - 1, r);
    const maxC = Math.max(b.cols - 1, c);
    const ok = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr <= maxR && cc <= maxC;
    const filled = (rr: number, cc: number) => !this.isEmpty(s, rr, cc);
    let rr = r;
    let cc = c;
    if (!ok(rr + dr, cc + dc)) return { r: dr < 0 ? 0 : dr > 0 ? maxR : r, c: dc < 0 ? 0 : dc > 0 ? maxC : c };
    if (filled(rr, cc) && filled(rr + dr, cc + dc)) {
      while (ok(rr + dr, cc + dc) && filled(rr + dr, cc + dc)) { rr += dr; cc += dc; }
      return { r: rr, c: cc };
    }
    rr += dr; cc += dc;
    while (ok(rr, cc) && !filled(rr, cc)) {
      if (!ok(rr + dr, cc + dc)) break;
      rr += dr; cc += dc;
    }
    return { r: rr, c: cc };
  }

  // ----- selection -----
  select(r: number, c: number, range?: Range, reveal = true) {
    const s = this.sheet;
    const rr = Math.max(0, Math.min(MAX_ROWS - 1, r));
    const cc = Math.max(0, Math.min(MAX_COLS - 1, c));
    s.sel = { r: rr, c: cc, range: normRange(range ?? { r0: rr, c0: cc, r1: rr, c1: cc }) };
    this.ui.reveal = reveal;
    this.ui.selectedChart = null;
    this.emit();
  }

  /** Selection range (expanded to merges that the active cell covers). */
  selRange(s: Sheet = this.sheet): Range { return s.sel.range; }

  setActiveSheet(i: number) {
    if (i < 0 || i >= this.sheets.length || i === this.active) return;
    this.commitEdit();
    this.active = i;
    this.ui.selectedChart = null;
    this.emit();
  }

  // ----- editing state -----
  beginEdit(text: string | null, mode: 'enter' | 'edit', source: 'cell' | 'bar' = 'cell') {
    const s = this.sheet;
    const cell = this.getCell(s, s.sel.r, s.sel.c);
    this.ui.edit = { sheetId: s.id, r: s.sel.r, c: s.sel.c, text: text ?? cell?.v ?? '', mode, source };
    this.emit();
  }
  setEditText(text: string) {
    if (!this.ui.edit) return;
    this.ui.edit = { ...this.ui.edit, text };
    this.emit();
  }
  cancelEdit() {
    if (!this.ui.edit) return;
    this.ui.edit = null;
    this.ui.focusGrid++;
    this.emit();
  }
  /** Commit the in-progress edit; returns true if something was committed. */
  commitEdit(): boolean {
    const e = this.ui.edit;
    if (!e) return false;
    this.ui.edit = null;
    const s = this.sheetById(e.sheetId);
    if (!s) return false;
    let text = e.text;
    // Auto-close parentheses like Excel does for simple cases.
    if (text.startsWith('=')) {
      const open = (text.match(/\(/g) || []).length - (text.match(/\)/g) || []).length;
      if (open > 0 && !/"/.test(text)) text += ')'.repeat(open);
    }
    const prev = this.getCell(s, e.r, e.c);
    if ((prev?.v ?? '') === text) { this.emit(); return false; }
    this.setInputs(s, [{ r: e.r, c: e.c, v: text }]);
    return true;
  }

  // ----- undo -----
  private pushUndo(e: UndoEntry) {
    this.redoStack = [];
    if (this.grouping) { this.grouping.push(e); return; }
    this.undoStack.push(e);
    if (this.undoStack.length > 200) this.undoStack.shift();
    // Snapshots can be big — keep only the 20 most recent.
    const hasSnap = (u: UndoEntry): boolean => u.kind === 'snap' || (u.kind === 'group' && u.entries.some(hasSnap));
    let snaps = 0;
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      if (hasSnap(this.undoStack[i]) && ++snaps > 20) { this.undoStack.splice(0, i + 1); break; }
    }
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Run several edits (cells, structure, sheets) as one undo step. */
  group(fn: () => void) {
    if (this.grouping) { fn(); return; }
    const list: UndoEntry[] = [];
    this.grouping = list;
    try { fn(); } finally { this.grouping = null; }
    if (list.length) this.pushUndo(list.length === 1 ? list[0] : { kind: 'group', entries: list });
  }

  private undoEntry(e: UndoEntry) {
    if (e.kind === 'cells') this.applyCellEntries(e.sheetId, e.before);
    else if (e.kind === 'snap') { e.after = this.snapshot(); this.restore(e.before); }
    else for (let i = e.entries.length - 1; i >= 0; i--) this.undoEntry(e.entries[i]);
  }
  private redoEntry(e: UndoEntry) {
    if (e.kind === 'cells') this.applyCellEntries(e.sheetId, e.after);
    else if (e.kind === 'snap') { if (e.after) { const before = this.snapshot(); this.restore(e.after); e.before = before; } }
    else for (const x of e.entries) this.redoEntry(x);
  }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.undoEntry(e);
    this.redoStack.push(e);
    this.emit(true);
    return true;
  }
  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.redoEntry(e);
    this.undoStack.push(e);
    this.emit(true);
    return true;
  }

  /** Run a structural change with whole-workbook snapshot undo. */
  structural(fn: () => void) {
    const before = this.snapshot();
    fn();
    this.pushUndo({ kind: 'snap', before });
    this.emit(true);
  }

  snapshot(): string { return JSON.stringify(workbookToJSON(this)); }
  private restore(json: string) {
    const fresh = workbookFromJSON(JSON.parse(json));
    // Reuse existing Sheet objects (by id) so references held by the UI stay valid; keep transient state.
    const old = new Map(this.sheets.map((s) => [s.id, s]));
    this.sheets = fresh.sheets.map((f) => {
      const o = old.get(f.id);
      if (!o) return f;
      const { sel, scroll } = o;
      Object.assign(o, f, { sel, scroll, _bounds: undefined, _hidden: undefined });
      return o;
    });
    this.active = Math.min(fresh.active, this.sheets.length - 1);
    this.rebuildEngine();
  }

  private applyCellEntries(sheetId: string, entries: [number, CellData | undefined][]) {
    const s = this.sheetById(sheetId);
    if (!s) return;
    // HyperFormula's per-cell updates are slow for big batches; rebuilding the engine is far faster then.
    if (entries.length > 1500) {
      for (const [k, cell] of entries) { if (cell) s.cells.set(k, cell); else s.cells.delete(k); }
      this.rebuildEngine();
      return;
    }
    const id = this.hfId(s);
    this.hf.batch(() => {
      for (const [k, cell] of entries) {
        if (cell) s.cells.set(k, cell); else s.cells.delete(k);
        this.hf.setCellContents({ sheet: id, row: keyRow(k), col: keyCol(k) }, [[toHF(cell)]]);
      }
    });
  }

  /** Low-level: replace cells (undoable). `undefined` deletes. */
  setCells(s: Sheet, changes: { r: number; c: number; cell: CellData | undefined }[]) {
    if (!changes.length) return;
    const before: [number, CellData | undefined][] = [];
    const after: [number, CellData | undefined][] = [];
    for (const ch of changes) {
      const k = cellKey(ch.r, ch.c);
      before.push([k, s.cells.get(k)]);
      const cell = ch.cell && (ch.cell.v !== '' || (ch.cell.f && Object.keys(ch.cell.f).length)) ? ch.cell : undefined;
      after.push([k, cell]);
    }
    this.applyCellEntries(s.id, after);
    this.pushUndo({ kind: 'cells', sheetId: s.id, before, after });
    this.emit(true);
  }

  /** Set raw inputs, keeping existing formats. */
  setInputs(s: Sheet, items: { r: number; c: number; v: string }[]) {
    this.setCells(s, items.map(({ r, c, v }) => {
      const prev = this.getCell(s, r, c);
      return { r, c, cell: { v, ...(prev?.f ? { f: prev.f } : {}) } };
    }));
  }

  /** Iterate cells in a range that exist in the sparse map (fast for huge ranges). */
  cellsIn(s: Sheet, g: Range): [number, number, CellData][] {
    const out: [number, number, CellData][] = [];
    const area = (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
    if (area <= s.cells.size) {
      for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
        const cell = s.cells.get(cellKey(r, c));
        if (cell) out.push([r, c, cell]);
      }
    } else {
      for (const [k, cell] of s.cells) {
        const r = keyRow(k);
        const c = keyCol(k);
        if (r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1) out.push([r, c, cell]);
      }
    }
    return out;
  }

  /** Clamp a (possibly whole-column/row) range to the used area. */
  clampToUsed(s: Sheet, g: Range): Range {
    const b = this.bounds(s);
    return { r0: g.r0, c0: g.c0, r1: Math.min(g.r1, Math.max(g.r0, b.rows - 1)), c1: Math.min(g.c1, Math.max(g.c0, b.cols - 1)) };
  }

  clear(s: Sheet, g: Range, what: 'contents' | 'formats' | 'all') {
    // Rows hidden by a filter are left alone (as in Excel): clearing what you see never wipes what you don't.
    const hidden = this.hiddenRows(s);
    const changes = this.cellsIn(s, g).filter(([r]) => !hidden.has(r)).map(([r, c, cell]) => ({
      r, c,
      cell: what === 'all' ? undefined : what === 'contents' ? (cell.f ? { v: '', f: cell.f } : undefined) : { v: cell.v },
    }));
    this.setCells(s, changes);
  }

  formatRange(s: Sheet, g: Range, patch: Partial<CellFormat> | ((f: CellFormat, r: number, c: number) => CellFormat)) {
    const gg = this.clampFormatRange(s, g);
    const hidden = this.hiddenRows(s);
    const changes: { r: number; c: number; cell: CellData | undefined }[] = [];
    for (let r = gg.r0; r <= gg.r1; r++) for (let c = gg.c0; c <= gg.c1; c++) {
      if (hidden.has(r)) continue; // filtered-out rows keep their formatting
      const prev = this.getCell(s, r, c);
      const base = prev?.f ?? {};
      let f = typeof patch === 'function' ? patch({ ...base }, r, c) : { ...base, ...patch };
      f = cleanFormat(f);
      changes.push({ r, c, cell: { v: prev?.v ?? '', ...(Object.keys(f).length ? { f } : {}) } });
    }
    this.setCells(s, changes);
  }

  /** Whole-column/row formatting is limited to the used area (+ a margin) to keep the sparse map small. */
  private clampFormatRange(s: Sheet, g: Range): Range {
    const b = this.bounds(s);
    return {
      r0: g.r0, c0: g.c0,
      r1: g.r1 - g.r0 > 5000 ? Math.max(g.r0, b.rows + 100) : g.r1,
      c1: g.c1 - g.c0 > 200 ? Math.max(g.c0, b.cols + 10) : g.c1,
    };
  }

  // ----- clipboard blocks -----
  /** Paste a block of cells at (r, c). `from` = origin of the block for relative formula shifting. */
  pasteBlock(s: Sheet, r: number, c: number, block: (CellData | undefined)[][], from?: { r: number; c: number; rows?: number[] }, valuesOnly = false) {
    const changes: { r: number; c: number; cell: CellData | undefined }[] = [];
    block.forEach((row, i) => row.forEach((cell, j) => {
      const tr = r + i;
      const tc = c + j;
      if (tr >= MAX_ROWS || tc >= MAX_COLS) return;
      if (!cell) { changes.push({ r: tr, c: tc, cell: undefined }); return; }
      let v = cell.v;
      if (from && v.startsWith('=')) v = shiftFormula(v, tr - (from.rows?.[i] ?? from.r + i), tc - (from.c + j));
      if (valuesOnly) {
        const prev = this.getCell(s, tr, tc);
        changes.push({ r: tr, c: tc, cell: { v, ...(prev?.f ? { f: prev.f } : {}) } });
      } else changes.push({ r: tr, c: tc, cell: { ...cell, v } });
    }));
    this.setCells(s, changes);
  }

  /** Fill `target` by repeating the `src` block (formulas shifted). Linear series for numeric columns/rows. */
  fill(s: Sheet, src: Range, target: Range) {
    const changes: { r: number; c: number; cell: CellData | undefined }[] = [];
    const h = src.r1 - src.r0 + 1;
    const w = src.c1 - src.c0 + 1;
    const down = target.r0 < src.r0 || target.r1 > src.r1;
    const series = (vals: (number | null)[]): number | null => {
      if (vals.length < 2 || vals.some((v) => v == null)) return null;
      const d = (vals[1] as number) - (vals[0] as number);
      for (let i = 2; i < vals.length; i++) if (Math.abs((vals[i] as number) - (vals[i - 1] as number) - d) > 1e-9) return null;
      return d;
    };
    const hidden = this.hiddenRows(s);
    for (let r = target.r0; r <= target.r1; r++) for (let c = target.c0; c <= target.c1; c++) {
      if (r >= src.r0 && r <= src.r1 && c >= src.c0 && c <= src.c1) continue;
      if (hidden.has(r)) continue; // filling a filtered list fills only the visible rows
      const sr = src.r0 + (((r - src.r0) % h) + h) % h;
      const sc = src.c0 + (((c - src.c0) % w) + w) % w;
      const cell = this.getCell(s, sr, sc);
      if (!cell) { changes.push({ r, c, cell: undefined }); continue; }
      let v = cell.v;
      if (v.startsWith('=')) v = shiftFormula(v, r - sr, c - sc);
      else {
        // numeric series along the fill direction
        const line = down
          ? Array.from({ length: h }, (_, i) => this.rawNumber(s, src.r0 + i, c))
          : Array.from({ length: w }, (_, j) => this.rawNumber(s, r, src.c0 + j));
        const d = series(line);
        if (d != null) {
          const last = line[line.length - 1] as number;
          const steps = down ? (r > src.r1 ? r - src.r1 : r - src.r0) : (c > src.c1 ? c - src.c1 : c - src.c0);
          const base = down ? (r > src.r1 ? last : (line[0] as number)) : (c > src.c1 ? last : (line[0] as number));
          v = String(+(base + d * steps).toPrecision(15));
        }
      }
      changes.push({ r, c, cell: { ...cell, v } });
    }
    this.setCells(s, changes);
  }

  private rawNumber(s: Sheet, r: number, c: number): number | null {
    const cell = this.getCell(s, r, c);
    if (!cell || cell.v.startsWith('=')) return null;
    const n = Number(String(toHF(cell)));
    return cell.v.trim() !== '' && isFinite(n) ? n : null;
  }

  // ----- structure -----
  private refreshFormulas() {
    for (const s of this.sheets) {
      const id = this.hfId(s);
      for (const [k, cell] of s.cells) {
        if (!cell.v.startsWith('=')) continue;
        const f = this.hf.getCellFormula({ sheet: id, row: keyRow(k), col: keyCol(k) });
        if (f) cell.v = f;
      }
    }
  }

  private remap<T>(m: Map<number, T>, fn: (k: number) => number | null): Map<number, T> {
    const out = new Map<number, T>();
    for (const [k, v] of m) { const nk = fn(k); if (nk != null) out.set(nk, v); }
    return out;
  }

  private shiftRanges(s: Sheet, fn: (g: Range) => Range | null) {
    s.merges = s.merges.map(fn).filter((g): g is Range => !!g && (g.r0 !== g.r1 || g.c0 !== g.c1));
    s.condFormats = s.condFormats.flatMap((cf) => {
      const g = parseRange(cf.range);
      if (!g) return [cf];
      const n = fn(g);
      return n ? [{ ...cf, range: rangeToA1(n) }] : [];
    });
    if (s.filter) {
      const n = fn(s.filter.range);
      s.filter = n ? { ...s.filter, range: n } : null;
    }
    for (const sh of this.sheets) for (const ch of sh.charts) {
      if (ch.sheetId !== s.id) continue;
      const g = parseRange(ch.range);
      const n = g && fn(g);
      if (n) ch.range = rangeToA1(n);
    }
  }

  insertRows(s: Sheet, at: number, count: number) {
    this.structural(() => {
      this.hf.addRows(this.hfId(s), [at, count]);
      s.cells = this.remap(s.cells, (k) => { const r = keyRow(k); return r >= at ? cellKey(r + count, keyCol(k)) : k; });
      s.rowHeights = this.remap(s.rowHeights, (r) => (r >= at ? r + count : r));
      this.shiftRanges(s, (g) => shiftRangeInsert(g, 'row', at, count));
      this.refreshFormulas();
    });
  }

  deleteRows(s: Sheet, at: number, count: number) {
    this.deleteRowBlocks(s, [[at, count]]);
  }

  /** Delete several separate row blocks ([start, count], any order) as one change — e.g. the visible rows of a filtered list. */
  deleteRowBlocks(s: Sheet, blocks: [number, number][]) {
    const bl = blocks.filter(([, n]) => n > 0).sort((a, b) => b[0] - a[0]); // bottom-up keeps earlier indexes valid
    if (!bl.length) return;
    const starts = bl.map(([a]) => a).reverse();
    const ends = bl.map(([a, n]) => a + n).reverse();
    /** New index of row r, or null when it is deleted. */
    const mapRow = (r: number): number | null => {
      let removed = 0;
      for (let i = 0; i < starts.length && starts[i] <= r; i++) {
        if (r < ends[i]) return null;
        removed += ends[i] - starts[i];
      }
      return r - removed;
    };
    this.structural(() => {
      this.hf.removeRows(this.hfId(s), ...bl.map(([a, n]) => [a, n] as [number, number]));
      s.cells = this.remap(s.cells, (k) => { const r = mapRow(keyRow(k)); return r == null ? null : cellKey(r, keyCol(k)); });
      s.rowHeights = this.remap(s.rowHeights, mapRow);
      for (const [a, n] of bl) this.shiftRanges(s, (g) => shiftRangeDelete(g, 'row', a, n));
      this.refreshFormulas();
    });
  }

  insertCols(s: Sheet, at: number, count: number) {
    this.structural(() => {
      this.hf.addColumns(this.hfId(s), [at, count]);
      s.cells = this.remap(s.cells, (k) => { const c = keyCol(k); return c >= at ? cellKey(keyRow(k), c + count) : k; });
      s.colWidths = this.remap(s.colWidths, (c) => (c >= at ? c + count : c));
      if (s.filter) {
        s.filter.hidden = shiftKeys(s.filter.hidden, (c) => (c >= at ? c + count : c));
        if (s.filter.contains) s.filter.contains = shiftKeys(s.filter.contains, (c) => (c >= at ? c + count : c));
      }
      this.shiftRanges(s, (g) => shiftRangeInsert(g, 'col', at, count));
      this.refreshFormulas();
    });
  }

  deleteCols(s: Sheet, at: number, count: number) {
    this.structural(() => {
      this.hf.removeColumns(this.hfId(s), [at, count]);
      s.cells = this.remap(s.cells, (k) => { const c = keyCol(k); return c < at ? k : c < at + count ? null : cellKey(keyRow(k), c - count); });
      s.colWidths = this.remap(s.colWidths, (c) => (c < at ? c : c < at + count ? null : c - count));
      if (s.filter) {
        s.filter.hidden = shiftKeys(s.filter.hidden, (c) => (c < at ? c : c < at + count ? null : c - count));
        if (s.filter.contains) s.filter.contains = shiftKeys(s.filter.contains, (c) => (c < at ? c : c < at + count ? null : c - count));
      }
      this.shiftRanges(s, (g) => shiftRangeDelete(g, 'col', at, count));
      this.refreshFormulas();
    });
  }

  /** Sort rows of `g` by column `col` (absolute). Moves raw inputs + formats; relative formulas are shifted. */
  sortRange(s: Sheet, g: Range, col: number, asc: boolean, hasHeader: boolean) {
    const r0 = hasHeader ? g.r0 + 1 : g.r0;
    if (r0 >= g.r1) return;
    const rows: { r: number; key: unknown }[] = [];
    for (let r = r0; r <= g.r1; r++) rows.push({ r, key: this.value(s, r, col) });
    const rank = (v: unknown) => (typeof v === 'number' ? 0 : typeof v === 'string' && v !== '' ? 1 : typeof v === 'boolean' ? 2 : v == null || v === '' ? 4 : 3);
    rows.sort((a, b) => {
      const ra = rank(a.key);
      const rb = rank(b.key);
      // Blanks always last
      if (ra === 4 || rb === 4) return ra - rb;
      if (ra !== rb) return asc ? ra - rb : rb - ra;
      let d = 0;
      if (ra === 0) d = (a.key as number) - (b.key as number);
      else d = String(a.key).localeCompare(String(b.key), undefined, { numeric: true, sensitivity: 'base' });
      return asc ? d : -d;
    });
    const changes: { r: number; c: number; cell: CellData | undefined }[] = [];
    rows.forEach((row, i) => {
      const target = r0 + i;
      for (let c = g.c0; c <= g.c1; c++) {
        const cell = this.getCell(s, row.r, c);
        if (!cell) { changes.push({ r: target, c, cell: undefined }); continue; }
        const v = cell.v.startsWith('=') ? shiftFormula(cell.v, target - row.r, 0) : cell.v;
        changes.push({ r: target, c, cell: { ...cell, v } });
      }
    });
    this.setCells(s, changes);
  }

  // ----- sheets -----
  uniqueSheetName(base: string): string {
    let name = base;
    let i = 2;
    while (this.sheetByName(name)) name = `${base} ${i++}`;
    return name;
  }

  addSheet(name?: string, at = this.sheets.length): Sheet {
    const nm = this.uniqueSheetName(name ?? `Sheet ${this.sheets.length + 1}`);
    const s = newSheet(nm);
    this.structural(() => {
      this.hf.addSheet(nm);
      this.sheets.splice(at, 0, s);
      this.active = at;
    });
    return s;
  }

  renameSheet(s: Sheet, name: string): boolean {
    const nm = name.trim();
    if (!nm || /[\\/?*[\]:]/.test(nm) || nm.length > 31) return false;
    const other = this.sheetByName(nm);
    if (other && other !== s) return false;
    if (nm === s.name) return true;
    this.structural(() => {
      this.hf.renameSheet(this.hfId(s), nm);
      s.name = nm;
      this.refreshFormulas();
    });
    return true;
  }

  deleteSheet(s: Sheet): boolean {
    if (this.sheets.length <= 1) return false;
    this.structural(() => {
      const idx = this.sheets.indexOf(s);
      this.hf.removeSheet(this.hfId(s));
      this.sheets.splice(idx, 1);
      for (const sh of this.sheets) sh.charts = sh.charts.filter((c) => c.sheetId !== s.id);
      this.active = Math.min(this.active, this.sheets.length - 1);
      this.refreshFormulas();
    });
    return true;
  }

  duplicateSheet(s: Sheet): Sheet {
    const json = sheetToJSON(s);
    const copy = sheetFromJSON(json);
    copy.id = uid();
    copy.name = this.uniqueSheetName(`${s.name} copy`);
    copy.charts = copy.charts.map((c) => ({ ...c, id: uid(), sheetId: c.sheetId === s.id ? copy.id : c.sheetId }));
    this.structural(() => {
      const idx = this.sheets.indexOf(s) + 1;
      this.sheets.splice(idx, 0, copy);
      this.active = idx;
      this.rebuildEngine();
    });
    return copy;
  }

  moveSheet(from: number, to: number) {
    if (to < 0 || to >= this.sheets.length || from === to) return;
    this.structural(() => {
      const activeSheet = this.sheet;
      const [s] = this.sheets.splice(from, 1);
      this.sheets.splice(to, 0, s);
      this.active = this.sheets.indexOf(activeSheet);
    });
  }

  /** Replace the contents of a sheet with a 2D array of raw inputs (used by pivot/import). */
  writeGrid(s: Sheet, r0: number, c0: number, rows: (string | number | null)[][], fmt?: (r: number, c: number) => CellFormat | undefined) {
    const changes: { r: number; c: number; cell: CellData | undefined }[] = [];
    rows.forEach((row, i) => row.forEach((v, j) => {
      const f = fmt?.(i, j);
      const sv = v == null ? '' : typeof v === 'number' ? String(v) : v;
      if (sv === '' && !f) return;
      changes.push({ r: r0 + i, c: c0 + j, cell: { v: sv, ...(f ? { f } : {}) } });
    }));
    this.setCells(s, changes);
  }
}

function shiftKeys<T>(o: Record<number, T>, fn: (k: number) => number | null): Record<number, T> {
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(o)) { const nk = fn(+k); if (nk != null) out[nk] = v; }
  return out;
}

export function cleanFormat(f: CellFormat): CellFormat {
  const out: any = {};
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === false || v === '' || v === null) continue;
    if (k === 'nf' && v === 'general') continue;
    if (k === 'bd') { const b = cleanFormat(v as any); if (Object.keys(b).length) out.bd = b; continue; }
    out[k] = v;
  }
  return out;
}

// ---------- Serialization (workbook.json) ----------

export interface SheetJSON {
  id: string;
  name: string;
  cells: Record<string, CellData>;
  colWidths: Record<string, number>;
  rowHeights: Record<string, number>;
  merges: string[];
  freeze: { rows: number; cols: number };
  charts: ChartDef[];
  condFormats: CondRule[];
  filters: { range: string; hidden: Record<string, string[]>; contains?: Record<string, string> } | null;
  showGrid?: boolean;
}
export interface WorkbookJSON { formatVersion: 1; activeSheet: number; sheets: SheetJSON[] }


export function sheetToJSON(s: Sheet): SheetJSON {
  const cells: Record<string, CellData> = {};
  for (const [k, cell] of s.cells) {
    if (cell.v === '' && (!cell.f || !Object.keys(cell.f).length)) continue;
    cells[toA1(keyRow(k), keyCol(k))] = cell.f && Object.keys(cell.f).length ? { v: cell.v, f: cell.f } : { v: cell.v };
  }
  return {
    id: s.id, name: s.name, cells,
    colWidths: Object.fromEntries(s.colWidths), rowHeights: Object.fromEntries(s.rowHeights),
    merges: s.merges.map(rangeToA1), freeze: { ...s.freeze },
    charts: s.charts.map((c) => ({ ...c })), condFormats: s.condFormats.map((c) => ({ ...c })),
    filters: s.filter ? { range: rangeToA1(s.filter.range), hidden: { ...s.filter.hidden }, contains: { ...(s.filter.contains ?? {}) } } : null,
    showGrid: s.showGrid,
  };
}

export function sheetFromJSON(j: SheetJSON): Sheet {
  const s = newSheet(j.name);
  s.id = j.id || uid();
  for (const [a1, cell] of Object.entries(j.cells ?? {})) {
    const a = parseA1(a1);
    if (a && cell && typeof cell.v === 'string') s.cells.set(cellKey(a.r, a.c), cell.f ? { v: cell.v, f: cell.f } : { v: cell.v });
  }
  for (const [k, v] of Object.entries(j.colWidths ?? {})) s.colWidths.set(+k, v);
  for (const [k, v] of Object.entries(j.rowHeights ?? {})) s.rowHeights.set(+k, v);
  s.merges = (j.merges ?? []).map((m) => parseRange(m)).filter((g): g is Range => !!g);
  s.freeze = { rows: j.freeze?.rows ?? 0, cols: j.freeze?.cols ?? 0 };
  s.charts = (j.charts ?? []).map((c) => ({ ...c }));
  s.condFormats = (j.condFormats ?? []).map((c) => ({ ...c }));
  const fr = j.filters && parseRange(j.filters.range);
  s.filter = fr ? {
    range: fr,
    hidden: Object.fromEntries(Object.entries(j.filters!.hidden ?? {}).map(([k, v]) => [+k, v])),
    contains: Object.fromEntries(Object.entries(j.filters!.contains ?? {}).map(([k, v]) => [+k, v])),
  } : null;
  s.showGrid = j.showGrid !== false;
  return s;
}

export function workbookToJSON(wb: Workbook): WorkbookJSON {
  return { formatVersion: 1, activeSheet: wb.active, sheets: wb.sheets.map(sheetToJSON) };
}

export function workbookFromJSON(j: WorkbookJSON): { sheets: Sheet[]; active: number } {
  const sheets = (j.sheets ?? []).map(sheetFromJSON);
  return { sheets: sheets.length ? sheets : [newSheet('Sheet 1')], active: Math.max(0, Math.min(j.activeSheet ?? 0, sheets.length - 1)) };
}

export function loadWorkbook(j: WorkbookJSON): Workbook {
  const { sheets, active } = workbookFromJSON(j);
  const wb = new Workbook(sheets);
  wb.active = active;
  return wb;
}
