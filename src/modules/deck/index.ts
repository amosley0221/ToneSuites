// Tone Deck — slides module definition.
import type { ExportFormat, ModuleDef } from '@/core/types';
import { MODULE_META } from '@/modules/meta';
import { deckCommands } from './commands';
import { DeckDoc } from './doc';
import { Editor } from './Editor';
import { menus } from './menus';
import { deckToMarkdown, outlineToDeck, parseOutline } from './outline';
import { deserializeDeck, serializeDeck } from './serialize';

const meta = MODULE_META.deck;
const base = (title: string) => (title || 'Deck').replace(/\.[^.]+$/, '');

const exports: ExportFormat[] = [
  {
    id: 'pdf', name: 'PDF', ext: 'pdf', opensIn: 'paper', description: 'One page per slide · opens in Paper',
    run: async (m, _o, title) => {
      const { exportPdf } = await import('./exportPdf');
      return { kind: 'doc', mode: 'paper', bytes: await exportPdf(m as DeckDoc, base(title)), filename: `${base(title)}.pdf` };
    },
  },
  {
    id: 'pptx', name: 'PowerPoint', ext: 'pptx', description: 'Editable shapes, text, tables and notes',
    run: async (m, _o, title) => {
      const { exportPptx } = await import('./exportPptx');
      return { kind: 'file', bytes: await exportPptx(m as DeckDoc, base(title)), filename: `${base(title)}.pptx` };
    },
  },
  {
    id: 'png', name: 'PNG (current slide)', ext: 'png', opensIn: 'pixel', description: '1920×1080 image of the current slide · opens in Pixel',
    run: async (m, _o, title) => {
      const d = m as DeckDoc;
      const { exportSlidePng } = await import('./raster');
      return { kind: 'doc', mode: 'pixel', bytes: await exportSlidePng(d), filename: `${base(title)}-slide-${d.ui.current + 1}.png` };
    },
  },
  {
    id: 'outline', name: 'Write outline', ext: 'md', opensIn: 'write', description: 'Titles, text and notes as a document · opens in Write',
    run: async (m, _o, title) => ({
      kind: 'doc', mode: 'write', bytes: new TextEncoder().encode(deckToMarkdown((m as DeckDoc).data, base(title))), filename: `${base(title)}.md`,
    }),
  },
];

const deck: ModuleDef<DeckDoc> = {
  ...meta,
  createBlank: async () => ({ model: new DeckDoc(), title: 'Untitled deck' }),
  openFile: async (bytes, filename) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'pptx') throw new Error('PowerPoint import is on the roadmap');
    return new DeckDoc(outlineToDeck(parseOutline(new TextDecoder().decode(bytes))));
  },
  serialize: serializeDeck,
  deserialize: deserializeDeck,
  exports,
  menus,
  commands: deckCommands,
  Editor,
  statusHint: (m) => `Slide ${m.ui.current + 1} of ${m.data.slides.length} · 16:9 · 1920×1080`,
};

export default deck;
