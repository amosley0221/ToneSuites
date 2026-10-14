import { describe, expect, it } from 'vitest';
import { colToLetters, lettersToCol, parseA1, parseRange, parseSheetRange, rangeToA1, shiftFormula, shiftRangeDelete, shiftRangeInsert, toA1 } from './address';
import { parseDelimited, sniffDelimiter, toDelimited, parseClipboardTsv, toClipboardTsv } from './csv';
import { buildPivot } from './pivot';
import { Workbook, workbookToJSON, loadWorkbook } from './model';
import { extractSeries, niceScale } from './chart';
import { evalRule, lerpColor, statsFor } from './condfmt';
import { formatNumber, fromExcelFormat } from './numfmt';
import { Axis } from './geometry';

describe('address helpers', () => {
  it('converts columns both ways', () => {
    for (const [c, s] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [51, 'AZ'], [701, 'ZZ'], [702, 'AAA'], [16383, 'XFD']] as const) {
      expect(colToLetters(c)).toBe(s);
      expect(lettersToCol(s)).toBe(c);
    }
    expect(lettersToCol('a1')).toBe(-1);
  });
  it('parses A1 and ranges', () => {
    expect(parseA1('C12')).toEqual({ r: 11, c: 2 });
    expect(parseA1('$B$3')).toEqual({ r: 2, c: 1 });
    expect(parseA1('A0')).toBeNull();
    expect(toA1(0, 0)).toBe('A1');
    expect(parseRange('B5:A1')).toEqual({ r0: 0, c0: 0, r1: 4, c1: 1 });
    expect(rangeToA1({ r0: 0, c0: 0, r1: 7, c1: 3 })).toBe('A1:D8');
    expect(rangeToA1({ r0: 3, c0: 4, r1: 3, c1: 4 })).toBe('E4');
    expect(parseSheetRange("'Budget 2026'!A1:D8")).toEqual({ sheet: 'Budget 2026', range: { r0: 0, c0: 0, r1: 7, c1: 3 } });
    expect(parseRange('C:D')?.c0).toBe(2);
  });
  it('shifts relative references in formulas', () => {
    expect(shiftFormula('=A1+$B$2+C$3+$D4', 2, 1)).toBe('=B3+$B$2+D$3+$D6');
    expect(shiftFormula('=SUM(A1:A3)*LOG10(2)', 1, 0)).toBe('=SUM(A2:A4)*LOG10(2)');
    expect(shiftFormula('="A1"&A1', 1, 0)).toBe('="A1"&A2');
    expect(shiftFormula("='Sheet 1'!B2", 0, 1)).toBe("='Sheet 1'!C2");
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
  });
  it('shifts ranges for structural edits', () => {
    expect(shiftRangeInsert({ r0: 2, c0: 0, r1: 5, c1: 1 }, 'row', 3, 2)).toEqual({ r0: 2, c0: 0, r1: 7, c1: 1 });
    expect(shiftRangeDelete({ r0: 2, c0: 0, r1: 5, c1: 1 }, 'row', 0, 3)).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 });
    expect(shiftRangeDelete({ r0: 2, c0: 0, r1: 3, c1: 1 }, 'row', 2, 2)).toBeNull();
  });
});

describe('csv', () => {
  it('parses quoted fields, escaped quotes, embedded newlines and CRLF', () => {
    const text = 'name,note,amount\r\n"Smith, J","He said ""hi""",12.5\r\nDoe,"line1\nline2",\r\n';
    expect(parseDelimited(text, ',')).toEqual([
      ['name', 'note', 'amount'],
      ['Smith, J', 'He said "hi"', '12.5'],
      ['Doe', 'line1\nline2', ''],
    ]);
  });
  it('keeps empty trailing quoted field and strips BOM', () => {
    expect(parseDelimited('﻿a,""', ',')).toEqual([['a', '']]);
  });
  it('sniffs delimiters', () => {
    expect(sniffDelimiter('a;b;c\n1;2;3')).toBe(';');
    expect(sniffDelimiter('a,b', 'x.tsv')).toBe('\t');
  });
  it('round-trips', () => {
    const rows = [['a,b', 'c"d', ' e'], ['1', '', 'x\ny']];
    expect(parseDelimited(toDelimited(rows, ','), ',')).toEqual(rows);
    expect(parseClipboardTsv(toClipboardTsv(rows))).toEqual(rows);
  });
});

