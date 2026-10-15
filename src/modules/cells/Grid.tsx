// Virtualised canvas grid: draws only visible rows/cols (frozen panes, merges, conditional formats),
// handles selection, editing, resizing, fill handle, clipboard and keyboard navigation.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MenuItem } from '@/ui';
import { runCommand } from '@/core/commands';
import { cellKey, colToLetters, intersects, MAX_COLS, MAX_ROWS, normRange, parseRange, rangeToA1, shiftFormula as shiftF, toA1, type Range } from './address';
import { copySelection, pasteText } from './clipboard';
import { condStyleAt, prepareRules, type CondStyle } from './condfmt';
import { Axis } from './geometry';
import { AcDropdown, canInsertRef, useFormulaAssist } from './FormulaAssist';
import { ChartObject } from './ChartObject';
import { FilterMenu } from './FilterMenu';
import { DEFAULT_COL_W, DEFAULT_ROW_H, type CellFormat, type Display, type Sheet, type Workbook } from './model';

export const HW = 44;
export const HH = 26;

interface Theme {
  bg0: string; bg1: string; bg2: string; bg3: string; line: string; ink: string; mute: string; accent: string; onAccent: string;
  sel: string; negative: string; info: string; fontUI: string; fontMono: string;
}

function readTheme(el: Element): Theme {
  const cs = getComputedStyle(el);
  const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
  return {
    bg0: v('--bg0', '#0c0c0e'), bg1: v('--bg1', '#141417'), bg2: v('--bg2', '#1c1c20'), bg3: v('--bg3', '#26262c'),
    line: v('--line', '#2b2b32'), ink: v('--ink', '#f2f1ee'), mute: v('--mute', '#8d8d96'), accent: v('--accent', '#ff5a1f'),
    onAccent: v('--on-accent', '#0c0c0e'), sel: v('--sel', 'rgba(255,90,31,.14)'), negative: v('--negative', '#e5484d'),
    info: v('--info', '#4f8ff7'), fontUI: v('--font-ui', 'Archivo, sans-serif'), fontMono: v('--font-mono', 'monospace'),
  };
}

/** Readable text colour on top of a user fill colour. */
function contrastOn(fill: string, t: Theme): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(fill);
  if (!m) return t.ink;
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#141414' : '#f2f1ee';
}

interface Geo {
  rows: Axis; cols: Axis; fr: number; fc: number; fW: number; fH: number; W: number; H: number; sx: number; sy: number;
}

type Hit = { area: 'corner' } | { area: 'col'; c: number; edge: number | null } | { area: 'row'; r: number; edge: number | null } | { area: 'cell'; r: number; c: number; handle: boolean };

type Drag =
  | { mode: 'select'; anchor: { r: number; c: number } }
  | { mode: 'cols'; anchor: number }
  | { mode: 'rows'; anchor: number }
  | { mode: 'resize-col'; index: number; start: number; orig: number | undefined; base: number }
  | { mode: 'resize-row'; index: number; start: number; orig: number | undefined; base: number }
  | { mode: 'fill'; src: Range; target: Range | null }
  | { mode: 'point'; start: number; len: number; anchor: { r: number; c: number } };

const measureCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

/** Width that fits the widest displayed value in column c. */
export function autofitWidth(wb: Workbook, s: Sheet, c: number): number {
  const ctx = measureCanvas?.getContext('2d');
  if (!ctx) return DEFAULT_COL_W;
  const t = readTheme(document.documentElement);
  let max = 0;
  const b = wb.bounds(s);
  const lim = Math.min(b.rows, 20000);
  for (let r = 0; r < lim; r++) {
    const cell = wb.getCell(s, r, c);
    if (!cell || cell.v === '') continue;
    const d = wb.display(s, r, c);
    ctx.font = `${cell.f?.b ? 700 : 500} 12px ${d.kind === 'num' ? t.fontMono : t.fontUI}`;
    max = Math.max(max, ctx.measureText(d.text).width);
  }
  return Math.max(40, Math.min(800, Math.ceil(max + 20)));
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (line && ctx.measureText(test).width > width) { out.push(line.trimEnd()); line = w.trimStart(); }
      else line = test;
    }
    out.push(line);
  }
  return out;
}

