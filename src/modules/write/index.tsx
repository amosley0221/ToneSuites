// Tone Write — word processor module definition.
import type { ExportFormat, ModuleDef } from '@/core/types';
import { writeCommands } from './commands';
import { WriteEditor } from './Editor';
import { docToHtml, docToText, importFile } from './io';
import { menus } from './menus';
import { deserializeModel, serializeModel, WriteModel } from './model';
import { toMarkdown } from './markdown';
import { docStats, toToneOutline } from './stats';
import { stripExtension } from './util';

const enc = (s: string) => new TextEncoder().encode(s);
const base = (title: string) => stripExtension(title);

const exportsList: ExportFormat[] = [
  {
    id: 'pdf', name: 'PDF', ext: 'pdf', opensIn: 'paper',
    description: 'Opens in Tone Paper · paginated with your page setup',
    options: [{ id: 'markup', label: 'Tracked changes', choices: ['Final', 'Show markup'], default: 'Final' }],
    run: async (model, opts, title) => {
      const { pdfBytes } = await import('./pdfExport');
      return { kind: 'doc', mode: 'paper', bytes: await pdfBytes(model as WriteModel, { markup: opts.markup === 'Show markup' }), filename: base(title) + '.pdf' };
    },
  },
  {
    id: 'docx', name: 'Word document', ext: 'docx', description: 'Compatible with Word 2016+ · keeps tracked changes & comments',
    run: async (model, _opts, title) => {
      const { docxBytes } = await import('./docxExport');
      return { kind: 'file', bytes: await docxBytes(model as WriteModel), filename: base(title) + '.docx' };
    },
  },
  {
    id: 'md', name: 'Markdown', ext: 'md', description: 'Plain text with headings',
    run: async (model, _opts, title) => ({ kind: 'file', bytes: enc(toMarkdown((model as WriteModel).state.doc)), filename: base(title) + '.md' }),
  },
  {
    id: 'html', name: 'HTML', ext: 'html', description: 'Web page with the document styles',
    run: async (model, _opts, title) => {
      const m = model as WriteModel;
      return { kind: 'file', bytes: enc(docToHtml(m.state.doc, base(title), m.page, m.footnotes)), filename: base(title) + '.html' };
    },
  },
  {
    id: 'txt', name: 'Plain text', ext: 'txt', description: 'Text only, changes accepted',
    run: async (model, _opts, title) => ({ kind: 'file', bytes: enc(docToText((model as WriteModel).state.doc, (model as WriteModel).footnotes)), filename: base(title) + '.txt' }),
  },
  {
    id: 'toneoutline', name: 'Deck outline', ext: 'toneoutline', opensIn: 'deck',
    description: 'One slide per heading, opens in Deck',
    run: async (model, _opts, title) => {
      const outline = toToneOutline((model as WriteModel).state.doc, base(title));
      return { kind: 'doc', mode: 'deck', bytes: enc(JSON.stringify(outline)), filename: base(title) + '.toneoutline' };
    },
  },
];

const statsCache = new WeakMap<object, number>();

const write: ModuleDef<WriteModel> = {
  id: 'write',
  mark: 'Wr',
  name: 'Write',
  description: 'Long-form, styles, track changes',
  opens: ['docx', 'md', 'markdown', 'txt', 'html', 'htm'],
  createBlank: async () => ({ model: new WriteModel(), title: 'Untitled' }),
  openFile: (bytes, filename) => importFile(bytes, filename),
  serialize: async (m) => serializeModel(m),
  deserialize: async (files, formatVersion) => deserializeModel(files, formatVersion),
  saveForeign: async (m, format) => {
    switch (format) {
      case 'docx': { const { docxBytes } = await import('./docxExport'); return docxBytes(m); }
      case 'md': case 'markdown': return enc(toMarkdown(m.state.doc));
      case 'html': case 'htm': return enc(docToHtml(m.state.doc, 'Document', m.page, m.footnotes));
      case 'txt': return enc(docToText(m.state.doc, m.footnotes));
      default: return null;
    }
  },
  exports: exportsList,
  menus,
  commands: (getModel, api) => writeCommands(getModel, api),
  Editor: WriteEditor,
  statusHint: (m) => {
    let words = statsCache.get(m.state.doc);
    if (words == null) { words = docStats(m.state.doc).words; statsCache.set(m.state.doc, words); }
    const pages = Math.max(1, m.ui.pages);
    const cur = Math.min(pages, Math.max(1, m.ui.blockPages[m.state.selection.$head.index(0)] ?? 1));
    return `Page ${cur} of ${pages} · ${words.toLocaleString()} word${words === 1 ? '' : 's'} · ${m.page.paper}${m.tracking ? ' · Tracking' : ''}`;
  },
};

export default write;
