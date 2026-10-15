import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { cssFont, fitText, fontCategory, standardFontFor } from './fonts';
import { fontUses, pdfBytes, sanitize } from './pdfExport';
import { WriteModel } from './model';
import { schema } from './schema';

describe('Write fonts', () => {
  it('classifies families for fallbacks', () => {
    expect(fontCategory('Fira Code')).toBe('mono');
    expect(fontCategory('Courier New')).toBe('mono');
    expect(fontCategory('Encode Sans')).toBe('sans');
    expect(fontCategory('EB Garamond')).toBe('serif');
    expect(fontCategory('PT Serif')).toBe('serif');
    expect(fontCategory('Noto Sans')).toBe('sans');
    expect(cssFont('Lobster')).toBe('"Lobster", sans-serif');
    expect(cssFont('Georgia')).toBe('"Georgia", serif');
    expect(cssFont('JetBrains Mono')).toBe('"JetBrains Mono", ui-monospace, monospace');
    expect(standardFontFor('Arial')).toBe('sans');
    expect(standardFontFor('Times New Roman')).toBe('serif');
    expect(standardFontFor('Lobster')).toBeNull();
  });

  it('keeps characters an embedded font has and substitutes the rest', () => {
    const has = (c: number) => c < 0x250 || c === 0x416; // Latin + "Ж"
    expect(fitText('Žluťoučký Ж → 中', has, sanitize)).toBe('Žluťoučký Ж -> ?');
    expect(fitText('a\tb\nc​', has, sanitize)).toBe('a    b c');
    // Standard fonts still get the WinAnsi substitution.
    expect(sanitize('Ж')).toBe('?');
  });

  it('lists the faces a document needs', () => {
    const ts = (f: string) => schema.marks.textStyle.create({ fontFamily: f });
    const doc = schema.node('doc', null, [
      schema.node('heading', { level: 1 }, [schema.text('Head', [ts('Lobster')])]),
      schema.node('paragraph', null, [schema.text('a', [ts('Lobster'), schema.marks.em.create()]), schema.text(' plain')]),
      schema.node('code_block', null, [schema.text('x = 1')]),
    ]);
    const keys = fontUses(doc).map(([f, b, i]) => `${f}${b ? ' bold' : ''}${i ? ' italic' : ''}`).sort();
    expect(keys).toEqual(['Archivo', 'JetBrains Mono', 'Lobster bold', 'Lobster italic']);
  });

  it('exports with the standard fonts when a font can’t be loaded', async () => {
    const ts = schema.marks.textStyle.create({ fontFamily: 'Not Installed Anywhere' });
    const m = new WriteModel(schema.node('doc', null, [schema.node('paragraph', null, [schema.text('Héllo Ж wörld', [ts]), schema.text(' and more')])]));
    const bytes = await pdfBytes(m);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(1);
  });
});
