// Pure selection-mask operations. A mask is a doc-sized 0..255 coverage buffer.
import { gaussFloat, luma, type Img } from './img';

export interface Mask { w: number; h: number; data: Uint8Array }
export interface Rect { x: number; y: number; w: number; h: number }
export type CombineOp = 'replace' | 'add' | 'subtract' | 'intersect';

export const emptyMask = (w: number, h: number): Mask => ({ w, h, data: new Uint8Array(w * h) });
export function fullMask(w: number, h: number): Mask { const m = emptyMask(w, h); m.data.fill(255); return m; }
export const cloneMask = (m: Mask): Mask => ({ w: m.w, h: m.h, data: new Uint8Array(m.data) });

export function rectMask(w: number, h: number, r: Rect): Mask {
  const m = emptyMask(w, h);
  const x0 = Math.max(0, Math.round(r.x)), y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(w, Math.round(r.x + r.w)), y1 = Math.min(h, Math.round(r.y + r.h));
  for (let y = y0; y < y1; y++) m.data.fill(255, y * w + x0, y * w + Math.max(x0, x1));
  return m;
}

/** Ellipse inscribed in rect, with 4×4 supersampled anti-aliasing on the edge. */
export function ellipseMask(w: number, h: number, r: Rect): Mask {
  const m = emptyMask(w, h);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rx = r.w / 2, ry = r.h / 2;
  if (rx <= 0 || ry <= 0) return m;
  const y0 = Math.max(0, Math.floor(r.y)), y1 = Math.min(h, Math.ceil(r.y + r.h));
  const x0 = Math.max(0, Math.floor(r.x)), x1 = Math.min(w, Math.ceil(r.x + r.w));
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    let inside = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + 0.5) / 4 - cx) / rx, py = (y + (sy + 0.5) / 4 - cy) / ry;
      if (px * px + py * py <= 1) inside++;
    }
    m.data[y * w + x] = Math.round((inside / 16) * 255);
  }
  return m;
}

/** Even-odd polygon fill sampled at pixel centers. */
export function polygonMask(w: number, h: number, pts: [number, number][]): Mask {
  const m = emptyMask(w, h);
  if (pts.length < 3) return m;
  const xs: number[] = [];
  for (let y = 0; y < h; y++) {
    const cy = y + 0.5;
    xs.length = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(w, Math.ceil(xs[k + 1] - 0.5));
      if (b > a) m.data.fill(255, y * w + a, y * w + b);
    }
  }
  return m;
}

export function combine(base: Mask | null, add: Mask, op: CombineOp): Mask {
  if (op === 'replace') return add;
  if (!base) return op === 'add' ? add : emptyMask(add.w, add.h);
  const out = emptyMask(base.w, base.h);
  const a = base.data, b = add.data, d = out.data;
  for (let i = 0; i < d.length; i++) {
    d[i] = op === 'add' ? Math.max(a[i], b[i]) : op === 'subtract' ? Math.max(0, a[i] - b[i]) : Math.min(a[i], b[i]);
  }
  return out;
}

export function invertMask(m: Mask): Mask {
  const out = emptyMask(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) out.data[i] = 255 - m.data[i];
  return out;
}

export function isEmpty(m: Mask | null): boolean {
  if (!m) return true;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) return false;
  return true;
}

