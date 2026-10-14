// Canvas view: checkerboard + composite, overlays (selection, transform, crop, guides, rulers), pointer input.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { composite } from '../engine/composite';
import type { PixelDoc } from '../engine/doc';
import { maskBounds, maskOutline, type Mask } from '../engine/mask';
import { rerender, textBox, fontString } from '../engine/render';
import type { ToolController, PointerInfo } from './controller';

const RULER = 18;
const outlineCache = new WeakMap<Mask, Path2D>();
function outlinePath(m: Mask): Path2D {
  let p = outlineCache.get(m);
  if (!p) {
    p = new Path2D();
    const s = maskOutline(m);
    for (let i = 0; i < s.length; i += 4) { p.moveTo(s[i], s[i + 1]); p.lineTo(s[i + 2], s[i + 3]); }
    outlineCache.set(m, p);
  }
  return p;
}

export interface ViewApi {
  fit: () => void;
  zoomTo: (z: number, sx?: number, sy?: number) => void;
  zoomAt: (factor: number, sx: number, sy: number) => void;
  panBy: (dx: number, dy: number) => void;
  redrawOverlay: () => void;
  size: () => { w: number; h: number };
}

export function Viewport({ doc, ctl, apiRef, onEditText, textEdit, onTextDone, spaceHeld, cursorRef }: {
  doc: PixelDoc;
  ctl: ToolController;
  apiRef: React.MutableRefObject<ViewApi | null>;
  onEditText: (id: string, isNew: boolean) => void;
  textEdit: { id: string; isNew: boolean } | null;
  onTextDone: () => void;
  spaceHeld: React.MutableRefObject<boolean>;
  cursorRef: React.MutableRefObject<(c: string) => void>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const base = useRef<HTMLCanvasElement>(null);
  const over = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const ants = useRef(0);
  const raf = useRef({ base: 0, over: 0 });
  const fitted = useRef(false);
  const [, setTick] = useState(0);


  // ---------- drawing ----------
  const colors = () => {
    const cs = getComputedStyle(wrap.current!);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    return { check: v('--check', '#2a2a2e'), check2: v('--check2', '#1e1e22'), accent: v('--accent', '#ff5a1f'), info: v('--info', '#4f8ff7'), bg1: v('--bg1', '#141417'), mute: v('--mute', '#8d8d96'), line: v('--line', '#2b2b32') };
  };

  const drawBase = () => {
    raf.current.base = 0;
    const c = base.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    const { zoom, panX, panY } = doc.ui;
    const w = doc.width * zoom, h = doc.height * zoom;
    const col = colors();
    x.save();
    x.shadowColor = 'rgba(0,0,0,.45)';
    x.shadowBlur = 60;
    x.shadowOffsetY = 20;
    x.fillStyle = col.check2;
    x.fillRect(panX, panY, w, h);
    x.restore();
    // checkerboard (8px squares in screen space)
    x.save();
    x.beginPath();
    x.rect(panX, panY, w, h);
    x.clip();
    x.fillStyle = col.check;
    const x0 = Math.max(panX, 0), y0 = Math.max(panY, 0);
    const x1 = Math.min(panX + w, size.current.w), y1 = Math.min(panY + h, size.current.h);
    for (let yy = Math.floor((y0 - panY) / 8) * 8 + panY; yy < y1; yy += 8) {
      for (let xx = Math.floor((x0 - panX) / 8) * 8 + panX; xx < x1; xx += 8) {
        if ((Math.round((xx - panX) / 8) + Math.round((yy - panY) / 8)) % 2 === 0) x.fillRect(xx, yy, 8, 8);
      }
    }
    const comp = composite(doc);
    x.imageSmoothingEnabled = zoom < 1;
    x.imageSmoothingQuality = 'high';
    if (doc.ui.flipView) { x.translate(panX + w, panY); x.scale(-1, 1); x.drawImage(comp, 0, 0, w, h); }
    else x.drawImage(comp, panX, panY, w, h);
    x.restore();
  };

  const toScreen = (dx: number, dy: number): [number, number] => {
    const { zoom, panX, panY, flipView } = doc.ui;
    return [panX + (flipView ? doc.width - dx : dx) * zoom, panY + dy * zoom];
  };

  const drawOverlay = () => {
    raf.current.over = 0;
    const c = over.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const x = c.getContext('2d')!;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, c.width, c.height);
    const { zoom, panX, panY, flipView } = doc.ui;
    const col = colors();
    const docT = () => { x.setTransform(dpr * zoom * (flipView ? -1 : 1), 0, 0, dpr * zoom, dpr * (panX + (flipView ? doc.width * zoom : 0)), dpr * panY); };
    const scrT = () => x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = size.current.w, H = size.current.h;
    // grid
    if (doc.ui.showGrid) {
      const step = gridStep(zoom);
      x.strokeStyle = 'rgba(128,128,128,.35)';
      x.lineWidth = 1;
      x.beginPath();
      for (let gx = 0; gx <= doc.width; gx += step) { const [sx] = toScreen(gx, 0); x.moveTo(Math.round(sx) + 0.5, panY); x.lineTo(Math.round(sx) + 0.5, panY + doc.height * zoom); }
      for (let gy = 0; gy <= doc.height; gy += step) { const [, sy] = toScreen(0, gy); x.moveTo(panX, Math.round(sy) + 0.5); x.lineTo(panX + doc.width * zoom, Math.round(sy) + 0.5); }
      x.stroke();
    }
    if (doc.ui.showPixelGrid && zoom >= 8) {
      x.strokeStyle = 'rgba(128,128,128,.25)';
      x.beginPath();
      const gx0 = Math.max(0, Math.floor(-panX / zoom)), gx1 = Math.min(doc.width, Math.ceil((W - panX) / zoom));
      const gy0 = Math.max(0, Math.floor(-panY / zoom)), gy1 = Math.min(doc.height, Math.ceil((H - panY) / zoom));
      for (let gx = gx0; gx <= gx1; gx++) { const sx = Math.round(panX + gx * zoom) + 0.5; x.moveTo(sx, panY + gy0 * zoom); x.lineTo(sx, panY + gy1 * zoom); }
      for (let gy = gy0; gy <= gy1; gy++) { const sy = Math.round(panY + gy * zoom) + 0.5; x.moveTo(panX + gx0 * zoom, sy); x.lineTo(panX + gx1 * zoom, sy); }
      x.stroke();
    }
    // layer edges
    const al = doc.active;
    if (doc.ui.showLayerEdges && al?.canvas && al.kind !== 'group' && al.kind !== 'adjustment') {
      const [sx, sy] = toScreen(al.x, al.y);
      x.strokeStyle = col.info;
      x.strokeRect(Math.round(flipView ? sx - al.canvas.width * zoom : sx) + 0.5, Math.round(sy) + 0.5, al.canvas.width * zoom, al.canvas.height * zoom);
    }
    // guides
    if (doc.ui.showGuides && doc.ui.showExtras) {
      x.strokeStyle = col.info;
      x.lineWidth = 1;
      for (const g of doc.guides) {
        x.beginPath();
        if (g.axis === 'v') { const [sx] = toScreen(g.pos, 0); x.moveTo(Math.round(sx) + 0.5, 0); x.lineTo(Math.round(sx) + 0.5, H); }
        else { const [, sy] = toScreen(0, g.pos); x.moveTo(0, Math.round(sy) + 0.5); x.lineTo(W, Math.round(sy) + 0.5); }
        x.stroke();
      }
    }
    // selection marching ants
    const sel = doc.selection;
    if (sel && doc.ui.showExtras && !ctl.transform) {
      docT();
      const p = outlinePath(sel);
      x.lineWidth = 1 / zoom;
      x.setLineDash([]);
      x.strokeStyle = 'rgba(0,0,0,.55)';
      x.stroke(p);
      x.strokeStyle = col.accent;
      x.setLineDash([4 / zoom, 4 / zoom]);
      x.lineDashOffset = -ants.current / zoom;
      x.stroke(p);
      x.setLineDash([]);
      scrT();
      const b = maskBounds(sel);
      if (b && !ctl.overlay.marquee) {
        const [sx, sy] = toScreen(b.x, b.y + b.h);
        x.font = '10px "JetBrains Mono", monospace';
        x.fillStyle = col.accent;
        x.fillText(`${b.w} × ${b.h}${al ? ` · Layer: ${al.name}` : ''}`, flipView ? sx - b.w * zoom : sx, sy + 14);
      }
    }
    const o = ctl.overlay;
    x.setLineDash([]);
    if (o.marquee) {
      const r = o.marquee.r;
      docT();
      x.lineWidth = 1 / zoom;
      x.strokeStyle = col.accent;
      x.fillStyle = 'rgba(255,90,31,.06)';
      x.setLineDash([4 / zoom, 4 / zoom]);
      x.beginPath();
      if (o.marquee.kind === 'rect') x.rect(r.x, r.y, r.w, r.h); else x.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.1, r.w / 2), Math.max(0.1, r.h / 2), 0, 0, Math.PI * 2);
      x.fill(); x.stroke();
      x.setLineDash([]);
      scrT();
      const [sx, sy] = toScreen(r.x, r.y + r.h);
      x.font = '10px "JetBrains Mono", monospace';
      x.fillStyle = col.accent;
      x.fillText(`${r.w} × ${r.h}`, sx, sy + 14);
    }
    if (o.lasso && o.lasso.length) {
      docT();
      x.lineWidth = 1 / zoom;
      x.strokeStyle = col.accent;
      x.setLineDash([4 / zoom, 4 / zoom]);
      x.beginPath();
      o.lasso.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      if (o.rubber) x.lineTo(o.rubber[0], o.rubber[1]);
      x.stroke();
      x.setLineDash([]);
      scrT();
    }
    if (o.line) {
      const [ax, ay] = toScreen(o.line.x0, o.line.y0), [bx, by] = toScreen(o.line.x1, o.line.y1);
      x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(ax, ay); x.lineTo(bx, by); x.stroke();
      x.strokeStyle = '#000'; x.lineWidth = 1; x.stroke();
      for (const [px, py] of [[ax, ay], [bx, by]]) { x.fillStyle = '#fff'; x.fillRect(px - 4, py - 4, 8, 8); x.strokeRect(px - 4 + 0.5, py - 4 + 0.5, 7, 7); }
    }
    if (o.shape) {
      docT();
      x.lineWidth = 1 / zoom;
      x.strokeStyle = col.accent;
      const r = o.shape.r;
      x.beginPath();
      if (o.shape.kind === 'line' && o.shape.line) { x.moveTo(o.shape.line[0], o.shape.line[1]); x.lineTo(o.shape.line[2], o.shape.line[3]); }
      else if (o.shape.kind === 'ellipse') x.ellipse(r.x + r.w / 2, r.y + r.h / 2, Math.max(0.1, r.w / 2), Math.max(0.1, r.h / 2), 0, 0, Math.PI * 2);
      else x.rect(r.x, r.y, r.w, r.h);
      x.stroke();
      scrT();
    }
    // crop
    if (ctl.crop) {
      const r = ctl.crop;
      const [sx, sy] = toScreen(r.x, r.y);
      const rx = flipView ? sx - r.w * zoom : sx, rw = r.w * zoom, rh = r.h * zoom;
      x.fillStyle = 'rgba(0,0,0,.55)';
      x.beginPath();
      x.rect(0, 0, W, H);
      x.rect(rx + rw, sy, -rw, rh);
      x.fill('nonzero');
      drawBox(x, rx, sy, rw, rh, true);
      x.font = '10px "JetBrains Mono", monospace';
      x.fillStyle = '#fff';
      x.fillText(`${Math.round(r.w)} × ${Math.round(r.h)}`, rx, sy + rh + 14);
    }
    // free transform box
    const t = ctl.transform;
    if (t) {
      const cs = t.corners().map(([px, py]) => toScreen(px, py));
      x.strokeStyle = '#fff';
      x.lineWidth = 1;
      x.shadowColor = 'rgba(0,0,0,.6)';
      x.shadowBlur = 2;
      x.beginPath();
      cs.forEach(([px, py], i) => (i ? x.lineTo(px, py) : x.moveTo(px, py)));
      x.closePath();
      x.stroke();
      x.shadowBlur = 0;
      // thirds grid
      x.strokeStyle = 'rgba(255,255,255,.3)';
      const lerp = (a: number[], b: number[], k: number) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
      for (const k of [1 / 3, 2 / 3]) {
        const a = lerp(cs[0], cs[1], k), b = lerp(cs[3], cs[2], k), c2 = lerp(cs[0], cs[3], k), d = lerp(cs[1], cs[2], k);
        x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.moveTo(c2[0], c2[1]); x.lineTo(d[0], d[1]); x.stroke();
      }
      const mids = [lerp(cs[0], cs[1], 0.5), lerp(cs[1], cs[2], 0.5), lerp(cs[2], cs[3], 0.5), lerp(cs[3], cs[0], 0.5)];
      for (const [px, py] of [...cs, ...mids]) { x.fillStyle = '#fff'; x.fillRect(px - 4.5, py - 4.5, 9, 9); x.strokeStyle = '#000'; x.strokeRect(px - 4.5, py - 4.5, 9, 9); }
      const [cx, cy] = toScreen(t.p.cx, t.p.cy);
      x.strokeStyle = '#fff';
      x.beginPath(); x.arc(cx, cy, 5, 0, Math.PI * 2); x.stroke();
    }
    // clone source marker
    if (o.cloneSrc || (doc.ui.tool === 'clone' && doc.ui.cloneSource)) {
      const s = o.cloneSrc ?? doc.ui.cloneSource!;
      const [sx, sy] = toScreen(s.x, s.y);
      x.strokeStyle = '#fff'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(sx - 8, sy); x.lineTo(sx + 8, sy); x.moveTo(sx, sy - 8); x.lineTo(sx, sy + 8); x.stroke();
    }
    // brush cursor
    if (o.cursor && !spaceHeld.current) {
      const [sx, sy] = toScreen(o.cursor.x, o.cursor.y);
      const r = Math.max(1.5, o.cursor.r * zoom);
      x.lineWidth = 1;
      x.strokeStyle = 'rgba(0,0,0,.7)'; x.beginPath(); x.arc(sx, sy, r + 1, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(sx, sy, r, 0, Math.PI * 2); x.stroke();
      if (r < 4) { x.beginPath(); x.moveTo(sx - 6, sy); x.lineTo(sx + 6, sy); x.moveTo(sx, sy - 6); x.lineTo(sx, sy + 6); x.stroke(); }
    }
    if (doc.ui.showRulers) drawRulers(x, col);
  };

  const drawRulers = (x: CanvasRenderingContext2D, col: ReturnType<typeof colors>) => {
    const { zoom, panX, panY } = doc.ui;
    const W = size.current.w, H = size.current.h;
    x.fillStyle = col.bg1;
    x.fillRect(0, 0, W, RULER);
    x.fillRect(0, 0, RULER, H);
    x.strokeStyle = col.line;
    x.beginPath(); x.moveTo(0, RULER + 0.5); x.lineTo(W, RULER + 0.5); x.moveTo(RULER + 0.5, 0); x.lineTo(RULER + 0.5, H); x.stroke();
    const step = gridStep(zoom);
    x.font = '9px "JetBrains Mono", monospace';
    x.fillStyle = col.mute;
    x.strokeStyle = col.mute;
    x.beginPath();
    const vx0 = Math.floor(-panX / zoom / step) * step, vx1 = (W - panX) / zoom;
    for (let v = vx0; v <= vx1; v += step / 4) {
      const sx = Math.round(panX + v * zoom) + 0.5;
      if (sx < RULER) continue;
      const major = Math.abs(v % step) < 1e-6;
      x.moveTo(sx, major ? 4 : 13); x.lineTo(sx, RULER);
      if (major) x.fillText(String(Math.round(v)), sx + 2, 10);
    }
    const vy0 = Math.floor(-panY / zoom / step) * step, vy1 = (H - panY) / zoom;
    for (let v = vy0; v <= vy1; v += step / 4) {
      const sy = Math.round(panY + v * zoom) + 0.5;
      if (sy < RULER) continue;
      const major = Math.abs(v % step) < 1e-6;
      x.moveTo(major ? 4 : 13, sy); x.lineTo(RULER, sy);
      if (major) { x.save(); x.translate(10, sy + 2); x.rotate(-Math.PI / 2); x.fillText(String(Math.round(v)), 0, 0); x.restore(); }
    }
    x.stroke();
    x.fillStyle = col.bg1;
    x.fillRect(0, 0, RULER, RULER);
  };

  const scheduleBase = () => { if (!raf.current.base) raf.current.base = requestAnimationFrame(() => { drawBase(); drawOverlay(); }); };
  const scheduleOverlay = () => { if (!raf.current.over) raf.current.over = requestAnimationFrame(drawOverlay); };

  // ---------- view API ----------
  const fit = () => {
    const { w, h } = size.current;
    if (!w || !h) return;
    const pad = 48;
    const z = Math.min((w - pad * 2) / doc.width, (h - pad * 2) / doc.height);
    zoomTo(Math.max(0.01, z), undefined, undefined, true);
  };
  const zoomTo = (z: number, sx?: number, sy?: number, center = false) => {
    const nz = Math.max(0.01, Math.min(64, z));
    const { w, h } = size.current;
    if (center) { doc.ui.panX = Math.round((w - doc.width * nz) / 2); doc.ui.panY = Math.round((h - doc.height * nz) / 2); }
    else {
      const px = sx ?? w / 2, py = sy ?? h / 2;
      const dx = (px - doc.ui.panX) / doc.ui.zoom, dy = (py - doc.ui.panY) / doc.ui.zoom;
      doc.ui.panX = Math.round(px - dx * nz);
      doc.ui.panY = Math.round(py - dy * nz);
    }
    doc.ui.zoom = nz;
    scheduleBase();
    doc.emit();
  };
  const fitRect = (r: { x: number; y: number; w: number; h: number }) => {
    const { w, h } = size.current;
    const z = Math.max(0.01, Math.min(64, Math.min((w - 96) / r.w, (h - 96) / r.h)));
    doc.ui.zoom = z;
    doc.ui.panX = Math.round(w / 2 - (r.x + r.w / 2) * z);
    doc.ui.panY = Math.round(h / 2 - (r.y + r.h / 2) * z);
    scheduleBase();
    doc.emit();
  };
  const panBy = (dx: number, dy: number) => { doc.ui.panX += dx; doc.ui.panY += dy; scheduleBase(); };
  apiRef.current = {
    fit, zoomTo: (z, sx, sy) => zoomTo(z, sx, sy), zoomAt: (f, sx, sy) => zoomTo(doc.ui.zoom * f, sx, sy), panBy,
    redrawOverlay: scheduleOverlay, size: () => size.current,
  };
  doc.view = { fit, zoomTo: (z) => zoomTo(z), fitRect };

  // ---------- lifecycle ----------
  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = !size.current.w;
      const prev = size.current;
      size.current = { w: r.width, h: r.height };
      for (const c of [base.current!, over.current!]) { c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); c.style.width = r.width + 'px'; c.style.height = r.height + 'px'; }
      if (first && !fitted.current && r.width > 0) {
        fitted.current = true;
        const pad = 48;
        const z = Math.min(1, (r.width - pad * 2) / doc.width, (r.height - pad * 2) / doc.height);
        if (doc.ui.panX === 0 && doc.ui.panY === 0 && doc.ui.zoom === 1) zoomTo(Math.max(0.01, z), undefined, undefined, true);
      } else if (!first) {
        // keep the image centered when the area resizes
        doc.ui.panX += Math.round((r.width - prev.w) / 2);
        doc.ui.panY += Math.round((r.height - prev.h) / 2);
      }
      drawBase();
      drawOverlay();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  useEffect(() => {
    const offP = doc.onPaint(scheduleBase);
    const offS = doc.subscribe(scheduleBase);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const mo = new MutationObserver(scheduleBase);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
    media.addEventListener?.('change', scheduleBase);
    const iv = setInterval(() => { if (doc.selection && doc.ui.showExtras) { ants.current = (ants.current + 1) % 8; scheduleOverlay(); } }, 120);
    return () => { offP(); offS(); clearInterval(iv); mo.disconnect(); media.removeEventListener?.('change', scheduleBase); cancelAnimationFrame(raf.current.base); cancelAnimationFrame(raf.current.over); raf.current = { base: 0, over: 0 }; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // ---------- input ----------
  const info = (e: React.PointerEvent | React.MouseEvent | PointerEvent | MouseEvent): PointerInfo => {
    const r = over.current!.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const { zoom, panX, panY, flipView } = doc.ui;
    let x = (sx - panX) / zoom;
    if (flipView) x = doc.width - x;
    const pe = e as PointerEvent;
    return {
      x, y: (sy - panY) / zoom, sx, sy, pressure: pe.pressure ?? 0.5, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey,
      button: e.button, pointerType: pe.pointerType ?? 'mouse', detail: e.detail,
    };
  };

  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; cx: number; cy: number } | null>(null);
  const guideDrag = useRef<{ idx: number; axis: 'h' | 'v' } | null>(null);

  const setCursor = (c: string) => { if (over.current) over.current.style.cursor = spaceHeld.current ? 'grab' : c; };
  cursorRef.current = setCursor;

  const onDown = (e: React.PointerEvent) => {
    over.current!.setPointerCapture(e.pointerId);
    wrap.current?.focus();
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
        if (ctl.dragging) ctl.up(info(e));
        return;
      }
    }
    const p = info(e);
    if (textEdit) { onTextDone(); }
    if (e.button === 1 || spaceHeld.current) { ctl.tempHand(p); return; }
    if (e.button === 2) return;
    // rulers → new guide; existing guides draggable with the move tool
    if (doc.ui.showRulers && (p.sx < RULER || p.sy < RULER)) {
      const axis = p.sy < RULER ? 'h' : 'v';
      doc.guides = [...doc.guides, { axis, pos: Math.round(axis === 'v' ? p.x : p.y) }];
      doc.ui.showGuides = true;
      guideDrag.current = { idx: doc.guides.length - 1, axis };
      return;
    }
    if (doc.ui.tool === 'move' && doc.ui.showGuides && !doc.ui.lockGuides) {
      const tol = 4 / doc.ui.zoom;
      const gi = doc.guides.findIndex((g) => Math.abs((g.axis === 'v' ? p.x : p.y) - g.pos) <= tol);
      if (gi >= 0) { guideDrag.current = { idx: gi, axis: doc.guides[gi].axis }; return; }
    }
    ctl.down(p);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touches.current.size === 2) {
        const [a, b] = [...touches.current.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        const r = over.current!.getBoundingClientRect();
        panBy(cx - pinch.current.cx, cy - pinch.current.cy);
        zoomTo(doc.ui.zoom * (d / pinch.current.d), cx - r.left, cy - r.top);
        pinch.current = { d, cx, cy };
        return;
      }
    }
    const p = info(e);
    if (guideDrag.current) {
      const g = guideDrag.current;
      doc.guides = doc.guides.map((x, i) => (i === g.idx ? { ...x, pos: Math.round(g.axis === 'v' ? p.x : p.y) } : x));
      scheduleOverlay();
      return;
    }
    ctl.move(p);
  };
  const onUp = (e: React.PointerEvent) => {
    touches.current.delete(e.pointerId);
    if (pinch.current) { if (touches.current.size < 2) pinch.current = null; return; }
    if (guideDrag.current) {
      const g = guideDrag.current;
      guideDrag.current = null;
      const pos = doc.guides[g.idx]?.pos ?? 0;
      if (pos < 0 || pos > (g.axis === 'v' ? doc.width : doc.height)) doc.guides = doc.guides.filter((_, i) => i !== g.idx);
      doc.commit('Guide');
      return;
    }
    ctl.up(info(e));
  };
  const onLeave = () => { if (!ctl.dragging) { ctl.overlay.cursor = undefined; scheduleOverlay(); } };

  useEffect(() => {
    const el = over.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || e.altKey) zoomTo(doc.ui.zoom * Math.exp(-e.deltaY * (e.ctrlKey && Math.abs(e.deltaY) < 50 ? 0.01 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
      else panBy(e.shiftKey ? -e.deltaY : -e.deltaX, e.shiftKey ? 0 : -e.deltaY);
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  // ---------- inline type editing ----------
  const tl = textEdit ? doc.layer(textEdit.id) : undefined;
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!textEdit) return; const t = setTimeout(() => ta.current?.focus(), 0); return () => clearTimeout(t); }, [textEdit]);
  let taStyle: React.CSSProperties | null = null;
  if (tl?.text) {
    const b = textBox(tl);
    const [sx, sy] = toScreen(b.x, b.y);
    const z = doc.ui.zoom;
    const lines = (tl.text.text || ' ').split('\n').length;
    taStyle = {
      position: 'absolute', left: sx, top: sy, width: Math.max(40, b.w * z + tl.text.size * z), height: lines * tl.text.size * tl.text.leading * z + 4,
      font: fontString({ ...tl.text, size: tl.text.size * z }), lineHeight: `${tl.text.size * tl.text.leading * z}px`,
      letterSpacing: `${(tl.text.tracking / 1000) * tl.text.size * z}px`, textAlign: tl.text.align,
      color: 'transparent', caretColor: 'var(--accent)', background: 'transparent', border: '1px dashed var(--accent)', outline: 'none', resize: 'none',
      padding: 0, margin: 0, overflow: 'hidden', whiteSpace: 'pre', zIndex: 3,
    };
  }

  return (
    <div ref={wrap} tabIndex={-1} style={{ flex: 1, position: 'relative', overflow: 'hidden', background: 'var(--canvas)', outline: 'none', touchAction: 'none' }}>
      <canvas ref={base} style={{ position: 'absolute', left: 0, top: 0 }} />
      <canvas ref={over} style={{ position: 'absolute', left: 0, top: 0, touchAction: 'none' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onLeave}
        onDoubleClick={(e) => {
          if (doc.ui.tool === 'hand') fit();
          else if (doc.ui.tool === 'zoom') zoomTo(1);
          else if (doc.ui.tool === 'move') {
            const hit = ctl.pickLayer(info(e).x, info(e).y);
            if (hit?.kind === 'text') { doc.activeId = hit.id; onEditText(hit.id, false); }
          }
        }}
        onContextMenu={(e) => e.preventDefault()} />
      {tl?.text && taStyle && (
        <textarea ref={ta} value={tl.text.text} spellCheck={false} style={taStyle}
          onChange={(e) => {
            tl.text = { ...tl.text!, text: e.target.value };
            const first = e.target.value.split('\n')[0].trim();
            if (first) tl.name = first.slice(0, 32);
            rerender(tl);
            doc.repaint();
            setTick((n) => n + 1);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); onTextDone(); }
          }}
          onBlur={() => onTextDone()} />
      )}
    </div>
  );
}

