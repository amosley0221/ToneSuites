// File I/O: native .tone payload, foreign images, PSD (ag-psd), exports.
import type { AdjustSpec } from './adjust';
import { fromPsdBlend, toPsdBlend, type BlendMode } from './blend';
import {
  bytesToCanvas, canvasAlphaToMask, canvasToBytes, ctx2d, grayToMaskCanvas, maskCanvasToGray, maskToCanvas, mimeFor, newCanvas, type Cnv,
} from './canvas';
import { flattenCopy } from './composite';
import { PixelDoc, type Channel, type Guide, type Layer, type LayerKind, type LayerStyles, type ShapeData, type TextData } from './doc';
import { docFromCanvas } from './ops';
import { rerender } from './render';

export const FORMAT_VERSION = 1;

interface LayerJson {
  id: string; name: string; kind: LayerKind; parentId: string | null; visible: boolean; opacity: number; blend: BlendMode;
  locked: boolean; x: number; y: number; hasCanvas: boolean;
  mask: { x: number; y: number; enabled: boolean } | null;
  styles: LayerStyles | null; text?: TextData; shape?: ShapeData; adjust?: AdjustSpec; fillColor?: string; collapsed?: boolean;
}
interface ImageJson {
  formatVersion: number; width: number; height: number; ppi: number; activeId: string | null;
  layers: LayerJson[]; guides: Guide[]; channels: { id: string; name: string }[]; selection: boolean;
  fg: string; bg: string; swatches: string[];
}

const dec = new TextDecoder();

export async function serialize(doc: PixelDoc): Promise<Record<string, Uint8Array | string>> {
  const files: Record<string, Uint8Array | string> = {};
  const layers: LayerJson[] = [];
  for (const l of doc.layers) {
    const hasCanvas = !!l.canvas && (l.kind === 'pixel' || l.kind === 'text' || l.kind === 'shape');
    if (hasCanvas) files[`layers/${l.id}.png`] = await canvasToBytes(l.canvas!);
    if (l.mask) files[`masks/${l.id}.png`] = await canvasToBytes(l.mask.canvas);
    layers.push({
      id: l.id, name: l.name, kind: l.kind, parentId: l.parentId, visible: l.visible, opacity: l.opacity, blend: l.blend,
      locked: l.locked, x: l.x, y: l.y, hasCanvas, mask: l.mask ? { x: l.mask.x, y: l.mask.y, enabled: l.mask.enabled } : null,
      styles: l.styles, text: l.text, shape: l.shape, adjust: l.adjust, fillColor: l.fillColor, collapsed: l.collapsed,
    });
  }
  for (const c of doc.channels) files[`channels/${c.id}.png`] = await canvasToBytes(maskToCanvas(c.mask));
  if (doc.selection) files['selection.png'] = await canvasToBytes(maskToCanvas(doc.selection));
  const json: ImageJson = {
    formatVersion: FORMAT_VERSION, width: doc.width, height: doc.height, ppi: doc.ppi, activeId: doc.activeId, layers,
    guides: doc.guides, channels: doc.channels.map((c) => ({ id: c.id, name: c.name })), selection: !!doc.selection,
    fg: doc.ui.fg, bg: doc.ui.bg, swatches: doc.swatches,
  };
  files['image.json'] = JSON.stringify(json);
  return files;
}

export async function deserialize(files: Record<string, Uint8Array>, formatVersion: number): Promise<PixelDoc> {
  const raw = files['image.json'];
  if (!raw) throw new Error('This Tone file has no image data');
  const json = JSON.parse(dec.decode(raw)) as ImageJson;
  if ((json.formatVersion ?? formatVersion) > FORMAT_VERSION) throw new Error('This file was made by a newer version of Tone Pixel');
  const doc = new PixelDoc(json.width, json.height, json.ppi || 72);
  for (const lj of json.layers) {
    const l: Layer = {
      id: lj.id, name: lj.name, kind: lj.kind, parentId: lj.parentId, visible: lj.visible, opacity: lj.opacity, blend: lj.blend,
      locked: lj.locked, x: lj.x, y: lj.y, canvas: null, mask: null, styles: lj.styles, text: lj.text, shape: lj.shape,
      adjust: lj.adjust, fillColor: lj.fillColor, collapsed: lj.collapsed,
    };
    const png = files[`layers/${lj.id}.png`];
    if (lj.hasCanvas && png) l.canvas = await bytesToCanvas(png);
    if (l.kind === 'text' || l.kind === 'shape') {
      // keep stored pixels if fonts are missing; otherwise re-render live content
      try { if (l.kind === 'text') { await document.fonts?.load?.(`${l.text!.weight} ${l.text!.size}px "${l.text!.font}"`); } rerender(l); } catch { /* keep stored */ }
    }
    const m = files[`masks/${lj.id}.png`];
    if (lj.mask && m) l.mask = { canvas: await bytesToCanvas(m), x: lj.mask.x, y: lj.mask.y, enabled: lj.mask.enabled };
    doc.layers.push(l);
  }
  doc.activeId = json.activeId && doc.layer(json.activeId) ? json.activeId : doc.layers[doc.layers.length - 1]?.id ?? null;
  doc.guides = json.guides ?? [];
  const chans: Channel[] = [];
  for (const c of json.channels ?? []) {
    const b = files[`channels/${c.id}.png`];
    if (b) chans.push({ id: c.id, name: c.name, mask: canvasAlphaToMask(await bytesToCanvas(b)) });
  }
  doc.channels = chans;
  if (json.selection && files['selection.png']) doc.selection = canvasAlphaToMask(await bytesToCanvas(files['selection.png']));
  doc.ui.fg = json.fg ?? doc.ui.fg;
  doc.ui.bg = json.bg ?? doc.ui.bg;
  doc.swatches = json.swatches ?? [];
  doc.resetHistory('Open');
  return doc;
}

