// Document operations shared by menu commands, panels and tools (browser only).
import { applyAdjust, defaultAdjust, ADJUST_NAMES, type AdjustSpec, type AdjustType } from './adjust';
import {
  canvasAlphaToMask, cloneCanvas, contentBounds, ctx2d, getImg, maskToCanvas, newCanvas, putImg, type Cnv,
} from './canvas';
import { composite, flattenCopy, renderLayerAlone } from './composite';
import { defaultStyles, PixelDoc, type Layer } from './doc';
import { anchorOffset, intersectRect, transformedBounds, unionRect, type RectLike } from './geometry';
import { mixByMask, type Img } from './img';
import {
  borderMask, combine, contractMask, expandMask, featherMask, flipMask, fullMask, invertMask, isEmpty, maskBounds,
  offsetMask, resampleMask, rotateMask, smoothMask, type Mask, type Rect,
} from './mask';
import { rerender } from './render';

export class UserError extends Error {}

// ---------- creation ----------

export type BackgroundFill = 'white' | 'black' | 'transparent' | 'background';

export function createDoc(w: number, h: number, ppi: number, background: BackgroundFill, bgColor = '#FFFFFF'): PixelDoc {
  const doc = new PixelDoc(w, h, ppi);
  const bg = doc.newPixelLayer('Background');
  if (background !== 'transparent') {
    const x = ctx2d(bg.canvas!);
    x.fillStyle = background === 'white' ? '#FFFFFF' : background === 'black' ? '#000000' : bgColor;
    x.fillRect(0, 0, w, h);
  }
  doc.addLayer(bg, null);
  doc.resetHistory('New canvas');
  return doc;
}

export function docFromCanvas(c: Cnv, name = 'Background', ppi = 72): PixelDoc {
  const doc = new PixelDoc(c.width, c.height, ppi);
  const l = doc.makeLayer('pixel', name, { canvas: c });
  doc.addLayer(l, null);
  doc.resetHistory('Open');
  return doc;
}

// ---------- guards ----------

export function requirePixelLayer(doc: PixelDoc, l: Layer | undefined = doc.active): Layer {
  if (!l) throw new UserError('No layer selected');
  if (l.locked) throw new UserError(`“${l.name}” is locked`);
  if (l.kind === 'text') throw new UserError('This is a type layer — rasterize it first (Layer › Rasterize › Type)');
  if (l.kind === 'shape') throw new UserError('This is a shape layer — rasterize it first (Layer › Rasterize › Shape)');
  if (l.kind === 'group') throw new UserError('Select a pixel layer — groups have no pixels of their own');
  if (l.kind === 'adjustment') throw new UserError('Adjustment layers have no pixels — select a pixel layer');
  if (l.kind === 'fill') throw new UserError('Fill layers have no pixels — rasterize it first');
  return l;
}

/** Selection restricted to a layer canvas frame (layer-local coordinates). */
export function localSelection(doc: PixelDoc, l: Layer): Mask | null {
  if (!doc.selection || !l.canvas) return null;
  return offsetMask(doc.selection, l.canvas.width, l.canvas.height, -l.x, -l.y);
}

/** Region of the layer canvas worth processing (selection bounds + margin, or the whole canvas). */
function workRect(doc: PixelDoc, l: Layer, margin: number): RectLike {
  const full = { x: 0, y: 0, w: l.canvas!.width, h: l.canvas!.height };
  if (!doc.selection) return full;
  const b = maskBounds(doc.selection);
  if (!b) return full;
  return intersectRect(full, { x: b.x - l.x - margin, y: b.y - l.y - margin, w: b.w + margin * 2, h: b.h + margin * 2 }) ?? full;
}

/** Run a pure pixel function on the active layer, respecting the selection. Returns preview canvas or commits. */
export function processLayer(doc: PixelDoc, fn: (img: Img) => Img, margin = 64, l = requirePixelLayer(doc)): Cnv {
  if (doc.selection && isEmpty(doc.selection)) throw new UserError('The selection is empty');
  const src = l.canvas ?? newCanvas(doc.width, doc.height);
  const r = workRect(doc, l, margin);
  const orig = getImg(src, r);
  const res = fn(orig);
  if (doc.selection) {
    const m = offsetMask(doc.selection, r.w, r.h, -l.x - r.x, -l.y - r.y);
    mixByMask(orig, res, m.data);
  }
  const out = cloneCanvas(src);
  putImg(out, res, r.x, r.y);
  return out;
}

export function applyPixels(doc: PixelDoc, label: string, fn: (img: Img) => Img, margin = 64) {
  const l = requirePixelLayer(doc);
  const out = processLayer(doc, fn, margin, l);
  l.canvas = out;
  doc.override = null;
  doc.commit(label);
}

/** Show a pixel-function preview on the active layer (cleared by clearPreview). */
export function previewPixels(doc: PixelDoc, fn: (img: Img) => Img, margin = 64) {
  const l = requirePixelLayer(doc);
  const out = processLayer(doc, fn, margin, l);
  doc.override = { layerId: l.id, target: 'pixels', render: () => ({ canvas: out, x: l.x, y: l.y }) };
  doc.touch();
}

