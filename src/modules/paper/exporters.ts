// Convert & export formats for Paper.
import type { ExportFormat } from '@/core/types';
import type { PaperModel } from './model';
import { applyModel, bytesText, canvasPng, renderBytesPage } from './render';
import { itemsToParagraphs, paragraphsToHtml } from './text';

const stem = (t: string) => t.replace(/\.(pdf|tone)$/i, '') || 'document';

export const paperExports: ExportFormat[] = [
  {
    id: 'pdf', name: 'PDF (flattened copy)', ext: 'pdf',
    description: 'Annotations, signatures, form values and applied redactions burnt into a standard PDF',
    run: async (m, _o, title) => ({ kind: 'file', bytes: (await applyModel(m as PaperModel)).bytes, filename: `${stem(title)}.pdf` }),
  },
  {
    id: 'write', name: 'Write document', ext: 'html', opensIn: 'write',
    description: 'Text and headings reflowed from the PDF text layer · opens in Write (scans need OCR)',
    run: async (m, _o, title) => {
      const bytes = (await applyModel(m as PaperModel)).bytes;
      const pages = await bytesText(bytes);
      const html = paragraphsToHtml(stem(title), pages.map(itemsToParagraphs));
      return { kind: 'doc', mode: 'write', bytes: new TextEncoder().encode(html), filename: `${stem(title)}.html` };
    },
  },
  {
    id: 'png', name: 'PNG (current page)', ext: 'png',
    description: 'The page you are viewing, with edits, as an image',
    options: [{ id: 'dpi', label: 'Resolution', choices: ['72 dpi', '150 dpi', '300 dpi'], default: '150 dpi' }],
    run: async (m, o, title) => {
      const model = m as PaperModel;
      const dpi = parseInt(o.dpi ?? '150', 10) || 150;
      const bytes = (await applyModel(model)).bytes;
      const canvas = await renderBytesPage(bytes, model.ui.page, dpi / 72);
      return { kind: 'file', bytes: await canvasPng(canvas), filename: `${stem(title)}-p${model.ui.page + 1}.png` };
    },
  },
  {
    id: 'txt', name: 'Plain text', ext: 'txt',
    description: 'Text layer of every page, one blank line between paragraphs',
    run: async (m, _o, title) => {
      const bytes = (await applyModel(m as PaperModel)).bytes;
      const pages = await bytesText(bytes);
      const text = pages.map((items) => itemsToParagraphs(items).map((p) => p.text).join('\n\n')).join('\n\n\f\n\n');
      return { kind: 'file', bytes: new TextEncoder().encode(text), filename: `${stem(title)}.txt` };
    },
  },
];
