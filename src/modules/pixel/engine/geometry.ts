// Pure size/units math for New canvas, Image size, Canvas size and transforms.

export type Unit = 'px' | 'in' | 'cm' | 'mm';

export function toPx(v: number, unit: Unit, ppi: number): number {
  switch (unit) {
    case 'px': return Math.round(v);
    case 'in': return Math.round(v * ppi);
    case 'cm': return Math.round((v / 2.54) * ppi);
    case 'mm': return Math.round((v / 25.4) * ppi);
  }
}

export function fromPx(px: number, unit: Unit, ppi: number): number {
  switch (unit) {
    case 'px': return px;
    case 'in': return round2(px / ppi);
    case 'cm': return round2((px / ppi) * 2.54);
    case 'mm': return round2((px / ppi) * 25.4);
  }
}

const round2 = (v: number) => Math.round(v * 100) / 100;

export const MAX_DIM = 30000;
export const clampDim = (v: number) => Math.max(1, Math.min(MAX_DIM, Math.round(v) || 1));

/** Constrained resize: when one side changes, the other follows the original aspect ratio. */
export function constrainSize(origW: number, origH: number, changed: 'w' | 'h', value: number): { w: number; h: number } {
  const v = clampDim(value);
  return changed === 'w' ? { w: v, h: clampDim((v * origH) / origW) } : { w: clampDim((v * origW) / origH), h: v };
}

/** Byte size of an 8-bit RGBA image. */
export const rgbaBytes = (w: number, h: number) => w * h * 4;

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB';
  if (n >= 1024) return Math.round(n / 1024) + ' KB';
  return n + ' B';
}

/**
 * Canvas size anchor (0..8, row-major 3×3; 4 = center) → offset of old content inside the new canvas.
 */
export function anchorOffset(oldW: number, oldH: number, newW: number, newH: number, anchor: number): { dx: number; dy: number } {
  const ax = anchor % 3, ay = Math.floor(anchor / 3);
  return {
    dx: ax === 0 ? 0 : ax === 1 ? Math.round((newW - oldW) / 2) : newW - oldW,
    dy: ay === 0 ? 0 : ay === 1 ? Math.round((newH - oldH) / 2) : newH - oldH,
  };
}

export interface RectLike { x: number; y: number; w: number; h: number }

/** Axis-aligned bounds of a w×h box scaled by (sx,sy), rotated by `angle` around its center (cx,cy). */
export function transformedBounds(w: number, h: number, cx: number, cy: number, sx: number, sy: number, angle: number): RectLike {
  const c = Math.cos(angle), s = Math.sin(angle);
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => {
    const X = x * sx, Y = y * sy;
    return [cx + X * c - Y * s, cy + X * s + Y * c];
  });
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.floor(Math.min(...xs)), y0 = Math.floor(Math.min(...ys));
  return { x: x0, y: y0, w: Math.ceil(Math.max(...xs)) - x0, h: Math.ceil(Math.max(...ys)) - y0 };
}

export function unionRect(a: RectLike, b: RectLike): RectLike {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function intersectRect(a: RectLike, b: RectLike): RectLike | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}

/** Normalize a drag from (x0,y0) to (x1,y1) into a rect; `square` constrains, `fromCenter` mirrors around start. */
export function dragRect(x0: number, y0: number, x1: number, y1: number, square: boolean, fromCenter: boolean): RectLike {
  let dx = x1 - x0, dy = y1 - y0;
  if (square) { const m = Math.max(Math.abs(dx), Math.abs(dy)); dx = Math.sign(dx || 1) * m; dy = Math.sign(dy || 1) * m; }
  if (fromCenter) return { x: x0 - Math.abs(dx), y: y0 - Math.abs(dy), w: Math.abs(dx) * 2, h: Math.abs(dy) * 2 };
  return { x: Math.min(x0, x0 + dx), y: Math.min(y0, y0 + dy), w: Math.abs(dx), h: Math.abs(dy) };
}

/** Canvas presets for New canvas (feature list). */
export const CANVAS_PRESETS: { id: string; label: string; w: number; h: number; unit: Unit; ppi: number; hint: string }[] = [
  { id: 'letter', label: 'Letter', w: 8.5, h: 11, unit: 'in', ppi: 300, hint: '8.5 × 11 in' },
  { id: 'a4', label: 'A4', w: 21, h: 29.7, unit: 'cm', ppi: 300, hint: '21 × 29.7 cm' },
  { id: 'hd', label: '1920 × 1080', w: 1920, h: 1080, unit: 'px', ppi: 72, hint: 'HD' },
  { id: '4k', label: '4K UHD', w: 3840, h: 2160, unit: 'px', ppi: 72, hint: '3840 × 2160' },
  { id: 'square', label: 'Square 2048', w: 2048, h: 2048, unit: 'px', ppi: 72, hint: '2048 px' },
  { id: 'insta', label: 'Instagram portrait', w: 1080, h: 1350, unit: 'px', ppi: 72, hint: '1080 × 1350' },
];
