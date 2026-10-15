// Layer-stack compositing (Canvas2D). Groups render isolated; adjustment layers run on the CPU.
import { applyAdjust } from './adjust';
import { compositeOp } from './blend';
import { clearCanvas, ctx2d, newCanvas, putImg, type Cnv } from './canvas';
import { hasStyles, type Layer, type LayerStyles, type PixelDoc } from './doc';

const caches = new WeakMap<PixelDoc, Map<number, { rev: number; w: number; h: number; canvas: Cnv }>>();
const pools = new WeakMap<PixelDoc, Map<number, Cnv[]>>();

/** Render state: `k` scales document pixels to output pixels (view composites render below 100%). */
interface RC { k: number; w: number; h: number; opts: { exclude?: string; only?: Set<string> } }

const rc = (doc: PixelDoc, k = 1, opts: RC['opts'] = {}): RC =>
  ({ k, w: Math.max(1, Math.round(doc.width * k)), h: Math.max(1, Math.round(doc.height * k)), opts });

function pool(doc: PixelDoc, r: RC, i: number): Cnv {
  let m = pools.get(doc);
  if (!m) { m = new Map(); pools.set(doc, m); }
  let p = m.get(r.k);
  if (!p) { p = []; m.set(r.k, p); }
  let c = p[i];
  if (!c || c.width !== r.w || c.height !== r.h) { c = newCanvas(r.w, r.h); p[i] = c; }
  clearCanvas(c);
  return c;
}

/** Draw a doc-space canvas positioned at (x, y) into an output context. */
function put(ctx: CanvasRenderingContext2D, r: RC, c: Cnv, x: number, y: number) {
  if (r.k === 1) ctx.drawImage(c, x, y);
  else {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(c, x * r.k, y * r.k, c.width * r.k, c.height * r.k);
  }
}

/** Release cached canvases (e.g. when a document closes). */
export function releaseComposite(doc: PixelDoc) { caches.delete(doc); pools.delete(doc); }

/** Flattened document (cached by pixelRev). Do not draw into the returned canvas. */
export function composite(doc: PixelDoc): Cnv { return compositeView(doc, 1); }

/**
 * Flattened document at scale `k` (≤ 1) for on-screen display: zoomed-out views of big images composite far fewer
 * pixels (adjustment layers, masks and styles included). Cached per scale by pixelRev. Do not draw into it.
 */
export function compositeView(doc: PixelDoc, k: number): Cnv {
  const r = rc(doc, k);
  let m = caches.get(doc);
  if (!m) { m = new Map(); caches.set(doc, m); }
  const c = m.get(k);
  if (c && c.rev === doc.pixelRev && c.w === r.w && c.h === r.h) return c.canvas;
  const out = c && c.w === r.w && c.h === r.h ? c.canvas : newCanvas(r.w, r.h);
  clearCanvas(out);
  renderChildren(doc, null, ctx2d(out), 0, r);
  m.set(k, { rev: doc.pixelRev, w: r.w, h: r.h, canvas: out });
  return out;
}

/** A fresh flattened copy (export, merge visible, sample-all). `exclude` hides one layer. */
export function flattenCopy(doc: PixelDoc, opts: { exclude?: string; only?: Set<string> } = {}): Cnv {
  const out = newCanvas(doc.width, doc.height);
  renderChildren(doc, null, ctx2d(out), 0, rc(doc, 1, opts));
  return out;
}

function renderChildren(doc: PixelDoc, parentId: string | null, ctx: CanvasRenderingContext2D, depth: number, r: RC) {
  for (const l of doc.childrenOf(parentId)) {
    if (!l.visible || l.id === r.opts.exclude) continue;
    if (r.opts.only && !r.opts.only.has(l.id) && l.kind !== 'group') continue;
    drawLayer(doc, l, ctx, depth, r);
  }
}

function layerSource(doc: PixelDoc, l: Layer): { canvas: Cnv; x: number; y: number } | null {
  const o = doc.override;
  if (o && o.layerId === l.id && o.target === 'pixels') return o.render();
  return l.canvas ? { canvas: l.canvas, x: l.x, y: l.y } : null;
}

function maskSource(doc: PixelDoc, l: Layer): { canvas: Cnv; x: number; y: number } | null {
  const o = doc.override;
  if (o && o.layerId === l.id && o.target === 'mask') return o.render();
  if (!l.mask || !l.mask.enabled) return null;
  return l.mask;
}

