import { describe, expect, it } from 'vitest';
import { applyAdjust, curveLut, defaultAdjust, levelsLut, equalize, autoContrast } from './engine/adjust';
import { blendChannel, blendRGB, compositePixel, fromPsdBlend, toPsdBlend } from './engine/blend';
import { FILTERS, defaultParams, gaussianBlur, mosaic, median, offset, findEdges, highPass, rank, boxBlur, addNoise } from './engine/filters';
import { anchorOffset, constrainSize, dragRect, fromPx, toPx, transformedBounds } from './engine/geometry';
import { createImg, hexToRgb, rgbToHex, hslToRgb, rgbToHsl, type Img } from './engine/img';
import {
  combine, contractMask, ellipseMask, emptyMask, expandMask, featherMask, flipMask, fullMask, growMask, invertMask, isEmpty,
  magicWand, maskBounds, maskOutline, offsetMask, polygonMask, rectMask, resampleMask, rotateMask, similarMask, borderMask,
} from './engine/mask';

/** Minimal ImageData-like image filled with a color function. */
function img(w: number, h: number, f: (x: number, y: number) => [number, number, number, number]): Img {
  const im = createImg(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) im.data.set(f(x, y), (y * w + x) * 4);
  return im;
}
const px = (im: Img, x: number, y: number) => Array.from(im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4));
const solid = (w: number, h: number, c: [number, number, number, number]) => img(w, h, () => c);

