import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFTextField, StandardFonts } from 'pdf-lib';
import { buildPdf, createBlankPdf, wrapLines } from './apply';
import { PaperModel, type Edit, type PaperData } from './model';
import { blankPage, deletePages, dropTarget, insertAt, movePages, parseRanges, rotatePages, splitAt, splitEvery, subsetData } from './pageops';
import { makeViewport } from './viewport';
import { deserializeModel, serializeModel } from './serialize';

async function pdfWithPages(n: number, opts: { form?: boolean } = {}) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < n; i++) {
    const p = d.addPage([600, 800]);
    p.drawText(`Page ${i + 1}`, { x: 50, y: 700, size: 20, font: f });
  }
  if (opts.form) d.getForm().createTextField('name').addToPage(d.getPage(0), { x: 50, y: 600, width: 200, height: 20 });
  return d.save();
}

describe('parseRanges', () => {
  it('parses groups', () => {
    expect(parseRanges('1-3,5', 10)).toEqual([[0, 1, 2], [4]]);
    expect(parseRanges(' 8- ', 10)).toEqual([[7, 8, 9]]);
    expect(parseRanges('-2', 10)).toEqual([[0, 1]]);
    expect(parseRanges('3-1', 5)).toEqual([[2, 1, 0]]);
  });
  it('rejects bad input', () => {
    expect(() => parseRanges('', 3)).toThrow();
    expect(() => parseRanges('4', 3)).toThrow(/outside/);
    expect(() => parseRanges('a-b', 3)).toThrow();
  });
  it('splits every n and at cuts', () => {
    expect(splitEvery(2, 5)).toEqual([[0, 1], [2, 3], [4]]);
    expect(splitAt(5, [2, 0, 4])).toEqual([[0, 1], [2, 3], [4]]);
  });
});

describe('page ops', () => {
  const pages = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, src: 's', index: i, rot: 0 as const }));
  it('moves a multi-selection keeping order', () => {
    const t = dropTarget(pages, ['b', 'd'], 5);
    expect(movePages(pages, ['b', 'd'], t).map((p) => p.id).join('')).toBe('aceb' + 'd');
    expect(movePages(pages, ['d', 'e'], dropTarget(pages, ['d', 'e'], 0)).map((p) => p.id).join('')).toBe('deabc');
  });
  it('rotates and deletes with their edits', () => {
    expect(rotatePages(pages, ['a'], -90)[0].rot).toBe(270);
    const edits: Edit[] = [{ id: 'x', page: 'c', created: 0, kind: 'whiteout', rect: { x: 0, y: 0, w: 1, h: 1 } }];
    const r = deletePages({ pages, edits, newFields: [] }, ['c']);
    expect(r.pages.length).toBe(4);
    expect(r.edits.length).toBe(0);
  });
  it('subsets with re-minted ids and copied edits', () => {
    const data: PaperData = {
      sources: [{ id: 's', name: 'x.pdf', bytes: new Uint8Array() }], pages: [...pages],
      edits: [{ id: 'x', page: 'c', created: 0, kind: 'whiteout', rect: { x: 0, y: 0, w: 1, h: 1 } }],
      formValues: { a: 'b' }, newFields: [], flattenForm: false,
    };
    const sub = subsetData(data, [2, 3]);
    expect(sub.pages.map((p) => p.index)).toEqual([2, 3]);
    expect(sub.pages[0].id).not.toBe('c');
    expect(sub.edits[0].page).toBe(sub.pages[0].id);
    expect(sub.formValues).toEqual({ a: 'b' });
    expect(insertAt(pages, 1, [blankPage()]).length).toBe(6);
  });
});

describe('viewport', () => {
  it('round-trips points in every rotation', () => {
    for (const rot of [0, 90, 180, 270]) {
      const vp = makeViewport([0, 0, 600, 800], rot, 1.5);
      const [vx, vy] = vp.toView(100, 200);
      const [x, y] = vp.toPdf(vx, vy);
      expect(x).toBeCloseTo(100); expect(y).toBeCloseTo(200);
      expect(vx).toBeGreaterThanOrEqual(0); expect(vy).toBeGreaterThanOrEqual(0);
    }
    const v0 = makeViewport([0, 0, 600, 800], 0, 1);
    expect(v0.toView(0, 800)).toEqual([0, 0]);
    const v90 = makeViewport([0, 0, 600, 800], 90, 1);
    expect([v90.width, v90.height]).toEqual([800, 600]);
    expect(v90.toView(0, 0)).toEqual([0, 0]);
  });
  it('converts rects', () => {
    const vp = makeViewport([0, 0, 600, 800], 0, 2);
    expect(vp.rectToView({ x: 10, y: 700, w: 50, h: 20 })).toEqual({ left: 20, top: 160, width: 100, height: 40 });
  });
});

