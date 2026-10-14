// Pure filter implementations on Img buffers (unit-tested; no DOM).
import {
  clamp, cloneImg, createImg, fromPremul, gaussFloat, boxBlurFloat, luma, rng, toPremul, type Img,
} from './img';

export interface FilterParam {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit?: string;
  /** Rendered as a checkbox (0/1). */
  toggle?: boolean;
}

export interface FilterDef {
  id: string;
  name: string;
  cat: 'Blur' | 'Sharpen' | 'Noise' | 'Stylize' | 'Distort' | 'Light' | 'Pixelate' | 'Other';
  params: FilterParam[];
  /** Shown as a tile in the Filter gallery. */
  gallery: boolean;
  /** Not implemented yet (tile shown disabled). */
  planned?: boolean;
  run: (img: Img, p: Record<string, number>, ctx: FilterCtx) => Img;
}

export interface FilterCtx { seed: number; fg: [number, number, number]; bg: [number, number, number] }

const P = (id: string, label: string, min: number, max: number, def: number, step = 1, unit?: string): FilterParam =>
  ({ id, label, min, max, step, default: def, unit });
const T = (id: string, label: string, def: 0 | 1): FilterParam => ({ id, label, min: 0, max: 1, step: 1, default: def, toggle: true });

// ---------- building blocks ----------

export function gaussianBlur(img: Img, radius: number): Img {
  if (radius <= 0.2) return cloneImg(img);
  const f = toPremul(img);
  gaussFloat(f, img.width, img.height, 4, radius);
  return fromPremul(f, img.width, img.height);
}

export function boxBlur(img: Img, radius: number): Img {
  const r = Math.round(radius);
  if (r < 1) return cloneImg(img);
  const f = toPremul(img);
  boxBlurFloat(f, img.width, img.height, 4, r);
  return fromPremul(f, img.width, img.height);
}

function sampleBilinear(f: Float32Array, w: number, h: number, x: number, y: number, c: number): number {
  x = x < 0 ? 0 : x > w - 1 ? w - 1 : x;
  y = y < 0 ? 0 : y > h - 1 ? h - 1 : y;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = x - x0, fy = y - y0;
  const a = f[(y0 * w + x0) * 4 + c], b = f[(y0 * w + x1) * 4 + c];
  const d = f[(y1 * w + x0) * 4 + c], e = f[(y1 * w + x1) * 4 + c];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
}

export function motionBlur(img: Img, angleDeg: number, distance: number): Img {
  const { width: w, height: h } = img;
  const n = Math.max(1, Math.round(distance));
  if (n < 2) return cloneImg(img);
  const f = toPremul(img);
  const out = new Float32Array(f.length);
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(a), dy = -Math.sin(a);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0, al = 0;
      for (let k = 0; k < n; k++) {
        const t = k - (n - 1) / 2;
        const sx = x + dx * t, sy = y + dy * t;
        r += sampleBilinear(f, w, h, sx, sy, 0);
        g += sampleBilinear(f, w, h, sx, sy, 1);
        b += sampleBilinear(f, w, h, sx, sy, 2);
        al += sampleBilinear(f, w, h, sx, sy, 3);
      }
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = al / n;
    }
  }
  return fromPremul(out, w, h);
}

/** orig + amount * (orig - blurred), optionally gated by a luminance threshold. */
export function unsharpMask(img: Img, amountPct: number, radius: number, threshold = 0): Img {
  const blurred = gaussianBlur(img, radius);
  const out = cloneImg(img);
  const d = out.data, s = img.data, b = blurred.data;
  const k = amountPct / 100;
  for (let i = 0; i < d.length; i += 4) {
    if (threshold > 0) {
      const diff = Math.abs(luma(s[i], s[i + 1], s[i + 2]) - luma(b[i], b[i + 1], b[i + 2]));
      if (diff * 2 < threshold) continue;
    }
    d[i] = s[i] + (s[i] - b[i]) * k;
    d[i + 1] = s[i + 1] + (s[i + 1] - b[i + 1]) * k;
    d[i + 2] = s[i + 2] + (s[i + 2] - b[i + 2]) * k;
  }
  return out;
}