describe('filters', () => {
  it('blurs leave a flat image unchanged and keep alpha', () => {
    const s = solid(8, 8, [100, 150, 200, 255]);
    for (const out of [gaussianBlur(s, 3), boxBlur(s, 2), median(s, 2)]) {
      expect(px(out, 4, 4)).toEqual([100, 150, 200, 255]);
    }
  });

  it('gaussian blur spreads a single bright pixel', () => {
    const s = img(9, 9, (x, y) => (x === 4 && y === 4 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    const out = gaussianBlur(s, 1.5);
    expect(px(out, 4, 4)[0]).toBeLessThan(255);
    expect(px(out, 5, 4)[0]).toBeGreaterThan(0);
    expect(px(out, 0, 0)[0]).toBe(0);
  });

  it('blur does not bleed black from transparent pixels', () => {
    const s = img(6, 1, (x) => (x < 3 ? [255, 0, 0, 255] : [0, 0, 0, 0]));
    const out = gaussianBlur(s, 1);
    const p = px(out, 2, 0);
    expect(p[0]).toBeGreaterThan(250); // still pure red, just less opaque
    expect(p[3]).toBeLessThan(255);
  });

  it('mosaic averages each cell', () => {
    const s = img(4, 2, (x) => (x % 2 ? [200, 0, 0, 255] : [0, 0, 0, 255]));
    const out = mosaic(s, 2);
    expect(px(out, 0, 0)).toEqual([100, 0, 0, 255]);
    expect(px(out, 1, 1)).toEqual([100, 0, 0, 255]);
  });

  it('median removes an isolated speck', () => {
    const s = img(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255, 255] : [10, 10, 10, 255]));
    expect(px(median(s, 1), 2, 2)).toEqual([10, 10, 10, 255]);
  });

  it('offset wraps around', () => {
    const s = img(3, 1, (x) => [x * 10, 0, 0, 255]);
    const out = offset(s, 1, 0);
    expect([px(out, 0, 0)[0], px(out, 1, 0)[0], px(out, 2, 0)[0]]).toEqual([20, 0, 10]);
  });

  it('find edges is white on flat areas and dark on an edge', () => {
    const s = img(6, 6, (x) => (x < 3 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const out = findEdges(s);
    expect(px(out, 0, 3)[0]).toBe(255);
    expect(px(out, 3, 3)[0]).toBeLessThan(100);
  });

  it('high pass is mid gray on flat images', () => {
    expect(px(highPass(solid(6, 6, [40, 80, 120, 255]), 2), 3, 3).slice(0, 3)).toEqual([128, 128, 128]);
  });

  it('maximum/minimum dilate and erode', () => {
    const s = img(5, 1, (x) => (x === 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
    expect(px(rank(s, 1, 'max'), 1, 0)[0]).toBe(255);
    expect(px(rank(s, 1, 'min'), 2, 0)[0]).toBe(0);
  });

  it('noise is deterministic per seed', () => {
    const s = solid(4, 4, [128, 128, 128, 255]);
    expect(Array.from(addNoise(s, 20, false, true, 7).data)).toEqual(Array.from(addNoise(s, 20, false, true, 7).data));
  });

  it('every registered filter runs on a tiny image without changing its size', () => {
    const s = img(7, 5, (x, y) => [x * 30, y * 40, 90, 255]);
    for (const f of FILTERS) {
      const out = f.run(s, defaultParams(f), { seed: 1, fg: [0, 0, 0], bg: [255, 255, 255] });
      expect([out.width, out.height]).toEqual([7, 5]);
      expect(out.data.length).toBe(7 * 5 * 4);
    }
  });

  it('filters never mutate their input', () => {
    const s = img(6, 6, (x, y) => [x * 40, y * 40, 50, 255]);
    const before = Array.from(s.data);
    for (const f of FILTERS) f.run(s, defaultParams(f), { seed: 1, fg: [0, 0, 0], bg: [255, 255, 255] });
    expect(Array.from(s.data)).toEqual(before);
  });
});

describe('adjustments', () => {
  it('identity curve and levels are no-ops', () => {
    const c = curveLut([[0, 0], [255, 255]]);
    const l = levelsLut(0, 255, 1, 0, 255);
    for (const i of [0, 17, 128, 255]) { expect(c[i]).toBe(i); expect(l[i]).toBe(i); }
  });

  it('curve passes through its control points and stays monotone', () => {
    const lut = curveLut([[0, 0], [64, 40], [192, 216], [255, 255]]);
    expect(lut[64]).toBe(40);
    expect(lut[192]).toBe(216);
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });

  it('levels stretch the input range', () => {
    const l = levelsLut(50, 200, 1, 0, 255);
    expect(l[50]).toBe(0);
    expect(l[200]).toBe(255);
    expect(l[125]).toBe(128);
  });

  it('invert, threshold and posterize', () => {
    const s = solid(1, 1, [10, 100, 250, 255]);
    expect(px(applyAdjust(s, { type: 'invert' }), 0, 0)).toEqual([245, 155, 5, 255]);
    expect(px(applyAdjust(s, { type: 'threshold', level: 128 }), 0, 0).slice(0, 3)).toEqual([0, 0, 0]);
    const p = px(applyAdjust(s, { type: 'posterize', levels: 2 }), 0, 0);
    expect(p.slice(0, 3)).toEqual([0, 0, 255]);
  });

  it('default adjustments keep the image (nearly) unchanged', () => {
    const s = img(4, 4, (x, y) => [x * 60, y * 60, 128, 255]);
    for (const t of ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 'hueSaturation', 'colorBalance', 'channelMixer', 'basic'] as const) {
      const out = applyAdjust(s, defaultAdjust(t));
      for (let i = 0; i < s.data.length; i++) expect(Math.abs(out.data[i] - s.data[i])).toBeLessThanOrEqual(2);
    }
  });

  it('auto contrast stretches a narrow range to full', () => {
    const s = img(10, 1, (x) => [100 + x * 5, 100 + x * 5, 100 + x * 5, 255]);
    const out = autoContrast(s);
    expect(px(out, 0, 0)[0]).toBe(0);
    expect(px(out, 9, 0)[0]).toBe(255);
    expect(px(equalize(s), 9, 0)[0]).toBe(255);
  });
});

describe('blend math', () => {
  it('separable modes match the W3C formulas', () => {
    expect(blendChannel('multiply', 0.5, 0.5)).toBeCloseTo(0.25);
    expect(blendChannel('screen', 0.5, 0.5)).toBeCloseTo(0.75);
    expect(blendChannel('overlay', 0.25, 1)).toBeCloseTo(0.5);
    expect(blendChannel('difference', 0.2, 0.7)).toBeCloseTo(0.5);
    expect(blendChannel('exclusion', 0.5, 0.5)).toBeCloseTo(0.5);
    expect(blendChannel('darken', 0.3, 0.6)).toBe(0.3);
    expect(blendChannel('lighten', 0.3, 0.6)).toBe(0.6);
    expect(blendChannel('color-dodge', 0.5, 0.5)).toBeCloseTo(1);
    expect(blendChannel('color-burn', 0.5, 0.5)).toBeCloseTo(0);
    expect(blendChannel('soft-light', 0.5, 0.5)).toBeCloseTo(0.5);
  });

  it('luminosity keeps the backdrop color with the source luminance', () => {
    const out = blendRGB('luminosity', [1, 0, 0], [0, 0, 0]);
    expect(out.every((v) => Math.abs(v) < 1e-6)).toBe(true);
  });

  it('normal composite with opacity mixes linearly', () => {
    expect(compositePixel('normal', [0, 0, 0, 255], [255, 255, 255, 255], 0.5)).toEqual([128, 128, 128, 255]);
    expect(compositePixel('multiply', [255, 255, 255, 255], [100, 50, 0, 255])).toEqual([100, 50, 0, 255]);
    expect(compositePixel('normal', [0, 0, 0, 0], [10, 20, 30, 128])).toEqual([10, 20, 30, 128]);
  });

  it('PSD blend keys round-trip', () => {
    expect(fromPsdBlend('color dodge')).toBe('color-dodge');
    expect(toPsdBlend('soft-light')).toBe('soft light');
    expect(fromPsdBlend('linear burn')).toBe('normal');
  });
});

describe('selection masks', () => {
  it('rect mask, bounds and invert', () => {
    const m = rectMask(10, 10, { x: 2, y: 3, w: 4, h: 5 });
    expect(maskBounds(m)).toEqual({ x: 2, y: 3, w: 4, h: 5 });
    const inv = invertMask(m);
    expect(inv.data[0]).toBe(255);
    expect(inv.data[3 * 10 + 2]).toBe(0);
    expect(isEmpty(combine(m, inv, 'intersect'))).toBe(true);
    expect(combine(m, inv, 'add').data.every((v) => v === 255)).toBe(true);
  });

  it('expand and contract grow and shrink by the radius', () => {
    const m = rectMask(20, 20, { x: 5, y: 5, w: 10, h: 10 });
    expect(maskBounds(expandMask(m, 2))).toEqual({ x: 3, y: 3, w: 14, h: 14 });
    expect(maskBounds(contractMask(m, 2))).toEqual({ x: 7, y: 7, w: 6, h: 6 });
    expect(isEmpty(contractMask(m, 6))).toBe(true);
  });

  it('border selects a ring around the edge', () => {
    const b = borderMask(rectMask(20, 20, { x: 5, y: 5, w: 10, h: 10 }), 4);
    expect(b.data[10 * 20 + 10]).toBe(0); // center not selected
    expect(b.data[5 * 20 + 10]).toBe(255); // edge selected
  });

  it('feather softens edges', () => {
    const f = featherMask(rectMask(20, 1, { x: 10, y: 0, w: 10, h: 1 }), 2);
    expect(f.data[10]).toBeGreaterThan(0);
    expect(f.data[10]).toBeLessThan(255);
  });

  it('ellipse and polygon masks', () => {
    const e = ellipseMask(10, 10, { x: 0, y: 0, w: 10, h: 10 });
    expect(e.data[5 * 10 + 5]).toBe(255);
    expect(e.data[0]).toBe(0);
    const p = polygonMask(10, 10, [[0, 0], [10, 0], [0, 10]]);
    expect(p.data[1 * 10 + 1]).toBe(255);
    expect(p.data[9 * 10 + 9]).toBe(0);
  });

  it('magic wand: contiguous vs global', () => {
    const s = img(5, 1, (x) => (x === 2 ? [0, 0, 0, 255] : [255, 255, 255, 255]));
    const c = magicWand(s, 0, 0, 10, true);
    expect(Array.from(c.data)).toEqual([255, 255, 0, 0, 0]);
    const g = magicWand(s, 0, 0, 10, false);
    expect(Array.from(g.data)).toEqual([255, 255, 0, 255, 255]);
  });

  it('grow and similar extend by color', () => {
    const s = img(5, 1, (x) => (x === 2 ? [0, 0, 0, 255] : [250, 250, 250, 255]));
    const seed = rectMask(5, 1, { x: 0, y: 0, w: 1, h: 1 });
    expect(Array.from(growMask(s, seed, 10).data)).toEqual([255, 255, 0, 0, 0]);
    expect(Array.from(similarMask(s, seed, 10).data)).toEqual([255, 255, 0, 255, 255]);
  });

  it('rotate, flip, offset and resample', () => {
    const m = emptyMask(3, 2);
    m.data[0] = 255; // top-left
    const r = rotateMask(m, 1);
    expect([r.w, r.h]).toEqual([2, 3]);
    expect(r.data[1]).toBe(255); // top-right after CW rotation
    expect(rotateMask(rotateMask(rotateMask(rotateMask(m, 1), 1), 1), 1).data).toEqual(m.data);
    expect(flipMask(m, true).data[2]).toBe(255);
    expect(offsetMask(m, 3, 2, 1, 1).data[1 * 3 + 1]).toBe(255);
    expect(resampleMask(fullMask(2, 2), 4, 4).data.every((v) => v === 255)).toBe(true);
  });

  it('outline of a rect has four runs', () => {
    const segs = maskOutline(rectMask(10, 10, { x: 2, y: 2, w: 3, h: 3 }));
    expect(segs.length / 4).toBe(4);
  });
});

describe('geometry & image size math', () => {
  it('unit conversion', () => {
    expect(toPx(8.5, 'in', 300)).toBe(2550);
    expect(toPx(21, 'cm', 300)).toBe(2480);
    expect(fromPx(2550, 'in', 300)).toBe(8.5);
  });
  it('constrained resize keeps the aspect ratio', () => {
    expect(constrainSize(4000, 3000, 'w', 2000)).toEqual({ w: 2000, h: 1500 });
    expect(constrainSize(1920, 1080, 'h', 540)).toEqual({ w: 960, h: 540 });
  });
  it('canvas size anchors', () => {
    expect(anchorOffset(100, 100, 200, 300, 4)).toEqual({ dx: 50, dy: 100 });
    expect(anchorOffset(100, 100, 200, 300, 0)).toEqual({ dx: 0, dy: 0 });
    expect(anchorOffset(100, 100, 200, 300, 8)).toEqual({ dx: 100, dy: 200 });
  });
  it('rotated bounds of a square at 45° grow by √2', () => {
    const b = transformedBounds(100, 100, 50, 50, 1, 1, Math.PI / 4);
    expect(b.w).toBeGreaterThanOrEqual(141);
    expect(b.w).toBeLessThanOrEqual(143);
  });
  it('drag rect normalizes and constrains', () => {
    expect(dragRect(10, 10, 0, 4, false, false)).toEqual({ x: 0, y: 4, w: 10, h: 6 });
    expect(dragRect(0, 0, 10, 4, true, false)).toEqual({ x: 0, y: 0, w: 10, h: 10 });
    expect(dragRect(5, 5, 7, 8, false, true)).toEqual({ x: 3, y: 2, w: 4, h: 6 });
  });
  it('color conversions round-trip', () => {
    expect(rgbToHex(...hexToRgb('#FF5A1F'))).toBe('#FF5A1F');
    const [h, s, l] = rgbToHsl(255, 90, 31);
    const back = hslToRgb(h, s, l).map(Math.round);
    expect(back).toEqual([255, 90, 31]);
  });
});
