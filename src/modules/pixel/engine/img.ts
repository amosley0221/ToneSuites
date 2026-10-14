// Pure pixel-buffer helpers (no DOM). Works on ImageData or any {data,width,height} object.

export interface Img {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function createImg(width: number, height: number): Img {
  return { data: new Uint8ClampedArray(width * height * 4), width, height };
}

export function cloneImg(src: Img): Img {
  return { data: new Uint8ClampedArray(src.data), width: src.width, height: src.height };
}

export const clamp = (v: number, lo = 0, hi = 255) => (v < lo ? lo : v > hi ? hi : v);
export const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** Deterministic PRNG (mulberry32) so previews and final renders match. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Premultiplied float copy (so blurs don't bleed black from transparent pixels). */
export function toPremul(src: Img): Float32Array {
  const n = src.width * src.height;
  const out = new Float32Array(n * 4);
  const d = src.data;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const a = d[o + 3] / 255;
    out[o] = d[o] * a;
    out[o + 1] = d[o + 1] * a;
    out[o + 2] = d[o + 2] * a;
    out[o + 3] = d[o + 3];
  }
  return out;
}

export function fromPremul(f: Float32Array, width: number, height: number): Img {
  const out = createImg(width, height);
  const d = out.data;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const A = f[o + 3];
    if (A <= 0.0001) { d[o] = d[o + 1] = d[o + 2] = d[o + 3] = 0; continue; }
    const a = A / 255;
    d[o] = f[o] / a;
    d[o + 1] = f[o + 1] / a;
    d[o + 2] = f[o + 2] / a;
    d[o + 3] = A;
  }
  return out;
}

/** One horizontal + vertical box-blur pass on interleaved float channels (in place). */
export function boxBlurFloat(buf: Float32Array, w: number, h: number, ch: number, r: number) {
  if (r < 1) return;
  const tmp = new Float32Array(buf.length);
  const win = 2 * r + 1;
  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w * ch;
    for (let c = 0; c < ch; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += buf[row + clampI(k, 0, w - 1) * ch + c];
      for (let x = 0; x < w; x++) {
        tmp[row + x * ch + c] = acc / win;
        const add = clampI(x + r + 1, 0, w - 1);
        const sub = clampI(x - r, 0, w - 1);
        acc += buf[row + add * ch + c] - buf[row + sub * ch + c];
      }
    }
  }
  // vertical
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < ch; c++) {
      let acc = 0;
      for (let k = -r; k <= r; k++) acc += tmp[clampI(k, 0, h - 1) * w * ch + x * ch + c];
      for (let y = 0; y < h; y++) {
        buf[y * w * ch + x * ch + c] = acc / win;
        const add = clampI(y + r + 1, 0, h - 1);
        const sub = clampI(y - r, 0, h - 1);
        acc += tmp[add * w * ch + x * ch + c] - tmp[sub * w * ch + x * ch + c];
      }
    }
  }
}

const clampI = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Box sizes approximating a gaussian of the given sigma with n passes. */
export function boxesForGauss(sigma: number, n = 3): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes.map((s) => Math.max(0, (s - 1) / 2));
}

export function gaussFloat(buf: Float32Array, w: number, h: number, ch: number, sigma: number) {
  if (sigma <= 0.2) return;
  for (const r of boxesForGauss(sigma)) boxBlurFloat(buf, w, h, ch, Math.round(r));
}

/** Blend `result` back over `orig` by a per-pixel 0..255 weight (selection mask), in place on result. */
export function mixByMask(orig: Img, result: Img, mask: Uint8Array | null, amount = 1) {
  if (!mask && amount >= 1) return result;
  const d = result.data, o = orig.data;
  const n = orig.width * orig.height;
  for (let i = 0; i < n; i++) {
    const t = (mask ? mask[i] / 255 : 1) * amount;
    if (t >= 1) continue;
    const p = i * 4;
    for (let c = 0; c < 4; c++) d[p + c] = o[p + c] + (d[p + c] - o[p + c]) * t;
  }
  return result;
}

/** 256-bin histograms of R, G, B and luminance (ignores fully transparent pixels). */
export function histogram(img: Img) {
  const r = new Uint32Array(256), g = new Uint32Array(256), b = new Uint32Array(256), l = new Uint32Array(256);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    r[d[i]]++; g[d[i + 1]]++; b[d[i + 2]]++;
    l[Math.round(luma(d[i], d[i + 1], d[i + 2]))]++;
  }
  return { r, g, b, l };
}

// ---------- color conversions ----------

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v)).toString(16).padStart(2, '0')).join('').toUpperCase();
}
