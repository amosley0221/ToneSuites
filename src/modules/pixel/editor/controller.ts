// Tool controller: turns pointer input (in document coordinates) into edits. No React.
import { composite } from '../engine/composite';
import { ctx2d, getImg, maskToCanvas, newCanvas, cloneCanvas, type Cnv } from '../engine/canvas';
import type { Layer, PixelDoc } from '../engine/doc';
import { dragRect, type RectLike } from '../engine/geometry';
import { rgbToHex } from '../engine/img';
import {
  combine, ellipseMask, isEmpty, magicWand, maskBounds, offsetMask, polygonMask, rectMask, featherMask, type CombineOp, type Mask,
} from '../engine/mask';
import { cropTo, requirePixelLayer, sampleImage, UserError, nextLayerName } from '../engine/ops';
import { BufferedStroke, RetouchStroke, type RetouchMode } from '../engine/paint';
import { renderShape, renderText, shapePath, textBox } from '../engine/render';
import { TransformSession } from '../engine/transform';
import { variantOf, type ToolId } from '../engine/tooldefs';

export interface PointerInfo {
  x: number; y: number; sx: number; sy: number; pressure: number;
  shift: boolean; alt: boolean; ctrl: boolean; button: number; pointerType: string; detail: number;
}

export interface Overlay {
  marquee?: { kind: 'rect' | 'ellipse'; r: RectLike };
  lasso?: [number, number][];
  rubber?: [number, number];
  line?: { x0: number; y0: number; x1: number; y1: number };
  shape?: { kind: 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line'; r: RectLike; line?: [number, number, number, number] };
  cursor?: { x: number; y: number; r: number };
  cloneSrc?: { x: number; y: number };
}

export interface ControllerEnv {
  toast: (msg: string, tone?: 'info' | 'error') => void;
  redrawOverlay: () => void;
  zoomAt: (factor: number, sx: number, sy: number) => void;
  panBy: (dx: number, dy: number) => void;
  editText: (layerId: string, isNew: boolean) => void;
  /** Screen px per doc px. */
  zoom: () => number;
  setCursor: (c: string) => void;
}

type Handle = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 } | 'move' | 'rotate';

export class ToolController {
  overlay: Overlay = {};
  transform: TransformSession | null = null;
  crop: RectLike | null = null;
  private drag: ((p: PointerInfo) => void) | null = null;
  private dragEnd: ((p: PointerInfo) => void) | null = null;

  constructor(private doc: PixelDoc, private env: ControllerEnv) {}

  get tool(): ToolId { return this.doc.ui.tool; }

  // ---------- transform / crop sessions ----------

  startTransform(): boolean {
    this.commitCrop(false);
    if (this.transform) return true;
    try {
      this.transform = new TransformSession(this.doc);
      this.doc.touch();
      return true;
    } catch (e) {
      this.env.toast((e as Error).message, 'error');
      return false;
    }
  }

  commitTransform() {
    if (!this.transform) return;
    const t = this.transform;
    this.transform = null;
    t.commit(); // a placement itself was already recorded by placeAll()
  }

  cancelTransform() {
    if (!this.transform) return;
    this.transform.cancel();
    this.transform = null;
    this.doc.emit();
  }

  commitCrop(apply = true) {
    if (!this.crop) return;
    const r = this.crop;
    this.crop = null;
    if (apply && r.w >= 1 && r.h >= 1) cropTo(this.doc, r, this.doc.ui.crop.deletePixels);
    else this.doc.emit();
  }

  /** Commit whatever is pending (before running a command). */
  commitAll() {
    this.commitTransform();
    if (this.crop) this.commitCrop(true);
    this.overlay.lasso = undefined;
  }

  cancelAll() {
    this.cancelTransform();
    if (this.crop) { this.crop = null; this.doc.emit(); }
    this.overlay = {};
    this.env.redrawOverlay();
  }

  // ---------- pointer routing ----------

  down(p: PointerInfo) {
    if (this.transform) return this.transformDown(p);
    if (this.crop && this.tool === 'crop') return this.cropDown(p);
    const t = this.tool;
    if (!variantOf(t).working) {
      this.env.toast(`${variantOf(t).name} is on the roadmap`);
      return;
    }
    try {
      switch (t) {
        case 'move': return this.moveDown(p);
        case 'marqueeRect': case 'marqueeEllipse': return this.marqueeDown(p);
        case 'marqueeRow': case 'marqueeCol': return this.singleLine(p);
        case 'lasso': return this.lassoDown(p);
        case 'polyLasso': return this.polyDown(p);
        case 'wand': return this.wand(p);
        case 'crop': return this.cropDown(p);
        case 'eyedropper': return this.eyedropper(p);
        case 'brush': case 'pencil': case 'eraser': case 'clone': case 'historyBrush': return this.strokeDown(p);
        case 'magicEraser': return this.magicEraser(p);
        case 'gradient': return this.gradientDown(p);
        case 'bucket': return this.bucket(p);
        case 'blur': case 'sharpen': case 'smudge': case 'dodge': case 'burn': case 'sponge': return this.retouchDown(p);
        case 'typeH': return this.typeDown(p);
        case 'rect': case 'ellipse': case 'triangle': case 'polygon': case 'line': return this.shapeDown(p);
        case 'hand': return this.handDown(p);
        case 'zoom': return this.env.zoomAt(p.alt ? 0.5 : 2, p.sx, p.sy);
      }
    } catch (e) {
      this.drag = null;
      this.dragEnd = null;
      this.doc.override = null;
      if (e instanceof UserError) this.env.toast(e.message, 'error');
      else throw e;
    }
  }

