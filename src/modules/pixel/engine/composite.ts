// Layer-stack compositing (Canvas2D). Groups render isolated; adjustment layers run on the CPU.
import { applyAdjust } from './adjust';
import { compositeOp } from './blend';
import { clearCanvas, ctx2d, newCanvas, putImg, type Cnv } from './canvas';
import { hasStyles, type Layer, type LayerStyles, type PixelDoc } from './doc';

const caches = new WeakMap<PixelDoc, { rev: number; w: number; h: number; canvas: Cnv }>();
const pools = new WeakMap<PixelDoc, Cnv[]>();

function pool(doc: PixelDoc, i: number): Cnv {
  let p = pools.get(doc);
  if (!p) { p = []; pools.set(doc, p); }
  let c = p[i];
  if (!c || c.width !== doc.width || c.height !== doc.height) { c = newCanvas(doc.width, doc.height); p[i] = c; }
  clearCanvas(c);
  return c;
}

/** Release cached canvases (e.g. when a document closes). */
export function releaseComposite(doc: PixelDoc) { caches.delete(doc); pools.delete(doc); }

/** Flattened document (cached by pixelRev). Do not draw into the returned canvas. */
export function composite(doc: PixelDoc): Cnv {
  const c = caches.get(doc);
  if (c && c.rev === doc.pixelRev && c.w === doc.width && c.h === doc.height) return c.canvas;
  const out = c && c.w === doc.width && c.h === doc.height ? c.canvas : newCanvas(doc.width, doc.height);
  clearCanvas(out);
  renderChildren(doc, null, ctx2d(out), 0);
  caches.set(doc, { rev: doc.pixelRev, w: doc.width, h: doc.height, canvas: out });
  return out;
}

/** A fresh flattened copy (export, merge visible, sample-all). `exclude` hides one layer. */
export function flattenCopy(doc: PixelDoc, opts: { exclude?: string; only?: Set<string> } = {}): Cnv {
  const out = newCanvas(doc.width, doc.height);
  renderChildren(doc, null, ctx2d(out), 0, opts);
  return out;
}

function renderChildren(doc: PixelDoc, parentId: string | null, ctx: CanvasRenderingContext2D, depth: number, opts: { exclude?: string; only?: Set<string> } = {}) {
  for (const l of doc.childrenOf(parentId)) {
    if (!l.visible || l.id === opts.exclude) continue;
    if (opts.only && !opts.only.has(l.id) && l.kind !== 'group') continue;
    drawLayer(doc, l, ctx, depth, opts);
  }
}

function layerSource(doc: PixelDoc, l: Layer): { canvas: Cnv; x: number; y: number } | null {
  const o = doc.override;
  if (o && o.layerId === l.id && o.target === 'pixels') return o.render();
  if (l.kind === 'fill') {
    const c = pool(doc, 999);
    const x = ctx2d(c);
    x.fillStyle = l.fillColor ?? '#000';
    x.fillRect(0, 0, c.width, c.height);
    return { canvas: c, x: 0, y: 0 };
  }
  return l.canvas ? { canvas: l.canvas, x: l.x, y: l.y } : null;
}

function maskSource(doc: PixelDoc, l: Layer): { canvas: Cnv; x: number; y: number } | null {
  const o = doc.override;
  if (o && o.layerId === l.id && o.target === 'mask') return o.render();
  if (!l.mask || !l.mask.enabled) return null;
  return l.mask;
}

function drawLayer(doc: PixelDoc, l: Layer, ctx: CanvasRenderingContext2D, depth: number, opts: { exclude?: string; only?: Set<string> }) {
  const base = depth * 4 + 1;
  const mask = maskSource(doc, l);
  if (l.kind === 'group') {
    const g = pool(doc, base);
    renderChildren(doc, l.id, ctx2d(g), depth + 1, opts);
    finish(doc, l, ctx, g, mask, base);
    return;
  }
  if (l.kind === 'adjustment') {
    const spec = doc.adjustOverride?.layerId === l.id ? doc.adjustOverride.spec : l.adjust;
    if (!spec) return;
    const t = pool(doc, base);
    const below = ctx.getImageData(0, 0, doc.width, doc.height);
    putImg(t, applyAdjust(below, spec));
    finish(doc, l, ctx, t, mask, base);
    return;
  }
  const src = layerSource(doc, l);
  if (!src) return;
  if (!mask && !hasStyles(l.styles)) {
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = compositeOp(l.blend);
    ctx.drawImage(src.canvas, src.x, src.y);
    ctx.restore();
    return;
  }
  const t = pool(doc, base);
  ctx2d(t).drawImage(src.canvas, src.x, src.y);
  finish(doc, l, ctx, t, mask, base);
}

