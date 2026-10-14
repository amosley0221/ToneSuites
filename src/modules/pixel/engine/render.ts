// Live (re-renderable) layer content: type and shape layers.
import { ctx2d, newCanvas } from './canvas';
import type { Layer, ShapeData, TextData } from './doc';

export const FONT_FAMILIES = [
  'Archivo', 'JetBrains Mono', 'Arial', 'Helvetica', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman',
  'Garamond', 'Courier New', 'Impact', 'Comic Sans MS', 'system-ui', 'serif', 'sans-serif', 'monospace',
];
export const FONT_WEIGHTS: { value: string; label: string }[] = [
  { value: '300', label: 'Light' }, { value: '400', label: 'Regular' }, { value: '500', label: 'Medium' },
  { value: '600', label: 'Semibold' }, { value: '700', label: 'Bold' }, { value: '800', label: 'Extra bold' }, { value: '900', label: 'Black' },
];

export const fontString = (t: TextData) => `${t.italic ? 'italic ' : ''}${t.weight} ${t.size}px "${t.font}", sans-serif`;

export function textPad(t: TextData) { return Math.ceil(t.size * 0.3) + 2; }

/** Measure + draw text into a fresh canvas. Keeps the text anchor (layer.x+pad, layer.y+pad) stable. */
export function renderText(l: Layer) {
  const t = l.text!;
  const probe = ctx2d(newCanvas(1, 1));
  probe.font = fontString(t);
  try { (probe as any).letterSpacing = `${(t.tracking / 1000) * t.size}px`; } catch { /* unsupported */ }
  const lines = (t.text || ' ').split('\n');
  const widths = lines.map((s) => probe.measureText(s || ' ').width);
  const lineH = t.size * t.leading;
  const pad = textPad(t);
  const boxW = Math.max(1, Math.ceil(Math.max(...widths)));
  const c = newCanvas(boxW + pad * 2, Math.ceil(lineH * lines.length) + pad * 2);
  const x = ctx2d(c);
  x.font = fontString(t);
  try { (x as any).letterSpacing = `${(t.tracking / 1000) * t.size}px`; } catch { /* unsupported */ }
  x.fillStyle = t.color;
  x.textBaseline = 'alphabetic';
  lines.forEach((s, i) => {
    const w = widths[i];
    const lx = pad + (t.align === 'center' ? (boxW - w) / 2 : t.align === 'right' ? boxW - w : 0);
    const by = pad + i * lineH + (lineH - t.size) / 2 + t.size * 0.82;
    x.fillText(s, lx, by);
    if (t.underline) x.fillRect(lx, by + t.size * 0.1, w, Math.max(1, t.size / 18));
  });
  l.canvas = c;
}

/** Text box rect in doc coordinates (used for hit-testing and the type editor overlay). */
export function textBox(l: Layer) {
  const pad = textPad(l.text!);
  return { x: l.x + pad, y: l.y + pad, w: (l.canvas?.width ?? pad * 2) - pad * 2, h: (l.canvas?.height ?? pad * 2) - pad * 2 };
}

export function shapePad(s: ShapeData) {
  return Math.ceil((s.stroke ? s.strokeWidth : 0) / 2) + 2;
}

export function shapePath(ctx: CanvasRenderingContext2D, s: ShapeData, ox: number, oy: number) {
  const { w, h } = s;
  ctx.beginPath();
  switch (s.type) {
    case 'rect':
      if (s.radius > 0 && (ctx as any).roundRect) (ctx as any).roundRect(ox, oy, w, h, Math.min(s.radius, w / 2, h / 2));
      else ctx.rect(ox, oy, w, h);
      break;
    case 'ellipse': ctx.ellipse(ox + w / 2, oy + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2); break;
    case 'triangle': ctx.moveTo(ox + w / 2, oy); ctx.lineTo(ox + w, oy + h); ctx.lineTo(ox, oy + h); ctx.closePath(); break;
    case 'polygon': {
      const n = Math.max(3, Math.round(s.sides));
      for (let i = 0; i < n; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        const px = ox + w / 2 + (Math.cos(a) * w) / 2, py = oy + h / 2 + (Math.sin(a) * h) / 2;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case 'line': ctx.moveTo(ox + (s.x1 ?? 0), oy + (s.y1 ?? 0)); ctx.lineTo(ox + (s.x2 ?? w), oy + (s.y2 ?? h)); break;
  }
}

/** Re-render a shape layer; keeps the shape box position stable when padding changes. */
export function renderShape(l: Layer) {
  const s = l.shape!;
  const oldPad = s.pad;
  const pad = s.type === 'line' ? Math.ceil(Math.max(1, s.strokeWidth) / 2) + 2 : shapePad(s);
  l.x += oldPad - pad;
  l.y += oldPad - pad;
  s.pad = pad;
  const c = newCanvas(Math.ceil(s.w) + pad * 2, Math.ceil(s.h) + pad * 2);
  const x = ctx2d(c);
  shapePath(x, s, pad, pad);
  if (s.type === 'line') {
    x.strokeStyle = s.stroke ?? s.fill ?? '#000';
    x.lineWidth = Math.max(1, s.strokeWidth);
    x.lineCap = 'round';
    x.stroke();
  } else {
    if (s.fill) { x.fillStyle = s.fill; x.fill(); }
    if (s.stroke && s.strokeWidth > 0) { x.strokeStyle = s.stroke; x.lineWidth = s.strokeWidth; x.stroke(); }
  }
  l.canvas = c;
}

export function rerender(l: Layer) {
  if (l.kind === 'text' && l.text) renderText(l);
  else if (l.kind === 'shape' && l.shape) renderShape(l);
}