  move(p: PointerInfo) {
    if (this.drag) { this.drag(p); return; }
    this.hover(p);
  }

  up(p: PointerInfo) {
    const end = this.dragEnd;
    this.drag = null;
    this.dragEnd = null;
    if (end) {
      try { end(p); } catch (e) {
        this.doc.override = null;
        if (e instanceof UserError) this.env.toast(e.message, 'error'); else throw e;
      }
    }
  }

  get dragging() { return !!this.drag; }

  hover(p: PointerInfo) {
    const t = this.tool;
    const brushy = ['brush', 'pencil', 'eraser', 'clone', 'historyBrush', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'sponge'].includes(t);
    this.overlay.cursor = brushy ? { x: p.x, y: p.y, r: this.doc.ui.brush.size / 2 } : undefined;
    if (this.overlay.lasso && t === 'polyLasso') this.overlay.rubber = [p.x, p.y];
    if (this.transform) this.env.setCursor(this.cursorForHandle(this.hitTransform(p)));
    else if (this.crop && t === 'crop') this.env.setCursor(this.cursorForHandle(this.hitRect(this.crop, p, false)));
    else this.env.setCursor(cursorFor(t));
    this.env.redrawOverlay();
  }

  // ---------- move ----------

  private moveDown(p: PointerInfo) {
    const doc = this.doc;
    if (p.alt && p.ctrl) return;
    let l = doc.active;
    if (this.doc.ui.move.autoSelect || p.ctrl) {
      const hit = this.pickLayer(p.x, p.y);
      if (hit) { l = hit; doc.activeId = hit.id; doc.emit(); }
    }
    if (!l) return;
    if (l.locked) throw new UserError(`“${l.name}” is locked`);
    if (doc.selection && l.kind === 'pixel') {
      // move selected pixels as a float, committed on release
      if (!this.startTransform()) return;
      const t = this.transform!;
      const start = { cx: t.p.cx, cy: t.p.cy };
      this.drag = (q) => { t.p.cx = start.cx + Math.round(q.x - p.x); t.p.cy = start.cy + Math.round(q.y - p.y); doc.repaint(); this.env.redrawOverlay(); };
      this.dragEnd = () => this.commitTransform();
      return;
    }
    const movers: Layer[] = l.kind === 'group' ? doc.descendants(l.id) : [l];
    const starts = movers.map((m) => ({ m, x: m.x, y: m.y, mx: m.mask?.x ?? 0, my: m.mask?.y ?? 0 }));
    if (l.kind === 'group' && l.mask) starts.push({ m: l, x: l.x, y: l.y, mx: l.mask.x, my: l.mask.y });
    let moved = false;
    this.drag = (q) => {
      const dx = Math.round(q.x - p.x), dy = Math.round(q.y - p.y);
      moved = moved || dx !== 0 || dy !== 0;
      for (const s of starts) {
        if (s.m !== l || l.kind !== 'group') { s.m.x = s.x + dx; s.m.y = s.y + dy; }
        if (s.m.mask) s.m.mask = { ...s.m.mask, x: s.mx + dx, y: s.my + dy };
      }
      doc.repaint();
    };
    this.dragEnd = () => { if (moved) doc.commit('Move'); };
  }

  nudge(dx: number, dy: number) {
    const doc = this.doc;
    if (this.transform) { this.transform.p.cx += dx; this.transform.p.cy += dy; doc.repaint(); this.env.redrawOverlay(); return; }
    const l = doc.active;
    if (!l || l.locked) return;
    if (doc.selection && l.kind === 'pixel') { if (this.startTransform()) { this.transform!.p.cx += dx; this.transform!.p.cy += dy; this.commitTransform(); } return; }
    const movers = l.kind === 'group' ? doc.descendants(l.id) : [l];
    for (const m of movers) { m.x += dx; m.y += dy; if (m.mask) m.mask = { ...m.mask, x: m.mask.x + dx, y: m.mask.y + dy }; }
    doc.commit('Nudge');
  }

