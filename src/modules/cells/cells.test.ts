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

describe('exports', () => {
  it('renders PDF pages and an HTML table', async () => {
    const { workbookToPdf, workbookToHtml } = await import('./exporters');
    const wb = new Workbook();
    const s = wb.sheet;
    const rows = Array.from({ length: 120 }, (_, i) => ({ r: i, c: 0, v: `Row ${i} – “quoted” <b>` }));
    wb.setInputs(s, [...rows, { r: 0, c: 1, v: '=1/0' }]);
    const pdf = await workbookToPdf(wb, 'Test.tone', { orientation: 'Landscape', fit: 'Fit to page width', sheets: 'All sheets' });
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
    const { PDFDocument } = await import('pdf-lib');
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(1);
    const html = workbookToHtml(wb, 'Test', 'active');
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('#DIV/0!');
  });
});

describe('autofilter contains search', () => {
  const setup = () => {
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.setInputs(s, [
      { r: 0, c: 0, v: 'Worker ID' }, { r: 0, c: 1, v: 'Name' },
      { r: 1, c: 0, v: '1006123' }, { r: 1, c: 1, v: 'Ann' },
      { r: 2, c: 0, v: '75568' }, { r: 2, c: 1, v: 'Antonio' },
      { r: 3, c: 0, v: '1007556' }, { r: 3, c: 1, v: 'Bo' },
    ]);
    s.filter = { range: { r0: 0, c0: 0, r1: 3, c1: 1 }, hidden: {}, contains: {} };
    return { wb, s };
  };
  it('hides rows that do not contain the query', () => {
    const { wb, s } = setup();
    s.filter!.contains = { 0: '75568' };
    s._hidden = undefined;
    expect([...wb.hiddenRows(s)].sort()).toEqual([1, 3]);
  });
  it('matches ignoring case, spaces and thousands separators', () => {
    const { wb, s } = setup();
    s.filter!.contains = { 1: ' ANTO ' };
    s._hidden = undefined;
    expect([...wb.hiddenRows(s)].sort()).toEqual([1, 3]);
    s.filter!.contains = { 0: '75,568' };
    s._hidden = undefined;
    expect([...wb.hiddenRows(s)].sort()).toEqual([1, 3]);
  });
  it('round-trips through the saved workbook', () => {
    const { wb, s } = setup();
    s.filter!.contains = { 0: '755' };
    const back = loadWorkbook(workbookToJSON(wb));
    expect(back.sheets[0].filter?.contains).toEqual({ 0: '755' });
  });
});

describe('CSV fidelity, undo groups and filtered copies (QA fixes)', () => {
  it('keeps leading-zero IDs and long numbers as text, and saves an opened CSV back unchanged', async () => {
    const { workbookFromDelimited, sheetToDelimited } = await import('./io');
    const { delimitedInput } = await import('./csv');
    expect(delimitedInput('001234')).toBe("'001234");
    expect(delimitedInput('1234567890123456789')).toBe("'1234567890123456789");
    expect(delimitedInput('0')).toBe('0');
    expect(delimitedInput('0.5')).toBe('0.5');
    const text = 'Worker ID,Name,Hire Date,Salary\r\n001001,Ann ,2020-07-10,"1,234"\r\n200000,Bob,07/14/2007,5000\r\n';
    const wb = workbookFromDelimited(text, 'hr.csv');
    expect(wb.display(wb.sheet, 1, 0).text).toBe('001001');
    expect(wb.display(wb.sheet, 2, 0).kind).toBe('num');
    expect(new TextDecoder().decode(sheetToDelimited(wb, wb.sheet, ','))).toBe(text);
  });
  it('orders slash dates by locale', async () => {
    const { localeDateFormats } = await import('./model');
    expect(localeDateFormats('en-US')).toContain('MM/DD/YYYY');
    expect(localeDateFormats('en-US')).not.toContain('DD/MM/YYYY');
    expect(localeDateFormats('en-GB')).toContain('DD/MM/YYYY');
  });
  it('keeps a formula calculating after its cell is formatted as Text', () => {
    const wb = new Workbook();
    wb.setInputs(wb.sheet, [{ r: 0, c: 0, v: '2' }, { r: 0, c: 1, v: '=A1*3' }]);
    wb.formatRange(wb.sheet, { r0: 0, c0: 1, r1: 0, c1: 1 }, { nf: 'text' });
    expect(wb.display(wb.sheet, 0, 1).text).toBe('6');
  });
  it('undoes a group of edits in one step', () => {
    const wb = new Workbook();
    wb.group(() => {
      const ns = wb.addSheet('Pivot');
      wb.writeGrid(ns, 0, 0, [['a', 1]]);
      wb.structural(() => { ns.freeze = { rows: 1, cols: 0 }; });
    });
    expect(wb.sheets.length).toBe(2);
    wb.undo();
    expect(wb.sheets.length).toBe(1);
    wb.redo();
    expect(wb.sheets.length).toBe(2);
    expect(wb.display(wb.sheets[1], 0, 0).text).toBe('a');
    expect(wb.sheets[1].freeze.rows).toBe(1);
  });
  it('finds the whole current region of a long list', () => {
    const wb = new Workbook();
    wb.writeGrid(wb.sheet, 0, 0, Array.from({ length: 15000 }, (_, i) => [`r${i}`, i]));
    expect(wb.currentRegion(wb.sheet, 0, 0)).toEqual({ r0: 0, c0: 0, r1: 14999, c1: 1 });
  });
  it('copies only visible rows of a filtered list and pastes them in one undo step', async () => {
    const { copySelection, pasteText } = await import('./clipboard');
    const wb = new Workbook();
    const s = wb.sheet;
    wb.writeGrid(s, 0, 0, [['Name', 'Dept', 'N'], ['Ann', 'HR', 1], ['Bob', 'IT', 2], ['Cy', 'HR', 3]]);
    wb.setInputs(s, [1, 2, 3].map((r) => ({ r, c: 3, v: `=C${r + 1}*10` })));
    s.filter = { range: { r0: 0, c0: 0, r1: 3, c1: 3 }, hidden: { 1: ['IT'] } };
    s._hidden = undefined;
    wb.select(0, 0, { r0: 0, c0: 0, r1: 3, c1: 3 });
    const tsv = copySelection(wb, false);
    expect(tsv.split('\n').map((l) => l.split('\t')[0])).toEqual(['Name', 'Ann', 'Cy']);
    wb.select(10, 0);
    pasteText(wb, tsv);
    expect(wb.getCell(s, 12, 3)?.v).toBe('=C13*10');
    expect(wb.display(s, 12, 3).text).toBe('30');
    wb.undo();
    expect(wb.getCell(s, 10, 0)).toBeUndefined();
  });
});

