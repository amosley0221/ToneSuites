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
  exports: cellsExports,
  menus: cellsMenus,
  commands: (getModel, api) => cellsCommands(getModel, api),
  Editor: CellsEditor,
  statusHint: (wb) => `${toA1(wb.sheet.sel.r, wb.sheet.sel.c)} · Sheet ${wb.active + 1} of ${wb.sheets.length} · Auto-calc on`,
};

export default cells;