  /** Topmost visible layer with a non-transparent pixel at (x,y). */
  pickLayer(x: number, y: number): Layer | null {
    const order = this.doc.panelOrder(false);
    for (const { layer: l } of order) {
      if (!this.doc.isEffectivelyVisible(l) || !l.canvas || l.kind === 'group' || l.kind === 'adjustment') continue;
      const lx = Math.floor(x - l.x), ly = Math.floor(y - l.y);
      if (lx < 0 || ly < 0 || lx >= l.canvas.width || ly >= l.canvas.height) continue;
      if (ctx2d(l.canvas).getImageData(lx, ly, 1, 1).data[3] > 0) return l;
    }
    return null;
  }

  // ---------- selections ----------

  private opFor(p: PointerInfo): CombineOp {
    if (p.shift && p.alt) return 'intersect';
    if (p.shift) return 'add';
    if (p.alt) return 'subtract';
    return this.doc.ui.select.mode;
  }

  private applySelection(m: Mask, op: CombineOp, label: string) {
    const doc = this.doc;
    let mask = doc.ui.select.feather > 0 ? featherMask(m, doc.ui.select.feather) : m;
    mask = combine(doc.selection, mask, op);
    doc.setSelection(isEmpty(mask) ? null : mask);
    doc.commit(label);
  }

  private marqueeDown(p: PointerInfo) {
    const doc = this.doc;
    const op = this.opFor(p);
    const kind = this.tool === 'marqueeEllipse' ? 'ellipse' : 'rect';
    // drag inside an existing selection (no modifiers) moves the outline
    if (op === 'replace' && doc.selection && this.insideSelection(p.x, p.y) && !p.shift && !p.alt) return this.moveSelection(p);
    let r: RectLike = { x: p.x, y: p.y, w: 0, h: 0 };
    this.drag = (q) => {
      r = dragRect(Math.round(p.x), Math.round(p.y), Math.round(q.x), Math.round(q.y), q.shift && op !== 'add', q.alt && op !== 'subtract');
      r = this.snapRect(r);
      this.overlay.marquee = { kind, r };
      this.env.redrawOverlay();
    };
    this.dragEnd = () => {
      this.overlay.marquee = undefined;
      if (r.w < 1 || r.h < 1) {
        if (op === 'replace' && doc.selection) { doc.setSelection(null); doc.commit('Deselect'); }
        this.env.redrawOverlay();
        return;
      }
      const m = kind === 'rect' ? rectMask(doc.width, doc.height, r) : ellipseMask(doc.width, doc.height, r);
      this.applySelection(m, op, kind === 'rect' ? 'Rectangular marquee' : 'Elliptical marquee');
    };
  }

  private insideSelection(x: number, y: number) {
    const s = this.doc.selection;
    if (!s) return false;
    const xi = Math.floor(x), yi = Math.floor(y);
    return xi >= 0 && yi >= 0 && xi < s.w && yi < s.h && s.data[yi * s.w + xi] >= 128;
  }

  private moveSelection(p: PointerInfo) {
    const doc = this.doc;
    const orig = doc.selection!;
    let dx = 0, dy = 0;
    this.drag = (q) => {
      dx = Math.round(q.x - p.x); dy = Math.round(q.y - p.y);
      doc.selection = offsetMask(orig, doc.width, doc.height, dx, dy);
      this.env.redrawOverlay();
    };
    this.dragEnd = () => {
      if (!dx && !dy) { doc.selection = orig; doc.setSelection(null); doc.commit('Deselect'); return; }
      doc.lastSelection = orig;
      doc.commit('Move selection');
    };
  }

  private singleLine(p: PointerInfo) {
    const doc = this.doc;
    const r = this.tool === 'marqueeRow' ? { x: 0, y: Math.floor(p.y), w: doc.width, h: 1 } : { x: Math.floor(p.x), y: 0, w: 1, h: doc.height };
    this.applySelection(rectMask(doc.width, doc.height, r), this.opFor(p), this.tool === 'marqueeRow' ? 'Single row marquee' : 'Single column marquee');
  }

  private lassoDown(p: PointerInfo) {
    const op = this.opFor(p);
    const pts: [number, number][] = [[p.x, p.y]];
    this.overlay.lasso = pts;
    this.drag = (q) => { pts.push([q.x, q.y]); this.env.redrawOverlay(); };
    this.dragEnd = () => {
      this.overlay.lasso = undefined;
      if (pts.length < 3) { this.env.redrawOverlay(); return; }
      this.applySelection(polygonMask(this.doc.width, this.doc.height, pts), op, 'Lasso');
    };
  }

  private polyOp: CombineOp = 'replace';

  private polyLast: { t: number; sx: number; sy: number } | null = null;

  private polyDown(p: PointerInfo) {
    const pts = this.overlay.lasso;
    // PointerEvent.detail is 0 in Chromium, so detect a double-click from time + distance too
    const now = performance.now(), last = this.polyLast;
    const dbl = p.detail >= 2 || (!!last && now - last.t < 400 && Math.hypot(p.sx - last.sx, p.sy - last.sy) < 6);
    this.polyLast = { t: now, sx: p.sx, sy: p.sy };
    if (!pts) { this.polyOp = this.opFor(p); this.overlay.lasso = [[p.x, p.y]]; this.env.redrawOverlay(); return; }
    const [fx, fy] = pts[0];
    const z = this.env.zoom();
    const nearStart = Math.hypot((p.x - fx) * z, (p.y - fy) * z) < 8;
    if (dbl || nearStart) { this.polyLast = null; this.closePoly(); return; }
    pts.push([p.x, p.y]);
    this.env.redrawOverlay();
  }