/** 3×3 convolution on RGB (alpha untouched), edge-clamped. */
export function convolve3(img: Img, k: number[], divisor = 1, offset = 0): Img {
  const { width: w, height: h } = img;
  const out = cloneImg(img);
  const s = img.data, d = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let j = -1; j <= 1; j++) {
          const yy = y + j < 0 ? 0 : y + j >= h ? h - 1 : y + j;
          for (let i = -1; i <= 1; i++) {
            const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
            acc += s[(yy * w + xx) * 4 + c] * k[(j + 1) * 3 + (i + 1)];
          }
        }
        d[o + c] = acc / divisor + offset;
      }
    }
  }
  return out;
}

export function sharpen(img: Img, amountPct: number): Img {
  const a = amountPct / 100;
  return convolve3(img, [0, -a, 0, -a, 1 + 4 * a, -a, 0, -a, 0]);
}

export function addNoise(img: Img, amountPct: number, mono: boolean, gaussian: boolean, seed: number): Img {
  const out = cloneImg(img);
  const d = out.data;
  const rand = rng(seed);
  const amp = (amountPct / 100) * 255;
  const sample = () => {
    if (!gaussian) return (rand() * 2 - 1) * amp;
    // Box–Muller
    const u = Math.max(1e-9, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * amp * 0.5;
  };
  for (let i = 0; i < d.length; i += 4) {
    if (mono) {
      const n = sample();
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    } else {
      d[i] += sample(); d[i + 1] += sample(); d[i + 2] += sample();
    }
  }
  return out;
}

export function filmGrain(img: Img, amountPct: number, size: number, seed: number): Img {
  const { width: w, height: h } = img;
  const rand = rng(seed);
  const noise = new Float32Array(w * h);
  for (let i = 0; i < noise.length; i++) noise[i] = rand() * 2 - 1;
  if (size > 1) {
    gaussFloat(noise, w, h, 1, (size - 1) * 0.6);
    // re-normalize contrast lost to blurring
    let max = 0;
    for (let i = 0; i < noise.length; i++) max = Math.max(max, Math.abs(noise[i]));
    if (max > 0) for (let i = 0; i < noise.length; i++) noise[i] /= max;
  }
  const out = cloneImg(img);
  const d = out.data;
  const amp = (amountPct / 100) * 90;
  for (let i = 0; i < noise.length; i++) {
    const o = i * 4;
    const l = luma(d[o], d[o + 1], d[o + 2]) / 255;
    const wgt = 1 - Math.abs(l - 0.5) * 1.4; // strongest in midtones
    const n = noise[i] * amp * Math.max(0.15, wgt);
    d[o] += n; d[o + 1] += n; d[o + 2] += n;
  }
  return out;
}

export function mosaic(img: Img, cell: number): Img {
  const { width: w, height: h } = img;
  const c = Math.max(1, Math.round(cell));
  const out = createImg(w, h);
  const s = img.data, d = out.data;
  for (let by = 0; by < h; by += c) {
    for (let bx = 0; bx < w; bx += c) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      const ex = Math.min(w, bx + c), ey = Math.min(h, by + c);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const o = (y * w + x) * 4;
        const al = s[o + 3];
        r += s[o] * al; g += s[o + 1] * al; b += s[o + 2] * al; a += al; n++;
      }
      const R = a ? r / a : 0, G = a ? g / a : 0, B = a ? b / a : 0, A = a / n;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const o = (y * w + x) * 4;
        d[o] = R; d[o + 1] = G; d[o + 2] = B; d[o + 3] = A;
      }
    }
  }
  return out;
}

