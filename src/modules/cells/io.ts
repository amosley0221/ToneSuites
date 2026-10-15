// Foreign formats: XLSX (exceljs) and CSV/TSV, plus the native workbook.json payload.
import { DetailedCellError } from 'hyperformula';
import { cellKey, keyCol, keyRow, parseRange, rangeToA1, toA1 } from './address';
import { delimitedInput, parseDelimited, sniffDelimiter, toDelimited } from './csv';
import { loadWorkbook, newSheet, Workbook, workbookToJSON, type CellFormat, type Sheet, type WorkbookJSON } from './model';
import { dateToSerial, fromExcelFormat, toExcelFormat, type NumFmt } from './numfmt';

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- native ----------

export function serializeWorkbook(wb: Workbook): Record<string, string> {
  wb.commitEdit();
  return { 'workbook.json': JSON.stringify(workbookToJSON(wb)) };
}

export function deserializeWorkbook(files: Record<string, Uint8Array>, formatVersion: number): Workbook {
  const raw = files['workbook.json'];
  if (!raw) throw new Error('This Cells file has no workbook.json');
  const j = JSON.parse(dec.decode(raw)) as WorkbookJSON;
  if ((j.formatVersion ?? formatVersion) > 1) throw new Error('This workbook was saved by a newer version of Tone');
  return loadWorkbook(j);
}

// ---------- CSV / TSV ----------

export function workbookFromDelimited(text: string, filename: string): Workbook {
  const delim = sniffDelimiter(text, filename);
  const rows = parseDelimited(text, delim);
  const base = filename.replace(/\.[^.]+$/, '').slice(0, 31).replace(/[\\/?*[\]:]/g, ' ').trim() || 'Sheet 1';
  const s = newSheet(base);
  fillSheet(s, rows);
  return new Workbook([s]);
}

export function fillSheet(s: Sheet, rows: string[][], r0 = 0, c0 = 0) {
  rows.forEach((row, r) => row.forEach((v, c) => {
    if (v !== '') s.cells.set(cellKey(r0 + r, c0 + c), { v: delimitedInput(v) });
  }));
}

/**
 * Text of the used range for CSV/TSV. Plain typed/imported values are written exactly as entered, so an
 * opened CSV saves back unchanged (dates keep "07/14/2007", IDs keep "001234"); formulas and cells with a
 * number format are written as displayed.
 */
export function sheetToRows(wb: Workbook, s: Sheet): string[][] {
  const b = wb.bounds(s);
  const out: string[][] = [];
  for (let r = 0; r < b.rows; r++) {
    const row: string[] = [];
    for (let c = 0; c < b.cols; c++) {
      const cell = wb.getCell(s, r, c);
      const plain = cell && !cell.v.startsWith('=') && !cell.f?.nf && cell.f?.dp == null;
      row.push(plain ? (cell.v.startsWith("'") ? cell.v.slice(1) : cell.v) : wb.display(s, r, c).text);
    }
    out.push(row);
  }
  return out;
}

export function sheetToDelimited(wb: Workbook, s: Sheet, delim: string): Uint8Array {
  return enc.encode(toDelimited(sheetToRows(wb, s), delim));
}

// ---------- XLSX ----------

async function excel() {
  const mod: any = await import('exceljs');
  return mod.default ?? mod;
}

const argbToHex = (argb?: string): string | undefined => (argb && /^[0-9a-f]{8}$/i.test(argb) ? '#' + argb.slice(2).toLowerCase() : undefined);
const NUMERIC_LIKE = /^\s*[-+]?[$€£]?(\d[\d,]*)?(\.\d+)?%?\s*$/;