const EMPTY: Display = { text: '', kind: 'empty' };
const REF_IN_FORMULA = /(?:^|[^A-Za-z0-9_$!.'])(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![A-Za-z0-9_(!])/g;

export function Grid({ wb, onEditChart, compact }: { wb: Workbook; onEditChart: (id: string) => void; compact: boolean }) {
  const version = useSyncExternalStore(useCallback((fn) => wb.subscribe(fn), [wb]), () => wb.version);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const sinkRef = useRef<HTMLTextAreaElement>(null);
  const chartLayerRef = useRef<HTMLDivElement>(null);
  const geoRef = useRef<Geo | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const lastPtr = useRef<{ x: number; y: number } | null>(null);
  const autoTimer = useRef<number | null>(null);
  const rafRef = useRef(0);
  const [extra, setExtra] = useState({ rows: 0, cols: 0 });
  const [, setScrollTick] = useState(0);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [filterMenu, setFilterMenu] = useState<{ col: number; x: number; y: number } | null>(null);
  const filterColRef = useRef<number | null>(null);
  const [cursor, setCursor] = useState('cell');
  const s = wb.sheet;
  const edit = wb.ui.edit && wb.ui.edit.sheetId === s.id ? wb.ui.edit : null;

  // ---------- geometry ----------
  const geoCache = useRef<{ key: string; rows: Axis; cols: Axis } | null>(null);
  const computeGeo = (): Geo => {
    const sc = scrollerRef.current;
    const b = wb.bounds(s);
    const z = wb.ui.zoom;
    const sel = s.sel.range;
    const rowCount = Math.min(MAX_ROWS, Math.max(1000, b.rows + 100, Math.min(sel.r1, b.rows + 2000) + 50, s.freeze.rows + 50) + extra.rows);
    const colCount = Math.min(MAX_COLS, Math.max(30, b.cols + 10, Math.min(sel.c1, b.cols + 200) + 10, s.freeze.cols + 10) + extra.cols);
    const key = `${wb.version}|${s.id}|${rowCount}|${colCount}|${z}`;
    let c = geoCache.current;
    if (!c || c.key !== key) {
      c = { key, rows: new Axis(DEFAULT_ROW_H, rowCount, s.rowHeights, wb.hiddenRows(s), z), cols: new Axis(DEFAULT_COL_W, colCount, s.colWidths, undefined, z) };
      geoCache.current = c;
    }
    const fr = Math.min(s.freeze.rows, rowCount - 1);
    const fc = Math.min(s.freeze.cols, colCount - 1);
    return {
      rows: c.rows, cols: c.cols, fr, fc, fW: c.cols.pos(fc), fH: c.rows.pos(fr),
      W: sc?.clientWidth ?? 0, H: sc?.clientHeight ?? 0, sx: sc?.scrollLeft ?? 0, sy: sc?.scrollTop ?? 0,
    };
  };
  const X = (g: Geo, c: number) => HW + g.cols.pos(c) - (c >= g.fc ? g.sx : 0);
  const Y = (g: Geo, r: number) => HH + g.rows.pos(r) - (r >= g.fr ? g.sy : 0);

  const rangeRect = (g: Geo, rg: Range) => {
    const r1 = Math.min(rg.r1, g.rows.count - 1);
    const c1 = Math.min(rg.c1, g.cols.count - 1);
    const x = X(g, rg.c0);
    const y = Y(g, rg.r0);
    return { x, y, w: Math.max(0, X(g, c1) + g.cols.size(c1) - x), h: Math.max(0, Y(g, r1) + g.rows.size(r1) - y) };
  };

  // ---------- drawing ----------
  const draw = () => {
    const cv = canvasRef.current;
    const sc = scrollerRef.current;
    const wrap = wrapRef.current;
    if (!cv || !sc || !wrap) return;
    const g = computeGeo();
    geoRef.current = g;
    const { W, H } = g;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      cv.style.width = W + 'px';
      cv.style.height = H + 'px';
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const t = readTheme(wrap);
    ctx.fillStyle = t.bg0;
    ctx.fillRect(0, 0, W, H);
    const lastR = g.rows.count - 1;
    const lastC = g.cols.count - 1;
    const rS = [Math.max(g.fr, g.rows.index(g.fH + g.sy)), Math.min(lastR, g.rows.index(g.sy + H - HH))];
    const cS = [Math.max(g.fc, g.cols.index(g.fW + g.sx)), Math.min(lastC, g.cols.index(g.sx + W - HW))];
    const rF = [0, g.fr - 1];
    const cF = [0, g.fc - 1];
    const regions: { r: number[]; c: number[]; clip: number[] }[] = [
      { r: rS, c: cS, clip: [HW + g.fW, HH + g.fH, W, H] },
      { r: rF, c: cS, clip: [HW + g.fW, HH, W, HH + g.fH] },
      { r: rS, c: cF, clip: [HW, HH + g.fH, HW + g.fW, H] },
      { r: rF, c: cF, clip: [HW, HH, HW + g.fW, HH + g.fH] },
    ];
    for (const reg of regions) {
      const [x0, y0, x1, y1] = reg.clip;
      if (reg.r[1] < reg.r[0] || reg.c[1] < reg.c[0] || x1 <= x0 || y1 <= y0) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      drawCells(ctx, t, g, reg.r[0], reg.r[1], reg.c[0], reg.c[1]);
      drawSelection(ctx, t, g);
      ctx.restore();
    }
    drawHeaders(ctx, t, g, rS, cS);
  };

  const drawCells = (ctx: CanvasRenderingContext2D, t: Theme, g: Geo, r0: number, r1: number, c0: number, c1: number) => {
    const z = wb.ui.zoom;
    const rules = prepareRules(wb, s);
    const sel = s.sel.range;
    const region: Range = { r0, c0, r1, c1 };
    const merges = s.merges.filter((m) => intersects(m, region));
    const covered = new Set<number>();
    for (const m of merges) {
      for (let r = Math.max(m.r0, r0); r <= Math.min(m.r1, r1); r++) for (let c = Math.max(m.c0, c0); c <= Math.min(m.c1, c1); c++) covered.add(cellKey(r, c));
    }
    const filt = s.filter;
    const isHeader = (r: number, c: number) => r < s.freeze.rows || (!!filt && r === filt.range.r0 && c >= filt.range.c0 && c <= filt.range.c1);
    interface Info { r: number; c: number; x: number; y: number; w: number; h: number; d: Display; f?: CellFormat; cs: CondStyle | null; header: boolean; merged: boolean }
    const infos: Info[] = [];
    const borders: { x: number; y: number; w: number; h: number; bd: NonNullable<CellFormat['bd']> }[] = [];
    const inSel = (r: number, c: number) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
    const cellInfo = (r: number, c: number) => {
      const cell = s.cells.get(cellKey(r, c));
      let d = EMPTY;
      let cs: CondStyle | null = null;
      if (cell && cell.v !== '') {
        d = wb.display(s, r, c);
        if (rules.length) cs = condStyleAt(rules, r, c, d.kind === 'num' ? d.num : d.text, d.text);
      }
      return { cell, d, cs };
    };
    // backgrounds
    for (let r = r0; r <= r1; r++) {
      const h = g.rows.size(r);
      if (h <= 0) continue;
      const y = Y(g, r);
      for (let c = c0; c <= c1; c++) {
        if (covered.has(cellKey(r, c))) continue;
        const w = g.cols.size(c);
        const x = X(g, c);
        const { cell, d, cs } = cellInfo(r, c);
        const header = isHeader(r, c);
        const bg = cs?.fill ?? cell?.f?.fill ?? (header ? t.bg1 : null);
        if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, w, h); }
        if (inSel(r, c)) { ctx.fillStyle = t.sel; ctx.fillRect(x, y, w, h); }
        if (cell?.f?.bd) borders.push({ x, y, w, h, bd: cell.f.bd });
        if (d.text || header) infos.push({ r, c, x, y, w, h, d, f: cell?.f, cs, header, merged: false });
      }
    }
    // gridlines
    const xa = X(g, c0);
    const xb = X(g, c1) + g.cols.size(c1);
    const ya = Y(g, r0);
    const yb = Y(g, r1) + g.rows.size(r1);
    if (s.showGrid) {
      ctx.strokeStyle = t.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let r = r0; r <= r1; r++) {
        if (g.rows.size(r) <= 0) continue;
        const y = Math.round(Y(g, r) + g.rows.size(r)) - 0.5;
        ctx.moveTo(xa, y); ctx.lineTo(xb, y);
      }
      for (let c = c0; c <= c1; c++) {
        const x = Math.round(X(g, c) + g.cols.size(c)) - 0.5;
        ctx.moveTo(x, ya); ctx.lineTo(x, yb);
      }
      ctx.stroke();
    }
    // merged cells drawn as one block
    for (const m of merges) {
      const rc = rangeRect(g, m);
      const { cell, d, cs } = cellInfo(m.r0, m.c0);
      ctx.fillStyle = cs?.fill ?? cell?.f?.fill ?? (isHeader(m.r0, m.c0) ? t.bg1 : t.bg0);
      ctx.fillRect(rc.x, rc.y, rc.w - 1, rc.h - 1);
      if (intersects(m, sel)) { ctx.fillStyle = t.sel; ctx.fillRect(rc.x, rc.y, rc.w - 1, rc.h - 1); }
      if (cell?.f?.bd) borders.push({ ...rc, bd: cell.f.bd });
      if (d.text) infos.push({ r: m.r0, c: m.c0, x: rc.x, y: rc.y, w: rc.w, h: rc.h, d, f: cell?.f, cs, header: isHeader(m.r0, m.c0), merged: true });
    }
    // explicit borders
    if (borders.length) {
      ctx.strokeStyle = t.ink;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const b of borders) {
        const l = Math.round(b.x) - 0.5;
        const r = Math.round(b.x + b.w) - 0.5;
        const tp = Math.round(b.y) - 0.5;
        const bt = Math.round(b.y + b.h) - 0.5;
        if (b.bd.t) { ctx.moveTo(l, tp); ctx.lineTo(r, tp); }
        if (b.bd.b) { ctx.moveTo(l, bt); ctx.lineTo(r, bt); }
        if (b.bd.l) { ctx.moveTo(l, tp); ctx.lineTo(l, bt); }
        if (b.bd.r) { ctx.moveTo(r, tp); ctx.lineTo(r, bt); }
      }
      ctx.stroke();
    }
    // text
    const pad = 8 * z;
    const fs = 12 * z;
    ctx.textBaseline = 'middle';
    for (const it of infos) {
      const { d, f, cs } = it;
      const isFilterHead = !!filt && it.r === filt.range.r0 && it.c >= filt.range.c0 && it.c <= filt.range.c1;
      if (!d.text) continue;
      const num = d.kind === 'num';
      const bold = !!(f?.b || cs?.b || it.header);
      const ital = !!(f?.i || cs?.i);
      ctx.font = `${ital ? 'italic ' : ''}${bold ? 700 : 500} ${fs}px ${num ? t.fontMono : t.fontUI}`;
      const fill = cs?.fill ?? f?.fill;
      ctx.fillStyle = cs?.color ?? f?.color ?? (d.kind === 'err' || (num && (d.num ?? 0) < 0) ? t.negative : fill ? contrastOn(fill, t) : t.ink);
      const align = f?.al ?? (num ? 'right' : d.kind === 'bool' || d.kind === 'err' ? 'center' : 'left');
      let clipW = it.w - (isFilterHead ? 18 : 0);
      if (align === 'left' && !f?.wrap && !num && !it.merged) {
        for (let cc = it.c + 1; cc <= c1 && cc < it.c + 30; cc++) {
          if (!wb.isEmpty(s, it.r, cc) || covered.has(cellKey(it.r, cc))) break;
          clipW += g.cols.size(cc);
        }
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(it.x, it.y, Math.max(0, clipW - 1), it.h - 1);
      ctx.clip();
      const avail = it.w - 2 * pad - (isFilterHead ? 14 : 0);
      if (f?.wrap) {
        const lines = wrapLines(ctx, d.text, Math.max(10, avail));
        const lh = 15 * z;
        const total = lines.length * lh;
        let ly = it.y + Math.max(lh / 2 + 3 * z, (it.h - total) / 2 + lh / 2);
        for (const ln of lines) {
          drawAligned(ctx, ln, it.x, it.w, pad, align, ly, f, fs);
          ly += lh;
        }
      } else {
        let text = d.text.replace(/\s*\n\s*/g, ' ');
        if (num && ctx.measureText(text).width > avail + 2 * pad - 4) text = '#'.repeat(Math.max(1, Math.floor((it.w - 6) / ctx.measureText('#').width)));
        drawAligned(ctx, text, it.x, clipW > it.w && align === 'left' ? clipW : it.w, pad, align, it.y + it.h / 2, f, fs);
      }
      ctx.restore();
    }
    // AutoFilter buttons
    if (filt && filt.range.r0 >= r0 && filt.range.r0 <= r1 && g.rows.size(filt.range.r0) > 0) {
      for (let c = Math.max(c0, filt.range.c0); c <= Math.min(c1, filt.range.c1); c++) {
        const x = X(g, c) + g.cols.size(c) - 18;
        const y = Y(g, filt.range.r0) + (g.rows.size(filt.range.r0) - 14) / 2;
        const active = (filt.hidden[c]?.length ?? 0) > 0 || !!filt.contains?.[c]?.trim();
        ctx.fillStyle = active ? t.accent : t.bg2;
        ctx.fillRect(x, y, 14, 14);
        ctx.strokeStyle = active ? t.accent : t.line;
        ctx.strokeRect(x + 0.5, y + 0.5, 13, 13);
        ctx.fillStyle = active ? t.onAccent : t.mute;
        ctx.beginPath();
        ctx.moveTo(x + 4, y + 5.5); ctx.lineTo(x + 10, y + 5.5); ctx.lineTo(x + 7, y + 9.5); ctx.closePath();
        ctx.fill();
      }
    }
  };

  const drawAligned = (ctx: CanvasRenderingContext2D, text: string, x: number, w: number, pad: number, align: string, y: number, f: CellFormat | undefined, fs: number) => {
    const tw = ctx.measureText(text).width;
    const tx = align === 'right' ? x + w - pad - tw : align === 'center' ? x + (w - tw) / 2 : x + pad;
    ctx.fillText(text, tx, y);
    if (f?.u || f?.s) {
      ctx.fillRect(tx, f.u ? y + fs * 0.5 : y, tw, 1);
      if (f.u && f.s) ctx.fillRect(tx, y, tw, 1);
    }
  };

  const drawSelection = (ctx: CanvasRenderingContext2D, t: Theme, g: Geo) => {
    const sel = s.sel.range;
    // Formula references while editing
    if (edit && edit.text.startsWith('=')) {
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.info;
      for (const m of edit.text.matchAll(REF_IN_FORMULA)) {
        const rg = parseRange(m[1]);
        if (!rg) continue;
        const rc = rangeRect(g, rg);
        ctx.strokeRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
      }
      ctx.restore();
    }
    const rc = rangeRect(g, sel);
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(rc.x + 1, rc.y + 1, Math.max(0, rc.w - 2), Math.max(0, rc.h - 2));
    if (sel.r1 > sel.r0 || sel.c1 > sel.c0) {
      const ac = rangeRect(g, wb.mergeAt(s, s.sel.r, s.sel.c) ?? { r0: s.sel.r, c0: s.sel.c, r1: s.sel.r, c1: s.sel.c });
      ctx.lineWidth = 1;
      ctx.strokeRect(ac.x + 2.5, ac.y + 2.5, Math.max(0, ac.w - 5), Math.max(0, ac.h - 5));
    }
    if (!edit && sel.r1 < MAX_ROWS - 1 && sel.c1 < MAX_COLS - 1) {
      ctx.fillStyle = t.bg0;
      ctx.fillRect(rc.x + rc.w - 5, rc.y + rc.h - 5, 8, 8);
      ctx.fillStyle = t.accent;
      ctx.fillRect(rc.x + rc.w - 4, rc.y + rc.h - 4, 6, 6);
    }
    const clip = wb.ui.clip;
    if (clip && clip.sheetId === s.id) {
      const cr = rangeRect(g, clip.range);
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.accent;
      ctx.strokeRect(cr.x + 1, cr.y + 1, cr.w - 2, cr.h - 2);
      ctx.restore();
    }
    const d = dragRef.current;
    if (d?.mode === 'fill' && d.target) {
      const tr = rangeRect(g, d.target);
      ctx.save();
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = t.accent;
      ctx.strokeRect(tr.x + 1, tr.y + 1, tr.w - 2, tr.h - 2);
      ctx.restore();
    }
  };

  const drawHeaders = (ctx: CanvasRenderingContext2D, t: Theme, g: Geo, rS: number[], cS: number[]) => {
    const { W, H } = g;
    const sel = s.sel.range;
    const allRows = sel.r0 === 0 && sel.r1 >= MAX_ROWS - 1;
    const allCols = sel.c0 === 0 && sel.c1 >= MAX_COLS - 1;
    ctx.font = `500 11px ${t.fontMono}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    // column header
    const colHead = (c0: number, c1: number, clip: number[]) => {
      if (c1 < c0) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(clip[0], 0, clip[1] - clip[0], HH); ctx.clip();
      for (let c = c0; c <= c1; c++) {
        const x = X(g, c);
        const w = g.cols.size(c);
        const on = c >= sel.c0 && c <= sel.c1;
        ctx.fillStyle = on ? (allRows ? t.bg3 : t.bg2) : t.bg1;
        ctx.fillRect(x, 0, w, HH);
        ctx.fillStyle = on ? t.ink : t.mute;
        ctx.fillText(colToLetters(c), x + w / 2, HH / 2 + 1);
        ctx.fillStyle = t.line;
        ctx.fillRect(Math.round(x + w) - 1, 0, 1, HH);
      }
      ctx.restore();
    };
    colHead(cS[0], cS[1], [HW + g.fW, W]);
    colHead(0, g.fc - 1, [HW, HW + g.fW]);
    // row header
    const rowHead = (r0: number, r1: number, clip: number[]) => {
      if (r1 < r0) return;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, clip[0], HW, clip[1] - clip[0]); ctx.clip();
      for (let r = r0; r <= r1; r++) {
        const h = g.rows.size(r);
        if (h <= 0) continue;
        const y = Y(g, r);
        const on = r >= sel.r0 && r <= sel.r1;
        ctx.fillStyle = on ? (allCols ? t.bg3 : t.bg2) : t.bg1;
        ctx.fillRect(0, y, HW, h);
        ctx.fillStyle = on ? t.ink : t.mute;
        ctx.fillText(String(r + 1), HW / 2, y + h / 2 + 1);
        ctx.fillStyle = t.line;
        ctx.fillRect(0, Math.round(y + h) - 1, HW, 1);
      }
      ctx.restore();
    };
    rowHead(rS[0], rS[1], [HH + g.fH, H]);
    rowHead(0, g.fr - 1, [HH, HH + g.fH]);
    ctx.textAlign = 'left';
    // corner + header borders
    ctx.fillStyle = t.bg1;
    ctx.fillRect(0, 0, HW, HH);
    ctx.fillStyle = t.line;
    ctx.fillRect(0, HH - 1, W, 1);
    ctx.fillRect(HW - 1, 0, 1, H);
    // freeze lines
    ctx.fillStyle = t.mute;
    if (g.fr > 0) ctx.fillRect(0, HH + g.fH - 1, W, 1);
    if (g.fc > 0) ctx.fillRect(HW + g.fW - 1, 0, 1, H);
  };

  const scheduleDraw = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => draw());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- layout + scroll ----------
  useLayoutEffect(() => {
    const g = computeGeo();
    const sp = spacerRef.current;
    if (sp) { sp.style.width = HW + g.cols.total + 'px'; sp.style.height = HH + g.rows.total + 'px'; }
    const sc = scrollerRef.current;
    if (sc && wb.ui.reveal) {
      wb.ui.reveal = false;
      const gg = { ...g, W: sc.clientWidth, H: sc.clientHeight };
      const { r, c } = revealTarget();
      if (c < gg.fc) sc.scrollLeft = 0;
      if (r < gg.fr) sc.scrollTop = 0;
      if (c >= gg.fc) {
        const x0 = gg.cols.pos(c);
        const x1 = x0 + gg.cols.size(c);
        if (x0 < sc.scrollLeft + gg.fW) sc.scrollLeft = x0 - gg.fW;
        else if (x1 > sc.scrollLeft + gg.W - HW) sc.scrollLeft = x1 - (gg.W - HW);
      }
      if (r >= gg.fr) {
        const y0 = gg.rows.pos(r);
        const y1 = y0 + gg.rows.size(r);
        if (y0 < sc.scrollTop + gg.fH) sc.scrollTop = y0 - gg.fH;
        else if (y1 > sc.scrollTop + gg.H - HH) sc.scrollTop = y1 - (gg.H - HH);
      }
    }
    // Restore per-sheet scroll when switching sheets
    draw();
    syncChartLayer();
  });

  const lastSheet = useRef(s.id);
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    if (!sc) return;
    if (lastSheet.current !== s.id) {
      lastSheet.current = s.id;
      sc.scrollLeft = s.scroll.x;
      sc.scrollTop = s.scroll.y;
      draw();
    }
  }, [s.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /** The cell to bring into view: the moving corner when extending, else the active cell. */
  const focusCorner = useRef<{ r: number; c: number } | null>(null);
  const revealTarget = () => {
    const f = focusCorner.current;
    focusCorner.current = null;
    return f ?? { r: s.sel.r, c: s.sel.c };
  };

  useEffect(() => {
    const sc = scrollerRef.current;
    const wrap = wrapRef.current;
    if (!sc || !wrap) return;
    const ro = new ResizeObserver(() => scheduleDraw());
    ro.observe(sc);
    const mo = new MutationObserver(() => scheduleDraw());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    void document.fonts?.ready.then(() => scheduleDraw());
    return () => { ro.disconnect(); mo.disconnect(); cancelAnimationFrame(rafRef.current); };
  }, [scheduleDraw]);

  useEffect(() => { sinkRef.current?.focus({ preventScroll: true }); }, [wb.ui.focusGrid]);

  const syncChartLayer = () => {
    const sc = scrollerRef.current;
    const layer = chartLayerRef.current;
    if (sc && layer) layer.style.transform = `translate(${-sc.scrollLeft}px, ${-sc.scrollTop}px)`;
  };

  const onScroll = () => {
    const sc = scrollerRef.current!;
    s.scroll = { x: sc.scrollLeft, y: sc.scrollTop };
    syncChartLayer();
    scheduleDraw();
    if (edit || filterMenu || menu) setScrollTick((n) => n + 1);
    const g = geoRef.current;
    if (g) {
      if (sc.scrollTop + sc.clientHeight > HH + g.rows.total - 400 && g.rows.count < MAX_ROWS) setExtra((e) => ({ ...e, rows: e.rows + 1000 }));
      if (sc.scrollLeft + sc.clientWidth > HW + g.cols.total - 300 && g.cols.count < MAX_COLS) setExtra((e) => ({ ...e, cols: e.cols + 20 }));
    }
  };

  // ---------- hit testing ----------
  const hitTest = (x: number, y: number): Hit => {
    const g = geoRef.current ?? computeGeo();
    const colAt = (px: number) => (px < HW + g.fW ? g.cols.index(px - HW) : g.cols.index(px - HW + g.sx));
    const rowAt = (py: number) => (py < HH + g.fH ? g.rows.index(py - HH) : g.rows.index(py - HH + g.sy));
    if (x < HW && y < HH) return { area: 'corner' };
    if (y < HH) {
      const c = colAt(Math.max(HW, x));
      const right = X(g, c) + g.cols.size(c);
      const left = X(g, c);
      const edge = Math.abs(x - right) <= 4 ? c : Math.abs(x - left) <= 4 && c > 0 ? c - 1 : null;
      return { area: 'col', c, edge };
    }
    if (x < HW) {
      const r = rowAt(Math.max(HH, y));
      const bottom = Y(g, r) + g.rows.size(r);
      const top = Y(g, r);
      let edge: number | null = Math.abs(y - bottom) <= 3 ? r : Math.abs(y - top) <= 3 && r > 0 ? r - 1 : null;
      if (edge != null) while (edge > 0 && g.rows.size(edge) === 0) edge--;
      return { area: 'row', r, edge };
    }
    const r = rowAt(y);
    const c = colAt(x);
    const rc = rangeRect(g, s.sel.range);
    const handle = !edit && Math.abs(x - (rc.x + rc.w - 1)) <= 5 && Math.abs(y - (rc.y + rc.h - 1)) <= 5;
    return { area: 'cell', r, c, handle };
  };

  const localXY = (e: { clientX: number; clientY: number }) => {
    const rect = scrollerRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const expandMerges = (rg: Range): Range => {
    let g = normRange(rg);
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of s.merges) {
        if (intersects(m, g) && (m.r0 < g.r0 || m.c0 < g.c0 || m.r1 > g.r1 || m.c1 > g.c1)) {
          g = { r0: Math.min(g.r0, m.r0), c0: Math.min(g.c0, m.c0), r1: Math.max(g.r1, m.r1), c1: Math.max(g.c1, m.c1) };
          changed = true;
        }
      }
    }
    return g;
  };

  const selectCells = (anchor: { r: number; c: number }, focus: { r: number; c: number }, reveal = false) => {
    const rg = expandMerges({ r0: anchor.r, c0: anchor.c, r1: focus.r, c1: focus.c });
    focusCorner.current = focus;
    wb.select(anchor.r, anchor.c, rg, reveal);
  };

  // ---------- pointer ----------
  const pointerTap = useRef<{ x: number; y: number; id: number } | null>(null);

  const lastPointerType = useRef('mouse');
  /** Is (x, y) on the AutoFilter dropdown button of a header cell? */
  const onFilterButton = (hit: Hit, x: number) => {
    if (hit.area !== 'cell' || !s.filter || hit.r !== s.filter.range.r0 || hit.c < s.filter.range.c0 || hit.c > s.filter.range.c1) return null;
    const g = geoRef.current!;
    const bx = X(g, hit.c) + g.cols.size(hit.c) - 18;
    return x >= bx && x <= bx + 16 ? bx : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const sc = scrollerRef.current!;
    const { x, y } = localXY(e);
    lastPointerType.current = e.pointerType;
    if (x > sc.clientWidth || y > sc.clientHeight) return; // scrollbars
    setMenu(null);
    const hit = hitTest(x, y);
    // Filter dropdown buttons
    const bx = onFilterButton(hit, x);
    if (bx != null && hit.area === 'cell') {
      e.preventDefault();
      wb.commitEdit();
      // Rows typed or pasted right below the list join the filter (as Excel does when you reopen it).
      const f = s.filter!;
      const below = wb.currentRegion(s, f.range.r0, f.range.c0).r1;
      if (below > f.range.r1) { f.range = { ...f.range, r1: below }; wb.emit(true); }
      const g = geoRef.current!;
      const rect = sc.getBoundingClientRect();
      filterColRef.current = hit.c;
      setFilterMenu({ col: hit.c, x: rect.left + bx, y: rect.top + Y(g, hit.r) + g.rows.size(hit.r) });
      return;
    }
    if (e.pointerType === 'touch') { pointerTap.current = { x, y, id: e.pointerId }; return; }
    if (e.button === 2) {
      if (hit.area === 'cell' && !(hit.r >= s.sel.range.r0 && hit.r <= s.sel.range.r1 && hit.c >= s.sel.range.c0 && hit.c <= s.sel.range.c1)) {
        wb.commitEdit();
        selectCells({ r: hit.r, c: hit.c }, { r: hit.r, c: hit.c });
      }
      return;
    }
    if (e.button !== 0) return;
    // Formula point mode: clicking a cell inserts its reference.
    const ed = wb.ui.edit;
    if (ed && hit.area === 'cell') {
      const caret = editCaret.current ?? ed.text.length;
      if (canInsertRef(ed.text, caret)) {
        e.preventDefault();
        const ref = toA1(hit.r, hit.c);
        const text = ed.text.slice(0, caret) + ref + ed.text.slice(caret);
        editCaret.current = caret + ref.length;
        pendingCaret.current = caret + ref.length;
        wb.setEditText(text);
        dragRef.current = { mode: 'point', start: caret, len: ref.length, anchor: { r: hit.r, c: hit.c } };
        startDrag(e);
        return;
      }
    }
    if (ed) wb.commitEdit();
    e.preventDefault();
    sinkRef.current?.focus({ preventScroll: true });
    if (hit.area === 'corner') { wb.select(0, 0, { r0: 0, c0: 0, r1: MAX_ROWS - 1, c1: MAX_COLS - 1 }, false); return; }
    if (hit.area === 'col') {
      if (hit.edge != null) {
        const g = geoRef.current!;
        dragRef.current = { mode: 'resize-col', index: hit.edge, start: x, orig: s.colWidths.get(hit.edge), base: g.cols.size(hit.edge) / wb.ui.zoom };
      } else {
        const anchor = e.shiftKey ? s.sel.c : hit.c;
        dragRef.current = { mode: 'cols', anchor };
        wb.select(firstVisibleRow(), anchor, { r0: 0, r1: MAX_ROWS - 1, c0: Math.min(anchor, hit.c), c1: Math.max(anchor, hit.c) }, false);
      }
      startDrag(e);
      return;
    }
    if (hit.area === 'row') {
      if (hit.edge != null) {
        const g = geoRef.current!;
        dragRef.current = { mode: 'resize-row', index: hit.edge, start: y, orig: s.rowHeights.get(hit.edge), base: g.rows.size(hit.edge) / wb.ui.zoom };
      } else {
        const anchor = e.shiftKey ? s.sel.r : hit.r;
        dragRef.current = { mode: 'rows', anchor };
        wb.select(anchor, 0, { r0: Math.min(anchor, hit.r), r1: Math.max(anchor, hit.r), c0: 0, c1: MAX_COLS - 1 }, false);
      }
      startDrag(e);
      return;
    }
    if (hit.handle) {
      dragRef.current = { mode: 'fill', src: { ...s.sel.range }, target: null };
      startDrag(e);
      return;
    }
    const anchor = e.shiftKey ? { r: s.sel.r, c: s.sel.c } : { r: hit.r, c: hit.c };
    const m = wb.mergeAt(s, anchor.r, anchor.c);
    const a = m ? { r: m.r0, c: m.c0 } : anchor;
    selectCells(a, { r: hit.r, c: hit.c });
    dragRef.current = { mode: 'select', anchor: a };
    startDrag(e);
  };

  const firstVisibleRow = () => { let r = 0; const hid = wb.hiddenRows(s); while (hid.has(r)) r++; return r; };

  const startDrag = (e: React.PointerEvent) => {
    scrollerRef.current!.setPointerCapture(e.pointerId);
    lastPtr.current = localXY(e);
    if (autoTimer.current) clearInterval(autoTimer.current);
    autoTimer.current = window.setInterval(autoScroll, 50);
  };

  const autoScroll = () => {
    const sc = scrollerRef.current;
    const p = lastPtr.current;
    const d = dragRef.current;
    if (!sc || !p || !d || d.mode.startsWith('resize')) return;
    let dx = 0;
    let dy = 0;
    if (p.x > sc.clientWidth - 8) dx = Math.min(60, p.x - sc.clientWidth + 8);
    else if (p.x < HW && d.mode !== 'rows') dx = -Math.min(60, HW - p.x + 4);
    if (p.y > sc.clientHeight - 8) dy = Math.min(60, p.y - sc.clientHeight + 8);
    else if (p.y < HH && d.mode !== 'cols') dy = -Math.min(60, HH - p.y + 4);
    if (dx || dy) { sc.scrollLeft += dx; sc.scrollTop += dy; dragTo(p.x, p.y); }
  };

  const dragTo = (x: number, y: number) => {
    const d = dragRef.current;
    const sc = scrollerRef.current!;
    if (!d) return;
    const cx = Math.max(HW + 1, Math.min(sc.clientWidth - 1, x));
    const cy = Math.max(HH + 1, Math.min(sc.clientHeight - 1, y));
    const hit = hitTest(cx, cy);
    if (d.mode === 'select' && hit.area === 'cell') selectCells(d.anchor, { r: hit.r, c: hit.c });
    else if (d.mode === 'cols') {
      const c = (hitTest(cx, HH - 1) as { c: number }).c;
      wb.select(s.sel.r, d.anchor, { r0: 0, r1: MAX_ROWS - 1, c0: Math.min(d.anchor, c), c1: Math.max(d.anchor, c) }, false);
    } else if (d.mode === 'rows') {
      const r = (hitTest(HW - 1, cy) as { r: number }).r;
      wb.select(d.anchor, s.sel.c, { r0: Math.min(d.anchor, r), r1: Math.max(d.anchor, r), c0: 0, c1: MAX_COLS - 1 }, false);
    } else if (d.mode === 'resize-col') {
      const w = Math.max(16, Math.round(d.base + (x - d.start) / wb.ui.zoom));
      s.colWidths.set(d.index, w);
      wb.emit();
    } else if (d.mode === 'resize-row') {
      const h = Math.max(12, Math.round(d.base + (y - d.start) / wb.ui.zoom));
      s.rowHeights.set(d.index, h);
      wb.emit();
    } else if (d.mode === 'fill' && hit.area === 'cell') {
      const src = d.src;
      const below = hit.r - src.r1;
      const above = src.r0 - hit.r;
      const right = hit.c - src.c1;
      const left = src.c0 - hit.c;
      const vert = Math.max(below, above);
      const horiz = Math.max(right, left);
      let target: Range | null = null;
      if (vert > 0 && vert >= horiz) target = below > 0 ? { ...src, r1: hit.r } : { ...src, r0: hit.r };
      else if (horiz > 0) target = right > 0 ? { ...src, c1: hit.c } : { ...src, c0: hit.c };
      d.target = target;
      scheduleDraw();
    } else if (d.mode === 'point' && hit.area === 'cell' && wb.ui.edit) {
      const ref = rangeToA1({ r0: d.anchor.r, c0: d.anchor.c, r1: hit.r, c1: hit.c });
      const t = wb.ui.edit.text;
      const text = t.slice(0, d.start) + ref + t.slice(d.start + d.len);
      d.len = ref.length;
      editCaret.current = d.start + ref.length;
      pendingCaret.current = d.start + ref.length;
      wb.setEditText(text);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = localXY(e);
    if (pointerTap.current && e.pointerType === 'touch') {
      if (Math.hypot(p.x - pointerTap.current.x, p.y - pointerTap.current.y) > 8) pointerTap.current = null;
      return;
    }
    if (dragRef.current) { lastPtr.current = p; dragTo(p.x, p.y); return; }
    const sc = scrollerRef.current!;
    if (p.x > sc.clientWidth || p.y > sc.clientHeight) return;
    const hit = hitTest(p.x, p.y);
    const cur = hit.area === 'col' && hit.edge != null ? 'col-resize' : hit.area === 'row' && hit.edge != null ? 'row-resize'
      : hit.area === 'cell' && hit.handle ? 'crosshair' : hit.area === 'col' ? 's-resize' : hit.area === 'row' ? 'e-resize' : 'cell';
    if (cur !== cursor) setCursor(cur === 's-resize' ? 'pointer' : cur === 'e-resize' ? 'pointer' : cur);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (pointerTap.current && e.pointerType === 'touch') {
      const p = pointerTap.current;
      pointerTap.current = null;
      const hit = hitTest(p.x, p.y);
      wb.commitEdit();
      if (hit.area === 'cell') {
        const now = Date.now();
        if (lastTap.current && now - lastTap.current.t < 350 && lastTap.current.r === hit.r && lastTap.current.c === hit.c) { wb.beginEdit(null, 'edit'); lastTap.current = null; return; }
        lastTap.current = { t: now, r: hit.r, c: hit.c };
        selectCells({ r: hit.r, c: hit.c }, { r: hit.r, c: hit.c });
      } else if (hit.area === 'col') wb.select(firstVisibleRow(), hit.c, { r0: 0, r1: MAX_ROWS - 1, c0: hit.c, c1: hit.c }, false);
      else if (hit.area === 'row') wb.select(hit.r, 0, { r0: hit.r, r1: hit.r, c0: 0, c1: MAX_COLS - 1 }, false);
      return;
    }
    const d = dragRef.current;
    dragRef.current = null;
    if (autoTimer.current) { clearInterval(autoTimer.current); autoTimer.current = null; }
    if (!d) return;
    try { scrollerRef.current?.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    if (d.mode === 'resize-col') {
      const w = s.colWidths.get(d.index)!;
      if (d.orig === undefined) s.colWidths.delete(d.index); else s.colWidths.set(d.index, d.orig);
      const cols = s.sel.range.c0 <= d.index && d.index <= s.sel.range.c1 && s.sel.range.r1 >= MAX_ROWS - 1 ? [s.sel.range.c0, s.sel.range.c1] : [d.index, d.index];
      wb.structural(() => { for (let c = cols[0]; c <= cols[1]; c++) s.colWidths.set(c, w); });
    } else if (d.mode === 'resize-row') {
      const h = s.rowHeights.get(d.index)!;
      if (d.orig === undefined) s.rowHeights.delete(d.index); else s.rowHeights.set(d.index, d.orig);
      const rows = s.sel.range.r0 <= d.index && d.index <= s.sel.range.r1 && s.sel.range.c1 >= MAX_COLS - 1 ? [s.sel.range.r0, s.sel.range.r1] : [d.index, d.index];
      wb.structural(() => { for (let r = rows[0]; r <= rows[1]; r++) s.rowHeights.set(r, h); });
    } else if (d.mode === 'fill' && d.target) {
      wb.fill(s, d.src, d.target);
      wb.select(s.sel.r, s.sel.c, normRange(d.target), false);
    } else if (d.mode === 'point') {
      // keep focus in the editor
    }
    scheduleDraw();
  };
  const lastTap = useRef<{ t: number; r: number; c: number } | null>(null);

  const onDoubleClick = (e: React.MouseEvent) => {
    // Touch double-taps are handled in endDrag; the browser's synthetic dblclick would start a second edit.
    if (lastPointerType.current === 'touch' || filterMenu) return;
    const { x, y } = localXY(e);
    const hit = hitTest(x, y);
    if (onFilterButton(hit, x) != null) return;
    if (hit.area === 'col' && hit.edge != null) {
      const c = hit.edge;
      const w = autofitWidth(wb, s, c);
      wb.structural(() => { s.colWidths.set(c, w); });
      return;
    }
    if (hit.area === 'row' && hit.edge != null) {
      const r = hit.edge;
      wb.structural(() => { s.rowHeights.delete(r); });
      return;
    }
    if (hit.area === 'cell' && !wb.ui.edit) wb.beginEdit(null, 'edit');
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  // ---------- keyboard ----------
  const move = (dr: number, dc: number, extend: boolean, jump: boolean) => {
    const g = geoRef.current ?? computeGeo();
    const sel = s.sel.range;
    const anchor = { r: s.sel.r, c: s.sel.c };
    let from = anchor;
    if (extend) from = { r: sel.r0 === anchor.r ? sel.r1 : sel.r0, c: sel.c0 === anchor.c ? sel.c1 : sel.c0 };
    else {
      // leaving a merged cell: start from its far edge
      const m = wb.mergeAt(s, anchor.r, anchor.c);
      if (m) from = { r: dr > 0 ? m.r1 : dr < 0 ? m.r0 : anchor.r, c: dc > 0 ? m.c1 : dc < 0 ? m.c0 : anchor.c };
    }
    let to: { r: number; c: number };
    if (jump) to = wb.dataEdge(s, from.r, from.c, dr, dc);
    else to = { r: dr ? g.rows.step(from.r, dr, MAX_ROWS - 1) : from.r, c: Math.max(0, Math.min(MAX_COLS - 1, from.c + dc)) };
    if (extend) selectCells(anchor, to, true);
    else {
      const m = wb.mergeAt(s, to.r, to.c);
      const t = m ? { r: m.r0, c: m.c0 } : to;
      focusCorner.current = to;
      wb.select(t.r, t.c, m ?? undefined, true);
    }
  };

  const pageRows = () => {
    const g = geoRef.current ?? computeGeo();
    return Math.max(1, Math.floor((g.H - HH - g.fH) / (DEFAULT_ROW_H * wb.ui.zoom)) - 1);
  };

  const onSinkKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    if (ctrl && !e.altKey && !e.shiftKey && ['c', 'x', 'v'].includes(k.toLowerCase())) { e.stopPropagation(); return; }
    const done = () => { e.preventDefault(); e.stopPropagation(); };
    // The sink is a textarea, so the app shell leaves these to us.
    if (ctrl && !e.altKey) {
      const kl = k.toLowerCase();
      if (kl === 'z' && !e.shiftKey) { done(); wb.undo(); return; }
      if (kl === 'y' || (kl === 'z' && e.shiftKey)) { done(); wb.redo(); return; }
      if (kl === 'a' && !e.shiftKey) { done(); wb.select(0, 0, { r0: 0, c0: 0, r1: MAX_ROWS - 1, c1: MAX_COLS - 1 }, false); return; }
    }
    switch (k) {
      case 'ArrowUp': done(); return move(-1, 0, e.shiftKey, ctrl);
      case 'ArrowDown': done(); return move(1, 0, e.shiftKey, ctrl);
      case 'ArrowLeft': done(); return move(0, -1, e.shiftKey, ctrl);
      case 'ArrowRight': done(); return move(0, 1, e.shiftKey, ctrl);
      case 'Tab': done(); return move(0, e.shiftKey ? -1 : 1, false, false);
      case 'Enter':
        if (ctrl || e.altKey) return;
        done();
        return move(e.shiftKey ? -1 : 1, 0, false, false);
      case 'Home': done();
        if (ctrl) wb.select(0, 0); else if (e.shiftKey) selectCells({ r: s.sel.r, c: s.sel.c }, { r: s.sel.r, c: 0 }, true); else wb.select(s.sel.r, 0);
        return;
      case 'End': {
        done();
        const b = wb.bounds(s);
        if (ctrl) wb.select(Math.max(0, b.rows - 1), Math.max(0, b.cols - 1));
        else {
          let c = Math.max(0, b.cols - 1);
          while (c > 0 && wb.isEmpty(s, s.sel.r, c)) c--;
          wb.select(s.sel.r, c);
        }
        return;
      }
      case 'PageDown': done(); {
        const n = pageRows();
        const sc = scrollerRef.current!;
        sc.scrollTop += n * DEFAULT_ROW_H * wb.ui.zoom;
        if (e.shiftKey) selectCells({ r: s.sel.r, c: s.sel.c }, { r: Math.min(MAX_ROWS - 1, s.sel.range.r1 + n), c: s.sel.c }, true);
        else wb.select(Math.min(MAX_ROWS - 1, s.sel.r + n), s.sel.c);
      }
        return;
      case 'PageUp': done(); {
        const n = pageRows();
        const sc = scrollerRef.current!;
        sc.scrollTop -= n * DEFAULT_ROW_H * wb.ui.zoom;
        if (e.shiftKey) selectCells({ r: s.sel.r, c: s.sel.c }, { r: Math.max(0, s.sel.range.r0 - n), c: s.sel.c }, true);
        else wb.select(Math.max(0, s.sel.r - n), s.sel.c);
      }
        return;
      case 'F2': done(); wb.beginEdit(null, 'edit'); return;
      case 'Delete':
        done();
        if (wb.ui.selectedChart) { const id = wb.ui.selectedChart; wb.structural(() => { s.charts = s.charts.filter((c) => c.id !== id); }); wb.ui.selectedChart = null; return; }
        wb.clear(s, s.sel.range, 'contents');
        return;
      case 'Backspace':
        done();
        if (wb.ui.selectedChart) { const id = wb.ui.selectedChart; wb.structural(() => { s.charts = s.charts.filter((c) => c.id !== id); }); wb.ui.selectedChart = null; return; }
        wb.beginEdit('', 'enter');
        return;
      case 'Escape':
        if (wb.ui.clip) { done(); wb.ui.clip = null; wb.emit(); }
        if (wb.ui.selectedChart) { done(); wb.ui.selectedChart = null; wb.emit(); }
        return;
      case ' ':
        if (ctrl && !e.shiftKey) { done(); wb.select(firstVisibleRow(), s.sel.c, { r0: 0, r1: MAX_ROWS - 1, c0: s.sel.range.c0, c1: s.sel.range.c1 }, false); return; }
        if (e.shiftKey && !ctrl) { done(); wb.select(s.sel.r, 0, { r0: s.sel.range.r0, r1: s.sel.range.r1, c0: 0, c1: MAX_COLS - 1 }, false); return; }
        break;
    }
    if (k.length === 1 && !ctrl && !e.altKey) {
      done();
      wb.beginEdit(k, 'enter');
    }
  };

  const onCopy = (e: React.ClipboardEvent) => {
    if (wb.ui.edit) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copySelection(wb, false));
  };
  const onCut = (e: React.ClipboardEvent) => {
    if (wb.ui.edit) return;
    e.preventDefault();
    e.clipboardData.setData('text/plain', copySelection(wb, true));
  };
  const onPaste = (e: React.ClipboardEvent) => {
    if (wb.ui.edit) return;
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    if (text) pasteText(wb, text);
  };

  // ---------- in-cell editor ----------
  const editCaret = useRef<number | null>(null);
  const pendingCaret = useRef<number | null>(null);

  const g = geoRef.current;
  let editorBox: { x: number; y: number; w: number; h: number } | null = null;
  if (edit && g) {
    const m = wb.mergeAt(s, edit.r, edit.c);
    const rc = rangeRect({ ...g, sx: scrollerRef.current?.scrollLeft ?? g.sx, sy: scrollerRef.current?.scrollTop ?? g.sy }, m ?? { r0: edit.r, c0: edit.c, r1: edit.r, c1: edit.c });
    editorBox = rc;
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0, background: 'var(--bg0)', overflow: 'hidden' }} data-v={version}>
      <canvas ref={canvasRef} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }} />
      <div ref={scrollerRef} onScroll={onScroll} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onDoubleClick={onDoubleClick} onContextMenu={onContextMenu}
        style={{ position: 'absolute', inset: 0, overflow: 'auto', cursor, touchAction: 'pan-x pan-y' }}>
        <div ref={spacerRef} style={{ width: 1, height: 1 }} />
      </div>
      {/* Floating charts */}
      <div style={{ position: 'absolute', left: HW, top: HH, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        <div ref={chartLayerRef} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }}>
          {s.charts.map((ch) => <ChartObject key={ch.id} wb={wb} chart={ch} sheet={s} onEdit={() => onEditChart(ch.id)} />)}
        </div>
      </div>
      <textarea ref={sinkRef} aria-label="Spreadsheet grid" onKeyDown={onSinkKeyDown} onCopy={onCopy} onCut={onCut} onPaste={onPaste} value="" onChange={() => {}}
        style={{ position: 'absolute', left: HW + 4, top: HH + 4, width: 1, height: 1, opacity: 0, padding: 0, border: 0, resize: 'none', pointerEvents: 'none' }} />
      {edit && editorBox && (
        <CellEditor wb={wb} box={editorBox} editCaret={editCaret} pendingCaret={pendingCaret} move={(dr, dc) => move(dr, dc, false, false)} compact={compact} />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
      {filterMenu && s.filter && (
        <FilterMenu key={`${s.id}:${filterMenu.col}`} wb={wb} sheet={s} col={filterMenu.col} x={filterMenu.x} y={filterMenu.y}
          // A click on another column's button opens that menu while this one closes: leave the new one alone.
          onClose={() => { if (filterColRef.current !== filterMenu.col) return; filterColRef.current = null; setFilterMenu(null); wb.ui.focusGrid++; wb.emit(); }} />
      )}
    </div>
  );
}

// ---------- in-cell editor ----------

function CellEditor({ wb, box, editCaret, pendingCaret, move, compact }: {
  wb: Workbook; box: { x: number; y: number; w: number; h: number };
  editCaret: React.MutableRefObject<number | null>; pendingCaret: React.MutableRefObject<number | null>;
  move: (dr: number, dc: number) => void; compact: boolean;
}) {
  const edit = wb.ui.edit!;
  const ref = useRef<HTMLTextAreaElement>(null);
  const [caret, setCaret] = useState(edit.text.length);
  const assist = useFormulaAssist(wb, edit.text, caret);
  const focused = edit.source === 'cell';

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta || !focused) return;
    if (document.activeElement !== ta) {
      ta.focus({ preventScroll: true });
      const p = pendingCaret.current ?? ta.value.length;
      ta.setSelectionRange(p, p);
    }
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta || pendingCaret.current == null) return;
    const p = pendingCaret.current;
    pendingCaret.current = null;
    if (focused) { ta.focus({ preventScroll: true }); ta.setSelectionRange(p, p); }
    setCaret(p);
  });

  const updateCaret = () => {
    const ta = ref.current;
    if (!ta) return;
    editCaret.current = ta.selectionStart;
    setCaret(ta.selectionStart);
  };

  const accept = (i?: number) => {
    const res = assist.accept(i);
    if (!res) return;
    pendingCaret.current = res.caret;
    editCaret.current = res.caret;
    wb.setEditText(res.text);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const ctrl = e.ctrlKey || e.metaKey;
    e.stopPropagation();
    const stop = () => e.preventDefault();
    if (assist.open) {
      if (e.key === 'ArrowDown') { stop(); assist.move(1); return; }
      if (e.key === 'ArrowUp') { stop(); assist.move(-1); return; }
      if (e.key === 'Tab') { stop(); accept(); return; }
      if (e.key === 'Escape') { stop(); assist.dismiss(); return; }
    }
    if (e.key === 'Enter' && e.altKey) {
      stop();
      const ta = ref.current!;
      const p = ta.selectionStart;
      const text = edit.text.slice(0, p) + '\n' + edit.text.slice(ta.selectionEnd);
      pendingCaret.current = p + 1;
      wb.setEditText(text);
      return;
    }
    if (e.key === 'Enter') {
      stop();
      if (ctrl) {
        // Ctrl+Enter: fill the whole selection with this entry
        const s = wb.sheet;
        const g = s.sel.range;
        const text = edit.text;
        wb.ui.edit = null;
        const items: { r: number; c: number; v: string }[] = [];
        // Whole rows/columns are limited to the used area; an ordinary selection is filled completely.
        const lim = wb.clampToUsed(s, g);
        const r1 = g.r1 >= MAX_ROWS - 1 ? Math.max(lim.r1, g.r0) : g.r1;
        const c1 = g.c1 >= MAX_COLS - 1 ? Math.max(lim.c1, g.c0) : g.c1;
        const hidden = wb.hiddenRows(s);
        for (let r = g.r0; r <= r1; r++) for (let c = g.c0; c <= c1; c++) {
          if (hidden.has(r)) continue;
          items.push({ r, c, v: text.startsWith('=') ? shiftF(text, r - edit.r, c - edit.c) : text });
        }
        wb.setInputs(s, items);
        wb.ui.focusGrid++;
        wb.emit();
        return;
      }
      wb.commitEdit();
      wb.ui.focusGrid++;
      move(e.shiftKey ? -1 : 1, 0);
      return;
    }
    if (e.key === 'Tab') { stop(); wb.commitEdit(); wb.ui.focusGrid++; move(0, e.shiftKey ? -1 : 1); return; }
    if (e.key === 'Escape') { stop(); wb.cancelEdit(); return; }
    if (edit.mode === 'enter' && !edit.text.startsWith('=') && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      stop();
      wb.commitEdit();
      wb.ui.focusGrid++;
      const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key as 'ArrowUp']!;
      move(d[0], d[1]);
    }
  };

  // Grow to fit content (Excel-like): width up to 3x cell, height by lines.
  const lines = edit.text.split('\n');
  const longest = Math.max(...lines.map((l) => l.length));
  const w = Math.max(box.w + 1, Math.min(Math.max(box.w * 3, 420), longest * 7.4 + 24));
  const h = Math.max(box.h + 1, lines.length * 16 + 10);
  return (
    <>
      <textarea ref={ref} value={edit.text} spellCheck={false}
        readOnly={!focused && compact}
        onChange={(e) => { editCaret.current = e.target.selectionStart; setCaret(e.target.selectionStart); assist.reset(); wb.setEditText(e.target.value); }}
        onKeyDown={onKeyDown} onSelect={updateCaret} onClick={updateCaret} onKeyUp={updateCaret}
        onFocus={() => { if (wb.ui.edit && wb.ui.edit.source !== 'cell') { wb.ui.edit = { ...wb.ui.edit, source: 'cell' }; wb.emit(); } }}
        style={{
          position: 'absolute', left: box.x - 1, top: box.y - 1, width: w, height: h, zIndex: 5, resize: 'none', overflow: 'hidden',
          padding: `${Math.max(4, (box.h - 16) / 2)}px 7px 0`, margin: 0, background: 'var(--bg0)', color: 'var(--ink)', outline: '2px solid var(--accent)',
          outlineOffset: -2, border: 0, font: `500 ${12 * wb.ui.zoom}px/16px ${edit.text.startsWith('=') ? 'var(--font-mono)' : 'var(--font-ui)'}`, whiteSpace: 'pre',
          boxShadow: 'var(--shadow-float)',
        }} />
      {focused && <AcDropdown wb={wb} assist={assist} onPick={(i) => accept(i)} style={{ left: box.x - 1, top: box.y + h + 2 }} />}
    </>
  );
}


// ---------- context menu ----------

function ContextMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener('pointerdown', close);
    window.addEventListener('blur', close);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('blur', close); };
  }, [onClose]);
  const items: ([string, string] | '-')[] = [
    ['Cut', 'cells.edit.cut'], ['Copy', 'cells.edit.copy'], ['Paste', 'cells.edit.paste'], ['Paste values only', 'cells.edit.pasteValues'], '-',
    ['Insert rows above', 'cells.insert.rowsAbove'], ['Insert rows below', 'cells.insert.rowsBelow'], ['Delete rows', 'cells.insert.deleteRows'], '-',
    ['Insert columns left', 'cells.insert.colsLeft'], ['Insert columns right', 'cells.insert.colsRight'], ['Delete columns', 'cells.insert.deleteCols'], '-',
    ['Clear contents', 'cells.edit.clearContents'], ['Sort A → Z', 'cells.data.sortAsc'], ['Sort Z → A', 'cells.data.sortDesc'], ['Filter', 'cells.data.filter'], '-',
    ['Merge cells', 'cells.format.merge'], ['Conditional formatting…', 'cells.format.condFormat'], ['Chart…', 'cells.insert.chart'],
  ];
  const left = Math.min(x, window.innerWidth - 250);
  const top = Math.min(y, window.innerHeight - 470);
  return (
    <div onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'fixed', left, top: Math.max(4, top), width: 240, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 60, padding: '4px 0' }}>
      {items.map((it, i) => it === '-'
        ? <div key={i} style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
        : <MenuItem key={it[1]} label={it[0]} onClick={() => { onClose(); runCommand(it[1]); }} />)}
    </div>
  );
}