/** Apply mask + styles to a doc-sized content canvas and draw it with the layer's opacity and blend. */
function finish(doc: PixelDoc, l: Layer, ctx: CanvasRenderingContext2D, content: Cnv, mask: { canvas: Cnv; x: number; y: number } | null, base: number) {
  const cx = ctx2d(content);
  if (mask) {
    cx.save();
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(mask.canvas, mask.x, mask.y);
    cx.restore();
  }
  if (l.styles && hasStyles(l.styles)) drawUnderEffects(doc, ctx, content, l.styles, l.opacity, base);
  if (l.styles?.colorOverlay.enabled) {
    const co = l.styles.colorOverlay;
    cx.save();
    cx.globalCompositeOperation = 'source-atop';
    cx.globalAlpha = co.opacity;
    cx.fillStyle = co.color;
    cx.fillRect(0, 0, content.width, content.height);
    cx.restore();
  }
  ctx.save();
  ctx.globalAlpha = l.opacity;
  ctx.globalCompositeOperation = compositeOp(l.blend);
  ctx.drawImage(content, 0, 0);
  ctx.restore();
}

const FAR = 100000;

/** Drop shadow, outer glow and (outside) stroke are drawn beneath the layer content. */
function drawUnderEffects(doc: PixelDoc, ctx: CanvasRenderingContext2D, content: Cnv, s: LayerStyles, layerOpacity: number, base: number) {
  if (s.dropShadow.enabled) {
    const d = s.dropShadow;
    const a = (d.angle * Math.PI) / 180;
    ctx.save();
    ctx.globalCompositeOperation = compositeOp(d.blend);
    ctx.globalAlpha = layerOpacity;
    ctx.shadowColor = rgba(d.color, d.opacity);
    ctx.shadowBlur = d.size;
    ctx.shadowOffsetX = FAR - Math.cos(a) * d.distance;
    ctx.shadowOffsetY = Math.sin(a) * d.distance;
    ctx.drawImage(content, -FAR, 0);
    ctx.restore();
  }
  if (s.outerGlow.enabled) {
    const g = s.outerGlow;
    ctx.save();
    ctx.globalCompositeOperation = compositeOp(g.blend);
    ctx.globalAlpha = layerOpacity;
    ctx.shadowColor = rgba(g.color, g.opacity);
    ctx.shadowBlur = g.size;
    ctx.shadowOffsetX = FAR;
    ctx.drawImage(content, -FAR, 0);
    ctx.drawImage(content, -FAR, 0);
    ctx.restore();
  }
  if (s.stroke.enabled && s.stroke.size > 0) {
    const st = s.stroke;
    // silhouette tinted with the stroke color
    const sil = pool(doc, base + 1);
    const sx = ctx2d(sil);
    sx.drawImage(content, 0, 0);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = st.color;
    sx.fillRect(0, 0, sil.width, sil.height);
    sx.globalCompositeOperation = 'source-over';
    // dilate by stamping the silhouette around circles of decreasing radius
    const ring = pool(doc, base + 2);
    const rx = ctx2d(ring);
    const r = st.size;
    for (let rr = r; rr > 0; rr -= Math.max(1, r / 3)) {
      const n = Math.min(64, Math.max(8, Math.ceil((2 * Math.PI * rr) / 1.5)));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        rx.drawImage(sil, Math.cos(a) * rr, Math.sin(a) * rr);
      }
    }
    rx.globalCompositeOperation = 'destination-out';
    rx.drawImage(content, 0, 0);
    rx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.globalAlpha = layerOpacity * st.opacity;
    ctx.drawImage(ring, 0, 0);
    ctx.restore();
  }
}

export function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Bake a single layer (mask + styles) into a doc-sized canvas (Rasterize › Layer style, merge). */
export function renderLayerAlone(doc: PixelDoc, l: Layer): Cnv {
  const out = newCanvas(doc.width, doc.height);
  const saved = { opacity: l.opacity, blend: l.blend };
  l.opacity = 1;
  l.blend = 'normal';
  try { drawLayer(doc, l, ctx2d(out), 6, {}); } finally { l.opacity = saved.opacity; l.blend = saved.blend; }
  return out;
}