function rawFromExcelCell(cell: any): { v: string; nf?: NumFmt } {
  const v = cell.value;
  if (v == null) return { v: '' };
  const f = cell.formula;
  if (f) return { v: '=' + String(f).replace(/^=/, '') };
  if (typeof v === 'number') return { v: String(v) };
  if (typeof v === 'boolean') return { v: v ? 'TRUE' : 'FALSE' };
  if (v instanceof Date) {
    const serial = dateToSerial(v);
    return { v: String(+serial.toFixed(8)), nf: Number.isInteger(serial) ? 'date' : 'datetime' };
  }
  if (typeof v === 'string') return { v: v.startsWith('=') || (NUMERIC_LIKE.test(v) && /\d/.test(v)) ? "'" + v : v };
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return { v: v.richText.map((t: any) => t.text).join('') };
    if ('text' in v) return { v: String(v.text ?? '') };
    if ('error' in v) return { v: String(v.error) };
    if ('result' in v && v.result != null) return { v: String(v.result) };
  }
  return { v: String(v) };
}

function formatFromExcelCell(cell: any, nfHint?: NumFmt): CellFormat | undefined {
  const f: CellFormat = {};
  const font = cell.font;
  if (font?.bold) f.b = true;
  if (font?.italic) f.i = true;
  if (font?.underline) f.u = true;
  if (font?.strike) f.s = true;
  const fc = argbToHex(font?.color?.argb);
  if (fc && fc !== '#000000' && fc !== '#ffffff') f.color = fc;
  const fill = cell.fill;
  if (fill?.type === 'pattern' && fill.pattern === 'solid') {
    const hex = argbToHex(fill.fgColor?.argb);
    if (hex) f.fill = hex;
  }
  const al = cell.alignment;
  if (al?.horizontal === 'left' || al?.horizontal === 'center' || al?.horizontal === 'right') f.al = al.horizontal;
  if (al?.wrapText) f.wrap = true;
  const nf = fromExcelFormat(cell.numFmt);
  if (nf) { f.nf = nf.nf; if (nf.dp != null && nf.nf !== 'date' && nf.nf !== 'datetime' && nf.nf !== 'text') f.dp = nf.dp; if (nf.cur && nf.cur !== '$') f.cur = nf.cur; }
  else if (nfHint) f.nf = nfHint;
  const bd = cell.border;
  if (bd) {
    const b = { t: !!bd.top?.style, r: !!bd.right?.style, b: !!bd.bottom?.style, l: !!bd.left?.style };
    if (b.t || b.r || b.b || b.l) f.bd = b;
  }
  return Object.keys(f).length ? f : undefined;
}

export async function workbookFromXlsx(bytes: Uint8Array): Promise<Workbook> {
  const ExcelJS = await excel();
  const xwb = new ExcelJS.Workbook();
  await xwb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const sheets: Sheet[] = [];
  const used = new Set<string>();
  xwb.eachSheet((ws: any) => {
    let name = String(ws.name || `Sheet ${sheets.length + 1}`);
    while (used.has(name.toLowerCase())) name += ' 2';
    used.add(name.toLowerCase());
    const s = newSheet(name);
    ws.eachRow({ includeEmpty: false }, (row: any, rn: number) => {
      if (row.height && Math.abs(row.height - 15) > 0.5) s.rowHeights.set(rn - 1, Math.max(12, Math.round(row.height * 4 / 3)));
      row.eachCell({ includeEmpty: false }, (cell: any, cn: number) => {
        if (cell.isMerged && cell.master !== cell) return;
        const { v, nf } = rawFromExcelCell(cell);
        const f = formatFromExcelCell(cell, nf);
        if (v === '' && !f) return;
        s.cells.set(cellKey(rn - 1, cn - 1), f ? { v, f } : { v });
      });
    });
    (ws.columns ?? []).forEach((col: any, i: number) => {
      if (col?.width) s.colWidths.set(i, Math.max(24, Math.round(col.width * 7 + 5)));
    });
    const merges: string[] = ws.model?.merges ?? [];
    s.merges = merges.map((m) => parseRange(m)).filter((g): g is NonNullable<typeof g> => !!g);
    const view = ws.views?.[0];
    if (view?.state === 'frozen') s.freeze = { rows: view.ySplit ?? 0, cols: view.xSplit ?? 0 };
    if (view && view.showGridLines === false) s.showGrid = false;
    const af = ws.autoFilter;
    const afRef = typeof af === 'string' ? af : af?.from && af?.to ? `${typeof af.from === 'string' ? af.from : toA1(af.from.row - 1, af.from.column - 1)}:${typeof af.to === 'string' ? af.to : toA1(af.to.row - 1, af.to.column - 1)}` : null;
    const afRange = afRef ? parseRange(afRef) : null;
    if (afRange) s.filter = { range: afRange, hidden: {} };
    sheets.push(s);
  });
  return new Workbook(sheets);
}