function gridStep(zoom: number) {
  const target = 80 / zoom;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  return steps.find((s) => s >= target) ?? 10000;
}

function drawBox(x: CanvasRenderingContext2D, rx: number, ry: number, rw: number, rh: number, thirds: boolean) {
  x.strokeStyle = '#fff';
  x.lineWidth = 1;
  x.strokeRect(Math.round(rx) + 0.5, Math.round(ry) + 0.5, Math.round(rw), Math.round(rh));
  if (thirds) {
    x.strokeStyle = 'rgba(255,255,255,.3)';
    x.beginPath();
    for (const k of [1 / 3, 2 / 3]) { x.moveTo(rx + rw * k, ry); x.lineTo(rx + rw * k, ry + rh); x.moveTo(rx, ry + rh * k); x.lineTo(rx + rw, ry + rh * k); }
    x.stroke();
  }
  for (const [px, py] of [[rx, ry], [rx + rw / 2, ry], [rx + rw, ry], [rx + rw, ry + rh / 2], [rx + rw, ry + rh], [rx + rw / 2, ry + rh], [rx, ry + rh], [rx, ry + rh / 2]]) {
    x.fillStyle = '#fff'; x.fillRect(px - 4.5, py - 4.5, 9, 9); x.strokeStyle = '#000'; x.strokeRect(px - 4.5, py - 4.5, 9, 9);
  }
}