export function emboss(img: Img, angleDeg: number, height: number, amountPct: number): Img {
  const { width: w, height: h } = img;
  const out = cloneImg(img);
  const s = img.data, d = out.data;
  const a = (angleDeg * Math.PI) / 180;
  const dx = Math.round(Math.cos(a) * height), dy = Math.round(-Math.sin(a) * height);
  const k = amountPct / 100;
  const L = (x: number, y: number) => {
    x = x < 0 ? 0 : x >= w ? w - 1 : x;
    y = y < 0 ? 0 : y >= h ? h - 1 : y;
    const o = (y * w + x) * 4;
    return luma(s[o], s[o + 1], s[o + 2]);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = 128 + (L(x + dx, y + dy) - L(x - dx, y - dy)) * k;
    const o = (y * w + x) * 4;
    d[o] = d[o + 1] = d[o + 2] = v;
  }
  return out;
}

/** Sobel edge magnitude, inverted so edges are dark on white (Photoshop style). */
export function findEdges(img: Img): Img {
  const { width: w, height: h } = img;
  const out = cloneImg(img);
  const s = img.data, d = out.data;
  const at = (x: number, y: number, c: number) => {
    x = x < 0 ? 0 : x >= w ? w - 1 : x;
    y = y < 0 ? 0 : y >= h ? h - 1 : y;
    return s[(y * w + x) * 4 + c];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      const gx = -at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c) + at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c);
      const gy = -at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c) + at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c);
      d[o + c] = 255 - Math.min(255, Math.sqrt(gx * gx + gy * gy) / 2);
    }
  }
  return out;
}

export function highPass(img: Img, radius: number): Img {
  const b = gaussianBlur(img, radius);
  const out = cloneImg(img);
  const s = img.data, bd = b.data, d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 128 + s[i] - bd[i];
    d[i + 1] = 128 + s[i + 1] - bd[i + 1];
    d[i + 2] = 128 + s[i + 2] - bd[i + 2];
  }
  return out;
}

/** Intensity-binned "oil paint" (most frequent intensity in the neighbourhood wins). */
export function oilPaint(img: Img, radius: number, levels: number): Img {
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.round(radius));
  const L = Math.max(2, Math.round(levels));
  const s = img.data;
  const out = cloneImg(img);
  const d = out.data;
  const bin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) bin[i] = Math.min(L - 1, Math.floor((luma(s[i * 4], s[i * 4 + 1], s[i * 4 + 2]) * L) / 256));
  const cnt = new Uint32Array(L), sr = new Float64Array(L), sg = new Float64Array(L), sb = new Float64Array(L);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    cnt.fill(0); sr.fill(0); sg.fill(0); sb.fill(0);
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r), x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      const i = yy * w + xx, b = bin[i];
      cnt[b]++; sr[b] += s[i * 4]; sg[b] += s[i * 4 + 1]; sb[b] += s[i * 4 + 2];
    }
    let best = 0;
    for (let k = 1; k < L; k++) if (cnt[k] > cnt[best]) best = k;
    const o = (y * w + x) * 4;
    d[o] = sr[best] / cnt[best]; d[o + 1] = sg[best] / cnt[best]; d[o + 2] = sb[best] / cnt[best];
  }
  return out;
}

export function vignette(img: Img, amountPct: number, midpointPct: number, featherPct: number): Img {
  const { width: w, height: h } = img;
  const out = cloneImg(img);
  const d = out.data;
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const mid = midpointPct / 100, fe = Math.max(0.01, featherPct / 100);
  const k = amountPct / 100;
  const e0 = mid - fe / 2, e1 = mid + fe / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const nx = (x - cx) / (cx || 1), ny = (y - cy) / (cy || 1);
    const dist = Math.sqrt(nx * nx + ny * ny) / Math.SQRT2 * 1.2;
    let t = (dist - e0) / (e1 - e0);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = t * t * (3 - 2 * t);
    if (t === 0) continue;
    const o = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) {
      d[o + c] = k < 0 ? d[o + c] * (1 + k * t) : d[o + c] + (255 - d[o + c]) * k * t;
    }
  }
  return out;
}