  closePoly() {
    const pts = this.overlay.lasso;
    this.overlay.lasso = undefined;
    this.overlay.rubber = undefined;
    if (!pts || pts.length < 3) { this.env.redrawOverlay(); return; }
    this.applySelection(polygonMask(this.doc.width, this.doc.height, pts), this.polyOp, 'Polygonal lasso');
  }

  popPolyPoint() {
    if (this.overlay.lasso && this.overlay.lasso.length > 1) { this.overlay.lasso.pop(); this.env.redrawOverlay(); }
  }

  private wand(p: PointerInfo) {
    const doc = this.doc;
    const { tolerance, contiguous, sampleAll } = doc.ui.wand;
    const img = sampleImage(doc, sampleAll);
    const m = magicWand(img, p.x, p.y, tolerance, contiguous);
    if (isEmpty(m)) return;
    this.applySelection(m, this.opFor(p), 'Magic wand');
  }

  // ---------- crop ----------

  private cropDown(p: PointerInfo) {
    const doc = this.doc;
    if (this.crop) {
      const h = this.hitRect(this.crop, p, false);
      if (h) return this.dragRectHandle(this.crop, h, p, (r) => { this.crop = r; });
      // click outside the crop box starts a new one
    }
    const start = { x: Math.round(Math.max(0, Math.min(doc.width, p.x))), y: Math.round(Math.max(0, Math.min(doc.height, p.y))) };
    let r: RectLike = { ...start, w: 0, h: 0 };
    this.drag = (q) => {
      r = dragRect(start.x, start.y, Math.round(q.x), Math.round(q.y), q.shift, q.alt);
      this.crop = r;
      this.env.redrawOverlay();
    };
    this.dragEnd = () => {
      if (r.w < 2 || r.h < 2) this.crop = { x: 0, y: 0, w: doc.width, h: doc.height };
      doc.emit();
    };
  }

  private dragRectHandle(r0: RectLike, h: Handle, p: PointerInfo, set: (r: RectLike) => void) {
    const start = { ...r0 };
    this.drag = (q) => {
      const dx = Math.round(q.x - p.x), dy = Math.round(q.y - p.y);
      let { x, y, w, h: hh } = start;
      if (h === 'move' || h === 'rotate') { x += dx; y += dy; }
      else {
        if (h.hx === -1) { x += dx; w -= dx; }
        if (h.hx === 1) w += dx;
        if (h.hy === -1) { y += dy; hh -= dy; }
        if (h.hy === 1) hh += dy;
        if (w < 0) { x += w; w = -w; }
        if (hh < 0) { y += hh; hh = -hh; }
      }
      set({ x, y, w: Math.max(1, w), h: Math.max(1, hh) });
      this.env.redrawOverlay();
    };
    this.dragEnd = () => this.doc.emit();
  }

  // ---------- color sampling ----------