describe('buildPdf', () => {
  it('applies page order, rotation, deletion and blank pages', async () => {
    const bytes = await pdfWithPages(3);
    const m = PaperModel.fromPdf(bytes, 'x.pdf', 3);
    m.mutate((d) => {
      d.pages = movePages(d.pages, [d.pages[2].id], 0);
      d.pages = rotatePages(d.pages, [d.pages[0].id], 90);
      Object.assign(d, deletePages(d, [d.pages[1].id]));
      d.pages = insertAt(d.pages, 2, [blankPage([300, 300])]);
    });
    const { bytes: out } = await buildPdf(m.data());
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getRotation().angle).toBe(90);
    expect(doc.getPage(2).getSize()).toEqual({ width: 300, height: 300 });
  });

  it('merges a second source and draws edits', async () => {
    const a = await pdfWithPages(1), b = await pdfWithPages(2);
    const m = PaperModel.fromPdf(a, 'a.pdf', 1);
    m.mutate((d) => {
      d.sources.push({ id: 'src1', name: 'b.pdf', bytes: b });
      d.pages.push({ id: 'pb', src: 'src1', index: 1, rot: 0 });
      d.edits.push({ id: 'h', page: 'pb', created: 1, kind: 'highlight', rects: [{ x: 40, y: 690, w: 100, h: 30 }], color: '#ffd400', style: 'highlight' });
      d.edits.push({ id: 't', page: 'pb', created: 2, kind: 'text', rect: { x: 40, y: 400, w: 200, h: 40 }, text: 'Hello ☃ world', size: 12, color: '#000000' });
      d.edits.push({ id: 'n', page: d.pages[0].id, created: 3, kind: 'note', x: 10, y: 790, text: 'Check', color: '#ffd400' });
      d.edits.push({ id: 'r', page: d.pages[0].id, created: 4, kind: 'redact', rect: { x: 40, y: 690, w: 100, h: 30 }, applied: true });
    });
    const res = await buildPdf(m.data());
    expect(res.warnings.some((w) => /black boxes only/.test(w))).toBe(true);
    const doc = await PDFDocument.load(res.bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).node.Annots()?.size()).toBe(1);
  });

  it('rasterizer replaces the redacted page content', async () => {
    const a = await pdfWithPages(2);
    const m = PaperModel.fromPdf(a, 'a.pdf', 2);
    m.mutate((d) => d.edits.push({ id: 'r', page: d.pages[0].id, created: 0, kind: 'redact', rect: { x: 0, y: 0, w: 10, h: 10 }, applied: true }));
    // 1×1 transparent PNG stands in for the pdf.js raster.
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const res = await buildPdf(m.data(), { rasterize: async () => ({ png, view: [0, 0, 600, 800] }) });
    expect(res.warnings.length).toBe(0);
    const doc = await PDFDocument.load(res.bytes);
    expect(doc.getPageCount()).toBe(2);
    const fonts = (i: number) => doc.getPage(i).node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)?.keys().length ?? 0;
    expect(fonts(0)).toBe(0);
    expect(fonts(1)).toBeGreaterThan(0);
    // The replaced page's original content stream is garbage-collected out of the file.
    const kept = await buildPdf(PaperModel.fromPdf(a, 'a.pdf', 2).data());
    const count = async (b: Uint8Array) => (await PDFDocument.load(b)).context.enumerateIndirectObjects().length;
    const onlyOne = PaperModel.fromPdf(a, 'a.pdf', 2);
    onlyOne.mutate((d) => Object.assign(d, deletePages(d, [d.pages[0].id])));
    expect(await count((await buildPdf(onlyOne.data())).bytes)).toBeLessThan(await count(kept.bytes));
  });

  it('fills form fields and adds new ones', async () => {
    const a = await pdfWithPages(1, { form: true });
    const m = PaperModel.fromPdf(a, 'f.pdf', 1);
    m.mutate((d) => {
      d.formValues.name = 'Ada';
      d.newFields.push({ id: 'f1', page: d.pages[0].id, rect: { x: 50, y: 500, w: 150, h: 20 }, type: 'text', name: 'name', required: true });
      d.newFields.push({ id: 'f2', page: d.pages[0].id, rect: { x: 50, y: 400, w: 150, h: 40 }, type: 'signature', name: 'Sign here', required: false });
    });
    const res = await buildPdf(m.data());
    const doc = await PDFDocument.load(res.bytes);
    const form = doc.getForm();
    expect((form.getField('name') as PDFTextField).getText()).toBe('Ada');
    expect(form.getFields().map((f) => f.getName()).sort()).toEqual(['Sign here', 'name', 'name 2']);
  });

  it('creates a blank Letter PDF', async () => {
    const doc = await PDFDocument.load(await createBlankPdf());
    expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
  });
});

describe('model', () => {
  it('undo/redo restores edits', () => {
    const m = new PaperModel('x.pdf');
    m.mutate((d) => d.edits.push({ id: 'w', page: 'p', created: 0, kind: 'whiteout', rect: { x: 0, y: 0, w: 1, h: 1 } }));
    expect(m.edits.length).toBe(1);
    m.undo(); expect(m.edits.length).toBe(0);
    m.redo(); expect(m.edits.length).toBe(1);
  });
  it('serializes and deserializes', async () => {
    const bytes = await pdfWithPages(2);
    const m = PaperModel.fromPdf(bytes, 'x.pdf', 2);
    m.mutate((d) => { d.sources.push({ id: 'src1', name: 'y.pdf', bytes }); d.pages.push({ id: 'q', src: 'src1', index: 0, rot: 0 }); });
    const files = serializeModel(m);
    expect(Object.keys(files).sort()).toEqual(['edits.json', 'original.pdf', 'sources/src1.pdf']);
    const enc = new TextEncoder();
    const back = deserializeModel(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? enc.encode(v) : v])), 1);
    expect(back.pages.length).toBe(3);
    expect(back.sources[1].bytes.length).toBe(bytes.length);
  });
  it('wraps text', () => {
    expect(wrapLines('aa bb cc', 5, (s) => s.length)).toEqual(['aa bb', 'cc']);
  });
});