/** Bloom-style glow: blurred highlights screened over the image. */
export function glow(img: Img, radius: number, amountPct: number, thresholdPct: number): Img {
  const hi = cloneImg(img);
  const hd = hi.data;
  const th = (thresholdPct / 100) * 255;
  for (let i = 0; i < hd.length; i += 4) {
    const l = luma(hd[i], hd[i + 1], hd[i + 2]);
    const f = l <= th ? 0 : (l - th) / Math.max(1, 255 - th);
    hd[i] *= f; hd[i + 1] *= f; hd[i + 2] *= f;
  }
  const b = gaussianBlur(hi, radius);
  const out = cloneImg(img);
  const d = out.data, bd = b.data;
  const k = amountPct / 100;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const s = (bd[i + c] * k) / 255, base = d[i + c] / 255;
      d[i + c] = (1 - (1 - base) * (1 - s)) * 255;
    }
  }
  return out;
}

/** Radial chromatic aberration: red pushed outward, blue inward. */
export function chromaticAberration(img: Img, shift: number): Img {
  const { width: w, height: h } = img;
  const f = toPremul(img);
  const out = new Float32Array(f.length);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  const maxR = Math.sqrt(cx * cx + cy * cy) || 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const vx = (x - cx) / maxR, vy = (y - cy) / maxR;
    out[o] = sampleBilinear(f, w, h, x - vx * shift, y - vy * shift, 0);
    out[o + 1] = f[o + 1];
    out[o + 2] = sampleBilinear(f, w, h, x + vx * shift, y + vy * shift, 2);
    out[o + 3] = f[o + 3];
  }
  return fromPremul(out, w, h);
}

/** Color halftone (per-channel rotated dot screens). */
export function colorHalftone(img: Img, cell: number): Img {
  const { width: w, height: h } = img;
  const c = Math.max(2, cell);
  const s = img.data;
  const out = cloneImg(img);
  const d = out.data;
  const angles = [15, 75, 0].map((a) => (a * Math.PI) / 180);
  for (let ch = 0; ch < 3; ch++) {
    const ca = Math.cos(angles[ch]), sa = Math.sin(angles[ch]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      // rotate into screen space, find the cell center, rotate back to sample
      const u = x * ca + y * sa, v = -x * sa + y * ca;
      const cu = (Math.floor(u / c) + 0.5) * c, cv = (Math.floor(v / c) + 0.5) * c;
      const sx = Math.round(cu * ca - cv * sa), sy = Math.round(cu * sa + cv * ca);
      const px = sx < 0 ? 0 : sx >= w ? w - 1 : sx, py = sy < 0 ? 0 : sy >= h ? h - 1 : sy;
      const ink = 1 - s[(py * w + px) * 4 + ch] / 255;
      const radius = Math.sqrt(ink) * c * 0.7071;
      const dist = Math.hypot(u - cu, v - cv);
      const cover = clamp(radius - dist + 0.5, 0, 1);
      d[(y * w + x) * 4 + ch] = 255 * (1 - cover);
    }
  }
  return out;
}

/** Median filter (Huang's sliding histogram per channel). */
export function median(img: Img, radius: number): Img {
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.round(radius));
  const s = img.data;
  const out = cloneImg(img);
  const d = out.data;
  const hist = new Uint32Array(256);
  const half = Math.floor(((2 * r + 1) * (2 * r + 1)) / 2);
  for (let c = 0; c < 3; c++) {
    for (let y = 0; y < h; y++) {
      hist.fill(0);
      let total = 0;
      const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
      for (let yy = y0; yy <= y1; yy++) for (let xx = 0; xx <= Math.min(w - 1, r); xx++) { hist[s[(yy * w + xx) * 4 + c]]++; total++; }
      for (let x = 0; x < w; x++) {
        if (x > 0) {
          const xo = x - r - 1, xi = x + r;
          for (let yy = y0; yy <= y1; yy++) {
            if (xo >= 0) { hist[s[(yy * w + xo) * 4 + c]]--; total--; }
            if (xi < w) { hist[s[(yy * w + xi) * 4 + c]]++; total++; }
          }
        }
        const target = Math.min(half, Math.floor(total / 2));
        let acc = 0, m = 0;
        for (; m < 256; m++) { acc += hist[m]; if (acc > target) break; }
        d[(y * w + x) * 4 + c] = m;
      }
    }
  }
  return out;
}

