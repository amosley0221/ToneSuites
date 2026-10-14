// Pure image adjustments (destructive or as adjustment layers). No DOM.
import { clamp, cloneImg, gaussFloat, histogram, hslToRgb, luma, rgbToHsl, type Img } from './img';

export type CurvePoints = [number, number][];
export type RGB = [number, number, number];

export type AdjustSpec =
  | { type: 'brightnessContrast'; brightness: number; contrast: number }
  | { type: 'levels'; inBlack: number; inWhite: number; gamma: number; outBlack: number; outWhite: number }
  | { type: 'curves'; rgb: CurvePoints; r: CurvePoints; g: CurvePoints; b: CurvePoints }
  | { type: 'exposure'; exposure: number; offset: number; gamma: number }
  | { type: 'vibrance'; vibrance: number; saturation: number }
  | { type: 'hueSaturation'; hue: number; saturation: number; lightness: number; colorize: number }
  | { type: 'colorBalance'; shadows: RGB; midtones: RGB; highlights: RGB; preserveLum: number }
  | { type: 'blackWhite'; reds: number; yellows: number; greens: number; cyans: number; blues: number; magentas: number }
  | { type: 'photoFilter'; color: string; density: number; preserveLum: number }
  | { type: 'channelMixer'; r: [number, number, number, number]; g: [number, number, number, number]; b: [number, number, number, number]; mono: number }
  | { type: 'invert' }
  | { type: 'posterize'; levels: number }
  | { type: 'threshold'; level: number }
  | { type: 'gradientMap'; from: string; to: string; reverse: number }
  | { type: 'desaturate' }
  | { type: 'basic'; exposure: number; contrast: number; highlights: number; shadows: number; saturation: number; temperature: number; clarity: number };

export type AdjustType = AdjustSpec['type'];

export const ADJUST_NAMES: Record<AdjustType, string> = {
  brightnessContrast: 'Brightness/Contrast', levels: 'Levels', curves: 'Curves', exposure: 'Exposure', vibrance: 'Vibrance',
  hueSaturation: 'Hue/Saturation', colorBalance: 'Color balance', blackWhite: 'Black & white', photoFilter: 'Photo filter',
  channelMixer: 'Channel mixer', invert: 'Invert', posterize: 'Posterize', threshold: 'Threshold', gradientMap: 'Gradient map',
  desaturate: 'Desaturate', basic: 'Basic adjustments',
};

const ID: CurvePoints = [[0, 0], [255, 255]];

export function defaultAdjust(type: AdjustType, fg = '#000000', bg = '#FFFFFF'): AdjustSpec {
  switch (type) {
    case 'brightnessContrast': return { type, brightness: 0, contrast: 0 };
    case 'levels': return { type, inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };
    case 'curves': return { type, rgb: ID.map((p) => [...p] as [number, number]), r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] };
    case 'exposure': return { type, exposure: 0, offset: 0, gamma: 1 };
    case 'vibrance': return { type, vibrance: 0, saturation: 0 };
    case 'hueSaturation': return { type, hue: 0, saturation: 0, lightness: 0, colorize: 0 };
    case 'colorBalance': return { type, shadows: [0, 0, 0], midtones: [0, 0, 0], highlights: [0, 0, 0], preserveLum: 1 };
    case 'blackWhite': return { type, reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80 };
    case 'photoFilter': return { type, color: '#EC8A00', density: 25, preserveLum: 1 };
    case 'channelMixer': return { type, r: [100, 0, 0, 0], g: [0, 100, 0, 0], b: [0, 0, 100, 0], mono: 0 };
    case 'invert': return { type };
    case 'posterize': return { type, levels: 4 };
    case 'threshold': return { type, level: 128 };
    case 'gradientMap': return { type, from: fg, to: bg, reverse: 0 };
    case 'desaturate': return { type };
    case 'basic': return { type, exposure: 0, contrast: 0, highlights: 0, shadows: 0, saturation: 0, temperature: 0, clarity: 0 };
  }
}

// ---------- LUT helpers ----------

export function lutFrom(fn: (v: number) => number): Uint8ClampedArray {
  const l = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) l[i] = Math.round(fn(i));
  return l;
}

