// Command handlers for every implemented Cells menu id.
import type { CommandHandler, ModuleApi } from '@/core/types';
import { colToLetters, MAX_COLS, MAX_ROWS, normRange, parseRange, rangeToA1, shiftFormula, toA1, type Range } from './address';
import { copySelection, pasteText } from './clipboard';
import { parseDelimited, sniffDelimiter } from './csv';
import { autofitWidth } from './Grid';
import { workbookFromXlsx } from './io';
import { DEFAULT_COL_W, DEFAULT_ROW_H, type CellData, type CellFormat, type Sheet, type Workbook } from './model';
import { defaultDecimals, type NumFmt } from './numfmt';
import { ChartDialog } from './ChartDialog';
import { PivotDialog } from './PivotDialog';
import { CondFormatDialog } from './CondFormatDialog';
import { FindDialog, FunctionListDialog, PromptDialog } from './MiscDialogs';

/** The focused text field, if it is not the grid itself (so edit shortcuts act on it natively). */
function editableFocus(): HTMLInputElement | HTMLTextAreaElement | HTMLElement | null {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el.getAttribute('aria-label') === 'Spreadsheet grid') return null;
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return el;
  return null;
}

/** Selection rows/cols clamped to something sensible for whole-row/column selections. */
const selRows = (wb: Workbook, s: Sheet) => { const g = s.sel.range; return [g.r0, g.r1 >= MAX_ROWS - 1 ? Math.max(g.r0, wb.bounds(s).rows - 1) : g.r1]; };
const selCols = (wb: Workbook, s: Sheet) => { const g = s.sel.range; return [g.c0, g.c1 >= MAX_COLS - 1 ? Math.max(g.c0, wb.bounds(s).cols - 1) : g.c1]; };

/** Range to act on for sort/filter/pivot: selection, or the current region around a single cell. */
function dataRange(wb: Workbook, s: Sheet): Range {
  const g = s.sel.range;
  if (g.r0 === g.r1 && g.c0 === g.c1) return wb.currentRegion(s, g.r0, g.c0);
  return wb.clampToUsed(s, g);
}

/** Header row heuristic: first row all text, and some column below has a number. */
function looksLikeHeader(wb: Workbook, s: Sheet, g: Range): boolean {
  if (g.r1 <= g.r0) return false;
  if (s.filter && s.filter.range.r0 === g.r0) return true;
  let anyText = false;
  for (let c = g.c0; c <= g.c1; c++) {
    const v = wb.value(s, g.r0, c);
    if (typeof v === 'number') return false;
    if (typeof v === 'string' && v !== '') anyText = true;
  }
  if (!anyText) return false;
  const f = wb.getCell(s, g.r0, g.c0)?.f;
  if (f?.b) return true;
  for (let c = g.c0; c <= g.c1; c++) if (typeof wb.value(s, g.r0 + 1, c) === 'number') return true;
  return false;
}

