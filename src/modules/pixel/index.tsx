// Tone Pixel — raster image editor module.
import type { ExportFormat, ModuleDef } from '@/core/types';
import { moduleApi } from '@/core/documents';
import { commands } from './commands';
import { NewCanvasDialog, type NewCanvasResult } from './dialogs/NewCanvas';
import type { PixelDoc } from './engine/doc';
import { deserialize, flatBytes, openFile, pdfBytes, saveForeign, serialize, writePsdBytes } from './engine/io';
import { createDoc } from './engine/ops';
import { variantOf } from './engine/tooldefs';
import { Editor } from './editor/Editor';
import { menus } from './menus';

const base = (title: string) => title.replace(/\.[^.]+$/, '') || 'image';
const SCALE = { id: 'scale', label: 'Size', choices: ['100%', '50%', '25%', '200%'], default: '100%' };
const scaleOf = (o: Record<string, string>) => (parseFloat(o.scale ?? '100') || 100) / 100;

const exportsList: ExportFormat[] = [
  {
    id: 'png', name: 'PNG', ext: 'png', description: 'Lossless · transparency kept', options: [SCALE],
    run: async (m, o, t) => ({ kind: 'file', bytes: await flatBytes(m as PixelDoc, 'png', 1, scaleOf(o)), filename: `${base(t)}.png` }),
  },
  {
    id: 'jpg', name: 'JPEG', ext: 'jpg', description: 'Lossy · flattened on white',
    options: [{ id: 'quality', label: 'Quality', choices: ['100', '92', '80', '60', '40'], default: '92' }, SCALE],
    run: async (m, o, t) => ({ kind: 'file', bytes: await flatBytes(m as PixelDoc, 'jpg', (parseInt(o.quality ?? '92', 10) || 92) / 100, scaleOf(o)), filename: `${base(t)}.jpg` }),
  },
  {
    id: 'webp', name: 'WebP', ext: 'webp', description: 'Small files · transparency kept',
    options: [{ id: 'quality', label: 'Quality', choices: ['100', '90', '80', '60'], default: '90' }, SCALE],
    run: async (m, o, t) => ({ kind: 'file', bytes: await flatBytes(m as PixelDoc, 'webp', (parseInt(o.quality ?? '90', 10) || 90) / 100, scaleOf(o)), filename: `${base(t)}.webp` }),
  },
  {
    id: 'psd', name: 'Photoshop', ext: 'psd', description: 'Layers preserved (names, opacity, blend, masks)',
    run: async (m, _o, t) => ({ kind: 'file', bytes: await writePsdBytes(m as PixelDoc), filename: `${base(t)}.psd` }),
  },
  {
    id: 'pdf', name: 'PDF', ext: 'pdf', description: 'Flattened · page sized to the image · opens in Paper', opensIn: 'paper',
    run: async (m, _o, t) => ({ kind: 'doc', mode: 'paper', bytes: await pdfBytes(m as PixelDoc), filename: `${base(t)}.pdf` }),
  },
];

const pixel: ModuleDef<PixelDoc> = {
  id: 'pixel',
  mark: 'Px',
  name: 'Pixel',
  description: 'Layers, masks, retouch, RAW',
  opens: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'psd'],
  createBlank: () => new Promise((resolve) => {
    let done = false;
    moduleApi(null).openDialog((close) => (
      <NewCanvasDialog onDone={(r: NewCanvasResult | null) => {
        if (done) return;
        done = true;
        close();
        resolve(r ? { model: createDoc(r.width, r.height, r.ppi, r.background, r.bgColor), title: `${r.name}.tone` } : null);
      }} />
    ));
  }),
  openFile,
  serialize,
  deserialize,
  saveForeign,
  exports: exportsList,
  menus,
  commands,
  Editor,
  statusHint: (doc) => `${variantOf(doc.ui.tool).name} · Layer: ${doc.active?.name ?? '—'} · ${fmtZoom(doc.ui.zoom)}`,
};

function fmtZoom(z: number) {
  const p = z * 100;
  return (p >= 100 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
}

export default pixel;