  private sampleAt(x: number, y: number): string | null {
    const doc = this.doc;
    const n = doc.ui.eyedropper.sample;
    let src: Cnv, ox = 0, oy = 0;
    const l = doc.active;
    if (doc.ui.eyedropper.source === 'layer' && l?.canvas && l.kind !== 'group' && l.kind !== 'adjustment') { src = l.canvas; ox = l.x; oy = l.y; }
    else src = composite(doc);
    const cx = Math.floor(x - ox), cy = Math.floor(y - oy);
    const half = Math.floor(n / 2);
    const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
    const x1 = Math.min(src.width, cx + half + 1), y1 = Math.min(src.height, cy + half + 1);
    if (x1 <= x0 || y1 <= y0) return null;
    const d = ctx2d(src).getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let r = 0, g = 0, b = 0, a = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i] * d[i + 3]; g += d[i + 1] * d[i + 3]; b += d[i + 2] * d[i + 3]; a += d[i + 3]; }
    if (!a) return null;
    return rgbToHex(r / a, g / a, b / a);
  }

  private eyedropper(p: PointerInfo) {
    const set = (q: PointerInfo) => {
      const c = this.sampleAt(q.x, q.y);
      if (!c) return;
      if (p.alt) this.doc.ui.bg = c; else this.doc.ui.fg = c;
      this.doc.emit();
    };
    set(p);
    this.drag = set;
    this.dragEnd = () => {};
  }

  // ---------- painting ----------

  private paintTarget(): { layer: Layer; onMask: boolean } {
    const doc = this.doc;
    const l = doc.active;
    if (!l) throw new UserError('Select a layer to paint on');
    if (!doc.isEffectivelyVisible(l)) throw new UserError('The target layer is hidden');
    if (doc.ui.editMask && l.mask) {
      if (l.locked) throw new UserError(`“${l.name}” is locked`);
      return { layer: l, onMask: true };
    }
    return { layer: requirePixelLayer(doc, l), onMask: false };
  }

  private strokeDown(p: PointerInfo) {
    const doc = this.doc;
    const t = this.tool;
    if (t === 'clone' && p.alt) {
      doc.ui.cloneSource = { x: p.x, y: p.y };
      this.overlay.cloneSrc = { x: p.x, y: p.y };
      this.env.toast('Clone source set — paint to copy from it');
      this.env.redrawOverlay();
      return;
    }
    const { layer, onMask } = this.paintTarget();
    const b = doc.ui.brush;
    const pencil = t === 'pencil';
    const mode = t === 'eraser' ? 'erase' : t === 'clone' ? 'clone' : t === 'historyBrush' ? 'history' : 'paint';
    if (mode === 'clone' && !doc.ui.cloneSource) throw new UserError('Alt-click to set a clone source first');
    const stroke = new BufferedStroke(doc, layer, onMask, {
      mode, color: doc.ui.fg, size: b.size, hardness: pencil ? 100 : b.hardness, roundness: b.roundness, angle: b.angle, aliased: pencil,
      opacity: b.opacity / 100, flow: pencil ? 1 : b.flow / 100, spacing: pencil ? 0.05 : Math.max(0.01, b.spacing / 100),
      pressureSize: b.pressureSize && p.pointerType === 'pen', pressureOpacity: b.pressureOpacity && p.pointerType === 'pen',
    });
    if (mode === 'clone') {
      const src = doc.ui.cloneSource!;
      const snapshot = doc.ui.retouch.sampleAll ? cloneCanvas(composite(doc)) : cloneCanvas(layer.canvas!);
      const sx = doc.ui.retouch.sampleAll ? 0 : layer.x, sy = doc.ui.retouch.sampleAll ? 0 : layer.y;
      stroke.setSource(snapshot, sx, sy, p.x - src.x, p.y - src.y);
    }
    if (mode === 'history') {
      const old = doc.historyLayer(doc.ui.historySource, layer.id);
      if (!old?.canvas) throw new UserError('This layer did not exist at the history source state');
      stroke.setSource(old.canvas, old.x, old.y, 0, 0);
    }
    doc.override = { layerId: layer.id, target: onMask ? 'mask' : 'pixels', render: () => stroke.render() };
    stroke.to(p.x, p.y, pressureOf(p));
    doc.repaint();
    this.drag = (q) => {
      let x = q.x, y = q.y;
      stroke.to(x, y, pressureOf(q));
      this.overlay.cursor = { x, y, r: b.size / 2 };
      if (mode === 'clone' && doc.ui.cloneSource) this.overlay.cloneSrc = { x: x - (p.x - doc.ui.cloneSource.x), y: y - (p.y - doc.ui.cloneSource.y) };
      doc.repaint();
      this.env.redrawOverlay();
    };
    this.dragEnd = () => {
      stroke.commit();
      doc.override = null;
      this.overlay.cloneSrc = undefined;
      doc.commit({ paint: pencil ? 'Pencil' : 'Brush stroke', erase: 'Eraser', clone: 'Clone stamp', history: 'History brush' }[mode]);
    };
  }

  private retouchDown(p: PointerInfo) {
    const doc = this.doc;
    const { layer } = this.paintTarget();
    if (doc.ui.editMask && layer.mask) throw new UserError('Retouch tools work on pixels — click the layer thumbnail to target pixels');
    const t = this.tool as RetouchMode;
    const strength = t === 'dodge' || t === 'burn' ? doc.ui.tone.exposure : doc.ui.retouch.strength;
    const s = new RetouchStroke(doc, layer, t, doc.ui.brush.size, doc.ui.brush.hardness, strength, { range: doc.ui.tone.range, sponge: doc.ui.tone.spongeMode });
    s.to(p.x, p.y);
    doc.repaint();
    this.drag = (q) => { s.to(q.x, q.y); this.overlay.cursor = { x: q.x, y: q.y, r: doc.ui.brush.size / 2 }; doc.repaint(); this.env.redrawOverlay(); };
    this.dragEnd = () => doc.commit({ blur: 'Blur tool', sharpen: 'Sharpen tool', smudge: 'Smudge tool', dodge: 'Dodge', burn: 'Burn', sponge: 'Sponge' }[t]);
  }

  private magicEraser(p: PointerInfo) {
    const doc = this.doc;
    const l = requirePixelLayer(doc);
    const img = getImg(doc.layerDocCanvas(l));
    let m = magicWand(img, p.x, p.y, doc.ui.wand.tolerance, doc.ui.wand.contiguous);
    if (doc.selection) m = combine(doc.selection, m, 'intersect');
    if (isEmpty(m)) return;
    const c = ctx2d(doc.writable(l));
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.drawImage(maskToCanvas(m), -l.x, -l.y);
    c.restore();
    doc.commit('Magic eraser');
  }

  private bucket(p: PointerInfo) {
    const doc = this.doc;
    const l = requirePixelLayer(doc);
    const { tolerance, contiguous, sampleAll, opacity } = doc.ui.bucket;
    const img = sampleImage(doc, sampleAll);
    let m = magicWand(img, p.x, p.y, tolerance, contiguous);
    if (doc.selection) m = combine(doc.selection, m, 'intersect');
    if (isEmpty(m)) return;
    doc.expandToDoc(l);
    const tmp = newCanvas(doc.width, doc.height);
    const t = ctx2d(tmp);
    t.drawImage(maskToCanvas(m), 0, 0);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = doc.ui.fg;
    t.fillRect(0, 0, doc.width, doc.height);
    const c = ctx2d(doc.writable(l));
    c.save();
    c.globalAlpha = opacity / 100;
    c.drawImage(tmp, -l.x, -l.y);
    c.restore();
    doc.commit('Paint bucket');
  }

  private gradientDown(p: PointerInfo) {
    const doc = this.doc;
    const l = requirePixelLayer(doc);
    let end = { x: p.x, y: p.y };
    this.drag = (q) => {
      end = { x: q.x, y: q.y };
      if (q.shift) {
        const a = Math.round(Math.atan2(q.y - p.y, q.x - p.x) / (Math.PI / 4)) * (Math.PI / 4);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        end = { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
      }
      this.overlay.line = { x0: p.x, y0: p.y, x1: end.x, y1: end.y };
      this.env.redrawOverlay();
    };
    this.dragEnd = () => {
      this.overlay.line = undefined;
      if (Math.hypot(end.x - p.x, end.y - p.y) < 1) { this.env.redrawOverlay(); return; }
      const g = doc.ui.gradient;
      doc.expandToDoc(l);
      const tmp = newCanvas(doc.width, doc.height);
      const t = ctx2d(tmp);
      const grad = g.type === 'radial'
        ? t.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.hypot(end.x - p.x, end.y - p.y))
        : t.createLinearGradient(p.x, p.y, end.x, end.y);
      let a = doc.ui.fg, b = g.fade === 'fgclear' ? transparentOf(doc.ui.fg) : doc.ui.bg;
      if (g.reverse) [a, b] = [b, a];
      grad.addColorStop(0, a);
      grad.addColorStop(1, b);
      t.fillStyle = grad;
      t.fillRect(0, 0, doc.width, doc.height);
      if (doc.selection) { t.globalCompositeOperation = 'destination-in'; t.drawImage(doc.selectionCanvas()!, 0, 0); }
      const c = ctx2d(doc.writable(l));
      c.save();
      c.globalAlpha = g.opacity / 100;
      c.drawImage(tmp, -l.x, -l.y);
      c.restore();
      doc.commit('Gradient');
    };
  }

  // ---------- type & shapes ----------

  private typeDown(p: PointerInfo) {
    const doc = this.doc;
    // click on an existing type layer edits it
    const hit = doc.panelOrder(false).map((o) => o.layer).find((l) => {
      if (l.kind !== 'text' || !l.canvas || !doc.isEffectivelyVisible(l)) return false;
      const b = textBox(l);
      return p.x >= b.x - 4 && p.x <= b.x + b.w + 4 && p.y >= b.y - 4 && p.y <= b.y + b.h + 4;
    });
    if (hit) {
      if (hit.locked) throw new UserError(`“${hit.name}” is locked`);
      doc.activeId = hit.id;
      doc.emit();
      this.env.editText(hit.id, false);
      return;
    }
    const t = { ...doc.ui.type, text: '', color: doc.ui.fg };
    const l = doc.makeLayer('text', 'Type', { text: t });
    renderText(l);
    const pad = Math.ceil(t.size * 0.3) + 2;
    l.x = Math.round(p.x) - pad;
    l.y = Math.round(p.y - t.size * t.leading * 0.8) - pad;
    doc.addLayer(l);
    doc.touch();
    this.env.editText(l.id, true);
  }

  private shapeDown(p: PointerInfo) {
    const doc = this.doc;
    const t = this.tool as 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line';
    const sopts = doc.ui.shape;
    const start = { x: Math.round(p.x), y: Math.round(p.y) };
    let r: RectLike = { ...start, w: 0, h: 0 };
    let line: [number, number, number, number] = [start.x, start.y, start.x, start.y];
    this.drag = (q) => {
      if (t === 'line') {
        let ex = q.x, ey = q.y;
        if (q.shift) { const a = Math.round(Math.atan2(ey - start.y, ex - start.x) / (Math.PI / 4)) * (Math.PI / 4); const d = Math.hypot(ex - start.x, ey - start.y); ex = start.x + Math.cos(a) * d; ey = start.y + Math.sin(a) * d; }
        line = [start.x, start.y, ex, ey];
        r = { x: Math.min(start.x, ex), y: Math.min(start.y, ey), w: Math.abs(ex - start.x), h: Math.abs(ey - start.y) };
      } else r = dragRect(start.x, start.y, Math.round(q.x), Math.round(q.y), q.shift, q.alt);
      this.overlay.shape = { kind: t, r, line };
      this.env.redrawOverlay();
    };
    this.dragEnd = () => {
      this.overlay.shape = undefined;
      const tooSmall = t === 'line' ? Math.hypot(line[2] - line[0], line[3] - line[1]) < 2 : r.w < 2 || r.h < 2;
      if (tooSmall) { this.env.redrawOverlay(); return; }
      const shape = {
        type: t, w: Math.max(1, r.w), h: Math.max(1, r.h),
        fill: t === 'line' ? null : sopts.fillOn ? doc.ui.fg : null,
        stroke: t === 'line' ? doc.ui.fg : sopts.strokeOn && sopts.strokeWidth > 0 ? doc.ui.bg : null,
        strokeWidth: t === 'line' ? Math.max(1, sopts.strokeWidth || 2) : sopts.strokeWidth,
        sides: sopts.sides, radius: t === 'rect' ? sopts.radius : 0, pad: 0,
        ...(t === 'line' ? { x1: line[0] - r.x, y1: line[1] - r.y, x2: line[2] - r.x, y2: line[3] - r.y } : {}),
      };
      if (sopts.mode === 'pixels') {
        const l = requirePixelLayer(doc);
        doc.expandToDoc(l);
        const c = ctx2d(doc.writable(l));
        c.save();
        if (doc.selection) {
          // clip to selection via an intermediate
          const tmp = newCanvas(doc.width, doc.height);
          drawShapeInto(ctx2d(tmp), shape, r.x, r.y);
          const tc = ctx2d(tmp);
          tc.globalCompositeOperation = 'destination-in';
          tc.drawImage(doc.selectionCanvas()!, 0, 0);
          c.drawImage(tmp, -l.x, -l.y);
        } else drawShapeInto(c, shape, r.x - l.x, r.y - l.y);
        c.restore();
        doc.commit('Shape');
        return;
      }
      const l = doc.makeLayer('shape', nextLayerName(doc, labelOfShape(t)), { shape, x: r.x, y: r.y });
      renderShape(l);
      doc.addLayer(l);
      doc.commit('New shape layer');
    };
  }

  // ---------- view ----------

  private handDown(p: PointerInfo) {
    let last = { x: p.sx, y: p.sy };
    this.drag = (q) => { this.env.panBy(q.sx - last.x, q.sy - last.y); last = { x: q.sx, y: q.sy }; };
    this.dragEnd = () => {};
  }

  /** Space-bar hand: pans without changing the tool. */
  tempHand(p: PointerInfo) { this.handDown(p); }

  // ---------- transform handles ----------

  hitTransform(p: PointerInfo): Handle | null {
    const t = this.transform;
    if (!t) return null;
    const z = this.env.zoom();
    const [lx, ly] = t.toLocal(p.x, p.y);
    const hw = (t.w * Math.abs(t.p.sx)) / 2, hh = (t.h * Math.abs(t.p.sy)) / 2;
    const tol = 7 / z;
    for (const hx of [-1, 0, 1] as const) for (const hy of [-1, 0, 1] as const) {
      if (!hx && !hy) continue;
      if (Math.abs(lx - hx * hw) <= tol && Math.abs(ly - hy * hh) <= tol) return { hx, hy };
    }
    if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) return 'move';
    return 'rotate';
  }

  private hitRect(r: RectLike, p: PointerInfo, rotate: boolean): Handle | null {
    const z = this.env.zoom();
    const tol = 7 / z;
    const xs = [r.x, r.x + r.w / 2, r.x + r.w], ys = [r.y, r.y + r.h / 2, r.y + r.h];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      if (i === 1 && j === 1) continue;
      if (Math.abs(p.x - xs[i]) <= tol && Math.abs(p.y - ys[j]) <= tol) return { hx: (i - 1) as -1 | 0 | 1, hy: (j - 1) as -1 | 0 | 1 };
    }
    if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return 'move';
    return rotate ? 'rotate' : null;
  }

  private cursorForHandle(h: Handle | null): string {
    if (!h) return cursorFor(this.tool);
    if (h === 'move') return 'move';
    if (h === 'rotate') return 'alias';
    if (h.hx && h.hy) return h.hx === h.hy ? 'nwse-resize' : 'nesw-resize';
    return h.hx ? 'ew-resize' : 'ns-resize';
  }

  private transformDown(p: PointerInfo) {
    const t = this.transform!;
    const h = this.hitTransform(p);
    if (!h) return;
    const s = { ...t.p };
    if (h === 'move') {
      this.drag = (q) => { t.p.cx = s.cx + (q.x - p.x); t.p.cy = s.cy + (q.y - p.y); this.doc.repaint(); this.env.redrawOverlay(); };
    } else if (h === 'rotate') {
      const a0 = Math.atan2(p.y - s.cy, p.x - s.cx);
      this.drag = (q) => {
        let a = s.angle + Math.atan2(q.y - s.cy, q.x - s.cx) - a0;
        if (q.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        t.p.angle = a;
        this.doc.repaint();
        this.env.redrawOverlay();
      };
    } else {
      const c = Math.cos(s.angle), sn = Math.sin(s.angle);
      this.drag = (q) => {
        // work in the box's local frame captured at drag start
        const dx = q.x - s.cx, dy = q.y - s.cy;
        const lx = dx * c + dy * sn, ly = -dx * sn + dy * c;
        let sx = s.sx, sy = s.sy, ox = 0, oy = 0;
        if (h.hx) {
          const fixed = (-h.hx * t.w * s.sx) / 2;
          sx = ((lx - fixed) * h.hx) / t.w * Math.sign(s.sx || 1);
          ox = (lx + fixed) / 2;
        }
        if (h.hy) {
          const fixed = (-h.hy * t.h * s.sy) / 2;
          sy = ((ly - fixed) * h.hy) / t.h * Math.sign(s.sy || 1);
          oy = (ly + fixed) / 2;
        }
        if (q.shift && h.hx && h.hy) {
          // keep proportions: use the larger relative change
          const k = Math.max(Math.abs(sx / s.sx), Math.abs(sy / s.sy));
          const nsx = s.sx * k * Math.sign(sx / s.sx || 1), nsy = s.sy * k * Math.sign(sy / s.sy || 1);
          ox = (-h.hx * t.w * s.sx) / 2 + (h.hx * t.w * nsx) / 2;
          oy = (-h.hy * t.h * s.sy) / 2 + (h.hy * t.h * nsy) / 2;
          sx = nsx; sy = nsy;
        }
        if (Math.abs(sx) < 0.01) sx = 0.01 * Math.sign(sx || 1);
        if (Math.abs(sy) < 0.01) sy = 0.01 * Math.sign(sy || 1);
        t.p.sx = sx; t.p.sy = sy;
        t.p.cx = s.cx + ox * c - oy * sn;
        t.p.cy = s.cy + ox * sn + oy * c;
        this.doc.repaint();
        this.env.redrawOverlay();
      };
    }
    this.dragEnd = () => this.doc.emit();
  }

  // ---------- snapping ----------

  private snapRect(r: RectLike): RectLike {
    const doc = this.doc;
    if (!doc.ui.snap) return r;
    const tol = 6 / this.env.zoom();
    const xs = [0, doc.width, ...(doc.ui.showGuides ? doc.guides.filter((g) => g.axis === 'v').map((g) => g.pos) : [])];
    const ys = [0, doc.height, ...(doc.ui.showGuides ? doc.guides.filter((g) => g.axis === 'h').map((g) => g.pos) : [])];
    const snap = (v: number, list: number[]) => { for (const s of list) if (Math.abs(v - s) <= tol) return s; return v; };
    const x0 = snap(r.x, xs), y0 = snap(r.y, ys), x1 = snap(r.x + r.w, xs), y1 = snap(r.y + r.h, ys);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Selection bounds for the options/status display. */
  selectionInfo(): RectLike | null { return this.doc.selection ? maskBounds(this.doc.selection) : null; }
}

function pressureOf(p: PointerInfo) {
  return p.pointerType === 'pen' ? (p.pressure > 0 ? p.pressure : 0.5) : 1;
}

function transparentOf(hex: string) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0)`;
}

function labelOfShape(t: string) {
  return ({ rect: 'Rectangle', ellipse: 'Ellipse', triangle: 'Triangle', polygon: 'Polygon', line: 'Line' } as Record<string, string>)[t] ?? 'Shape';
}

function drawShapeInto(c: CanvasRenderingContext2D, s: { type: 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line'; w: number; h: number; fill: string | null; stroke: string | null; strokeWidth: number; sides: number; radius: number; pad: number; x1?: number; y1?: number; x2?: number; y2?: number }, ox: number, oy: number) {
  shapePath(c, s, ox, oy);
  if (s.type === 'line') { c.strokeStyle = s.stroke ?? '#000'; c.lineWidth = Math.max(1, s.strokeWidth); c.lineCap = 'round'; c.stroke(); return; }
  if (s.fill) { c.fillStyle = s.fill; c.fill(); }
  if (s.stroke && s.strokeWidth > 0) { c.strokeStyle = s.stroke; c.lineWidth = s.strokeWidth; c.stroke(); }
}

export function cursorFor(t: ToolId): string {
  switch (t) {
    case 'move': return 'default';
    case 'hand': return 'grab';
    case 'zoom': return 'zoom-in';
    case 'typeH': return 'text';
    case 'eyedropper': return 'copy';
    case 'brush': case 'pencil': case 'eraser': case 'clone': case 'historyBrush': case 'blur': case 'sharpen': case 'smudge': case 'dodge': case 'burn': case 'sponge': return 'none';
    default: return 'crosshair';
  }
}
