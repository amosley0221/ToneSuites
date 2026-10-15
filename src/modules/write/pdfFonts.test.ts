// PDF export embeds the bundled and the user's fonts (fontData), and falls back to the standard fonts.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';

const root = new URL('../../../', import.meta.url);
const fontFile = new URL('node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff', root);
vi.mock('@/core/fonts', async (orig) => ({
  ...(await orig<typeof import('@/core/fonts')>()),
  fontData: vi.fn(async (family: string) => (family === 'Custom Test' ? new Uint8Array(readFileSync(fontFile)) : family === 'Broken' ? new Uint8Array([1, 2, 3]) : null)),
}));
// Bundled font files are fetched by URL (served by Vite in the app).
vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(new URL('.' + url.replace(/\?.*$/, ''), root))));

const { pdfBytes } = await import('./pdfExport');
const { WriteModel } = await import('./model');
const { schema } = await import('./schema');

async function fontNames(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const names = new Set<string>();
  for (const page of pdf.getPages()) {
    const fonts = page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict);
    fonts?.entries().forEach(([, ref]) => names.add(String(pdf.context.lookup(ref, PDFDict).get(PDFName.of('BaseFont'))).replace(/^\/[A-Z]{6}\+/, '/').replace(/-\d+$/, '')));
  }
  return [...names].sort();
}

const run = (f: string, t: string) => schema.text(t, [schema.marks.textStyle.create({ fontFamily: f })]);
const doc = (...nodes: ReturnType<typeof run>[]) => new WriteModel(schema.node('doc', null, [
  schema.node('heading', { level: 1 }, [schema.text('Heading')]),
  schema.node('paragraph', null, [schema.text('Body text → Ж '), ...nodes]),
  schema.node('code_block', null, [schema.text('let x = 1')]),
]));

describe('Write PDF fonts', () => {
  it('embeds bundled and added fonts; others fall back to the standard font of their kind', async () => {
    const names = await fontNames(await pdfBytes(doc(run('Custom Test', 'Custom arrow'), run('Broken', ' broken'), run('Missing', ' missing'), run('Georgia', ' serif'))));
    expect(names).toEqual(['/Archivo-Bold', '/Archivo-Medium', '/Helvetica', '/JetBrainsMono-Regular', '/Times-Roman']);
  });

  it('keeps the bundled fonts when an added font fails while subsetting', async () => {
    // "->" pulls a contextual-alternate glyph that this Latin subset file lacks, so saving with it throws.
    const names = await fontNames(await pdfBytes(doc(run('Custom Test', 'a -> b'))));
    expect(names).toEqual(['/Archivo-Bold', '/Archivo-Medium', '/Helvetica', '/JetBrainsMono-Regular']);
  });
});