export function clearPreview(doc: PixelDoc) {
  if (!doc.override && !doc.adjustOverride) return;
  doc.override = null;
  doc.adjustOverride = null;
  doc.touch();
}

// ---------- fill / stroke / clear ----------

/** Paint `color` through the selection (or the whole layer) onto the active pixel layer. */
export function fillWith(doc: PixelDoc, color: string, opacity = 1, blend: GlobalCompositeOperation = 'source-over', maskOverride?: Mask, label = 'Fill') {
  const l = requirePixelLayer(doc);
  doc.expandToDoc(l);
  const tmp = newCanvas(doc.width, doc.height);
  const t = ctx2d(tmp);
  t.fillStyle = color;
  t.fillRect(0, 0, doc.width, doc.height);
  const m = maskOverride ?? doc.selection;
  if (m) { t.globalCompositeOperation = 'destination-in'; t.drawImage(maskToCanvas(m), 0, 0); }
  const c = ctx2d(doc.writable(l));
  c.save();
  c.globalAlpha = opacity;
  c.globalCompositeOperation = blend;
  c.drawImage(tmp, -l.x, -l.y);
  c.restore();
  doc.commit(label);
}

export function strokeSelection(doc: PixelDoc, width: number, color: string, location: 'inside' | 'center' | 'outside', opacity = 1) {
  if (!doc.selection) throw new UserError('Make a selection first');
  const s = doc.selection;
  const m = location === 'outside' ? combine(expandMask(s, width), s, 'subtract')
    : location === 'inside' ? combine(s, contractMask(s, width), 'subtract')
      : borderMask(s, width);
  fillWith(doc, color, opacity, 'source-over', m, 'Stroke');
}

export function clearPixels(doc: PixelDoc, label = 'Clear') {
  const l = requirePixelLayer(doc);
  const c = ctx2d(doc.writable(l));
  if (!doc.selection) { c.clearRect(0, 0, l.canvas!.width, l.canvas!.height); }
  else {
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(doc.selectionCanvas()!, -l.x, -l.y);
    c.restore();
  }
  doc.commit(label);
}

// ---------- clipboard ----------

export interface Clip { canvas: Cnv; x: number; y: number }
let internalClip: Clip | null = null;

/** Copy selected pixels of the active layer (or the merged image). */
export function copyPixels(doc: PixelDoc, merged: boolean): Clip {
  let src: Cnv, sx: number, sy: number;
  if (merged) { src = composite(doc); sx = 0; sy = 0; }
  else {
    const l = doc.active;
    if (!l || l.kind === 'group' || l.kind === 'adjustment') throw new UserError('Select a layer with pixels to copy');
    if (l.kind === 'fill') { src = renderLayerAlone(doc, l); sx = 0; sy = 0; }
    else { if (!l.canvas) throw new UserError('Layer is empty'); src = l.canvas; sx = l.x; sy = l.y; }
  }
  let rect: RectLike | null;
  if (doc.selection) rect = maskBounds(doc.selection);
  else { const b = contentBounds(src); rect = b ? { x: b.x + sx, y: b.y + sy, w: b.w, h: b.h } : null; }
  if (!rect) throw new UserError('Nothing to copy — the area is empty');
  const out = newCanvas(rect.w, rect.h);
  const o = ctx2d(out);
  o.drawImage(src, sx - rect.x, sy - rect.y);
  if (doc.selection) {
    o.globalCompositeOperation = 'destination-in';
    o.drawImage(doc.selectionCanvas()!, -rect.x, -rect.y);
  }
  const clip = { canvas: out, x: rect.x, y: rect.y };
  internalClip = clip;
  return clip;
}

export function getInternalClip() { return internalClip; }
export function setInternalClip(c: Clip) { internalClip = c; }

/** Add a pixel layer holding `c` (centered unless `inPlace`). Optional mask from the selection (Paste into). */
export function placeCanvas(doc: PixelDoc, c: Cnv, name: string, opts: { x?: number; y?: number; into?: boolean; fit?: boolean } = {}): Layer {
  let canvas = c;
  if (opts.fit && (c.width > doc.width || c.height > doc.height)) {
    const k = Math.min(doc.width / c.width, doc.height / c.height);
    canvas = newCanvas(Math.max(1, Math.round(c.width * k)), Math.max(1, Math.round(c.height * k)));
    const x = ctx2d(canvas);
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, canvas.width, canvas.height);
  }
  const l = doc.makeLayer('pixel', name, {
    canvas,
    x: opts.x ?? Math.round((doc.width - canvas.width) / 2),
    y: opts.y ?? Math.round((doc.height - canvas.height) / 2),
  });
  if (opts.into && doc.selection) l.mask = { canvas: maskToCanvas(doc.selection), x: 0, y: 0, enabled: true };
  doc.addLayer(l);
  return l;
}

// ---------- layers ----------

