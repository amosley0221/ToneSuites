// Copy / cut / paste as TSV. Internal copies keep raw inputs + formats (formulas re-based on paste);
// external text is parsed as TSV.
import { normRange, type Range } from './address';
import { parseClipboardTsv, toClipboardTsv } from './csv';
import type { CellData, Workbook } from './model';

export function copySelection(wb: Workbook, cut: boolean): string {
  wb.commitEdit();
  const s = wb.sheet;
  const g = wb.clampToUsed(s, s.sel.range);
  const texts: string[][] = [];
  const cells: (CellData | undefined)[][] = [];
  for (let r = g.r0; r <= g.r1; r++) {
    const tr: string[] = [];
    const cr: (CellData | undefined)[] = [];
    for (let c = g.c0; c <= g.c1; c++) {
      tr.push(wb.display(s, r, c).text);
      const cell = wb.getCell(s, r, c);
      cr.push(cell ? { ...cell } : undefined);
    }
    texts.push(tr);
    cells.push(cr);
  }
  const tsv = toClipboardTsv(texts);
  wb.ui.clip = { sheetId: s.id, range: g, cut, tsv, cells };
  wb.emit();
  return tsv;
}

/** Paste text at the selection. Uses the internal clipboard when the text matches what we copied. */
export function pasteText(wb: Workbook, text: string, valuesOnly = false) {
  wb.commitEdit();
  const s = wb.sheet;
  const { r, c } = { r: s.sel.range.r0, c: s.sel.range.c0 };
  const clip = wb.ui.clip;
  const norm = (t: string) => t.replace(/\r\n/g, '\n').replace(/\n$/, '');
  let block: (CellData | undefined)[][];
  let from: { r: number; c: number } | undefined;
  if (clip && norm(clip.tsv) === norm(text)) {
    if (valuesOnly) {
      block = clip.tsv === '' ? [[undefined]] : parseClipboardTsv(text).map((row) => row.map((v) => (v === '' ? undefined : { v })));
    } else {
      block = clip.cells;
      from = clip.cut ? undefined : { r: clip.range.r0, c: clip.range.c0 };
    }
  } else {
    block = parseClipboardTsv(text).map((row) => row.map((v) => (v === '' ? undefined : { v })));
  }
  // A single copied cell pasted into a larger selection fills the selection (Excel behaviour).
  const sel = s.sel.range;
  const h = block.length;
  const w = Math.max(...block.map((row) => row.length));
  if ((sel.r1 - sel.r0 + 1) % h === 0 && (sel.c1 - sel.c0 + 1) % w === 0 && (sel.r1 > sel.r0 || sel.c1 > sel.c0) && h * w < (sel.r1 - sel.r0 + 1) * (sel.c1 - sel.c0 + 1)) {
    const tiled: (CellData | undefined)[][] = [];
    const tiledFrom: typeof from = from;
    for (let i = 0; i <= sel.r1 - sel.r0; i++) {
      const row: (CellData | undefined)[] = [];
      for (let j = 0; j <= sel.c1 - sel.c0; j++) row.push(block[i % h][j % w]);
      tiled.push(row);
    }
    // Tiling copies formulas relative to their own tile, so paste tile by tile.
    if (tiledFrom) {
      for (let i = 0; i <= sel.r1 - sel.r0; i += h) for (let j = 0; j <= sel.c1 - sel.c0; j += w) wb.pasteBlock(s, r + i, c + j, block, tiledFrom, valuesOnly);
      return;
    }
    block = tiled;
  }
  if (clip?.cut && !valuesOnly && norm(clip.tsv) === norm(text)) {
    const src = wb.sheetById(clip.sheetId);
    if (src) {
      // Clear source cells not overwritten by the destination.
      const dest: Range = { r0: r, c0: c, r1: r + h - 1, c1: c + w - 1 };
      const clears: { r: number; c: number; cell: undefined }[] = [];
      for (let rr = clip.range.r0; rr <= clip.range.r1; rr++) for (let cc = clip.range.c0; cc <= clip.range.c1; cc++) {
        if (src === s && rr >= dest.r0 && rr <= dest.r1 && cc >= dest.c0 && cc <= dest.c1) continue;
        clears.push({ r: rr, c: cc, cell: undefined });
      }
      wb.setCells(src, clears);
    }
    wb.ui.clip = null;
  }
  wb.pasteBlock(s, r, c, block, from, valuesOnly);
  const g = normRange({ r0: r, c0: c, r1: r + block.length - 1, c1: c + Math.max(...block.map((x) => x.length)) - 1 });
  wb.select(r, c, g, false);
}
