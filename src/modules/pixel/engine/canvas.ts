// DOM canvas helpers (browser only).
import type { Img } from './img';
import { emptyMask, type Mask, type Rect } from './mask';

export type Cnv = HTMLCanvasElement;

export function newCanvas(w: number, h: number): Cnv {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: Cnv): CanvasRenderingContext2D {
  return c.getContext('2d')!;
}

export function cloneCanvas(src: Cnv): Cnv {
  const c = newCanvas(src.width, src.height);
  ctx2d(c).drawImage(src, 0, 0);
  return c;
}

export function clearCanvas(c: Cnv) {
  const x = ctx2d(c);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.clearRect(0, 0, c.width, c.height);
}

export function getImg(c: Cnv, r?: Rect): Img {
  const rect = r ?? { x: 0, y: 0, w: c.width, h: c.height };
  return ctx2d(c).getImageData(rect.x, rect.y, Math.max(1, rect.w), Math.max(1, rect.h));
}

export function putImg(c: Cnv, img: Img, x = 0, y = 0) {
  const id = img instanceof ImageData ? img : new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height);
  ctx2d(c).putImageData(id, x, y);
}

export function imgToCanvas(img: Img): Cnv {
  const c = newCanvas(img.width, img.height);
  putImg(c, img);
  return c;
}

/** Mask → canvas whose alpha channel holds the mask (rgb black). */
export function maskToCanvas(m: Mask): Cnv {
  const c = newCanvas(m.w, m.h);
  const id = ctx2d(c).createImageData(m.w, m.h);
  for (let i = 0; i < m.data.length; i++) id.data[i * 4 + 3] = m.data[i];
  ctx2d(c).putImageData(id, 0, 0);
  return c;
}

/** Alpha channel of a canvas region (in a doc-sized frame at offset) → Mask. */
export function canvasAlphaToMask(c: Cnv, w = c.width, h = c.height, ox = 0, oy = 0): Mask {
  const m = emptyMask(w, h);
  const tmp = newCanvas(w, h);
  ctx2d(tmp).drawImage(c, ox, oy);
  const d = ctx2d(tmp).getImageData(0, 0, w, h).data;
  for (let i = 0; i < m.data.length; i++) m.data[i] = d[i * 4 + 3];
  return m;
}

/** Gray PNG-ish canvas (luminance = mask) for PSD export / thumbnails. */
export function maskCanvasToGray(c: Cnv): Cnv {
  const out = newCanvas(c.width, c.height);
  const src = ctx2d(c).getImageData(0, 0, c.width, c.height);
  const d = src.data;
  for (let i = 0; i < d.length; i += 4) { const a = d[i + 3]; d[i] = d[i + 1] = d[i + 2] = a; d[i + 3] = 255; }
  ctx2d(out).putImageData(src, 0, 0);
  return out;
}

/** Gray canvas (luminance) → alpha-coded mask canvas. */
export function grayToMaskCanvas(c: Cnv | HTMLCanvasElement): Cnv {
  const out = newCanvas(c.width, c.height);
  const x = ctx2d(out);
  x.drawImage(c, 0, 0);
  const id = x.getImageData(0, 0, c.width, c.height);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.round((d[i] + d[i + 1] + d[i + 2]) / 3); d[i + 3] = v; d[i] = d[i + 1] = d[i + 2] = 0; }
  x.putImageData(id, 0, 0);
  return out;
}

/** Bounding box of non-transparent pixels (null if empty). */
export function contentBounds(c: Cnv): Rect | null {
  const { width: w, height: h } = c;
  const d = ctx2d(c).getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    for (let x = 0; x < w; x++) {
      if (d[row + x * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function canvasToBlob(c: Cnv, type = 'image/png', quality?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode image'))), type, quality));
}

export async function canvasToBytes(c: Cnv, type = 'image/png', quality?: number): Promise<Uint8Array> {
  const b = await canvasToBlob(c, type, quality);
  return new Uint8Array(await b.arrayBuffer());
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' };
export const mimeFor = (ext: string) => MIME[ext.toLowerCase()] ?? 'image/png';

export async function bytesToCanvas(bytes: Uint8Array, mime = 'image/png'): Promise<Cnv> {
  const blob = mime ? new Blob([bytes as BlobPart], { type: mime }) : new Blob([bytes as BlobPart]);
  const bmp = await createImageBitmap(blob);
  const c = newCanvas(bmp.width, bmp.height);
  ctx2d(c).drawImage(bmp, 0, 0);
  bmp.close?.();
  return c;
}

export function solidCanvas(w: number, h: number, color: string): Cnv {
  const c = newCanvas(w, h);
  const x = ctx2d(c);
  x.fillStyle = color;
  x.fillRect(0, 0, w, h);
  return c;
}

/** Downscaled copy that fits inside max×max (for thumbnails and previews). */
export function thumbnail(src: Cnv, max: number): Cnv {
  const k = Math.min(1, max / Math.max(src.width, src.height));
  const c = newCanvas(Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)));
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}
