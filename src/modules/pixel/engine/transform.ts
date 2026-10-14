// Free transform: lifts the active layer (or the selected pixels) into a float that can be moved, scaled and rotated.
import { clearCanvas, contentBounds, ctx2d, maskToCanvas, newCanvas, type Cnv } from './canvas';
import type { Layer, PixelDoc } from './doc';
import { transformedBounds, unionRect } from './geometry';
import { canvasAlphaToMask } from './canvas';
import { isEmpty, maskBounds } from './mask';
import { rerender } from './render';
import { UserError } from './ops';

export interface TransformParams { cx: number; cy: number; sx: number; sy: number; angle: number }

export class TransformSession {
  readonly layer: Layer;
  /** Float content and its original doc-space rect. */
  readonly float: Cnv;
  readonly w: number;
  readonly h: number;
  readonly origin: TransformParams;
  p: TransformParams;
  smooth = true;
  /** Layer canvas with the floated pixels removed (null when the whole layer floats). */
  private base: { canvas: Cnv; x: number; y: number } | null;
  private selection: { canvas: Cnv; x: number; y: number } | null;
  private preview: Cnv;
  private live: 'text' | 'shape' | null;

  constructor(private doc: PixelDoc, readonly label = 'Free transform') {
    const l = doc.active;
    if (!l) throw new UserError('Select a layer to transform');
    if (l.locked) throw new UserError(`“${l.name}” is locked`);
    if (l.kind === 'group' || l.kind === 'adjustment' || l.kind === 'fill' || !l.canvas) throw new UserError('Select a layer with pixels to transform');
    this.layer = l;
    this.live = !doc.selection && (l.kind === 'text' || l.kind === 'shape') ? l.kind : null;
    let rect;
    if (doc.selection && l.kind === 'pixel') {
      if (isEmpty(doc.selection)) throw new UserError('The selection is empty');
      const b = maskBounds(doc.selection)!;
      rect = b;
      const f = newCanvas(b.w, b.h);
      const fx = ctx2d(f);
      fx.drawImage(l.canvas, l.x - b.x, l.y - b.y);
      fx.globalCompositeOperation = 'destination-in';
      fx.drawImage(doc.selectionCanvas()!, -b.x, -b.y);
      this.float = f;
      const base = newCanvas(l.canvas.width, l.canvas.height);
      const bx = ctx2d(base);
      bx.drawImage(l.canvas, 0, 0);
      bx.globalCompositeOperation = 'destination-out';
      bx.drawImage(doc.selectionCanvas()!, -l.x, -l.y);
      this.base = { canvas: base, x: l.x, y: l.y };
      this.selection = { canvas: maskToCanvas(doc.selection), x: 0, y: 0 };
    } else {
      if (doc.selection && l.kind !== 'pixel') throw new UserError('Deselect first to transform a live type or shape layer');
      const b = contentBounds(l.canvas);
      if (!b) throw new UserError('Layer is empty');
      rect = { x: l.x + b.x, y: l.y + b.y, w: b.w, h: b.h };
      const f = newCanvas(b.w, b.h);
      ctx2d(f).drawImage(l.canvas, -b.x, -b.y);
      this.float = f;
      this.base = null;
      this.selection = null;
    }
    this.w = rect.w;
    this.h = rect.h;
    this.origin = { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, sx: 1, sy: 1, angle: 0 };
    this.p = { ...this.origin };
    this.preview = newCanvas(doc.width, doc.height);
    doc.override = { layerId: l.id, target: 'pixels', render: () => this.render() };
  }