export function cellsCommands(getModel: () => Workbook | undefined, api: ModuleApi): Record<string, CommandHandler> {
  const run = (fn: (wb: Workbook, s: Sheet) => void | Promise<void>): CommandHandler => async () => {
    const wb = getModel();
    if (!wb) return;
    const before = wb.dataVersion;
    await fn(wb, wb.sheet);
    if (wb.dataVersion !== before) api.markDirty();
    api.refreshChrome?.();
  };
  /** Close a dialog: refocus the grid and mark dirty only if the document changed. */
  const openDlg = (wb: Workbook, render: (onClose: () => void) => React.ReactNode) => {
    const before = wb.dataVersion;
    api.openDialog((close) => render(() => { close(); wb.ui.focusGrid++; wb.emit(); if (wb.dataVersion !== before) api.markDirty(); api.refreshChrome?.(); }));
  };
  /** Commands that apply to the selection commit the in-progress edit first. */
  const onSel = (fn: (wb: Workbook, s: Sheet, g: Range) => void): CommandHandler => run((wb, s) => { wb.commitEdit(); fn(wb, s, s.sel.range); });

  const fmt = (patch: (f: CellFormat, wb: Workbook, s: Sheet) => Partial<CellFormat>) => onSel((wb, s, g) => {
    const active = wb.getCell(s, s.sel.r, s.sel.c)?.f ?? {};
    const p = patch(active, wb, s);
    wb.formatRange(s, g, p);
  });
  const toggle = (k: 'b' | 'i' | 'u' | 's' | 'wrap') => fmt((f) => ({ [k]: !f[k] }));
  const numFmt = (nf: NumFmt) => fmt(() => ({ nf, dp: undefined }));
  const align = (al: CellFormat['al']) => fmt((f) => ({ al: f.al === al ? undefined : al }));

  const decimals = (d: number) => onSel((wb, s, g) => {
    wb.formatRange(s, g, (f, r, c) => {
      let cur = f.dp;
      if (cur == null) {
        if (f.nf && f.nf !== 'general') cur = defaultDecimals(f.nf);
        else {
          const t = wb.display(s, r, c).text;
          const i = t.indexOf('.');
          cur = i < 0 ? 0 : t.length - i - 1 - (t.endsWith('%') ? 1 : 0);
        }
      }
      return { ...f, dp: Math.max(0, Math.min(10, cur + d)) };
    });
  });

  const borders = (mode: 'all' | 'outer' | 'bottom' | 'none') => onSel((wb, s, g0) => {
    const g = { r0: g0.r0, c0: g0.c0, r1: selRows(wb, s)[1], c1: selCols(wb, s)[1] };
    wb.formatRange(s, g, (f, r, c) => {
      if (mode === 'none') return { ...f, bd: undefined };
      if (mode === 'all') return { ...f, bd: { t: true, r: true, b: true, l: true } };
      const bd = { ...(f.bd ?? {}) };
      if (mode === 'bottom') { if (r === g.r1) bd.b = true; return { ...f, bd }; }
      if (r === g.r0) bd.t = true;
      if (r === g.r1) bd.b = true;
      if (c === g.c0) bd.l = true;
      if (c === g.c1) bd.r = true;
      return { ...f, bd };
    });
  });

  const freeze = (rows: number | null, cols: number | null) => run((wb, s) => {
    wb.structural(() => { s.freeze = { rows: rows ?? s.freeze.rows, cols: cols ?? s.freeze.cols }; });
  });

  const insertRows = (below: boolean) => onSel((wb, s) => {
    const [r0, r1] = selRows(wb, s);
    const n = Math.min(1000, r1 - r0 + 1);
    wb.insertRows(s, below ? r1 + 1 : r0, n);
    if (!below) wb.select(s.sel.r + n, s.sel.c, { ...s.sel.range, r0: s.sel.range.r0 + n, r1: Math.min(MAX_ROWS - 1, s.sel.range.r1 + n) }, false);
  });
  const insertCols = (right: boolean) => onSel((wb, s) => {
    const [c0, c1] = selCols(wb, s);
    const n = Math.min(200, c1 - c0 + 1);
    wb.insertCols(s, right ? c1 + 1 : c0, n);
    if (!right) wb.select(s.sel.r, s.sel.c + n, { ...s.sel.range, c0: s.sel.range.c0 + n, c1: Math.min(MAX_COLS - 1, s.sel.range.c1 + n) }, false);
  });

  const sort = (asc: boolean) => onSel((wb, s) => {
    const inFilter = s.filter && s.sel.r >= s.filter.range.r0 && s.sel.r <= s.filter.range.r1 && s.sel.c >= s.filter.range.c0 && s.sel.c <= s.filter.range.c1;
    const g = inFilter && s.sel.range.r0 === s.sel.range.r1 ? s.filter!.range : dataRange(wb, s);
    const header = inFilter ? true : s.sel.range.r0 === s.sel.range.r1 && s.sel.range.c0 === s.sel.range.c1 ? looksLikeHeader(wb, s, g) : false;
    wb.sortRange(s, g, s.sel.c, asc, header);
    api.toast(`Sorted ${rangeToA1(header ? { ...g, r0: g.r0 + 1 } : g)} by column ${colToLetters(s.sel.c)} ${asc ? 'A → Z' : 'Z → A'}`);
  });

  const autosum = onSel((wb, s, g) => {
    if (g.r0 === g.r1 && g.c0 === g.c1) {
      const { r, c } = s.sel;
      const isNum = (rr: number, cc: number) => rr >= 0 && cc >= 0 && wb.num(s, rr, cc) != null;
      let text = '=SUM()';
      if (isNum(r - 1, c)) {
        let top = r - 1;
        while (isNum(top - 1, c)) top--;
        text = `=SUM(${toA1(top, c)}:${toA1(r - 1, c)})`;
      } else if (isNum(r, c - 1)) {
        let left = c - 1;
        while (isNum(r, left - 1)) left--;
        text = `=SUM(${toA1(r, left)}:${toA1(r, c - 1)})`;
      }
      wb.beginEdit(text, 'edit');
      return;
    }
    const gg = wb.clampToUsed(s, g);
    const items: { r: number; c: number; v: string }[] = [];
    if (gg.r1 > gg.r0) for (let c = gg.c0; c <= gg.c1; c++) items.push({ r: gg.r1 + 1, c, v: `=SUM(${toA1(gg.r0, c)}:${toA1(gg.r1, c)})` });
    else for (let r = gg.r0; r <= gg.r1; r++) items.push({ r, c: gg.c1 + 1, v: `=SUM(${toA1(r, gg.c0)}:${toA1(r, gg.c1)})` });
    wb.setInputs(s, items);
  });

  const fillDir = (down: boolean) => onSel((wb, s, g0) => {
    const g = { ...g0, r1: selRows(wb, s)[1], c1: selCols(wb, s)[1] };
    if (down) {
      if (g.r1 === g.r0) { if (g.r0 === 0) return; wb.fill(s, { ...g, r0: g.r0 - 1, r1: g.r0 - 1 }, g); }
      else wb.fill(s, { ...g, r1: g.r0 }, g);
    } else {
      if (g.c1 === g.c0) { if (g.c0 === 0) return; wb.fill(s, { ...g, c0: g.c0 - 1, c1: g.c0 - 1 }, g); }
      else wb.fill(s, { ...g, c1: g.c0 }, g);
    }
  });

  const openPrompt = (title: string, label: string, initial: string, onOk: (v: string) => string | null, mono = true) =>
    api.openDialog((close) => <PromptDialog title={title} label={label} initial={initial} onOk={onOk} onClose={close} mono={mono} />);

  const insertSheetFrom = async (wb: Workbook, kind: 'delimited' | 'xlsx') => {
    if (kind === 'delimited') {
      const files = await api.pickFile(['csv', 'tsv', 'txt'], true);
      for (const f of files) {
        const text = new TextDecoder().decode(f.bytes);
        const rows = parseDelimited(text, sniffDelimiter(text, f.name));
        const ns = wb.addSheet(f.name.replace(/\.[^.]+$/, '').slice(0, 28).replace(/[\\/?*[\]:]/g, ' ').trim() || undefined);
        wb.writeGrid(ns, 0, 0, rows);
        wb.select(0, 0);
      }
      if (files.length) api.toast(`Imported ${files.length} file${files.length > 1 ? 's' : ''} as new sheet${files.length > 1 ? 's' : ''}`);
      return;
    }
    const [f] = await api.pickFile(['xlsx']);
    if (!f) return;
    const src = await workbookFromXlsx(f.bytes);
    wb.structural(() => {
      for (const sh of src.sheets) {
        sh.name = wb.uniqueSheetName(sh.name);
        wb.sheets.push(sh);
      }
      wb.active = wb.sheets.length - src.sheets.length;
      wb.rebuildEngine();
    });
    api.toast(`Imported ${src.sheets.length} sheet${src.sheets.length > 1 ? 's' : ''} from ${f.name}`);
  };

  const removeDuplicates = onSel((wb, s) => {
    const g = dataRange(wb, s);
    const header = looksLikeHeader(wb, s, g);
    const r0 = header ? g.r0 + 1 : g.r0;
    const seen = new Set<string>();
    const keep: number[] = [];
    for (let r = r0; r <= g.r1; r++) {
      const key = Array.from({ length: g.c1 - g.c0 + 1 }, (_, j) => wb.display(s, r, g.c0 + j).text).join('\u0001');
      if (seen.has(key)) continue;
      seen.add(key);
      keep.push(r);
    }
    const removed = g.r1 - r0 + 1 - keep.length;
    if (!removed) { api.toast('No duplicate rows found'); return; }
    const changes: { r: number; c: number; cell: CellData | undefined }[] = [];
    for (let i = 0; i <= g.r1 - r0; i++) {
      const src = keep[i];
      for (let c = g.c0; c <= g.c1; c++) {
        if (src == null) { changes.push({ r: r0 + i, c, cell: undefined }); continue; }
        const cell = wb.getCell(s, src, c);
        changes.push({ r: r0 + i, c, cell: cell ? { ...cell, v: cell.v.startsWith('=') ? shiftFormula(cell.v, r0 + i - src, 0) : cell.v } : undefined });
      }
    }
    wb.setCells(s, changes);
    api.toast(`Removed ${removed} duplicate row${removed > 1 ? 's' : ''}`);
  });

  const deleteChart = (wb: Workbook, s: Sheet) => {
    const id = wb.ui.selectedChart;
    if (!id) return false;
    wb.structural(() => { s.charts = s.charts.filter((c) => c.id !== id); });
    wb.ui.selectedChart = null;
    return true;
  };

  return {
    // File
    'cells.file.importDelimited': run((wb) => insertSheetFrom(wb, 'delimited')),
    'cells.file.importXlsx': run((wb) => insertSheetFrom(wb, 'xlsx')),

    // Edit
    'cells.edit.undo': run((wb) => { const el = editableFocus(); if (el) { document.execCommand('undo'); return; } wb.cancelEdit(); wb.undo(); }),
    'cells.edit.redo': run((wb) => { const el = editableFocus(); if (el) { document.execCommand('redo'); return; } wb.redo(); }),
    'cells.edit.copy': run(async (wb) => {
      if (editableFocus()) { document.execCommand('copy'); return; }
      await navigator.clipboard.writeText(copySelection(wb, false)).catch(() => api.toast('Clipboard access was blocked', 'error'));
    }),
    'cells.edit.cut': run(async (wb) => {
      if (editableFocus()) { document.execCommand('cut'); return; }
      await navigator.clipboard.writeText(copySelection(wb, true)).catch(() => api.toast('Clipboard access was blocked', 'error'));
    }),
    'cells.edit.paste': run(async (wb) => {
      const text = await navigator.clipboard.readText().catch(() => null);
      if (text == null) { api.toast('Clipboard access was blocked — use Ctrl V in the grid', 'error'); return; }
      if (editableFocus()) { document.execCommand('insertText', false, text); return; }
      pasteText(wb, text);
    }),
    'cells.edit.pasteValues': run(async (wb) => {
      const text = await navigator.clipboard.readText().catch(() => null);
      if (text == null) { api.toast('Clipboard access was blocked', 'error'); return; }
      pasteText(wb, text, true);
    }),
    'cells.edit.fillDown': fillDir(true),
    'cells.edit.fillRight': fillDir(false),
    'cells.edit.clearContents': onSel((wb, s, g) => { if (!deleteChart(wb, s)) wb.clear(s, g, 'contents'); }),
    'cells.edit.clearFormats': onSel((wb, s, g) => wb.clear(s, g, 'formats')),
    'cells.edit.clearAll': onSel((wb, s, g) => wb.clear(s, g, 'all')),
    'cells.edit.find': run((wb) => openDlg(wb, (onClose) => <FindDialog wb={wb} onClose={onClose} />)),
    'cells.edit.goto': run((wb) => { wb.ui.focusNameBox++; wb.emit(); }),
    'cells.edit.selectAll': run((wb) => {
      const el = editableFocus();
      if (el && 'select' in el) { (el as HTMLInputElement).select(); return; }
      wb.select(0, 0, { r0: 0, c0: 0, r1: MAX_ROWS - 1, c1: MAX_COLS - 1 }, false);
    }),

    // View
    'cells.view.freezeRow': freeze(1, 0),
    'cells.view.freezeCol': freeze(0, 1),
    'cells.view.freezeSel': run((wb, s) => { const { r, c } = s.sel; wb.structural(() => { s.freeze = { rows: r, cols: c }; }); }),
    'cells.view.unfreeze': freeze(0, 0),
    'cells.view.gridlines': run((wb, s) => wb.structural(() => { s.showGrid = !s.showGrid; })),
    'cells.view.formulas': run((wb) => { wb.ui.showFormulas = !wb.ui.showFormulas; wb.emit(); }),
    'cells.view.zoomIn': run((wb) => { wb.ui.zoom = Math.min(2, +(wb.ui.zoom + 0.1).toFixed(2)); wb.emit(); }),
    'cells.view.zoomOut': run((wb) => { wb.ui.zoom = Math.max(0.5, +(wb.ui.zoom - 0.1).toFixed(2)); wb.emit(); }),
    'cells.view.zoomReset': run((wb) => { wb.ui.zoom = 1; wb.emit(); }),

    // Insert
    'cells.insert.rowsAbove': insertRows(false),
    'cells.insert.rowsBelow': insertRows(true),
    'cells.insert.colsLeft': insertCols(false),
    'cells.insert.colsRight': insertCols(true),
    'cells.insert.deleteRows': onSel((wb, s) => {
      const [r0, r1] = selRows(wb, s);
      wb.deleteRows(s, r0, r1 - r0 + 1);
      wb.select(r0, s.sel.c);
    }),
    'cells.insert.deleteCols': onSel((wb, s) => {
      const [c0, c1] = selCols(wb, s);
      wb.deleteCols(s, c0, c1 - c0 + 1);
      wb.select(s.sel.r, c0);
    }),
    'cells.insert.sheet': run((wb) => { wb.commitEdit(); wb.addSheet(); }),
    'cells.insert.chart': run((wb) => { wb.commitEdit(); openDlg(wb, (onClose) => <ChartDialog wb={wb} onClose={onClose} />); }),
    'cells.insert.pivot': run((wb) => { wb.commitEdit(); openDlg(wb, (onClose) => <PivotDialog wb={wb} onClose={onClose} />); }),
    'cells.data.pivot': run((wb) => { wb.commitEdit(); openDlg(wb, (onClose) => <PivotDialog wb={wb} onClose={onClose} />); }),
    'cells.insert.autosum': autosum,

    // Format
    'cells.format.bold': toggle('b'),
    'cells.format.italic': toggle('i'),
    'cells.format.underline': toggle('u'),
    'cells.format.strike': toggle('s'),
    'cells.format.nf.general': numFmt('general'),
    'cells.format.nf.number': numFmt('number'),
    'cells.format.nf.integer': numFmt('integer'),
    'cells.format.nf.currency': numFmt('currency'),
    'cells.format.nf.percent': numFmt('percent'),
    'cells.format.nf.date': numFmt('date'),
    'cells.format.nf.datetime': numFmt('datetime'),
    'cells.format.nf.text': numFmt('text'),
    'cells.format.decInc': decimals(1),
    'cells.format.decDec': decimals(-1),
    'cells.format.alignLeft': align('left'),
    'cells.format.alignCenter': align('center'),
    'cells.format.alignRight': align('right'),
    'cells.format.wrap': toggle('wrap'),
    'cells.format.merge': onSel((wb, s, g0) => {
      const g = normRange({ ...g0, r1: selRows(wb, s)[1], c1: selCols(wb, s)[1] });
      if (g.r0 === g.r1 && g.c0 === g.c1) return;
      const lost = wb.cellsIn(s, g).filter(([r, c, cell]) => (r !== g.r0 || c !== g.c0) && cell.v !== '').length;
      wb.structural(() => {
        s.merges = s.merges.filter((m) => !(m.r0 <= g.r1 && g.r0 <= m.r1 && m.c0 <= g.c1 && g.c0 <= m.c1));
        s.merges.push(g);
        for (const [r, c, cell] of wb.cellsIn(s, g)) if ((r !== g.r0 || c !== g.c0) && cell.v !== '') { cell.v = ''; }
        wb.rebuildEngine();
      });
      if (lost) api.toast(`Merged — kept the top-left value, cleared ${lost} other cell${lost > 1 ? 's' : ''}`);
    }),
    'cells.format.unmerge': onSel((wb, s, g) => {
      wb.structural(() => { s.merges = s.merges.filter((m) => !(m.r0 <= g.r1 && g.r0 <= m.r1 && m.c0 <= g.c1 && g.c0 <= m.c1)); });
    }),
    'cells.format.bd.all': borders('all'),
    'cells.format.bd.outer': borders('outer'),
    'cells.format.bd.bottom': borders('bottom'),
    'cells.format.bd.none': borders('none'),
    'cells.format.condFormat': run((wb) => { wb.commitEdit(); openDlg(wb, (onClose) => <CondFormatDialog wb={wb} onClose={onClose} />); }),
    'cells.format.clear': onSel((wb, s, g) => wb.clear(s, g, 'formats')),
    'cells.format.colWidth': run((wb, s) => {
      const [c0, c1] = selCols(wb, s);
      openPrompt('Column width', `Width in pixels · ${colToLetters(c0)}${c1 > c0 ? ':' + colToLetters(c1) : ''}`, String(s.colWidths.get(c0) ?? DEFAULT_COL_W), (v) => {
        const n = Math.round(Number(v));
        if (!isFinite(n) || n < 8 || n > 2000) return 'Enter a width between 8 and 2000';
        wb.structural(() => { for (let c = c0; c <= c1; c++) s.colWidths.set(c, n); });
        api.markDirty();
        return null;
      });
    }),
    'cells.format.rowHeight': run((wb, s) => {
      const [r0, r1] = selRows(wb, s);
      openPrompt('Row height', `Height in pixels · rows ${r0 + 1}${r1 > r0 ? '–' + (r1 + 1) : ''}`, String(s.rowHeights.get(r0) ?? DEFAULT_ROW_H), (v) => {
        const n = Math.round(Number(v));
        if (!isFinite(n) || n < 8 || n > 1000) return 'Enter a height between 8 and 1000';
        wb.structural(() => { for (let r = r0; r <= r1; r++) s.rowHeights.set(r, n); });
        api.markDirty();
        return null;
      });
    }),
    'cells.format.autofit': run((wb, s) => {
      const [c0, c1] = selCols(wb, s);
      const widths = Array.from({ length: Math.min(200, c1 - c0 + 1) }, (_, i) => autofitWidth(wb, s, c0 + i));
      wb.structural(() => widths.forEach((w, i) => s.colWidths.set(c0 + i, w)));
    }),

    // Sheets
    'cells.sheet.rename': run((wb, s) => openPrompt('Rename sheet', 'Sheet name', s.name, (v) => {
      if (!wb.renameSheet(s, v)) return 'Use 1–31 characters, no \\ / ? * [ ] :, and a name not already used';
      api.markDirty();
      api.refreshChrome?.();
      return null;
    }, false)),
    'cells.sheet.duplicate': run((wb, s) => { wb.commitEdit(); wb.duplicateSheet(s); }),
    'cells.sheet.delete': run((wb, s) => {
      wb.commitEdit();
      if (!wb.deleteSheet(s)) api.toast('A workbook needs at least one sheet', 'error');
    }),
    'cells.sheet.moveLeft': run((wb) => wb.moveSheet(wb.active, wb.active - 1)),
    'cells.sheet.moveRight': run((wb) => wb.moveSheet(wb.active, wb.active + 1)),

    // Data
    'cells.data.sortAsc': sort(true),
    'cells.data.sortDesc': sort(false),
    'cells.data.filter': onSel((wb, s) => {
      if (s.filter) { wb.structural(() => { s.filter = null; }); return; }
      const g = dataRange(wb, s);
      if (g.r1 <= g.r0 && wb.isEmpty(s, g.r0, g.c0)) { api.toast('Select a table with a header row to filter', 'error'); return; }
      wb.structural(() => { s.filter = { range: g, hidden: {} }; });
    }),
    'cells.data.clearFilter': run((wb, s) => { if (s.filter) wb.structural(() => { s.filter!.hidden = {}; s.filter!.contains = {}; }); }),
    'cells.data.removeDuplicates': removeDuplicates,
    'cells.data.trim': onSel((wb, s, g) => {
      const items = wb.cellsIn(s, wb.clampToUsed(s, g))
        .filter(([, , cell]) => !cell.v.startsWith('=') && cell.v !== cell.v.trim().replace(/[ \t]+/g, ' '))
        .map(([r, c, cell]) => ({ r, c, v: cell.v.trim().replace(/[ \t]+/g, ' ') }));
      wb.setInputs(s, items);
      api.toast(items.length ? `Trimmed ${items.length} cell${items.length > 1 ? 's' : ''}` : 'Nothing to trim');
    }),

    // Tools
    'cells.tools.recalc': run((wb) => { wb.commitEdit(); wb.rebuildEngine(); wb.emit(); api.toast('Recalculated'); }),
    'cells.tools.functions': run((wb) => api.openDialog((close) => <FunctionListDialog wb={wb} onClose={close} />)),
  };
}