export function nextLayerName(doc: PixelDoc, base = 'Layer'): string {
  let n = 1;
  const names = new Set(doc.layers.map((l) => l.name));
  while (names.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function newLayer(doc: PixelDoc, name = nextLayerName(doc)) {
  const l = doc.newPixelLayer(name);
  doc.addLayer(l);
  doc.commit('New layer');
  return l;
}

export function duplicateLayer(doc: PixelDoc, l = doc.active): Layer | null {
  if (!l) return null;
  const dup = (src: Layer, parentId: string | null): Layer => ({
    ...src,
    id: (Math.random().toString(36).slice(2)) + Date.now().toString(36),
    name: parentId === src.parentId ? `${src.name} copy` : src.name,
    parentId,
    canvas: src.canvas ? cloneCanvas(src.canvas) : null,
    mask: src.mask ? { ...src.mask, canvas: cloneCanvas(src.mask.canvas) } : null,
    styles: src.styles ? structuredClone(src.styles) : null,
    text: src.text ? { ...src.text } : undefined,
    shape: src.shape ? { ...src.shape } : undefined,
    adjust: src.adjust ? structuredClone(src.adjust) : undefined,
  });
  const copy = dup(l, l.parentId);
  doc.layers.splice(lastIndexOfSubtree(doc, l) + 1, 0, copy);
  // duplicate children of groups
  if (l.kind === 'group') {
    const map = new Map<string, string>([[l.id, copy.id]]);
    let at = doc.layers.indexOf(copy);
    for (const d of doc.descendants(l.id)) {
      const c = dup(d, map.get(d.parentId!)!);
      map.set(d.id, c.id);
      doc.layers.splice(++at, 0, c);
    }
  }
  doc.activeId = copy.id;
  doc.commit('Duplicate layer');
  return copy;
}

function lastIndexOfSubtree(doc: PixelDoc, l: Layer): number {
  let i = doc.layers.indexOf(l);
  for (const d of doc.descendants(l.id)) i = Math.max(i, doc.layers.indexOf(d));
  return i;
}

export function deleteLayer(doc: PixelDoc, l = doc.active) {
  if (!l) return;
  if (doc.layers.length <= 1) throw new UserError('A document needs at least one layer');
  doc.removeLayer(l.id);
  doc.commit('Delete layer');
}

export function layerViaCopy(doc: PixelDoc, cut: boolean) {
  const l = doc.active;
  if (!doc.selection) { if (!cut) duplicateLayer(doc); else throw new UserError('Make a selection first'); return; }
  if (!l || !l.canvas) throw new UserError('Select a layer with pixels');
  const clip = copyPixels(doc, false);
  if (cut) {
    requirePixelLayer(doc, l);
    const c = ctx2d(doc.writable(l));
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(doc.selectionCanvas()!, -l.x, -l.y);
    c.restore();
  }
  placeCanvas(doc, clip.canvas, nextLayerName(doc), { x: clip.x, y: clip.y });
  doc.commit(cut ? 'Layer via cut' : 'Layer via copy');
}

export function groupLayers(doc: PixelDoc) {
  const l = doc.active;
  const g = doc.makeLayer('group', nextLayerName(doc, 'Group'));
  if (!l) { doc.addLayer(g, null); doc.commit('New group'); return; }
  doc.addLayer(g, l.id);
  l.parentId = g.id;
  // keep the record before the group so it stays a child in z-order
  doc.layers.splice(doc.layers.indexOf(l), 1);
  doc.layers.splice(doc.layers.indexOf(g), 0, l);
  doc.activeId = g.id;
  doc.commit('Group layers');
}

export function newGroup(doc: PixelDoc) {
  const g = doc.makeLayer('group', nextLayerName(doc, 'Group'));
  doc.addLayer(g);
  doc.commit('New group');
}

export function ungroup(doc: PixelDoc) {
  const g = doc.active;
  if (!g || g.kind !== 'group') throw new UserError('Select a group to ungroup');
  for (const c of doc.childrenOf(g.id)) c.parentId = g.parentId;
  const kids = doc.childrenOf(g.parentId).filter((x) => x.id !== g.id);
  doc.layers = doc.layers.filter((x) => x.id !== g.id);
  doc.activeId = kids[kids.length - 1]?.id ?? doc.layers[0]?.id ?? null;
  doc.commit('Ungroup layers');
}

export function rasterize(doc: PixelDoc, l: Layer, label = 'Rasterize') {
  if (l.kind === 'text' || l.kind === 'shape') { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; }
  else if (l.kind === 'fill') { l.canvas = renderFill(doc, l); l.x = 0; l.y = 0; l.kind = 'pixel'; l.fillColor = undefined; }
  else if (l.kind !== 'pixel') throw new UserError('This layer cannot be rasterized');
  doc.commit(label);
}

function renderFill(doc: PixelDoc, l: Layer): Cnv {
  const c = newCanvas(doc.width, doc.height);
  const x = ctx2d(c);
  x.fillStyle = l.fillColor ?? '#000';
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

/** Bake mask + styles into pixels (Layer › Rasterize › Layer style). */
export function bakeLayer(doc: PixelDoc, l: Layer) {
  if (l.kind === 'group' || l.kind === 'adjustment') throw new UserError('Select a pixel, type or shape layer');
  const c = renderLayerAlone(doc, l);
  l.canvas = c; l.x = 0; l.y = 0; l.mask = null; l.styles = null;
  if (l.kind !== 'pixel') { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; l.fillColor = undefined; }
  doc.commit('Rasterize layer style');
}

export function mergeDown(doc: PixelDoc) {
  const l = doc.active;
  if (!l) return;
  const sibs = doc.childrenOf(l.parentId);
  const below = sibs[sibs.indexOf(l) - 1];
  if (!below) throw new UserError('There is no layer below to merge into');
  if (below.kind === 'group' || below.kind === 'adjustment') throw new UserError('The layer below has no pixels to merge into');
  if (l.kind === 'group') throw new UserError('Merge down works on single layers');
  const out = newCanvas(doc.width, doc.height);
  const o = ctx2d(out);
  if (below.visible) { o.globalAlpha = below.opacity; o.drawImage(renderLayerAlone(doc, below), 0, 0); o.globalAlpha = 1; }
  if (l.visible) {
    if (l.kind === 'adjustment' && l.adjust) {
      const before = getImg(out);
      const after = applyAdjust(before, l.adjust);
      const m = l.mask ? canvasAlphaToMask(l.mask.canvas, doc.width, doc.height, l.mask.x, l.mask.y) : null;
      mixByMask(before, after, m?.data ?? null, l.opacity);
      putImg(out, after);
    } else {
      o.globalAlpha = l.opacity;
      o.globalCompositeOperation = l.blend === 'normal' ? 'source-over' : l.blend;
      o.drawImage(renderLayerAlone(doc, l), 0, 0);
    }
  }
  Object.assign(below, { kind: 'pixel', canvas: out, x: 0, y: 0, opacity: 1, blend: 'normal', mask: null, styles: null, text: undefined, shape: undefined, fillColor: undefined });
  doc.removeLayer(l.id);
  doc.activeId = below.id;
  doc.commit('Merge down');
}

export function mergeVisible(doc: PixelDoc) {
  const flat = flattenCopy(doc);
  const visible = doc.layers.filter((l) => doc.isEffectivelyVisible(l));
  if (!visible.length) throw new UserError('No visible layers to merge');
  const target = doc.makeLayer('pixel', 'Merged', { canvas: flat });
  const firstRoot = doc.childrenOf(null).find((l) => l.visible);
  doc.layers = doc.layers.filter((l) => !visible.includes(l) || l === firstRoot);
  if (firstRoot) { doc.layers.splice(doc.layers.indexOf(firstRoot), 1, target); }
  else doc.layers.push(target);
  // hidden children of merged groups lose their parent
  for (const l of doc.layers) if (l.parentId && !doc.layer(l.parentId)) l.parentId = null;
  doc.activeId = target.id;
  doc.commit('Merge visible');
}

export function flatten(doc: PixelDoc) {
  const flat = flattenCopy(doc);
  const l = doc.makeLayer('pixel', 'Background', { canvas: flat });
  doc.layers = [l];
  doc.activeId = l.id;
  doc.commit('Flatten image');
}

// ---------- adjustment & fill layers ----------

export function addAdjustmentLayer(doc: PixelDoc, spec: AdjustSpec) {
  const l = doc.makeLayer('adjustment', ADJUST_NAMES[spec.type], { adjust: spec });
  if (doc.selection) l.mask = { canvas: maskToCanvas(doc.selection), x: 0, y: 0, enabled: true };
  doc.addLayer(l);
  doc.commit(`New ${ADJUST_NAMES[spec.type]} layer`);
  return l;
}

export function addFillLayer(doc: PixelDoc, color: string) {
  const l = doc.makeLayer('fill', 'Color fill', { fillColor: color });
  if (doc.selection) l.mask = { canvas: maskToCanvas(doc.selection), x: 0, y: 0, enabled: true };
  doc.addLayer(l);
  doc.commit('New fill layer');
  return l;
}

export function applyAdjustDestructive(doc: PixelDoc, spec: AdjustSpec) {
  applyPixels(doc, ADJUST_NAMES[spec.type], (img) => applyAdjust(img, spec), 0);
}

export const adjustDefaults = (doc: PixelDoc, t: AdjustType) => defaultAdjust(t, doc.ui.fg, doc.ui.bg);

// ---------- masks ----------

function maskFrame(doc: PixelDoc, l: Layer): RectLike {
  const doc0 = { x: 0, y: 0, w: doc.width, h: doc.height };
  return l.canvas && l.kind !== 'fill' && l.kind !== 'adjustment' ? unionRect(doc0, { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height }) : doc0;
}

export type MaskMode = 'reveal' | 'hide' | 'revealSelection' | 'hideSelection' | 'transparency';

export function addMask(doc: PixelDoc, mode: MaskMode) {
  const l = doc.active;
  if (!l) throw new UserError('Select a layer');
  if (l.mask) throw new UserError('This layer already has a mask');
  const f = maskFrame(doc, l);
  const c = newCanvas(f.w, f.h);
  const x = ctx2d(c);
  if (mode === 'reveal' || mode === 'hideSelection') { x.fillStyle = '#000'; x.fillRect(0, 0, f.w, f.h); }
  if (mode === 'revealSelection' || mode === 'hideSelection') {
    if (!doc.selection) throw new UserError('Make a selection first');
    x.globalCompositeOperation = mode === 'revealSelection' ? 'source-over' : 'destination-out';
    x.drawImage(doc.selectionCanvas()!, -f.x, -f.y);
  }
  if (mode === 'transparency') {
    if (!l.canvas) throw new UserError('Layer has no pixels');
    x.drawImage(l.canvas, l.x - f.x, l.y - f.y);
  }
  l.mask = { canvas: c, x: f.x, y: f.y, enabled: true };
  doc.commit('Add layer mask');
}

export function deleteMask(doc: PixelDoc) {
  const l = doc.active;
  if (!l?.mask) throw new UserError('This layer has no mask');
  l.mask = null;
  doc.ui.editMask = false;
  doc.commit('Delete layer mask');
}

export function applyMask(doc: PixelDoc) {
  const l = doc.active;
  if (!l?.mask) throw new UserError('This layer has no mask');
  requirePixelLayer(doc, l);
  const c = ctx2d(doc.writable(l));
  c.save();
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(l.mask.canvas, l.mask.x - l.x, l.mask.y - l.y);
  c.restore();
  l.mask = null;
  doc.ui.editMask = false;
  doc.commit('Apply layer mask');
}

export function toggleMask(doc: PixelDoc) {
  const l = doc.active;
  if (!l?.mask) throw new UserError('This layer has no mask');
  l.mask = { ...l.mask, enabled: !l.mask.enabled };
  doc.commit(l.mask.enabled ? 'Enable layer mask' : 'Disable layer mask');
}

// ---------- layer styles ----------

let styleClip: Layer['styles'] = null;
export function copyStyle(doc: PixelDoc) {
  const l = doc.active;
  if (!l?.styles) throw new UserError('This layer has no style to copy');
  styleClip = structuredClone(l.styles);
}
export function pasteStyle(doc: PixelDoc) {
  const l = doc.active;
  if (!l || !styleClip) throw new UserError('Copy a layer style first');
  l.styles = structuredClone(styleClip);
  doc.commit('Paste layer style');
}
export function clearStyle(doc: PixelDoc) {
  const l = doc.active;
  if (!l) return;
  l.styles = null;
  doc.commit('Clear layer style');
}
export const ensureStyles = (l: Layer) => (l.styles ??= defaultStyles());

// ---------- canvas-level geometry ----------

function forEachCanvasLayer(doc: PixelDoc, fn: (l: Layer) => void) { for (const l of doc.layers) fn(l); }

export function imageSize(doc: PixelDoc, w: number, h: number, ppi: number, method: 'smooth' | 'nearest') {
  const sx = w / doc.width, sy = h / doc.height;
  const scaleCanvas = (c: Cnv) => {
    const out = newCanvas(Math.max(1, Math.round(c.width * sx)), Math.max(1, Math.round(c.height * sy)));
    const x = ctx2d(out);
    x.imageSmoothingEnabled = method === 'smooth';
    x.imageSmoothingQuality = 'high';
    x.drawImage(c, 0, 0, out.width, out.height);
    return out;
  };
  forEachCanvasLayer(doc, (l) => {
    if (l.kind === 'text' && l.text) { l.text = { ...l.text, size: Math.max(1, l.text.size * Math.sqrt(sx * sy)) }; l.x = Math.round(l.x * sx); l.y = Math.round(l.y * sy); rerender(l); }
    else if (l.kind === 'shape' && l.shape) {
      const s = l.shape;
      l.shape = { ...s, w: s.w * sx, h: s.h * sy, strokeWidth: s.strokeWidth * Math.sqrt(sx * sy), x1: (s.x1 ?? 0) * sx, x2: (s.x2 ?? 0) * sx, y1: (s.y1 ?? 0) * sy, y2: (s.y2 ?? 0) * sy };
      l.x = Math.round((l.x + s.pad) * sx) - s.pad; l.y = Math.round((l.y + s.pad) * sy) - s.pad;
      rerender(l);
    } else if (l.canvas) { l.canvas = scaleCanvas(l.canvas); l.x = Math.round(l.x * sx); l.y = Math.round(l.y * sy); }
    if (l.mask) l.mask = { ...l.mask, canvas: scaleCanvas(l.mask.canvas), x: Math.round(l.mask.x * sx), y: Math.round(l.mask.y * sy) };
  });
  if (doc.selection) doc.selection = resampleMask(doc.selection, w, h);
  doc.channels = doc.channels.map((c) => ({ ...c, mask: resampleMask(c.mask, w, h) }));
  doc.guides = doc.guides.map((g) => ({ ...g, pos: Math.round(g.pos * (g.axis === 'v' ? sx : sy)) }));
  doc.width = w; doc.height = h; doc.ppi = ppi;
  doc.commit('Image size');
}

export function canvasSize(doc: PixelDoc, w: number, h: number, anchor: number, extension: string | null) {
  const { dx, dy } = anchorOffset(doc.width, doc.height, w, h, anchor);
  const oldW = doc.width, oldH = doc.height;
  forEachCanvasLayer(doc, (l) => { l.x += dx; l.y += dy; if (l.mask) l.mask = { ...l.mask, x: l.mask.x + dx, y: l.mask.y + dy }; });
  if (doc.selection) doc.selection = offsetMask(doc.selection, w, h, dx, dy);
  doc.channels = doc.channels.map((c) => ({ ...c, mask: offsetMask(c.mask, w, h, dx, dy) }));
  doc.guides = doc.guides.map((g) => ({ ...g, pos: g.pos + (g.axis === 'v' ? dx : dy) }));
  doc.width = w; doc.height = h;
  const bottom = doc.childrenOf(null)[0];
  if (extension && bottom && bottom.kind === 'pixel' && !bottom.locked) {
    doc.expandToDoc(bottom);
    const c = ctx2d(doc.writable(bottom));
    c.save();
    c.fillStyle = extension;
    c.beginPath();
    c.rect(-bottom.x, -bottom.y, w, h);
    c.rect(dx - bottom.x + oldW, dy - bottom.y, -oldW, oldH); // hole (opposite winding)
    c.fill('nonzero');
    c.restore();
  }
  doc.commit('Canvas size');
}

/** Rotate the whole canvas: 1 = 90° CW, 2 = 180°, 3 = 90° CCW. Live type/shape layers are rasterized. */
export function rotateCanvas(doc: PixelDoc, q: 1 | 2 | 3) {
  const W = doc.width, H = doc.height;
  forEachCanvasLayer(doc, (l) => {
    if (l.kind === 'text' || l.kind === 'shape') { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; }
    if (l.canvas && l.kind !== 'fill') {
      const r = rotRect({ x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height }, W, H, q);
      l.canvas = rotCanvas(l.canvas, q); l.x = r.x; l.y = r.y;
    }
    if (l.mask) { const r = rotRect({ x: l.mask.x, y: l.mask.y, w: l.mask.canvas.width, h: l.mask.canvas.height }, W, H, q); l.mask = { ...l.mask, canvas: rotCanvas(l.mask.canvas, q), x: r.x, y: r.y }; }
  });
  if (doc.selection) doc.selection = rotateMask(doc.selection, q);
  doc.channels = doc.channels.map((c) => ({ ...c, mask: rotateMask(c.mask, q) }));
  doc.guides = [];
  if (q !== 2) { doc.width = H; doc.height = W; }
  doc.commit(q === 1 ? 'Rotate 90° CW' : q === 2 ? 'Rotate 180°' : 'Rotate 90° CCW');
}

function rotRect(r: RectLike, W: number, H: number, q: 1 | 2 | 3): RectLike {
  if (q === 1) return { x: H - (r.y + r.h), y: r.x, w: r.h, h: r.w };
  if (q === 2) return { x: W - (r.x + r.w), y: H - (r.y + r.h), w: r.w, h: r.h };
  return { x: r.y, y: W - (r.x + r.w), w: r.h, h: r.w };
}

export function rotCanvas(c: Cnv, q: 1 | 2 | 3): Cnv {
  const out = q === 2 ? newCanvas(c.width, c.height) : newCanvas(c.height, c.width);
  const x = ctx2d(out);
  if (q === 1) { x.translate(c.height, 0); x.rotate(Math.PI / 2); }
  else if (q === 2) { x.translate(c.width, c.height); x.rotate(Math.PI); }
  else { x.translate(0, c.width); x.rotate(-Math.PI / 2); }
  x.drawImage(c, 0, 0);
  return out;
}

export function flipCanvasImg(c: Cnv, horizontal: boolean): Cnv {
  const out = newCanvas(c.width, c.height);
  const x = ctx2d(out);
  if (horizontal) { x.translate(c.width, 0); x.scale(-1, 1); } else { x.translate(0, c.height); x.scale(1, -1); }
  x.drawImage(c, 0, 0);
  return out;
}

export function flipCanvas(doc: PixelDoc, horizontal: boolean) {
  const W = doc.width, H = doc.height;
  forEachCanvasLayer(doc, (l) => {
    if (l.kind === 'text' || l.kind === 'shape') { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; }
    if (l.canvas && l.kind !== 'fill') {
      if (horizontal) l.x = W - (l.x + l.canvas.width); else l.y = H - (l.y + l.canvas.height);
      l.canvas = flipCanvasImg(l.canvas, horizontal);
    }
    if (l.mask) {
      const m = l.mask;
      l.mask = { ...m, canvas: flipCanvasImg(m.canvas, horizontal), x: horizontal ? W - (m.x + m.canvas.width) : m.x, y: horizontal ? m.y : H - (m.y + m.canvas.height) };
    }
  });
  if (doc.selection) doc.selection = flipMask(doc.selection, horizontal);
  doc.channels = doc.channels.map((c) => ({ ...c, mask: flipMask(c.mask, horizontal) }));
  doc.commit(horizontal ? 'Flip canvas horizontal' : 'Flip canvas vertical');
}

/** Flip or rotate only the active layer (Edit › Transform). */
export function transformLayerSimple(doc: PixelDoc, op: 'flipH' | 'flipV' | 'r90' | 'r180' | 'r270') {
  const l = doc.active;
  if (!l || !l.canvas || l.kind === 'group' || l.kind === 'adjustment' || l.kind === 'fill') throw new UserError('Select a layer with pixels');
  if (l.locked) throw new UserError(`“${l.name}” is locked`);
  if (l.kind === 'text' || l.kind === 'shape') { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; }
  const cx = l.x + l.canvas.width / 2, cy = l.y + l.canvas.height / 2;
  l.canvas = op === 'flipH' ? flipCanvasImg(l.canvas, true) : op === 'flipV' ? flipCanvasImg(l.canvas, false) : rotCanvas(l.canvas, op === 'r90' ? 1 : op === 'r180' ? 2 : 3);
  l.x = Math.round(cx - l.canvas.width / 2);
  l.y = Math.round(cy - l.canvas.height / 2);
  doc.commit({ flipH: 'Flip horizontal', flipV: 'Flip vertical', r90: 'Rotate 90° CW', r180: 'Rotate 180°', r270: 'Rotate 90° CCW' }[op]);
}

/** Rotate canvas by an arbitrary angle (degrees), growing the canvas to fit. */
export function rotateArbitrary(doc: PixelDoc, deg: number) {
  const a = (deg * Math.PI) / 180;
  const b = transformedBounds(doc.width, doc.height, doc.width / 2, doc.height / 2, 1, 1, a);
  const rot = (c: Cnv, x: number, y: number) => {
    const cb = transformedBounds(c.width, c.height, x + c.width / 2, y + c.height / 2, 1, 1, a);
    const out = newCanvas(cb.w, cb.h);
    const o = ctx2d(out);
    o.imageSmoothingQuality = 'high';
    o.translate(x + c.width / 2 - cb.x, y + c.height / 2 - cb.y);
    o.rotate(a);
    o.drawImage(c, -c.width / 2, -c.height / 2);
    return { canvas: out, x: cb.x - b.x, y: cb.y - b.y };
  };
  forEachCanvasLayer(doc, (l) => {
    if (l.kind === 'text' || l.kind === 'shape') { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; }
    if (l.canvas && l.kind !== 'fill') { const r = rot(l.canvas, l.x, l.y); l.canvas = r.canvas; l.x = r.x; l.y = r.y; }
    if (l.mask) { const r = rot(l.mask.canvas, l.mask.x, l.mask.y); l.mask = { ...l.mask, canvas: r.canvas, x: r.x, y: r.y }; }
  });
  doc.selection = null;
  doc.guides = [];
  doc.width = b.w; doc.height = b.h;
  doc.commit(`Rotate ${deg}°`);
}

export function cropTo(doc: PixelDoc, r: RectLike, deletePixels = true, label = 'Crop') {
  const rect = { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
  forEachCanvasLayer(doc, (l) => {
    l.x -= rect.x; l.y -= rect.y;
    if (l.mask) l.mask = { ...l.mask, x: l.mask.x - rect.x, y: l.mask.y - rect.y };
    if (deletePixels && l.kind === 'pixel' && l.canvas) {
      const ir = intersectRect({ x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height }, { x: 0, y: 0, w: rect.w, h: rect.h });
      const out = newCanvas(ir?.w ?? 1, ir?.h ?? 1);
      if (ir) ctx2d(out).drawImage(l.canvas, l.x - ir.x, l.y - ir.y);
      l.canvas = out; l.x = ir?.x ?? 0; l.y = ir?.y ?? 0;
    }
  });
  if (doc.selection) doc.selection = offsetMask(doc.selection, rect.w, rect.h, -rect.x, -rect.y);
  doc.channels = doc.channels.map((c) => ({ ...c, mask: offsetMask(c.mask, rect.w, rect.h, -rect.x, -rect.y) }));
  doc.guides = doc.guides.map((g) => ({ ...g, pos: g.pos - (g.axis === 'v' ? rect.x : rect.y) }));
  doc.width = rect.w; doc.height = rect.h;
  if (doc.selection && isEmpty(doc.selection)) doc.selection = null;
  doc.commit(label);
}

export function trim(doc: PixelDoc, basedOn: 'transparent' | 'topLeft' | 'bottomRight') {
  const flat = flattenCopy(doc);
  const img = getImg(flat);
  const d = img.data, w = img.width, h = img.height;
  const ref = basedOn === 'bottomRight' ? (w * h - 1) * 4 : 0;
  const keep = (i: number) => basedOn === 'transparent' ? d[i + 3] > 0
    : Math.abs(d[i] - d[ref]) + Math.abs(d[i + 1] - d[ref + 1]) + Math.abs(d[i + 2] - d[ref + 2]) + Math.abs(d[i + 3] - d[ref + 3]) > 0;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (keep((y * w + x) * 4)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  if (x1 < 0) throw new UserError('Nothing to trim — the image would be empty');
  cropTo(doc, { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, true, 'Trim');
}

export function revealAll(doc: PixelDoc) {
  let r: RectLike = { x: 0, y: 0, w: doc.width, h: doc.height };
  for (const l of doc.layers) if (l.canvas && l.kind !== 'fill') r = unionRect(r, { x: l.x, y: l.y, w: l.canvas.width, h: l.canvas.height });
  if (r.x === 0 && r.y === 0 && r.w === doc.width && r.h === doc.height) throw new UserError('All pixels are already visible');
  cropTo(doc, r, false, 'Reveal all');
}

// ---------- selection ----------

export function selectAll(doc: PixelDoc) { doc.setSelection(fullMask(doc.width, doc.height)); doc.commit('Select all'); }
export function deselect(doc: PixelDoc) { if (!doc.selection) return; doc.setSelection(null); doc.commit('Deselect'); }
export function reselect(doc: PixelDoc) {
  const m = doc.lastSelection;
  if (!m || m.w !== doc.width || m.h !== doc.height) throw new UserError('No previous selection');
  doc.setSelection(m);
  doc.commit('Reselect');
}
export function inverse(doc: PixelDoc) {
  doc.setSelection(doc.selection ? invertMask(doc.selection) : fullMask(doc.width, doc.height));
  doc.commit('Select inverse');
}

export function modifySelection(doc: PixelDoc, kind: 'expand' | 'contract' | 'feather' | 'border' | 'smooth', amount: number) {
  const s = doc.selection;
  if (!s) throw new UserError('Make a selection first');
  const m = kind === 'expand' ? expandMask(s, amount) : kind === 'contract' ? contractMask(s, amount) : kind === 'feather' ? featherMask(s, amount) : kind === 'border' ? borderMask(s, amount) : smoothMask(s, amount);
  doc.setSelection(isEmpty(m) ? null : m);
  doc.commit({ expand: 'Expand selection', contract: 'Contract selection', feather: 'Feather', border: 'Border', smooth: 'Smooth selection' }[kind]);
}

/** Image used for sampling-based selections: the active layer framed to the document, or the merged image. */
export function sampleImage(doc: PixelDoc, all: boolean): Img {
  const l = doc.active;
  if (all || !l || !l.canvas || l.kind === 'group' || l.kind === 'adjustment') return getImg(composite(doc));
  return getImg(doc.layerDocCanvas(l));
}

export function selectionFromLayer(doc: PixelDoc, l: Layer) {
  if (!l.canvas) throw new UserError('Layer has no pixels');
  doc.setSelection(canvasAlphaToMask(l.canvas, doc.width, doc.height, l.x, l.y));
  doc.commit('Load selection');
}

export function saveSelectionChannel(doc: PixelDoc, name?: string) {
  if (!doc.selection) throw new UserError('Make a selection first');
  doc.channels = [...doc.channels, { id: Math.random().toString(36).slice(2), name: name || `Alpha ${doc.channels.length + 1}`, mask: doc.selection }];
  doc.commit('Save selection');
}

export function loadSelectionChannel(doc: PixelDoc, id: string, op: 'replace' | 'add' | 'subtract' | 'intersect' = 'replace') {
  const ch = doc.channels.find((c) => c.id === id);
  if (!ch) throw new UserError('Channel not found');
  doc.setSelection(combine(doc.selection, ch.mask, op));
  doc.commit('Load selection');
}

// ---------- align ----------

export function alignLayer(doc: PixelDoc, how: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom') {
  const l = doc.active;
  if (!l || !l.canvas || l.kind === 'group' || l.kind === 'adjustment' || l.kind === 'fill') throw new UserError('Select a layer with pixels');
  if (l.locked) throw new UserError(`“${l.name}” is locked`);
  const b = contentBounds(l.canvas);
  if (!b) throw new UserError('Layer is empty');
  const target: Rect = (doc.selection && maskBounds(doc.selection)) || { x: 0, y: 0, w: doc.width, h: doc.height };
  const cx = l.x + b.x, cy = l.y + b.y;
  if (how === 'left') l.x += target.x - cx;
  if (how === 'right') l.x += target.x + target.w - (cx + b.w);
  if (how === 'hcenter') l.x += Math.round(target.x + target.w / 2 - (cx + b.w / 2));
  if (how === 'top') l.y += target.y - cy;
  if (how === 'bottom') l.y += target.y + target.h - (cy + b.h);
  if (how === 'vcenter') l.y += Math.round(target.y + target.h / 2 - (cy + b.h / 2));
  doc.commit('Align');
}

/** Visible-content bounds of a layer in doc coordinates. */
export function layerBounds(l: Layer): RectLike | null {
  if (!l.canvas) return null;
  const b = contentBounds(l.canvas);
  return b ? { x: l.x + b.x, y: l.y + b.y, w: b.w, h: b.h } : null;
}