  /** Corners of the transformed box in doc space (tl, tr, br, bl). */
  corners(): [number, number][] {
    const { cx, cy, sx, sy, angle } = this.p;
    const c = Math.cos(angle), s = Math.sin(angle);
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => {
      const X = (u * this.w * sx) / 2, Y = (v * this.h * sy) / 2;
      return [cx + X * c - Y * s, cy + X * s + Y * c] as [number, number];
    });
  }

  /** Map a doc point into the box's unrotated local frame (relative to center, unscaled units). */
  toLocal(x: number, y: number): [number, number] {
    const { cx, cy, angle } = this.p;
    const c = Math.cos(-angle), s = Math.sin(-angle);
    const dx = x - cx, dy = y - cy;
    return [dx * c - dy * s, dx * s + dy * c];
  }

  get changed() {
    const a = this.p, b = this.origin;
    return a.cx !== b.cx || a.cy !== b.cy || a.sx !== b.sx || a.sy !== b.sy || a.angle !== b.angle;
  }

  private drawFloat(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    const { cx, cy, sx, sy, angle } = this.p;
    ctx.save();
    ctx.imageSmoothingEnabled = this.smooth;
    ctx.imageSmoothingQuality = 'high';
    ctx.translate(cx - ox, cy - oy);
    ctx.rotate(angle);
    ctx.scale(sx, sy);
    ctx.drawImage(this.float, -this.w / 2, -this.h / 2);
    ctx.restore();
  }

  render() {
    clearCanvas(this.preview);
    const x = ctx2d(this.preview);
    if (this.base) x.drawImage(this.base.canvas, this.base.x, this.base.y);
    this.drawFloat(x, 0, 0);
    return { canvas: this.preview, x: 0, y: 0 };
  }

  cancel() {
    this.doc.override = null;
    this.doc.touch();
  }

  commit() {
    const doc = this.doc, l = this.layer;
    doc.override = null;
    if (!this.changed) { doc.touch(); return; }
    const { cx, cy, sx, sy, angle } = this.p;
    const pureMove = sx === 1 && sy === 1 && angle === 0;
    if (this.live && (pureMove || angle === 0)) {
      // keep type/shape layers live for moves and axis scales
      const dx = cx - this.origin.cx, dy = cy - this.origin.cy;
      if (pureMove) { l.x = Math.round(l.x + dx); l.y = Math.round(l.y + dy); }
      else if (this.live === 'text' && l.text) {
        const k = Math.sqrt(Math.abs(sx * sy));
        l.text = { ...l.text, size: Math.max(1, l.text.size * k) };
        rerender(l);
        const b = contentBounds(l.canvas!);
        l.x = Math.round(cx - ((b?.x ?? 0) + (b?.w ?? 0) / 2));
        l.y = Math.round(cy - ((b?.y ?? 0) + (b?.h ?? 0) / 2));
      } else if (this.live === 'shape' && l.shape) {
        const s = l.shape;
        l.shape = { ...s, w: s.w * Math.abs(sx), h: s.h * Math.abs(sy), x1: (s.x1 ?? 0) * Math.abs(sx), x2: (s.x2 ?? 0) * Math.abs(sx), y1: (s.y1 ?? 0) * Math.abs(sy), y2: (s.y2 ?? 0) * Math.abs(sy) };
        rerender(l);
        l.x = Math.round(cx - l.canvas!.width / 2);
        l.y = Math.round(cy - l.canvas!.height / 2);
      }
      doc.commit(pureMove ? 'Move' : this.label);
      return;
    }
    if (this.live) { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; }
    const tb = transformedBounds(this.w, this.h, cx, cy, sx, sy, angle);
    const frame = this.base ? unionRect(tb, { x: this.base.x, y: this.base.y, w: this.base.canvas.width, h: this.base.canvas.height }) : tb;
    const out = newCanvas(Math.max(1, frame.w), Math.max(1, frame.h));
    const o = ctx2d(out);
    if (this.base) o.drawImage(this.base.canvas, this.base.x - frame.x, this.base.y - frame.y);
    this.drawFloat(o, frame.x, frame.y);
    l.canvas = out;
    l.x = frame.x;
    l.y = frame.y;
    if (this.selection) {
      // transform the selection with the pixels
      const m = newCanvas(doc.width, doc.height);
      const mx = ctx2d(m);
      mx.save();
      mx.translate(cx, cy);
      mx.rotate(angle);
      mx.scale(sx, sy);
      mx.drawImage(this.selection.canvas, -this.origin.cx, -this.origin.cy);
      mx.restore();
      doc.selection = canvasAlphaToMask(m);
    }
    doc.commit(pureMove ? 'Move' : this.label);
  }
}
