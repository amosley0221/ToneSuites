// Brush engine: stroke buffer (coverage) for brush/pencil/eraser/clone/history, and per-dab retouch tools.
import { clearCanvas, ctx2d, newCanvas, type Cnv } from './canvas';
import type { Layer, PixelDoc } from './doc';
import { clamp, hslToRgb, luma, rgbToHsl } from './img';

export interface TipOpts { size: number; hardness: number; roundness: number; angle: number; aliased: boolean }

const tipCache = new Map<string, Cnv>();

/** Black brush tip (alpha = coverage) for a given size/hardness. */
export function brushTip(o: TipOpts): Cnv {
  const size = Math.max(1, Math.round(o.size));
  const key = `${size}|${o.hardness}|${o.roundness}|${o.angle}|${o.aliased}`;
  let c = tipCache.get(key);
  if (c) return c;
  if (tipCache.size > 64) tipCache.clear();
  c = newCanvas(size, size);
  const x = ctx2d(c);
  const r = size / 2;
  x.translate(r, r);
  x.rotate((o.angle * Math.PI) / 180);
  x.scale(1, Math.max(0.05, o.roundness / 100));
  if (o.aliased) {
    // pixel-exact disc for the pencil
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.fillStyle = '#000';
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const dx = px + 0.5 - r, dy = (py + 0.5 - r) / Math.max(0.05, o.roundness / 100);
      if (dx * dx + dy * dy <= r * r || size <= 2) x.fillRect(px, py, 1, 1);
    }
  } else {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, r);
    const h = clamp(o.hardness / 100, 0, 0.99);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(h, 'rgba(0,0,0,1)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(0, 0, r, 0, Math.PI * 2);
    x.fill();
  }
  tipCache.set(key, c);
  return c;
}

/**
 * Where to draw a clone/history source canvas (positioned at canvasX/Y in doc space) inside a stroke target at fx/fy,
 * so that the pixel painted at doc point p comes from the source at p - off (off = stroke start - clone source point).
 */
export function cloneSourceOrigin(canvasX: number, canvasY: number, offX: number, offY: number, fx: number, fy: number) {
  return { x: canvasX + offX - fx, y: canvasY + offY - fy };
}

interface Clip { x: number; y: number; w: number; h: number }

export interface StrokeOpts extends TipOpts {
  mode: 'paint' | 'erase' | 'clone' | 'history';
  color: string;
  opacity: number; // 0..1
  flow: number; // 0..1
  spacing: number; // fraction of size
  pressureSize: boolean;
  pressureOpacity: boolean;
}

/** Brush stroke accumulated in a coverage buffer; previewed live and applied once on commit. */
export class BufferedStroke {
  readonly coverage: Cnv;
  private preview: Cnv;
  private colored: Cnv;
  private last: { x: number; y: number; p: number } | null = null;
  private dist = 0;
  /** Doc position of the target canvas. */
  readonly fx: number;
  readonly fy: number;
  private source: { canvas: Cnv; dx: number; dy: number } | null = null;
  private target: Cnv;

  constructor(private doc: PixelDoc, readonly layer: Layer, readonly onMask: boolean, private o: StrokeOpts) {
    if (onMask) {
      const m = doc.writableMask(layer);
      this.target = m.canvas; this.fx = m.x; this.fy = m.y;
    } else {
      doc.expandToDoc(layer);
      this.target = doc.writable(layer); this.fx = layer.x; this.fy = layer.y;
    }
    this.coverage = newCanvas(this.target.width, this.target.height);
    this.preview = newCanvas(this.target.width, this.target.height);
    this.colored = newCanvas(this.target.width, this.target.height);
  }

  /** Clone source: canvas positioned in doc space, sampled with an offset (doc units). */
  setSource(canvas: Cnv, canvasX: number, canvasY: number, offX: number, offY: number) {
    const o = cloneSourceOrigin(canvasX, canvasY, offX, offY, this.fx, this.fy);
    this.source = { canvas, dx: o.x, dy: o.y };
  }

  private dab(x: number, y: number, p: number) {
    const o = this.o;
    const size = Math.max(1, o.size * (o.pressureSize ? Math.max(0.05, p) : 1));
    const tip = brushTip({ ...o, size });
    const c = ctx2d(this.coverage);
    c.globalAlpha = clamp(o.flow * (o.pressureOpacity ? p : 1), 0, 1);
    const s = tip.width;
    const dx0 = Math.floor(x - this.fx - s / 2) - 2, dy0 = Math.floor(y - this.fy - s / 2) - 2;
    const d = this.dirty;
    this.dirty = d
      ? { x0: Math.min(d.x0, dx0), y0: Math.min(d.y0, dy0), x1: Math.max(d.x1, dx0 + s + 4), y1: Math.max(d.y1, dy0 + s + 4) }
      : { x0: dx0, y0: dy0, x1: dx0 + s + 4, y1: dy0 + s + 4 };
    c.drawImage(tip, o.aliased ? Math.round(x - this.fx - s / 2) : x - this.fx - s / 2, o.aliased ? Math.round(y - this.fy - s / 2) : y - this.fy - s / 2);
  }