describe('filtered lists: edits touch only visible rows', () => {
  const setup = () => {
    const wb = new Workbook();
    const s = wb.sheet;
    wb.writeGrid(s, 0, 0, [['Name', 'Dept'], ['Ann', 'HR'], ['Bob', 'IT'], ['Cy', 'HR'], ['Di', 'IT'], ['Ed', 'HR']]);
    wb.setInputs(s, [{ r: 7, c: 0, v: '=COUNTA(A2:A6)' }]);
    wb.structural(() => { s.filter = { range: { r0: 0, c0: 0, r1: 5, c1: 1 }, hidden: { 1: ['IT'] } }; });
    return { wb, s };
  };
  it('deletes only visible rows, in one undo step', () => {
    const { wb, s } = setup();
    wb.deleteRowBlocks(s, [[1, 1], [3, 1], [5, 1]]);
    expect([0, 1, 2].map((r) => wb.display(s, r, 0).text)).toEqual(['Name', 'Bob', 'Di']);
    expect(wb.getCell(s, 4, 0)?.v).toBe('=COUNTA(A2:A3)');
    expect(s.filter?.range).toEqual({ r0: 0, c0: 0, r1: 2, c1: 1 });
    wb.undo();
    expect([0, 1, 2, 3, 4, 5].map((r) => wb.display(s, r, 0).text)).toEqual(['Name', 'Ann', 'Bob', 'Cy', 'Di', 'Ed']);
  });
  it('clears and formats only visible rows', () => {
    const { wb, s } = setup();
    wb.formatRange(s, { r0: 1, c0: 0, r1: 5, c1: 0 }, { b: true });
    expect(wb.getCell(s, 2, 0)?.f?.b).toBeUndefined();
    expect(wb.getCell(s, 3, 0)?.f?.b).toBe(true);
    wb.clear(s, { r0: 1, c0: 0, r1: 5, c1: 1 }, 'all');
    expect(wb.display(s, 2, 0).text).toBe('Bob');
    expect(wb.display(s, 1, 0).text).toBe('');
  });
  it('colour scales only fill (a leftover text colour is ignored)', () => {
    const p = { rule: { id: 'x', range: 'A1:A3', kind: 'scale' as const, style: { color: '#e5484d' }, scale: { min: '#ffffff', max: '#000000' } }, range: { r0: 0, c0: 0, r1: 2, c1: 0 }, min: 0, max: 10 };
    const st = evalRule(p, 5, '5');
    expect(st?.color).toBeUndefined();
    expect(st?.fill).toBeTruthy();
  });
});

describe('foreignLosses (what saving to csv/xlsx would drop)', () => {
  it('lists filters, formatting and extra sheets for CSV, nothing for a plain sheet', async () => {
    const mod = (await import('./index')).default;
    const wb = new Workbook();
    const s = wb.sheets[0];
    wb.setInputs(s, [{ r: 0, c: 0, v: 'ID' }, { r: 1, c: 0, v: '7' }]);
    expect(mod.foreignLosses!(wb, 'csv')).toEqual([]);
    s.filter = { range: { r0: 0, c0: 0, r1: 1, c1: 0 }, hidden: {}, contains: { 0: '7' } };
    expect(mod.foreignLosses!(wb, 'csv')).toContain('Filters');
    expect(mod.foreignLosses!(wb, 'xlsx')).toEqual(['Filter selections (the filter buttons are kept)']);
  });
});