describe('pivot', () => {
  const header = ['Region', 'Product', 'Units'];
  const data = [['East', 'A', 10], ['West', 'A', 5], ['East', 'B', 3], ['East', 'A', 2], ['West', 'B', null]];
  it('aggregates rows with grand total', () => {
    const p = buildPivot(header, data, { rows: [0], cols: [], values: [{ field: 2, agg: 'sum' }], filters: [], grandTotals: true });
    expect(p.cells).toEqual([['Region', 'Units'], ['East', 15], ['West', 5], ['Grand total', 20]]);
  });
  it('cross-tabs with columns, count and avg', () => {
    const p = buildPivot(header, data, { rows: [0], cols: [1], values: [{ field: 2, agg: 'avg' }], filters: [], grandTotals: true });
    expect(p.headerRows).toBe(2);
    expect(p.cells[2]).toEqual(['East', 6, 3, 5]);
    const c = buildPivot(header, data, { rows: [1], cols: [], values: [{ field: 2, agg: 'count' }], filters: [{ field: 0, value: 'East' }], grandTotals: false });
    expect(c.cells).toEqual([['Product', 'Count of Units'], ['A', 2], ['B', 1]]);
  });
});

describe('workbook model + HyperFormula', () => {
  it('recalculates formulas through the model', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.setInputs(s, [{ r: 0, c: 0, v: '1,200' }, { r: 1, c: 0, v: '300' }, { r: 2, c: 0, v: '=SUM(A1:A2)' }]);
    expect(wb.value(s, 2, 0)).toBe(1500);
    wb.setInputs(s, [{ r: 1, c: 0, v: '-50' }]);
    expect(wb.value(s, 2, 0)).toBe(1150);
    expect(wb.display(s, 1, 0).text).toBe('-50');
    wb.undo();
    expect(wb.value(s, 2, 0)).toBe(1500);
  });
  it('keeps references right when inserting/deleting rows', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.setInputs(s, [{ r: 0, c: 0, v: '5' }, { r: 1, c: 0, v: '7' }, { r: 2, c: 0, v: '=A1*A2' }]);
    wb.insertRows(s, 1, 2);
    expect(wb.getCell(s, 4, 0)?.v).toBe('=A1*A4');
    expect(wb.value(s, 4, 0)).toBe(35);
    wb.deleteRows(s, 0, 1);
    expect(wb.getCell(s, 3, 0)?.v).toBe('=#REF!*A3');
    wb.undo();
    expect(wb.value(s, 4, 0)).toBe(35);
  });
  it('handles cross-sheet references, rename and serialization', () => {
    const wb = new Workbook();
    const s2 = wb.addSheet('Data');
    wb.setInputs(s2, [{ r: 0, c: 0, v: '42' }]);
    const s1 = wb.sheets[0];
    wb.setInputs(s1, [{ r: 0, c: 0, v: '=Data!A1*2' }]);
    expect(wb.value(s1, 0, 0)).toBe(84);
    wb.renameSheet(s2, 'Raw data');
    expect(wb.getCell(s1, 0, 0)?.v).toBe("='Raw data'!A1*2");
    const json = JSON.parse(JSON.stringify(workbookToJSON(wb)));
    expect(json.formatVersion).toBe(1);
    expect(json.sheets[0].cells.A1).toEqual({ v: "='Raw data'!A1*2" });
    const again = loadWorkbook(json);
    expect(again.value(again.sheets[0], 0, 0)).toBe(84);
  });
  it('sorts rows and fills series', () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.setInputs(s, [{ r: 0, c: 0, v: 'Name' }, { r: 1, c: 0, v: 'b' }, { r: 2, c: 0, v: 'c' }, { r: 3, c: 0, v: 'a' }]);
    wb.sortRange(s, { r0: 0, c0: 0, r1: 3, c1: 0 }, 0, true, true);
    expect([1, 2, 3].map((r) => wb.getCell(s, r, 0)?.v)).toEqual(['a', 'b', 'c']);
    wb.setInputs(s, [{ r: 0, c: 2, v: '2' }, { r: 1, c: 2, v: '4' }]);
    wb.fill(s, { r0: 0, c0: 2, r1: 1, c1: 2 }, { r0: 0, c0: 2, r1: 4, c1: 2 });
    expect(wb.value(s, 4, 2)).toBe(10);
  });
});

