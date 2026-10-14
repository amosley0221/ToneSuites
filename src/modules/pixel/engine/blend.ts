// Blend modes: names, Canvas2D composite operations, PSD keys, and the reference math (W3C compositing spec).

export type BlendMode =
  | 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' | 'color-burn'
  | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

export const BLEND_MODES: { id: BlendMode; label: string }[] = [
  { id: 'normal', label: 'Normal' }, { id: 'multiply', label: 'Multiply' }, { id: 'screen', label: 'Screen' },
  { id: 'overlay', label: 'Overlay' }, { id: 'soft-light', label: 'Soft light' }, { id: 'hard-light', label: 'Hard light' },
  { id: 'color-dodge', label: 'Color dodge' }, { id: 'color-burn', label: 'Color burn' }, { id: 'darken', label: 'Darken' },
  { id: 'lighten', label: 'Lighten' }, { id: 'difference', label: 'Difference' }, { id: 'exclusion', label: 'Exclusion' },
  { id: 'hue', label: 'Hue' }, { id: 'saturation', label: 'Saturation' }, { id: 'color', label: 'Color' }, { id: 'luminosity', label: 'Luminosity' },
];

export const blendLabel = (b: BlendMode) => BLEND_MODES.find((m) => m.id === b)?.label ?? 'Normal';

export function compositeOp(b: BlendMode): GlobalCompositeOperation {
  return b === 'normal' ? 'source-over' : b;
}

/** Photoshop/ag-psd blend keys ↔ ours. Unknown PSD modes fall back to normal. */
export function fromPsdBlend(k: string | undefined): BlendMode {
  if (!k) return 'normal';
  const id = k.replace(/ /g, '-') as BlendMode;
  return BLEND_MODES.some((m) => m.id === id) ? id : 'normal';
}
export function toPsdBlend(b: BlendMode): string {
  return b.replace(/-/g, ' ');
}

// ---------- reference math (channel values 0..1) ----------

export function blendChannel(mode: BlendMode, cb: number, cs: number): number {
  switch (mode) {
    case 'multiply': return cb * cs;
    case 'screen': return cb + cs - cb * cs;
    case 'overlay': return blendChannel('hard-light', cs, cb);
    case 'darken': return Math.min(cb, cs);
    case 'lighten': return Math.max(cb, cs);
    case 'color-dodge': return cb === 0 ? 0 : cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 'color-burn': return cb >= 1 ? 1 : cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 'hard-light': return cs <= 0.5 ? cb * 2 * cs : blendChannel('screen', cb, 2 * cs - 1);
    case 'soft-light': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const d = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (d - cb);
    }
    case 'difference': return Math.abs(cb - cs);
    case 'exclusion': return cb + cs - 2 * cb * cs;
    default: return cs;
  }
}

type C3 = [number, number, number];
const lum = (c: C3) => 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
function clipColor(c: C3): C3 {
  const l = lum(c), n = Math.min(...c), x = Math.max(...c);
  let o: C3 = [...c];
  if (n < 0) o = o.map((v) => l + ((v - l) * l) / (l - n)) as C3;
  if (x > 1) o = o.map((v) => l + ((v - l) * (1 - l)) / (x - l)) as C3;
  return o;
}
const setLum = (c: C3, l: number): C3 => { const d = l - lum(c); return clipColor([c[0] + d, c[1] + d, c[2] + d]); };
const sat = (c: C3) => Math.max(...c) - Math.min(...c);
function setSat(c: C3, s: number): C3 {
  const idx = [0, 1, 2].sort((a, b) => c[a] - c[b]);
  const [mn, md, mx] = idx;
  const o: C3 = [0, 0, 0];
  if (c[mx] > c[mn]) { o[md] = ((c[md] - c[mn]) * s) / (c[mx] - c[mn]); o[mx] = s; }
  return o;
}

/** Full RGB blend (handles non-separable hue/saturation/color/luminosity). */
export function blendRGB(mode: BlendMode, cb: C3, cs: C3): C3 {
  switch (mode) {
    case 'hue': return setLum(setSat(cs, sat(cb)), lum(cb));
    case 'saturation': return setLum(setSat(cb, sat(cs)), lum(cb));
    case 'color': return setLum(cs, lum(cb));
    case 'luminosity': return setLum(cb, lum(cs));
    default: return [blendChannel(mode, cb[0], cs[0]), blendChannel(mode, cb[1], cs[1]), blendChannel(mode, cb[2], cs[2])];
  }
}

/**
 * Source-over composite of a straight-alpha source pixel onto a backdrop with a blend mode and opacity
 * (0..255 ints in, 0..255 out). Used by tests and the CPU fallback.
 */
export function compositePixel(mode: BlendMode, back: [number, number, number, number], src: [number, number, number, number], opacity = 1): [number, number, number, number] {
  const ab = back[3] / 255, as = (src[3] / 255) * opacity;
  const cb: C3 = [back[0] / 255, back[1] / 255, back[2] / 255], cs: C3 = [src[0] / 255, src[1] / 255, src[2] / 255];
  const mixed = blendRGB(mode, cb, cs);
  const ao = as + ab * (1 - as);
  if (ao <= 0) return [0, 0, 0, 0];
  const out = [0, 1, 2].map((i) => {
    const csx = (1 - ab) * cs[i] + ab * mixed[i];
    return (as * csx + ab * cb[i] * (1 - as)) / ao;
  });
  return [Math.round(out[0] * 255), Math.round(out[1] * 255), Math.round(out[2] * 255), Math.round(ao * 255)];
}