  to(x: number, y: number, p: number) {
    if (!this.last) { this.dab(x, y, p); this.last = { x, y, p }; return; }
    const step = Math.max(1, this.o.size * this.o.spacing);
    const dx = x - this.last.x, dy = y - this.last.y;
    const len = Math.hypot(dx, dy);
    let t = step - this.dist;
    while (t <= len) {
      const k = t / len;
      this.dab(this.last.x + dx * k, this.last.y + dy * k, this.last.p + (p - this.last.p) * k);
      t += step;
    }
    this.dist = len - (t - step);
    this.last = { x, y, p };
  }

  /** Coverage area changed since the last render (target-local px); render() only redraws it. */
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private rendered = false;

  private colorize(clip?: Clip): Cnv {
    const col = this.colored;
    const c = ctx2d(col);
    c.save();
    if (clip) { c.clearRect(clip.x, clip.y, clip.w, clip.h); c.beginPath(); c.rect(clip.x, clip.y, clip.w, clip.h); c.clip(); }
    else clearCanvas(col);
    c.drawImage(this.coverage, 0, 0);
    const sel = this.doc.selectionCanvas();
    if (sel) { c.globalCompositeOperation = 'destination-in'; c.drawImage(sel, -this.fx, -this.fy); }
    c.globalCompositeOperation = 'source-in';
    if ((this.o.mode === 'clone' || this.o.mode === 'history') && this.source) c.drawImage(this.source.canvas, this.source.dx, this.source.dy);
    else { c.fillStyle = this.onMask ? '#000' : this.o.color; c.fillRect(0, 0, col.width, col.height); }
    c.restore();
    return col;
  }

  private applyTo(ctx: CanvasRenderingContext2D, clip?: Clip) {
    const col = this.colorize(clip);
    ctx.save();
    if (clip) { ctx.beginPath(); ctx.rect(clip.x, clip.y, clip.w, clip.h); ctx.clip(); }
    if (this.onMask) {
      // mask value from paint color luminance: white reveals, black hides
      const v = this.o.mode === 'erase' ? 1 : luma(...hexRgb(this.o.color)) / 255;
      ctx.globalAlpha = this.o.opacity;
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(col, 0, 0);
      if (v > 0) { ctx.globalAlpha = this.o.opacity * v; ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(col, 0, 0); }
    } else {
      ctx.globalAlpha = this.o.opacity;
      ctx.globalCompositeOperation = this.o.mode === 'erase' ? 'destination-out' : 'source-over';
      ctx.drawImage(col, 0, 0);
    }
    ctx.restore();
  }

  render(): { canvas: Cnv; x: number; y: number } {
    const p = ctx2d(this.preview);
    if (!this.rendered) {
      clearCanvas(this.preview);
      p.drawImage(this.target, 0, 0);
      this.applyTo(p);
      this.rendered = true;
    } else if (this.dirty) {
      // only the area the new dabs touched (big canvases stay fast while painting)
      const d = this.dirty;
      const x0 = Math.max(0, d.x0), y0 = Math.max(0, d.y0), x1 = Math.min(this.preview.width, d.x1), y1 = Math.min(this.preview.height, d.y1);
      if (x1 > x0 && y1 > y0) {
        const clip = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
        p.save();
        p.clearRect(clip.x, clip.y, clip.w, clip.h);
        p.beginPath(); p.rect(clip.x, clip.y, clip.w, clip.h); p.clip();
        p.drawImage(this.target, 0, 0);
        p.restore();
        this.applyTo(p, clip);
      }
    }
    this.dirty = null;
    return { canvas: this.preview, x: this.fx, y: this.fy };
  }

  commit() {
    this.applyTo(ctx2d(this.target));
  }
}

export function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------- retouch tools (blur / sharpen / smudge / dodge / burn / sponge) ----------

export type RetouchMode = 'blur' | 'sharpen' | 'smudge' | 'dodge' | 'burn' | 'sponge';

export class RetouchStroke {
  private last: { x: number; y: number } | null = null;
  private carry: Float32Array | null = null;
  private canvas: Cnv;
  private ctx: CanvasRenderingContext2D;

  constructor(private doc: PixelDoc, private layer: Layer, private mode: RetouchMode, private size: number, private hardness: number,
    private strength: number, private opts: { range?: 'shadows' | 'midtones' | 'highlights'; sponge?: 'saturate' | 'desaturate' } = {}) {
    doc.expandToDoc(layer);
    this.canvas = doc.writable(layer);
    this.ctx = ctx2d(this.canvas);
  }

