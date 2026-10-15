// Tone Cells — spreadsheet module (HyperFormula engine, canvas grid).
import type { ModuleDef } from '@/core/types';
import { MODULE_META } from '../meta';
import { cellsCommands } from './commands';
import { CellsEditor } from './Editor';
import { cellsExports } from './exporters';
import { deserializeWorkbook, openWorkbookFile, serializeWorkbook, sheetToDelimited, workbookToXlsx } from './io';
import { cellsMenus } from './menus';
import { Workbook } from './model';
import { toA1 } from './address';

const meta = MODULE_META.cells;

const cells: ModuleDef<Workbook> = {
  ...meta,
  createBlank: async () => ({ model: new Workbook(), title: 'Untitled.tone' }),
  openFile: (bytes, filename) => openWorkbookFile(bytes, filename),
  serialize: async (wb) => serializeWorkbook(wb),
  deserialize: async (files, formatVersion) => deserializeWorkbook(files, formatVersion),
  saveForeign: async (wb, format) => {
    if (format === 'xlsx') return workbookToXlsx(wb);
    // CSV/TSV hold a single sheet: write the active one (the first sheet is never silently preferred).
    if (format === 'csv') { wb.commitEdit(); return sheetToDelimited(wb, wb.sheet, ','); }
    if (format === 'tsv') { wb.commitEdit(); return sheetToDelimited(wb, wb.sheet, '\t'); }
    return null;
  },
  foreignLosses: (wb, format) => {
    const lost: string[] = [];
    const has = (f: (s: (typeof wb.sheets)[number]) => boolean) => wb.sheets.some(f);
    const filtered = has((s) => !!s.filter && (Object.values(s.filter.hidden).some((v) => v.length) || Object.values(s.filter.contains ?? {}).some((q) => q.trim())));
    if (format === 'csv' || format === 'tsv') {
      if (wb.sheets.length > 1) lost.push(`Other sheets (only "${wb.sheet.name}" is saved)`);
      if (has((s) => !!s.filter)) lost.push('Filters');
      if (has((s) => [...s.cells.values()].some((c) => c.f && Object.keys(c.f).length))) lost.push('Formatting (bold, colours, number formats, borders)');
      if (has((s) => [...s.cells.values()].some((c) => c.v.startsWith('=')))) lost.push('Formulas (their results are saved instead)');
      if (has((s) => s.merges.length > 0)) lost.push('Merged cells');
      if (has((s) => s.freeze.rows > 0 || s.freeze.cols > 0)) lost.push('Frozen panes');
      if (has((s) => s.colWidths.size > 0)) lost.push('Column widths');
    } else if (format === 'xlsx') {
      if (filtered) lost.push('Filter selections (the filter buttons are kept)');
    }
    if (has((s) => s.charts.length > 0)) lost.push('Charts');
    if (has((s) => s.condFormats.length > 0)) lost.push('Conditional formatting rules');
    return lost;
  },
  exports: cellsExports,
  menus: cellsMenus,
  commands: (getModel, api) => cellsCommands(getModel, api),
  Editor: CellsEditor,
  statusHint: (wb) => `${toA1(wb.sheet.sel.r, wb.sheet.sel.c)} · Sheet ${wb.active + 1} of ${wb.sheets.length} · Auto-calc on`,
};

export default cells;