export function maskBounds(m: Mask, threshold = 1): Rect | null {
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let y = 0; y < m.h; y++) {
    const row = y * m.w;
    for (let x = 0; x < m.w; x++) {
      if (m.data[row + x] >= threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Squared euclidean distance transform (Felzenszwalb) to the nearest "on" pixel. */
function distanceTransform(on: Uint8Array, w: number, h: number): Float32Array {
  const INF = 1e20;
  const f = new Float32Array(Math.max(w, h));
  const dt = new Float32Array(w * h);
  for (let i = 0; i < on.length; i++) dt[i] = on[i] ? 0 : INF;
  const d = new Float32Array(Math.max(w, h));
  const v = new Int32Array(Math.max(w, h));
  const z = new Float32Array(Math.max(w, h) + 1);
  const pass = (n: number) => {
    let k = 0;
    v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = dt[y * w + x];
    pass(h);
    for (let y = 0; y < h; y++) dt[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = dt[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) dt[y * w + x] = d[x];
  }
  return dt;
}

/** Grow the selection outward by r pixels (circular structuring element). */
export function expandMask(m: Mask, r: number): Mask {
  if (r <= 0) return cloneMask(m);
  const on = new Uint8Array(m.data.length);
  for (let i = 0; i < on.length; i++) on[i] = m.data[i] >= 128 ? 1 : 0;
  const dt = distanceTransform(on, m.w, m.h);
  const out = emptyMask(m.w, m.h);
  const r2 = r * r;
  for (let i = 0; i < on.length; i++) out.data[i] = dt[i] <= r2 ? 255 : 0;
  return out;
}

export function contractMask(m: Mask, r: number): Mask {
  if (r <= 0) return cloneMask(m);
  return invertMask(expandMask(invertMask(m), r));
}

export function borderMask(m: Mask, width: number): Mask {
  const half = Math.max(1, Math.round(width / 2));
  return combine(expandMask(m, half), contractMask(m, half), 'subtract');
}

export function featherMask(m: Mask, radius: number): Mask {
  if (radius <= 0) return cloneMask(m);
  const f = new Float32Array(m.data.length);
  for (let i = 0; i < f.length; i++) f[i] = m.data[i];
  gaussFloat(f, m.w, m.h, 1, radius);
  const out = emptyMask(m.w, m.h);
  for (let i = 0; i < f.length; i++) out.data[i] = Math.max(0, Math.min(255, Math.round(f[i])));
  return out;
}

/** Blur then re-threshold: rounds corners and removes specks. */
export function smoothMask(m: Mask, radius: number): Mask {
  const f = featherMask(m, radius);
  for (let i = 0; i < f.data.length; i++) f.data[i] = f.data[i] >= 128 ? 255 : 0;
  return f;
}

const colorDist = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number) =>
  Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b), Math.abs(d[i + 3] - a));

/** Magic wand: pixels within `tolerance` of the seed color, contiguous (scanline flood) or global. */
export function magicWand(img: Img, sx: number, sy: number, tolerance: number, contiguous: boolean): Mask {
  const { width: w, height: h, data: d } = img;
  const m = emptyMask(w, h);
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return m;
  const s = (sy * w + sx) * 4;
  const r = d[s], g = d[s + 1], b = d[s + 2], a = d[s + 3];
  const ok = (p: number) => colorDist(d, p * 4, r, g, b, a) <= tolerance;
  if (!contiguous) {
    for (let p = 0; p < w * h; p++) if (ok(p)) m.data[p] = 255;
    return m;
  }
  const stack: number[] = [sx, sy];
  while (stack.length) {
    const y = stack.pop()!, x0 = stack.pop()!;
    let x = x0;
    while (x >= 0 && !m.data[y * w + x] && ok(y * w + x)) x--;
    x++;
    let up = false, down = false;
    while (x < w && !m.data[y * w + x] && ok(y * w + x)) {
      m.data[y * w + x] = 255;
      if (y > 0) {
        const q = (y - 1) * w + x;
        if (!m.data[q] && ok(q)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false;
      }
      if (y < h - 1) {
        const q = (y + 1) * w + x;
        if (!m.data[q] && ok(q)) { if (!down) { stack.push(x, y + 1); down = true; } } else down = false;
      }
      x++;
    }
  }
  return m;
}

/** Color range: soft selection of pixels near `color` (fuzziness 0..200 like Photoshop). */
export function colorRange(img: Img, color: [number, number, number], fuzziness: number): Mask {
  const { width: w, height: h, data: d } = img;
  const m = emptyMask(w, h);
  const f = Math.max(1, fuzziness);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (!d[i + 3]) continue;
    const dist = Math.sqrt((d[i] - color[0]) ** 2 + (d[i + 1] - color[1]) ** 2 + (d[i + 2] - color[2]) ** 2) / 1.732;
    const t = 1 - dist / f;
    if (t > 0) m.data[p] = Math.round(Math.min(1, t * 2) * 255);
  }
  return m;
}

/** Luminance range (highlights/midtones/shadows) helper for Color range presets. */
export function toneRange(img: Img, which: 'highlights' | 'midtones' | 'shadows'): Mask {
  const { width: w, height: h, data: d } = img;
  const m = emptyMask(w, h);
  for (let p = 0; p < w * h; p++) {
    const l = luma(d[p * 4], d[p * 4 + 1], d[p * 4 + 2]) / 255;
    const v = which === 'highlights' ? (l - 0.6) / 0.3 : which === 'shadows' ? (0.4 - l) / 0.3 : 1 - Math.abs(l - 0.5) / 0.25;
    m.data[p] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
  return m;
}

function selectedColorBounds(img: Img, sel: Mask, tolerance: number) {
  const lo = [255, 255, 255], hi = [0, 0, 0];
  const d = img.data;
  for (let p = 0; p < sel.data.length; p++) {
    if (sel.data[p] < 128) continue;
    for (let c = 0; c < 3; c++) { lo[c] = Math.min(lo[c], d[p * 4 + c]); hi[c] = Math.max(hi[c], d[p * 4 + c]); }
  }
  return { lo: lo.map((v) => v - tolerance), hi: hi.map((v) => v + tolerance) };
}

/** Select › Similar: every pixel whose color falls in the selected pixels' range ± tolerance. */
export function similarMask(img: Img, sel: Mask, tolerance: number): Mask {
  const { lo, hi } = selectedColorBounds(img, sel, tolerance);
  const out = cloneMask(sel);
  const d = img.data;
  for (let p = 0; p < out.data.length; p++) {
    const i = p * 4;
    if (d[i] >= lo[0] && d[i] <= hi[0] && d[i + 1] >= lo[1] && d[i + 1] <= hi[1] && d[i + 2] >= lo[2] && d[i + 2] <= hi[2]) out.data[p] = 255;
  }
  return out;
}

/** Select › Grow: like Similar but only regions connected to the current selection. */
export function growMask(img: Img, sel: Mask, tolerance: number): Mask {
  const { lo, hi } = selectedColorBounds(img, sel, tolerance);
  const { w, h } = sel;
  const d = img.data;
  const out = cloneMask(sel);
  const ok = (p: number) => {
    const i = p * 4;
    return d[i] >= lo[0] && d[i] <= hi[0] && d[i + 1] >= lo[1] && d[i + 1] <= hi[1] && d[i + 2] >= lo[2] && d[i + 2] <= hi[2];
  };
  const queue: number[] = [];
  for (let p = 0; p < out.data.length; p++) if (out.data[p] >= 128) queue.push(p);
  while (queue.length) {
    const p = queue.pop()!;
    const x = p % w, y = (p - x) / w;
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of nb) if (q >= 0 && out.data[q] < 128 && ok(q)) { out.data[q] = 255; queue.push(q); }
  }
  return out;
}

/** Alpha channel of an image as a mask (Layer › Mask from transparency, Ctrl-click thumbnail). */
export function alphaToMask(img: Img): Mask {
  const m = emptyMask(img.width, img.height);
  for (let p = 0; p < m.data.length; p++) m.data[p] = img.data[p * 4 + 3];
  return m;
}

/** Nearest-neighbour resample (Image size). */
export function resampleMask(m: Mask, w: number, h: number): Mask {
  const out = emptyMask(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(m.h - 1, Math.floor((y * m.h) / h));
    for (let x = 0; x < w; x++) out.data[y * w + x] = m.data[sy * m.w + Math.min(m.w - 1, Math.floor((x * m.w) / w))];
  }
  return out;
}

/** Copy a mask into a new canvas size with an offset (Canvas size, crop). */
export function offsetMask(m: Mask, w: number, h: number, dx: number, dy: number): Mask {
  const out = emptyMask(w, h);
  for (let y = 0; y < h; y++) {
    const sy = y - dy;
    if (sy < 0 || sy >= m.h) continue;
    for (let x = 0; x < w; x++) {
      const sx = x - dx;
      if (sx >= 0 && sx < m.w) out.data[y * w + x] = m.data[sy * m.w + sx];
    }
  }
  return out;
}

/**
 * Boundary segments of the 50% threshold for marching ants: horizontal and vertical
 * runs as flat [x0,y0,x1,y1,...] lists in pixel-edge coordinates.
 */
export function maskOutline(m: Mask): number[] {
  const { w, h, data } = m;
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && data[y * w + x] >= 128;
  const segs: number[] = [];
  // horizontal edges between row y-1 and y
  for (let y = 0; y <= h; y++) {
    let start = -1;
    for (let x = 0; x <= w; x++) {
      const edge = x < w && on(x, y - 1) !== on(x, y);
      if (edge && start < 0) start = x;
      else if (!edge && start >= 0) { segs.push(start, y, x, y); start = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {
    let start = -1;
    for (let y = 0; y <= h; y++) {
      const edge = y < h && on(x - 1, y) !== on(x, y);
      if (edge && start < 0) start = y;
      else if (!edge && start >= 0) { segs.push(x, start, x, y); start = -1; }
    }
  }
  return segs;
}

/** Rotate a mask by 90° clockwise (1), 180° (2) or 90° counter-clockwise (3). */
export function rotateMask(m: Mask, quarter: 1 | 2 | 3): Mask {
  const { w, h } = m;
  const out = quarter === 2 ? emptyMask(w, h) : emptyMask(h, w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = m.data[y * w + x];
    if (quarter === 1) out.data[x * h + (h - 1 - y)] = v;
    else if (quarter === 2) out.data[(h - 1 - y) * w + (w - 1 - x)] = v;
    else out.data[(w - 1 - x) * h + y] = v;
  }
  return out;
}

export function flipMask(m: Mask, horizontal: boolean): Mask {
  const { w, h } = m;
  const out = emptyMask(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    out.data[y * w + x] = horizontal ? m.data[y * w + (w - 1 - x)] : m.data[(h - 1 - y) * w + x];
  }
  return out;
}