export function dustAndScratches(img: Img, radius: number, threshold: number): Img {
  const m = median(img, radius);
  if (threshold <= 0) return m;
  const out = cloneImg(img);
  const s = img.data, md = m.data, d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const diff = Math.abs(luma(s[i], s[i + 1], s[i + 2]) - luma(md[i], md[i + 1], md[i + 2]));
    if (diff > threshold) { d[i] = md[i]; d[i + 1] = md[i + 1]; d[i + 2] = md[i + 2]; }
  }
  return out;
}

/** Median on flat areas only, keeping edges. */
export function despeckle(img: Img): Img {
  const m = median(img, 1);
  const e = findEdges(img);
  const out = cloneImg(img);
  const md = m.data, ed = e.data, d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const edge = 255 - luma(ed[i], ed[i + 1], ed[i + 2]);
    if (edge < 40) { d[i] = md[i]; d[i + 1] = md[i + 1]; d[i + 2] = md[i + 2]; }
  }
  return out;
}

/** Separable max/min (morphology) on all four channels. */
export function rank(img: Img, radius: number, mode: 'max' | 'min'): Img {
  const { width: w, height: h } = img;
  const r = Math.max(1, Math.round(radius));
  const src = img.data;
  const tmp = new Uint8ClampedArray(src.length);
  const out = createImg(w, h);
  const pick = mode === 'max' ? Math.max : Math.min;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let v = src[(y * w + x) * 4 + c];
    for (let k = Math.max(0, x - r); k <= Math.min(w - 1, x + r); k++) v = pick(v, src[(y * w + k) * 4 + c]);
    tmp[(y * w + x) * 4 + c] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    let v = tmp[(y * w + x) * 4 + c];
    for (let k = Math.max(0, y - r); k <= Math.min(h - 1, y + r); k++) v = pick(v, tmp[(k * w + x) * 4 + c]);
    out.data[(y * w + x) * 4 + c] = v;
  }
  return out;
}

export function average(img: Img): Img {
  const out = cloneImg(img);
  const d = out.data;
  let r = 0, g = 0, b = 0, a = 0;
  for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al; }
  if (!a) return out;
  for (let i = 0; i < d.length; i += 4) { d[i] = r / a; d[i + 1] = g / a; d[i + 2] = b / a; }
  return out;
}

export function solarize(img: Img): Img {
  const out = cloneImg(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) for (let c = 0; c < 3; c++) if (d[i + c] > 127) d[i + c] = 255 - d[i + c];
  return out;
}

export function offset(img: Img, dx: number, dy: number): Img {
  const { width: w, height: h } = img;
  const out = createImg(w, h);
  const s = new Uint32Array(img.data.buffer.slice(img.data.byteOffset, img.data.byteOffset + img.data.byteLength));
  const d = new Uint32Array(out.data.buffer);
  for (let y = 0; y < h; y++) {
    const sy = (((y - dy) % h) + h) % h;
    for (let x = 0; x < w; x++) d[y * w + x] = s[sy * w + ((((x - dx) % w) + w) % w)];
  }
  return out;
}

export function clouds(img: Img, scale: number, seed: number, fg: [number, number, number], bg: [number, number, number]): Img {
  const { width: w, height: h } = img;
  const out = createImg(w, h);
  const rand = rng(seed);
  const G = 256;
  const grid = new Float32Array(G * G);
  for (let i = 0; i < grid.length; i++) grid[i] = rand();
  const val = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const g = (a: number, b: number) => grid[((b & (G - 1)) * G) + (a & (G - 1))];
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    return (g(xi, yi) * (1 - sx) + g(xi + 1, yi) * sx) * (1 - sy) + (g(xi, yi + 1) * (1 - sx) + g(xi + 1, yi + 1) * sx) * sy;
  };
  const base = Math.max(8, scale);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = 0, amp = 0.5, f = 1 / base;
    for (let o = 0; o < 6; o++) { v += val(x * f, y * f) * amp; amp /= 2; f *= 2; }
    const t = clamp(v / 0.984, 0, 1);
    const o = (y * w + x) * 4;
    out.data[o] = fg[0] + (bg[0] - fg[0]) * t;
    out.data[o + 1] = fg[1] + (bg[1] - fg[1]) * t;
    out.data[o + 2] = fg[2] + (bg[2] - fg[2]) * t;
    out.data[o + 3] = 255;
  }
  return out;
}