function drawLayer(doc: PixelDoc, l: Layer, ctx: CanvasRenderingContext2D, depth: number, r: RC) {
  const base = depth * 4 + 1;
  const mask = maskSource(doc, l);
  if (l.kind === 'group') {
    const g = pool(doc, r, base);
    renderChildren(doc, l.id, ctx2d(g), depth + 1, r);
    finish(doc, l, ctx, g, mask, base, r);
    return;
  }
  if (l.kind === 'adjustment') {
    const spec = doc.adjustOverride?.layerId === l.id ? doc.adjustOverride.spec : l.adjust;
    if (!spec) return;
    const t = pool(doc, r, base);
    const below = ctx.getImageData(0, 0, r.w, r.h);
    putImg(t, applyAdjust(below, spec));
    finish(doc, l, ctx, t, mask, base, r);
    return;
  }
  if (l.kind === 'fill') {
    const t = pool(doc, r, base);
    const x = ctx2d(t);
    x.fillStyle = l.fillColor ?? '#000';
    x.fillRect(0, 0, t.width, t.height);
    finish(doc, l, ctx, t, mask, base, r);
    return;
  }
  const src = layerSource(doc, l);
  if (!src) return;
  if (!mask && !hasStyles(l.styles)) {
    ctx.save();
    ctx.globalAlpha = l.opacity;
    ctx.globalCompositeOperation = compositeOp(l.blend);
    put(ctx, r, src.canvas, src.x, src.y);
    ctx.restore();
    return;
  }
  const t = pool(doc, r, base);
  put(ctx2d(t), r, src.canvas, src.x, src.y);
  finish(doc, l, ctx, t, mask, base, r);
}

/** Apply mask + styles to an output-sized content canvas and draw it with the layer's opacity and blend. */
function finish(doc: PixelDoc, l: Layer, ctx: CanvasRenderingContext2D, content: Cnv, mask: { canvas: Cnv; x: number; y: number } | null, base: number, r: RC) {
  const cx = ctx2d(content);
  if (mask) {
    cx.save();
    cx.globalCompositeOperation = 'destination-in';
    put(cx, r, mask.canvas, mask.x, mask.y);
    cx.restore();
  }
  if (l.styles && hasStyles(l.styles)) drawUnderEffects(doc, ctx, content, l.styles, l.opacity, base, r);
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

/** Drop shadow, outer glow and (outside) stroke are drawn beneath the layer content. Sizes scale with `r.k`. */
function drawUnderEffects(doc: PixelDoc, ctx: CanvasRenderingContext2D, content: Cnv, s: LayerStyles, layerOpacity: number, base: number, r: RC) {
  const k = r.k;
  if (s.dropShadow.enabled) {
    const d = s.dropShadow;
    const a = (d.angle * Math.PI) / 180;
    ctx.save();
    ctx.globalCompositeOperation = compositeOp(d.blend);
    ctx.globalAlpha = layerOpacity;
    ctx.shadowColor = rgba(d.color, d.opacity);
    ctx.shadowBlur = d.size * k;
    ctx.shadowOffsetX = FAR - Math.cos(a) * d.distance * k;
    ctx.shadowOffsetY = Math.sin(a) * d.distance * k;
    ctx.drawImage(content, -FAR, 0);
    ctx.restore();
  }
  if (s.outerGlow.enabled) {
    const g = s.outerGlow;
    ctx.save();
    ctx.globalCompositeOperation = compositeOp(g.blend);
    ctx.globalAlpha = layerOpacity;
    ctx.shadowColor = rgba(g.color, g.opacity);
    ctx.shadowBlur = g.size * k;
    ctx.shadowOffsetX = FAR;
    ctx.drawImage(content, -FAR, 0);
    ctx.drawImage(content, -FAR, 0);
    ctx.restore();
  }
  if (s.stroke.enabled && s.stroke.size > 0) {
    const st = s.stroke;
    // silhouette tinted with the stroke color
    const sil = pool(doc, r, base + 1);
    const sx = ctx2d(sil);
    sx.drawImage(content, 0, 0);
    sx.globalCompositeOperation = 'source-in';
    sx.fillStyle = st.color;
    sx.fillRect(0, 0, sil.width, sil.height);
    sx.globalCompositeOperation = 'source-over';
    // dilate by stamping the silhouette around circles of decreasing radius
    const ring = pool(doc, r, base + 2);
    const rx = ctx2d(ring);
    const rad = st.size * k;
    for (let rr = rad; rr > 0; rr -= Math.max(k, rad / 3)) {
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
  try { drawLayer(doc, l, ctx2d(out), 6, rc(doc)); } finally { l.opacity = saved.opacity; l.blend = saved.blend; }
  return out;
}