  to(x: number, y: number) {
    const step = Math.max(1, this.size * 0.2);
    if (!this.last) { this.dab(x, y); this.last = { x, y }; return; }
    const dx = x - this.last.x, dy = y - this.last.y;
    const len = Math.hypot(dx, dy);
    const n = Math.floor(len / step);
    for (let i = 1; i <= n; i++) this.dab(this.last.x + (dx * i * step) / len, this.last.y + (dy * i * step) / len);
    if (n > 0) this.last = { x: this.last.x + (dx * n * step) / len, y: this.last.y + (dy * n * step) / len };
  }

  private dab(dx: number, dy: number) {
    const l = this.layer;
    const r = Math.max(1, this.size / 2);
    const cx = dx - l.x, cy = dy - l.y;
    const x0 = Math.max(0, Math.floor(cx - r) - 1), y0 = Math.max(0, Math.floor(cy - r) - 1);
    const x1 = Math.min(this.canvas.width, Math.ceil(cx + r) + 1), y1 = Math.min(this.canvas.height, Math.ceil(cy + r) + 1);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 2 || h <= 2) return;
    const img = this.ctx.getImageData(x0, y0, w, h);
    const d = img.data;
    const src = new Uint8ClampedArray(d);
    const sel = this.doc.selection;
    const hard = clamp(this.hardness / 100, 0, 0.99);
    const k = clamp(this.strength / 100, 0, 1);
    const weight = (px: number, py: number) => {
      const dist = Math.hypot(px + x0 + 0.5 - cx, py + y0 + 0.5 - cy) / r;
      if (dist >= 1) return 0;
      let wgt = dist <= hard ? 1 : 1 - (dist - hard) / (1 - hard);
      if (sel) {
        const sx = px + x0 + l.x, sy = py + y0 + l.y;
        wgt *= sx >= 0 && sy >= 0 && sx < sel.w && sy < sel.h ? sel.data[sy * sel.w + sx] / 255 : 0;
      }
      return wgt;
    };
    if (this.mode === 'smudge' && !this.carry) {
      this.carry = new Float32Array(src.length);
      for (let i = 0; i < src.length; i++) this.carry[i] = src[i];
      this.carryW = w; this.carryH = h;
    }
    for (let py = 1; py < h - 1; py++) for (let px = 1; px < w - 1; px++) {
      const wgt = weight(px, py) * k;
      if (wgt <= 0) continue;
      const o = (py * w + px) * 4;
      if (this.mode === 'blur' || this.mode === 'sharpen') {
        for (let c = 0; c < 4; c++) {
          let acc = 0;
          for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) acc += src[((py + j) * w + px + i) * 4 + c];
          const avg = acc / 9;
          const v = this.mode === 'blur' ? avg : src[o + c] + (src[o + c] - avg) * 1.5;
          if (c === 3 && this.mode === 'sharpen') continue;
          d[o + c] = src[o + c] + (v - src[o + c]) * wgt;
        }
      } else if (this.mode === 'smudge') {
        const cw = this.carryW, ch = this.carryH;
        const cpx = Math.min(cw - 1, px), cpy = Math.min(ch - 1, py);
        const co = (cpy * cw + cpx) * 4;
        for (let c = 0; c < 4; c++) {
          const v = src[o + c] + (this.carry![co + c] - src[o + c]) * wgt;
          d[o + c] = v;
          this.carry![co + c] = this.carry![co + c] + (v - this.carry![co + c]) * (1 - wgt * 0.9);
        }
      } else if (this.mode === 'dodge' || this.mode === 'burn') {
        const lum = luma(src[o], src[o + 1], src[o + 2]) / 255;
        const range = this.opts.range ?? 'midtones';
        const rw = range === 'shadows' ? 1 - lum : range === 'highlights' ? lum : 1 - Math.abs(lum - 0.5) * 2;
        const a = wgt * 0.25 * Math.max(0.1, rw);
        for (let c = 0; c < 3; c++) d[o + c] = this.mode === 'dodge' ? src[o + c] + (255 - src[o + c]) * a : src[o + c] * (1 - a);
      } else if (this.mode === 'sponge') {
        const [hh, s, ll] = rgbToHsl(src[o], src[o + 1], src[o + 2]);
        const ns = clamp(this.opts.sponge === 'saturate' ? s + (1 - s) * wgt * 0.2 : s * (1 - wgt * 0.2), 0, 1);
        const [nr, ng, nb] = hslToRgb(hh, ns, ll);
        d[o] = nr; d[o + 1] = ng; d[o + 2] = nb;
      }
    }
    if (this.mode === 'smudge') {
      // the carried paint moves with the brush: re-sample from the result
      const cw = this.carryW;
      for (let py = 0; py < Math.min(h, this.carryH); py++) for (let px = 0; px < Math.min(w, cw); px++) {
        const o = (py * w + px) * 4, co = (py * cw + px) * 4;
        for (let c = 0; c < 4; c++) this.carry![co + c] = this.carry![co + c] * 0.5 + d[o + c] * 0.5;
      }
    }
    this.ctx.putImageData(img, x0, y0);
  }
  private carryW = 0;
  private carryH = 0;
}