describe('charts, conditional formats, number formats, geometry', () => {
  it('extracts series with header row and label column', () => {
    const d = extractSeries([[null, 'Jan', 'Feb'], ['Rent', 1, 2], ['Food', 3, 4]], [['', 'Jan', 'Feb'], ['Rent', '1', '2'], ['Food', '3', '4']]);
    expect(d.categories).toEqual(['Rent', 'Food']);
    expect(d.series).toEqual([{ name: 'Jan', values: [1, 3] }, { name: 'Feb', values: [2, 4] }]);
    expect(niceScale(0, 97)).toEqual({ min: 0, max: 100, step: 20 });
  });
  it('evaluates rules', () => {
    const rule = { id: 'x', range: 'A1:A3', kind: 'lt' as const, a: '0', style: { color: '#e5484d' } };
    expect(evalRule({ rule, range: { r0: 0, c0: 0, r1: 2, c1: 0 } }, -5, '-5')).toEqual({ color: '#e5484d' });
    expect(evalRule({ rule, range: { r0: 0, c0: 0, r1: 2, c1: 0 } }, 5, '5')).toBeNull();
    const top = { ...rule, kind: 'topN' as const, a: '2' };
    expect(statsFor(top, [1, 9, 4, 7]).threshold).toBe(7);
    expect(lerpColor('#000000', '#ffffff', 0.5)).toBe('#808080');
  });
  it('formats numbers', () => {
    expect(formatNumber(1234.5, 'currency', undefined)).toBe('$1,234.50');
    expect(formatNumber(-45, 'number', 2)).toBe('-45.00');
    expect(formatNumber(0.1234, 'percent', 1)).toBe('12.3%');
    expect(formatNumber(46053, 'date', undefined)).toBe('2026-01-31');
    expect(formatNumber(0.1 + 0.2, 'general', undefined)).toBe('0.3');
    expect(fromExcelFormat('#,##0.00')).toEqual({ nf: 'number', dp: 2 });
    expect(fromExcelFormat('0%')?.nf).toBe('percent');
  });
  it('maps positions to indexes with overrides and hidden rows', () => {
    const ax = new Axis(28, 10000, new Map([[2, 56]]), new Set([5, 6]));
    expect(ax.pos(3)).toBe(28 * 3 + 28);
    expect(ax.pos(7)).toBe(28 * 7 + 28 - 56);
    expect(ax.index(ax.pos(7) + 3)).toBe(7);
    expect(ax.step(4, 1)).toBe(7);
    expect(ax.total).toBe(28 * 10000 + 28 - 56);
  });
});

describe('xlsx round trip', () => {
  it('keeps values, formulas, formats, widths, merges and sheets', async () => {
    const { workbookToXlsx, workbookFromXlsx, workbookFromDelimited } = await import('./io');
    const wb = new Workbook();
    const s = wb.sheet;
    wb.setInputs(s, [{ r: 0, c: 0, v: 'Item' }, { r: 1, c: 0, v: '12.5' }, { r: 2, c: 0, v: '=A2*2' }]);
    wb.formatRange(s, { r0: 0, c0: 0, r1: 0, c1: 0 }, { b: true });
    wb.formatRange(s, { r0: 1, c0: 0, r1: 2, c1: 0 }, { nf: 'currency' });
    wb.structural(() => { s.colWidths.set(0, 200); s.merges.push({ r0: 4, c0: 0, r1: 4, c1: 2 }); s.freeze = { rows: 1, cols: 0 }; });
    wb.addSheet('Second');
    const bytes = await workbookToXlsx(wb);
    const back = await workbookFromXlsx(bytes);
    const b = back.sheets[0];
    expect(back.sheets.map((x) => x.name)).toEqual(['Sheet 1', 'Second']);
    expect(back.getCell(b, 2, 0)?.v).toBe('=A2*2');
    expect(back.value(b, 2, 0)).toBe(25);
    expect(back.getCell(b, 0, 0)?.f?.b).toBe(true);
    expect(back.getCell(b, 1, 0)?.f?.nf).toBe('currency');
    expect(b.colWidths.get(0)).toBe(200);
    expect(b.merges).toHaveLength(1);
    expect(b.freeze.rows).toBe(1);
    const csv = workbookFromDelimited('a,b\n1,2\n', 'x.csv');
    expect(csv.value(csv.sheet, 1, 1)).toBe(2);
  });
});