export async function workbookToXlsx(wb: Workbook): Promise<Uint8Array> {
  wb.commitEdit();
  const ExcelJS = await excel();
  const xwb = new ExcelJS.Workbook();
  xwb.creator = 'Tone Cells';
  for (const s of wb.sheets) {
    const views = s.freeze.rows || s.freeze.cols
      ? [{ state: 'frozen', xSplit: s.freeze.cols, ySplit: s.freeze.rows, showGridLines: s.showGrid }]
      : [{ showGridLines: s.showGrid }];
    const ws = xwb.addWorksheet(s.name, { views });
    for (const [c, w] of s.colWidths) ws.getColumn(c + 1).width = Math.max(1, (w - 5) / 7);
    for (const [r, h] of s.rowHeights) ws.getRow(r + 1).height = h * 0.75;
    const hfId = wb.hfId(s);
    for (const [k, cell] of s.cells) {
      const r = keyRow(k);
      const c = keyCol(k);
      const xc = ws.getCell(r + 1, c + 1);
      const val = cell.v === '' ? null : wb.hf.getCellValue({ sheet: hfId, row: r, col: c });
      const plain = val instanceof DetailedCellError ? { error: val.value } : val;
      if (cell.v.startsWith('=') && cell.v.length > 1) xc.value = { formula: cell.v.slice(1), result: plain ?? undefined };
      else if (cell.v.startsWith("'")) xc.value = cell.v.slice(1);
      else xc.value = plain as any;
      let nf = cell.f?.nf;
      if (!nf && typeof val === 'number') {
        const t = String(wb.hf.getCellValueDetailedType({ sheet: hfId, row: r, col: c }));
        if (t === 'NUMBER_DATE') nf = 'date';
        else if (t === 'NUMBER_DATETIME') nf = 'datetime';
        else if (t === 'NUMBER_PERCENT') nf = 'percent';
        else if (t === 'NUMBER_CURRENCY') nf = 'currency';
      }
      const f = cell.f ?? {};
      const code = toExcelFormat(nf, f.dp, f.cur);
      if (code) xc.numFmt = code;
      if (f.b || f.i || f.u || f.s || f.color) {
        xc.font = { bold: !!f.b, italic: !!f.i, underline: !!f.u, strike: !!f.s, ...(f.color ? { color: { argb: 'FF' + f.color.slice(1).toUpperCase() } } : {}) };
      }
      if (f.fill) xc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + f.fill.slice(1).toUpperCase() } };
      if (f.al || f.wrap) xc.alignment = { ...(f.al ? { horizontal: f.al } : {}), ...(f.wrap ? { wrapText: true } : {}) };
      if (f.bd) {
        const thin = { style: 'thin' };
        xc.border = { ...(f.bd.t ? { top: thin } : {}), ...(f.bd.r ? { right: thin } : {}), ...(f.bd.b ? { bottom: thin } : {}), ...(f.bd.l ? { left: thin } : {}) };
      }
    }
    for (const m of s.merges) {
      try { ws.mergeCells(rangeToA1(m)); } catch { /* overlapping merges are skipped */ }
    }
    if (s.filter) ws.autoFilter = rangeToA1(s.filter.range);
  }
  const buf = await xwb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

export async function openWorkbookFile(bytes: Uint8Array, filename: string): Promise<Workbook> {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  if (ext === 'xlsx') return workbookFromXlsx(bytes);
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return workbookFromDelimited(dec.decode(bytes), filename);
  throw new Error(`Cells can't open .${ext} files`);
}
