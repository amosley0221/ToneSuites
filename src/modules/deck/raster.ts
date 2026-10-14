// Canvas 2D rendering of a slide (PNG export) + image helpers. Browser-only.
import type { DeckDoc } from './doc';
import {
  cssFont, fontSizeOf, masterOf, MONO_FONT, SLIDE_H, SLIDE_W, slideBg, slideInk,
  type El, type ImageEl, type Rect, type Slide, type TextEl,
} from './model';
import { layoutTextEl, letterSpacingOf, textOpacityOf } from './textLayout';
import { wrapText } from './units';

/** Drawn rect of an image inside its box for object-fit cover / contain. */
export function naturalSize(iw: number, ih: number, el: ImageEl): Rect {
  if (!iw || !ih) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const k = el.fit === 'cover' ? Math.max(el.w / iw, el.h / ih) : Math.min(el.w / iw, el.h / ih);
  const w = iw * k, h = ih * k;
  return { x: el.x + (el.w - w) / 2, y: el.y + (el.h - h) / 2, w, h };
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('Image could not be decoded'));
    img.src = url;
  });
}

async function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Re-encode any browser-decodable image (webp, gif, svg, bmp) as PNG. */
export async function imageToPng(url: string): Promise<Uint8Array> {
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || 1;
  c.height = img.naturalHeight || 1;
  c.getContext('2d')!.drawImage(img, 0, 0);
  return canvasPng(c);
}

function fontCss(doc: DeckDoc, el: TextEl): string {
  const t = doc.data.theme, st = el.style;
  const fs = fontSizeOf(el);
  const italic = st.italic ? 'italic ' : '';
  if (el.role === 'title') return `${italic}${st.bold === false ? 600 : 900} ${fs}px ${cssFont(st.font ?? t.titleFont)}`;
  if (el.role === 'kicker') return `${italic}${st.bold ? 700 : 400} ${fs}px ${cssFont(st.font ?? MONO_FONT)}`;
  return `${italic}${st.bold ? 700 : 500} ${fs}px ${cssFont(st.font ?? t.bodyFont)}`;
}

function drawText(ctx: CanvasRenderingContext2D, doc: DeckDoc, el: TextEl, ink: string) {
  if (!el.text.trim()) return;
  ctx.save();
  ctx.font = fontCss(doc, el);
  const ls = letterSpacingOf(el);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = `${ls}px`;
  ctx.fillStyle = el.style.color ?? ink;
  ctx.globalAlpha = textOpacityOf(el);
  ctx.textBaseline = 'alphabetic';
  const measure = (s: string) => ctx.measureText(s).width;
  const fs = fontSizeOf(el);
  for (const ln of layoutTextEl(el, measure)) {
    if (ln.bulletX !== undefined) ctx.fillText('•', ln.bulletX, ln.baseline);
    ctx.fillText(ln.text, ln.x, ln.baseline);
    if (el.style.underline && ln.text) ctx.fillRect(ln.x, ln.baseline + fs * 0.08, measure(ln.text), Math.max(2, fs * 0.05));
  }
  ctx.restore();
}