export function applyLut(img: Img, r: Uint8ClampedArray, g = r, b = r): Img {
  const out = cloneImg(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
  return out;
}

export function levelsLut(inBlack: number, inWhite: number, gamma: number, outBlack: number, outWhite: number) {
  const span = Math.max(1, inWhite - inBlack);
  return lutFrom((v) => {
    const t = clamp((v - inBlack) / span, 0, 1);
    return outBlack + Math.pow(t, 1 / Math.max(0.01, gamma)) * (outWhite - outBlack);
  });
}

/** Monotone cubic (Fritsch–Carlson) interpolation through curve points → 256-entry LUT. */
export function curveLut(points: CurvePoints): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) return lutFrom((v) => v);
  if (pts.length === 1) return lutFrom(() => pts[0][1]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(Math.max(1e-6, xs[i + 1] - xs[i])); m.push((ys[i + 1] - ys[i]) / dx[i]); }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  return lutFrom((x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = dx[i], u = (x - xs[i]) / h;
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
    return clamp(h00 * ys[i] + h10 * h * t[i] + h01 * ys[i + 1] + h11 * h * t[i + 1]);
  });
}

/** Curve presets (feature list, not data). */
export const CURVE_PRESETS: Record<string, CurvePoints> = {
  'Linear contrast': [[0, 0], [64, 52], [192, 204], [255, 255]],
  'Strong contrast': [[0, 0], [64, 40], [192, 216], [255, 255]],
  Lighter: [[0, 0], [128, 160], [255, 255]],
  Darker: [[0, 0], [128, 96], [255, 255]],
  Negative: [[0, 255], [255, 0]],
};

// ---------- apply ----------

export function applyAdjust(img: Img, spec: AdjustSpec): Img {
  switch (spec.type) {
    case 'brightnessContrast': {
      const b = spec.brightness, c = clamp(spec.contrast, -100, 100);
      const f = c >= 0 ? 1 + c / 40 : 1 + c / 100;
      return applyLut(img, lutFrom((v) => (v + b * 1.0 - 128) * f + 128));
    }
    case 'levels': return applyLut(img, levelsLut(spec.inBlack, spec.inWhite, spec.gamma, spec.outBlack, spec.outWhite));
    case 'curves': {
      const m = curveLut(spec.rgb);
      const r = curveLut(spec.r), g = curveLut(spec.g), b = curveLut(spec.b);
      return applyLut(img, lutFrom((v) => m[r[v]]), lutFrom((v) => m[g[v]]), lutFrom((v) => m[b[v]]));
    }
    case 'exposure': {
      const k = Math.pow(2, spec.exposure), off = spec.offset, gm = 1 / Math.max(0.01, spec.gamma);
      // operate in linear light for a photographic response
      return applyLut(img, lutFrom((v) => {
        const lin = srgbToLinear(v / 255) * k + off;
        return linearToSrgb(Math.pow(clamp(lin, 0, 1), gm)) * 255;
      }));
    }
    case 'vibrance': return vibrance(img, spec.vibrance, spec.saturation);
    case 'hueSaturation': return hueSaturation(img, spec.hue, spec.saturation, spec.lightness, !!spec.colorize);
    case 'colorBalance': return colorBalance(img, spec.shadows, spec.midtones, spec.highlights, !!spec.preserveLum);
    case 'blackWhite': return blackWhite(img, spec);
    case 'photoFilter': return photoFilter(img, spec.color, spec.density, !!spec.preserveLum);
    case 'channelMixer': return channelMixer(img, spec.r, spec.g, spec.b, !!spec.mono);
    case 'invert': return applyLut(img, lutFrom((v) => 255 - v));
    case 'posterize': {
      const n = Math.max(2, Math.round(spec.levels));
      return applyLut(img, lutFrom((v) => Math.round(Math.round((v / 255) * (n - 1)) * (255 / (n - 1)))));
    }
    case 'threshold': {
      const out = cloneImg(img);
      const d = out.data;
      for (let i = 0; i < d.length; i += 4) { const v = luma(d[i], d[i + 1], d[i + 2]) >= spec.level ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = v; }
      return out;
    }
    case 'gradientMap': return gradientMap(img, spec.from, spec.to, !!spec.reverse);
    case 'desaturate': {
      const out = cloneImg(img);
      const d = out.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.max(d[i], d[i + 1], d[i + 2]) + Math.min(d[i], d[i + 1], d[i + 2])) / 2;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      return out;
    }
    case 'basic': return basic(img, spec);
  }
}

export const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

function vibrance(img: Img, vib: number, sat: number): Img {
  const out = cloneImg(img);
  const d = out.data;
  const sv = sat / 100, vv = vib / 100;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const s = max ? (max - min) / max : 0;
    // vibrance boosts low-saturation pixels more
    const amt = 1 + sv + vv * (1 - s);
    const l = luma(r, g, b);
    d[i] = l + (r - l) * amt; d[i + 1] = l + (g - l) * amt; d[i + 2] = l + (b - l) * amt;
  }
  return out;
}

