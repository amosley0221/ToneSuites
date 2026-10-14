// Page viewport math (mirrors pdf.js PageViewport) so overlays, blank pages and the pdf-lib writer
// share one coordinate system: PDF user space (y-up) <-> view pixels (y-down, rotated, scaled).
import type { Rect } from './model';

export type ViewBox = [number, number, number, number];

export interface Viewport {
  width: number;
  height: number;
  scale: number;
  rotation: number;
  transform: [number, number, number, number, number, number];
  toView: (x: number, y: number) => [number, number];
  toPdf: (vx: number, vy: number) => [number, number];
  /** User-space rect → view-space rect {left, top, width, height}. */
  rectToView: (r: Rect) => { left: number; top: number; width: number; height: number };
  /** Two view points → user-space rect. */
  rectFromView: (ax: number, ay: number, bx: number, by: number) => Rect;
}

export function normRot(r: number): 0 | 90 | 180 | 270 {
  const n = ((Math.round(r / 90) * 90) % 360 + 360) % 360;
  return n as 0 | 90 | 180 | 270;
}

export function makeViewport(view: ViewBox, rotation: number, scale: number): Viewport {
  const rot = normRot(rotation);
  const cx = (view[2] + view[0]) / 2, cy = (view[3] + view[1]) / 2;
  let a: number, b: number, c: number, d: number;
  switch (rot) {
    case 180: a = -1; b = 0; c = 0; d = 1; break;
    case 90: a = 0; b = 1; c = 1; d = 0; break;
    case 270: a = 0; b = -1; c = -1; d = 0; break;
    default: a = 1; b = 0; c = 0; d = -1;
  }
  let ox: number, oy: number, width: number, height: number;
  if (a === 0) {
    ox = Math.abs(cy - view[1]) * scale; oy = Math.abs(cx - view[0]) * scale;
    width = (view[3] - view[1]) * scale; height = (view[2] - view[0]) * scale;
  } else {
    ox = Math.abs(cx - view[0]) * scale; oy = Math.abs(cy - view[1]) * scale;
    width = (view[2] - view[0]) * scale; height = (view[3] - view[1]) * scale;
  }
  const t: Viewport['transform'] = [a * scale, b * scale, c * scale, d * scale, ox - a * scale * cx - c * scale * cy, oy - b * scale * cx - d * scale * cy];
  const toView = (x: number, y: number): [number, number] => [x * t[0] + y * t[2] + t[4], x * t[1] + y * t[3] + t[5]];
  const det = t[0] * t[3] - t[1] * t[2];
  const toPdf = (vx: number, vy: number): [number, number] => [
    ((vx - t[4]) * t[3] - (vy - t[5]) * t[2]) / det,
    (-(vx - t[4]) * t[1] + (vy - t[5]) * t[0]) / det,
  ];
  return {
    width, height, scale, rotation: rot, transform: t, toView, toPdf,
    rectToView: (r) => {
      const [x0, y0] = toView(r.x, r.y), [x1, y1] = toView(r.x + r.w, r.y + r.h);
      return { left: Math.min(x0, x1), top: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
    },
    rectFromView: (ax, ay, bx, by) => {
      const [x0, y0] = toPdf(ax, ay), [x1, y1] = toPdf(bx, by);
      return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
    },
  };
}