/** Name of the selection for the name box: "C12" or "A1:C5" (sheet-qualified when needed elsewhere). */
export function selectionLabel(wb: Workbook, s: Sheet): string {
  const g = s.sel.range;
  if (g.r0 === g.r1 && g.c0 === g.c1) return toA1(g.r0, g.c0);
  const m = wb.mergeAt(s, s.sel.r, s.sel.c);
  if (m && m.r0 === g.r0 && m.c0 === g.c0 && m.r1 === g.r1 && m.c1 === g.c1) return toA1(g.r0, g.c0);
  if (g.r0 === 0 && g.r1 >= MAX_ROWS - 1) return `${colToLetters(g.c0)}:${colToLetters(g.c1)}`;
  if (g.c0 === 0 && g.c1 >= MAX_COLS - 1) return `${g.r0 + 1}:${g.r1 + 1}`;
  return toA1(s.sel.r, s.sel.c);
}

/** Jump to "C12", "A1:B5", "Sheet 2!B3". Returns false when the text isn't an address. */
export function gotoAddress(wb: Workbook, text: string): boolean {
  const t = text.trim();
  const bang = t.lastIndexOf('!');
  let target = wb.sheet;
  let ref = t;
  if (bang >= 0) {
    let name = t.slice(0, bang);
    if (name.startsWith("'") && name.endsWith("'")) name = name.slice(1, -1).replace(/''/g, "'");
    const sh = wb.sheetByName(name);
    if (!sh) return false;
    target = sh;
    ref = t.slice(bang + 1);
  }
  const g = parseRange(ref);
  if (!g) return false;
  wb.commitEdit();
  if (target !== wb.sheet) wb.setActiveSheet(wb.sheets.indexOf(target));
  wb.select(g.r0, g.c0, g.r0 === g.r1 && g.c0 === g.c1 ? undefined : g, true);
  return true;
}