export function hueSaturation(img: Img, hue: number, sat: number, light: number, colorize: boolean): Img {
  const out = cloneImg(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    let [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    if (colorize) { h = (hue + 360) % 360; s = clamp((sat + 100) / 200, 0, 1) * 0.5 + 0.0; }
    else { h += hue; s = sat >= 0 ? s + (1 - s) * (sat / 100) * s * 1.2 + s * (sat / 100) * 0.3 : s * (1 + sat / 100); s = clamp(s, 0, 1); }
    l = light >= 0 ? l + (1 - l) * (light / 100) : l * (1 + light / 100);
    const [r, g, b] = hslToRgb(h, s, l);
    d[i] = r; d[i + 1] = g; d[i + 2] = b;
  }
  return out;
}

function colorBalance(img: Img, sh: RGB, mid: RGB, hi: RGB, preserve: boolean): Img {
  const out = cloneImg(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const l = luma(r, g, b) / 255;
    const ws = clamp(1 - l * 3.3, 0, 1) * 0.7 + clamp(0.5 - l, 0, 0.5) * 0.6;
    const wh = clamp((l - 0.7) * 3.3, 0, 1) * 0.7 + clamp(l - 0.5, 0, 0.5) * 0.6;
    const wm = clamp(1 - Math.abs(l - 0.5) * 2.2, 0, 1);
    let nr = r + (sh[0] * ws + mid[0] * wm + hi[0] * wh) * 1.0;
    let ng = g + (sh[1] * ws + mid[1] * wm + hi[1] * wh) * 1.0;
    let nb = b + (sh[2] * ws + mid[2] * wm + hi[2] * wh) * 1.0;
    if (preserve) {
      const l0 = luma(r, g, b), l1 = luma(nr, ng, nb);
      const k = l0 - l1;
      nr += k; ng += k; nb += k;
    }
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  return out;
}

function blackWhite(img: Img, s: Extract<AdjustSpec, { type: 'blackWhite' }>): Img {
  const out = cloneImg(img);
  const d = out.data;
  // hue-sector weights interpolated like Photoshop's B&W mixer
  const w = [s.reds, s.yellows, s.greens, s.cyans, s.blues, s.magentas].map((v) => v / 100);
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const [h, sat, l] = rgbToHsl(r, g, b);
    const sector = h / 60;
    const i0 = Math.floor(sector) % 6, i1 = (i0 + 1) % 6, f = sector - Math.floor(sector);
    const weight = w[i0] * (1 - f) + w[i1] * f;
    const gray = l * 255 + (weight - 0.5) * sat * 255 * (1 - Math.abs(2 * l - 1)) * 1.2;
    d[i] = d[i + 1] = d[i + 2] = gray;
  }
  return out;
}

function hex(c: string): RGB {
  const h = c.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function photoFilter(img: Img, color: string, density: number, preserve: boolean): Img {
  const [fr, fg, fb] = hex(color);
  const k = density / 100;
  const out = cloneImg(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    // multiply-style tint mixed by density
    let nr = r + ((r * fr) / 255 - r) * k, ng = g + ((g * fg) / 255 - g) * k, nb = b + ((b * fb) / 255 - b) * k;
    if (preserve) { const dl = luma(r, g, b) - luma(nr, ng, nb); nr += dl; ng += dl; nb += dl; }
    d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
  }
  return out;
}

function channelMixer(img: Img, R: number[], G: number[], B: number[], mono: boolean): Img {
  const out = cloneImg(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const nr = (r * R[0] + g * R[1] + b * R[2]) / 100 + R[3] * 2.55;
    if (mono) { d[i] = d[i + 1] = d[i + 2] = nr; continue; }
    d[i] = nr;
    d[i + 1] = (r * G[0] + g * G[1] + b * G[2]) / 100 + G[3] * 2.55;
    d[i + 2] = (r * B[0] + g * B[1] + b * B[2]) / 100 + B[3] * 2.55;
  }
  return out;
}

function gradientMap(img: Img, from: string, to: string, reverse: boolean): Img {
  let a = hex(from), b = hex(to);
  if (reverse) [a, b] = [b, a];
  const out = cloneImg(img);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const t = luma(d[i], d[i + 1], d[i + 2]) / 255;
    d[i] = a[0] + (b[0] - a[0]) * t; d[i + 1] = a[1] + (b[1] - a[1]) * t; d[i + 2] = a[2] + (b[2] - a[2]) * t;
  }
  return out;
}

/** Camera-RAW-style basic panel: exposure, contrast, highlights, shadows, saturation, temperature, clarity. */
function basic(img: Img, s: Extract<AdjustSpec, { type: 'basic' }>): Img {
  const k = Math.pow(2, s.exposure);
  const c = s.contrast / 100, hiK = s.highlights / 100, shK = s.shadows / 100;
  const tone = lutFrom((v) => {
    let x = linearToSrgb(clamp(srgbToLinear(v / 255) * k, 0, 1));
    // contrast around mid grey via smooth S-curve blend
    const sc = x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    x = c >= 0 ? x + (sc - x) * c : x + (0.5 - x) * -c * 0.5;
    // highlights/shadows: lift or lower tone ranges
    const hw = clamp((x - 0.5) * 2, 0, 1), sw = clamp((0.5 - x) * 2, 0, 1);
    x += hiK * hw * (hiK > 0 ? 1 - x : x) * 0.6;
    x += shK * sw * (shK > 0 ? 1 - x : x) * 0.6;
    return clamp(x, 0, 1) * 255;
  });
  const out = applyLut(img, tone);
  const d = out.data;
  const sat = s.saturation / 100, temp = s.temperature / 100;
  if (sat || temp) {
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (temp) { r += temp * 30; b -= temp * 30; }
      if (sat) { const l = luma(r, g, b); r = l + (r - l) * (1 + sat); g = l + (g - l) * (1 + sat); b = l + (b - l) * (1 + sat); }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  }
  if (s.clarity) {
    // local contrast: luminance minus a wide blur, weighted towards midtones
    const w = out.width, h = out.height;
    const L = new Float32Array(w * h);
    for (let i = 0; i < L.length; i++) L[i] = luma(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
    const B = new Float32Array(L);
    gaussFloat(B, w, h, 1, Math.max(4, Math.min(w, h) / 60));
    const k2 = s.clarity / 100;
    for (let i = 0; i < L.length; i++) {
      const mid = 1 - Math.abs(L[i] / 255 - 0.5) * 2;
      const delta = (L[i] - B[i]) * k2 * mid;
      d[i * 4] += delta; d[i * 4 + 1] += delta; d[i * 4 + 2] += delta;
    }
  }
  return out;
}

// ---------- automatic corrections ----------

function clipPoints(h: Uint32Array, clipFrac: number): [number, number] {
  let total = 0;
  for (let i = 0; i < 256; i++) total += h[i];
  const clip = total * clipFrac;
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += h[lo]; if (acc > clip) break; }
  acc = 0;
  for (; hi > 0; hi--) { acc += h[hi]; if (acc > clip) break; }
  return hi <= lo ? [0, 255] : [lo, hi];
}

/** Per-channel stretch (Photoshop "Auto tone"). */
export function autoTone(img: Img): Img {
  const h = histogram(img);
  const [rl, rh] = clipPoints(h.r, 0.001), [gl, gh] = clipPoints(h.g, 0.001), [bl, bh] = clipPoints(h.b, 0.001);
  return applyLut(img, levelsLut(rl, rh, 1, 0, 255), levelsLut(gl, gh, 1, 0, 255), levelsLut(bl, bh, 1, 0, 255));
}

/** Shared stretch across channels (keeps color casts). */
export function autoContrast(img: Img): Img {
  const h = histogram(img);
  const [rl, rh] = clipPoints(h.r, 0.001), [gl, gh] = clipPoints(h.g, 0.001), [bl, bh] = clipPoints(h.b, 0.001);
  const lut = levelsLut(Math.min(rl, gl, bl), Math.max(rh, gh, bh), 1, 0, 255);
  return applyLut(img, lut);
}

/** Per-channel stretch + neutralize midtones toward grey (gray-world). */
export function autoColor(img: Img): Img {
  const t = autoTone(img);
  const d = t.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  if (!n) return t;
  const avg = (r + g + b) / (3 * n);
  const gam = (m: number) => (m > 0 && avg > 0 ? Math.log(m / n / 255) / Math.log(avg / 255) : 1);
  const lr = levelsLut(0, 255, clamp(gam(r), 0.5, 2), 0, 255), lg = levelsLut(0, 255, clamp(gam(g), 0.5, 2), 0, 255), lb = levelsLut(0, 255, clamp(gam(b), 0.5, 2), 0, 255);
  return applyLut(t, lr, lg, lb);
}

/** Histogram equalization on luminance (applied to all channels via one LUT). */
export function equalize(img: Img): Img {
  const h = histogram(img).l;
  let total = 0;
  for (let i = 0; i < 256; i++) total += h[i];
  if (!total) return cloneImg(img);
  const cdf = new Float64Array(256);
  let acc = 0;
  for (let i = 0; i < 256; i++) { acc += h[i]; cdf[i] = acc / total; }
  return applyLut(img, lutFrom((v) => cdf[v] * 255));
}