async function drawEl(ctx: CanvasRenderingContext2D, doc: DeckDoc, el: El, ink: string) {
  if (el.type === 'text') return drawText(ctx, doc, el, ink);
  if (el.type === 'image') {
    const url = el.src ? doc.mediaUrl(el.src) : '';
    if (!url) return;
    try {
      const img = await loadImage(url);
      const r = naturalSize(img.naturalWidth, img.naturalHeight, el);
      ctx.save();
      ctx.beginPath(); ctx.rect(el.x, el.y, el.w, el.h); ctx.clip();
      ctx.drawImage(img, r.x, r.y, r.w, r.h);
      ctx.restore();
    } catch { /* undecodable image: skip */ }
    return;
  }
  if (el.type === 'shape') {
    ctx.save();
    const sw = el.strokeWidth;
    ctx.beginPath();
    if (el.shape === 'rect') ctx.rect(el.x + sw / 2, el.y + sw / 2, Math.max(0, el.w - sw), Math.max(0, el.h - sw));
    else if (el.shape === 'ellipse') ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.max(0, el.w / 2 - sw / 2), Math.max(0, el.h / 2 - sw / 2), 0, 0, Math.PI * 2);
    else { ctx.moveTo(el.x, el.flip ? el.y + el.h : el.y); ctx.lineTo(el.x + el.w, el.flip ? el.y : el.y + el.h); }
    if (el.shape !== 'line' && el.fill) { ctx.fillStyle = el.fill; ctx.fill(); }
    if (sw > 0 && (el.stroke || el.shape === 'line')) { ctx.lineWidth = sw; ctx.strokeStyle = el.stroke || ink; ctx.stroke(); }
    ctx.restore();
    return;
  }
  const rows = el.rows.length, cols = el.rows[0]?.length ?? 0;
  if (!rows || !cols) return;
  const cw = el.w / cols, fs = el.fontSize, lineH = fs * 1.3;
  ctx.save();
  let y = el.y;
  for (let r = 0; r < rows; r++) {
    const head = el.header && r === 0;
    ctx.font = `${head ? 800 : 500} ${fs}px ${cssFont(doc.data.theme.bodyFont)}`;
    const cells = el.rows[r].map((c) => wrapText(c, cw - 32, (s) => ctx.measureText(s).width));
    const rh = Math.max(lineH + 20, ...cells.map((l) => l.length * lineH + 20));
    for (let c = 0; c < cols; c++) {
      const x = el.x + c * cw;
      if (head) { ctx.globalAlpha = 0.08; ctx.fillStyle = ink; ctx.fillRect(x, y, cw, rh); }
      ctx.globalAlpha = 0.2; ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.strokeRect(x, y, cw, rh);
      ctx.globalAlpha = 1; ctx.fillStyle = ink;
      cells[c].forEach((ln, i) => ctx.fillText(ln, x + 16, y + 10 + i * lineH + fs * 0.95));
    }
    y += rh;
  }
  ctx.restore();
}

/** Render one slide to a canvas at `scale` (1 = 1920×1080). */
export async function renderSlideCanvas(doc: DeckDoc, s: Slide, index: number, total: number, scale = 1): Promise<HTMLCanvasElement> {
  await Promise.all(['400 20px "JetBrains Mono"', '500 20px Archivo', '700 20px Archivo', '900 20px Archivo'].map((f) => document.fonts?.load(f).catch(() => null)));
  const c = document.createElement('canvas');
  c.width = Math.round(SLIDE_W * scale);
  c.height = Math.round(SLIDE_H * scale);
  const ctx = c.getContext('2d')!;
  ctx.scale(scale, scale);
  const ink = slideInk(doc.data, s);
  ctx.fillStyle = slideBg(doc.data, s);
  ctx.fillRect(0, 0, SLIDE_W, SLIDE_H);
  for (const el of s.elements) await drawEl(ctx, doc, el, ink);
  const f = masterOf(doc.data).footer;
  ctx.font = `400 26px ${cssFont(MONO_FONT)}`;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.5;
  if (f.slideNumber) ctx.fillText(`${String(index + 1).padStart(2, '0')} / ${total}`, 128, SLIDE_H - 52);
  const right = [f.date ? new Date().toLocaleDateString() : '', f.showText ? f.text : ''].filter(Boolean).join(' · ');
  if (right) { ctx.textAlign = 'right'; ctx.fillText(right, SLIDE_W - 128, SLIDE_H - 52); }
  return c;
}

export async function exportSlidePng(doc: DeckDoc, index = doc.ui.current, scale = 1): Promise<Uint8Array> {
  const s = doc.data.slides[index];
  return canvasPng(await renderSlideCanvas(doc, s, index, doc.data.slides.length, scale));
}
