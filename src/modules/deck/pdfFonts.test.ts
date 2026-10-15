// Deck PDF export embeds bundled and added fonts and falls back to the standard fonts.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';

const root = new URL('../../../', import.meta.url);
vi.mock('@/core/fonts', async (orig) => ({
  ...(await orig<typeof import('@/core/fonts')>()),
  fontData: vi.fn(async (family: string) => (family === 'Custom Test'
    ? new Uint8Array(readFileSync(new URL('node_modules/@fontsource/archivo/files/archivo-latin-400-italic.woff', root))) : null)),
}));
vi.stubGlobal('fetch', async (url: string) => new Response(readFileSync(new URL('.' + url.replace(/\?.*$/, ''), root))));

const { exportPdf } = await import('./exportPdf');
const { DeckDoc } = await import('./doc');
const { textEl } = await import('./model');

async function fontNames(bytes: Uint8Array): Promise<string[]> {
  const pdf = await PDFDocument.load(bytes);
  const names = new Set<string>();
  for (const page of pdf.getPages()) {
    page.node.Resources()?.lookup(PDFName.of('Font'), PDFDict)?.entries().forEach(([, ref]) =>
      names.add(String(pdf.context.lookup(ref, PDFDict).get(PDFName.of('BaseFont'))).replace(/^\/[A-Z]{6}\+/, '/').replace(/-\d+$/, '')));
  }
  return [...names].sort();
}

describe('Deck PDF fonts', () => {
  it('embeds bundled + added fonts, falls back for the rest, and survives JetBrains Mono "->"', async () => {
    const doc = new DeckDoc();
    const s = doc.data.slides[0];
    s.elements = [
      textEl('kicker', { x: 100, y: 100, w: 1600, h: 60 }, 'Step 1 -> step 2'),
      textEl('title', { x: 100, y: 200, w: 1600, h: 200 }, 'Title'),
      { ...textEl('text', { x: 100, y: 500, w: 1600, h: 100 }, 'Custom'), style: { font: 'Custom Test' } },
      { ...textEl('text', { x: 100, y: 600, w: 1600, h: 100 }, 'Serif'), style: { font: 'Georgia' } },
      { ...textEl('text', { x: 100, y: 700, w: 1600, h: 100 }, 'Missing'), style: { font: 'Nope Sans' } },
    ];
    const names = await fontNames(await exportPdf(doc, 'Test'));
    expect(names).toEqual(['/Archivo-Black', '/Archivo-Italic', '/Helvetica', '/JetBrainsMono-Regular', '/Times-Roman']);
  });
});