// ---------- registry ----------

export const FILTERS: FilterDef[] = [
  { id: 'gaussianBlur', name: 'Gaussian blur', cat: 'Blur', gallery: true, params: [P('radius', 'Radius', 0.1, 250, 4, 0.1, 'px')], run: (i, p) => gaussianBlur(i, p.radius) },
  { id: 'motionBlur', name: 'Motion blur', cat: 'Blur', gallery: true, params: [P('angle', 'Angle', -90, 90, 0, 1, '°'), P('distance', 'Distance', 1, 200, 20, 1, 'px')], run: (i, p) => motionBlur(i, p.angle, p.distance) },
  { id: 'boxBlur', name: 'Box blur', cat: 'Blur', gallery: true, params: [P('radius', 'Radius', 1, 200, 5, 1, 'px')], run: (i, p) => boxBlur(i, p.radius) },
  { id: 'lensBlur', name: 'Lens blur', cat: 'Blur', gallery: true, planned: true, params: [], run: (i) => cloneImg(i) },
  { id: 'sharpen', name: 'Sharpen', cat: 'Sharpen', gallery: true, params: [P('amount', 'Amount', 1, 300, 60, 1, '%')], run: (i, p) => sharpen(i, p.amount) },
  { id: 'unsharpMask', name: 'Unsharp mask', cat: 'Sharpen', gallery: true, params: [P('amount', 'Amount', 1, 500, 100, 1, '%'), P('radius', 'Radius', 0.1, 100, 2, 0.1, 'px'), P('threshold', 'Threshold', 0, 255, 0, 1)], run: (i, p) => unsharpMask(i, p.amount, p.radius, p.threshold) },
  { id: 'highPass', name: 'High pass', cat: 'Sharpen', gallery: true, params: [P('radius', 'Radius', 0.1, 250, 10, 0.1, 'px')], run: (i, p) => highPass(i, p.radius) },
  { id: 'addNoise', name: 'Add noise', cat: 'Noise', gallery: true, params: [P('amount', 'Amount', 0, 100, 12, 0.5, '%'), T('gaussian', 'Gaussian distribution', 1), T('mono', 'Monochromatic', 0)], run: (i, p, c) => addNoise(i, p.amount, !!p.mono, !!p.gaussian, c.seed) },
  { id: 'filmGrain', name: 'Film grain', cat: 'Noise', gallery: true, params: [P('amount', 'Amount', 0, 100, 30, 1, '%'), P('size', 'Grain size', 1, 10, 2, 0.5)], run: (i, p, c) => filmGrain(i, p.amount, p.size, c.seed) },
  { id: 'median', name: 'Median', cat: 'Noise', gallery: true, params: [P('radius', 'Radius', 1, 20, 2, 1, 'px')], run: (i, p) => median(i, p.radius) },
  { id: 'despeckle', name: 'Despeckle', cat: 'Noise', gallery: true, params: [], run: (i) => despeckle(i) },
  { id: 'dustScratches', name: 'Dust & scratches', cat: 'Noise', gallery: false, params: [P('radius', 'Radius', 1, 20, 2, 1, 'px'), P('threshold', 'Threshold', 0, 255, 10)], run: (i, p) => dustAndScratches(i, p.radius, p.threshold) },
  { id: 'halftone', name: 'Halftone', cat: 'Stylize', gallery: true, params: [P('cell', 'Max radius', 2, 64, 8, 1, 'px')], run: (i, p) => colorHalftone(i, p.cell) },
  { id: 'mosaic', name: 'Pixelate', cat: 'Stylize', gallery: true, params: [P('cell', 'Cell size', 2, 200, 12, 1, 'px')], run: (i, p) => mosaic(i, p.cell) },
  { id: 'oilPaint', name: 'Oil paint', cat: 'Stylize', gallery: true, params: [P('radius', 'Stylization', 1, 10, 4, 1), P('levels', 'Levels', 4, 40, 20, 1)], run: (i, p) => oilPaint(i, p.radius, p.levels) },
  { id: 'emboss', name: 'Emboss', cat: 'Stylize', gallery: true, params: [P('angle', 'Angle', -180, 180, 135, 1, '°'), P('height', 'Height', 1, 10, 3, 1, 'px'), P('amount', 'Amount', 1, 500, 100, 1, '%')], run: (i, p) => emboss(i, p.angle, p.height, p.amount) },
  { id: 'findEdges', name: 'Find edges', cat: 'Stylize', gallery: true, params: [], run: (i) => findEdges(i) },
  { id: 'solarize', name: 'Solarize', cat: 'Stylize', gallery: false, params: [], run: (i) => solarize(i) },
  { id: 'liquify', name: 'Liquify', cat: 'Distort', gallery: true, planned: true, params: [], run: (i) => cloneImg(i) },
  { id: 'lensCorrection', name: 'Lens correction', cat: 'Distort', gallery: true, planned: true, params: [], run: (i) => cloneImg(i) },
  { id: 'chromatic', name: 'Chromatic aberration', cat: 'Distort', gallery: true, params: [P('shift', 'Shift', 0, 40, 4, 0.5, 'px')], run: (i, p) => chromaticAberration(i, p.shift) },
  { id: 'vignette', name: 'Vignette', cat: 'Light', gallery: true, params: [P('amount', 'Amount', -100, 100, -50, 1), P('midpoint', 'Midpoint', 0, 100, 60, 1), P('feather', 'Feather', 1, 100, 60, 1)], run: (i, p) => vignette(i, p.amount, p.midpoint, p.feather) },
  { id: 'glow', name: 'Glow', cat: 'Light', gallery: true, params: [P('radius', 'Radius', 1, 100, 12, 1, 'px'), P('amount', 'Amount', 0, 200, 60, 1, '%'), P('threshold', 'Threshold', 0, 100, 55, 1, '%')], run: (i, p) => glow(i, p.radius, p.amount, p.threshold) },
  { id: 'average', name: 'Average', cat: 'Blur', gallery: false, params: [], run: (i) => average(i) },
  { id: 'blur', name: 'Blur', cat: 'Blur', gallery: false, params: [], run: (i) => boxBlur(i, 1) },
  { id: 'blurMore', name: 'Blur more', cat: 'Blur', gallery: false, params: [], run: (i) => boxBlur(i, 2) },
  { id: 'sharpenMore', name: 'Sharpen more', cat: 'Sharpen', gallery: false, params: [], run: (i) => sharpen(i, 120) },
  { id: 'maximum', name: 'Maximum', cat: 'Other', gallery: false, params: [P('radius', 'Radius', 1, 50, 1, 1, 'px')], run: (i, p) => rank(i, p.radius, 'max') },
  { id: 'minimum', name: 'Minimum', cat: 'Other', gallery: false, params: [P('radius', 'Radius', 1, 50, 1, 1, 'px')], run: (i, p) => rank(i, p.radius, 'min') },
  { id: 'offset', name: 'Offset', cat: 'Other', gallery: false, params: [P('dx', 'Horizontal', -2000, 2000, 50, 1, 'px'), P('dy', 'Vertical', -2000, 2000, 50, 1, 'px')], run: (i, p) => offset(i, p.dx, p.dy) },
  { id: 'clouds', name: 'Clouds', cat: 'Other', gallery: false, params: [P('scale', 'Scale', 8, 512, 128, 1, 'px')], run: (i, p, c) => clouds(i, p.scale, c.seed, c.fg, c.bg) },
];

export const filterById = (id: string) => FILTERS.find((f) => f.id === id);

export function defaultParams(f: FilterDef): Record<string, number> {
  return Object.fromEntries(f.params.map((p) => [p.id, p.default]));
}