// ---------- foreign formats ----------

export async function openFile(bytes: Uint8Array, filename: string): Promise<PixelDoc> {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'psd') return openPsd(bytes);
  const c = await bytesToCanvas(bytes, mimeFor(ext));
  return docFromCanvas(c);
}

async function openPsd(bytes: Uint8Array): Promise<PixelDoc> {
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { skipThumbnail: true });
  const doc = new PixelDoc(psd.width, psd.height, (psd.imageResources?.resolutionInfo?.horizontalResolution as number) || 72);
  const walk = (children: any[] | undefined, parentId: string | null) => {
    for (const ch of children ?? []) {
      const isGroup = Array.isArray(ch.children);
      const l = doc.makeLayer(isGroup ? 'group' : 'pixel', ch.name || (isGroup ? 'Group' : 'Layer'), {
        parentId,
        visible: !ch.hidden,
        opacity: typeof ch.opacity === 'number' ? ch.opacity : 1,
        blend: fromPsdBlend(ch.blendMode),
        x: ch.left ?? 0,
        y: ch.top ?? 0,
        canvas: !isGroup && ch.canvas ? ch.canvas : null,
        collapsed: isGroup ? !ch.opened : undefined,
      });
      if (ch.mask?.canvas) {
        l.mask = { canvas: grayToMaskCanvas(ch.mask.canvas), x: ch.mask.left ?? 0, y: ch.mask.top ?? 0, enabled: !ch.mask.disabled };
      }
      doc.layers.push(l);
      if (isGroup) walk(ch.children, l.id);
    }
  };
  walk(psd.children, null);
  if (!doc.layers.length && psd.canvas) doc.layers.push(doc.makeLayer('pixel', 'Background', { canvas: psd.canvas as Cnv }));
  if (!doc.layers.length) doc.layers.push(doc.newPixelLayer('Background'));
  doc.activeId = doc.layers[doc.layers.length - 1].id;
  doc.resetHistory('Open');
  return doc;
}

export async function writePsdBytes(doc: PixelDoc): Promise<Uint8Array> {
  const { writePsdUint8Array } = await import('ag-psd');
  const toPsd = (parentId: string | null): any[] => doc.childrenOf(parentId).map((l) => {
    const base: any = { name: l.name, hidden: !l.visible, opacity: l.opacity, blendMode: toPsdBlend(l.blend) };
    if (l.kind === 'group') return { ...base, children: toPsd(l.id), opened: !l.collapsed };
    let canvas: Cnv | null = l.canvas, left = l.x, top = l.y;
    if (l.kind === 'fill' || l.kind === 'adjustment' || !canvas) {
      // adjustment/fill layers are written as pixel layers (fill) or empty layers (adjustment)
      canvas = l.kind === 'fill' ? solid(doc, l.fillColor ?? '#000') : newCanvas(1, 1);
      left = 0; top = 0;
    }
    const out: any = { ...base, canvas, left, top };
    if (l.mask) out.mask = { canvas: maskCanvasToGray(l.mask.canvas), left: l.mask.x, top: l.mask.y, defaultColor: 0, disabled: !l.mask.enabled };
    return out;
  });
  const psd = { width: doc.width, height: doc.height, children: toPsd(null), canvas: flattenCopy(doc) };
  return writePsdUint8Array(psd as any, { generateThumbnail: false });
}

function solid(doc: PixelDoc, color: string): Cnv {
  const c = newCanvas(doc.width, doc.height);
  const x = ctx2d(c);
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Flattened image encoded as png/jpeg/webp. JPEG has no alpha: composite over white. */
export async function flatBytes(doc: PixelDoc, ext: string, quality = 0.92, scale = 1): Promise<Uint8Array> {
  let c = flattenCopy(doc);
  if (scale !== 1) {
    const s = newCanvas(Math.max(1, Math.round(c.width * scale)), Math.max(1, Math.round(c.height * scale)));
    const x = ctx2d(s);
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, s.width, s.height);
    c = s;
  }
  if (ext === 'jpg' || ext === 'jpeg') {
    const w = newCanvas(c.width, c.height);
    const x = ctx2d(w);
    x.fillStyle = '#FFFFFF';
    x.fillRect(0, 0, w.width, w.height);
    x.drawImage(c, 0, 0);
    c = w;
  }
  return canvasToBytes(c, mimeFor(ext), ext === 'png' ? undefined : quality);
}

export async function saveForeign(doc: PixelDoc, format: string): Promise<Uint8Array | null> {
  const f = format.toLowerCase();
  if (f === 'png' || f === 'jpg' || f === 'jpeg' || f === 'webp') return flatBytes(doc, f);
  if (f === 'psd') return writePsdBytes(doc);
  return null;
}

/** A one-page PDF sized to the image (at its resolution) with the flattened PNG. */
export async function pdfBytes(doc: PixelDoc): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  const png = await pdf.embedPng(await flatBytes(doc, 'png'));
  const k = 72 / (doc.ppi || 72);
  const page = pdf.addPage([doc.width * k, doc.height * k]);
  page.drawImage(png, { x: 0, y: 0, width: doc.width * k, height: doc.height * k });
  return pdf.save();
}
