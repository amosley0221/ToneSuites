// Coordinate mapping from slide units (1920×1080) to export targets, plus text wrapping shared by PDF/PNG.
import { SLIDE_H, SLIDE_W, type Rect } from './model';

/** PowerPoint 16:9 "wide" layout. */
export const PPTX_W_IN = 13.333;
export const PPTX_H_IN = 7.5;
export const unitsToInX = (u: number) => round4((u / SLIDE_W) * PPTX_W_IN);
export const unitsToInY = (u: number) => round4((u / SLIDE_H) * PPTX_H_IN);
/** 1080 units = 7.5 in = 540 pt → 1 unit = 0.5 pt. */
export const unitsToPt = (u: number) => round4(u * (PPTX_H_IN * 72) / SLIDE_H);
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function rectToPptx(r: Rect): { x: number; y: number; w: number; h: number } {
  return { x: unitsToInX(r.x), y: unitsToInY(r.y), w: unitsToInX(r.w), h: unitsToInY(r.h) };
}

/** PDF page is 960×540 pt with origin bottom-left. */
export const PDF_SCALE = 0.5;
export function rectToPdf(r: Rect): { x: number; y: number; w: number; h: number } {
  return { x: r.x * PDF_SCALE, y: (SLIDE_H - r.y - r.h) * PDF_SCALE, w: r.w * PDF_SCALE, h: r.h * PDF_SCALE };
}

/** Greedy word wrap; words longer than the line are broken by character. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/).filter((w) => w.length);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (measure(cand.trimEnd()) <= maxWidth || !line.trim()) {
        if (!line.trim() && measure(w) > maxWidth && w.trim()) {
          // hard-break a very long word
          let chunk = '';
          for (const ch of w) {
            if (measure(chunk + ch) > maxWidth && chunk) { out.push(chunk); chunk = ''; }
            chunk += ch;
          }
          line = chunk;
        } else line = cand;
      } else {
        out.push(line.trimEnd());
        line = w.trim() ? w : '';
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

export function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 0, g: 0, b: 0 };
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
export const hexNoHash = (hex: string) => {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return h.slice(0, 6).toUpperCase();
};
