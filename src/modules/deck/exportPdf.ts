// PDF export with pdf-lib: one 960×540 pt page per slide (1 slide unit = 0.5 pt).
import {
  clip, endPath, PDFDocument, PDFFont, PDFImage, PDFPage, popGraphicsState, pushGraphicsState, rectangle, rgb,
  setCharacterSpacing, StandardFonts,
} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import archivo500 from '@fontsource/archivo/files/archivo-latin-500-normal.woff?url';
import archivo700 from '@fontsource/archivo/files/archivo-latin-700-normal.woff?url';
import archivo900 from '@fontsource/archivo/files/archivo-latin-900-normal.woff?url';
import mono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url';
import mono700 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff?url';
import type { DeckDoc } from './doc';
import {
  fontSizeOf, masterOf, MONO_FONT, SLIDE_H, SLIDE_W, slideBg, slideInk,
  type DeckData, type El, type ImageEl, type Slide, type TextEl,
} from './model';
import { layoutTextEl, letterSpacingOf, textOpacityOf } from './textLayout';
import { hexToRgb01, PDF_SCALE, rectToPdf, wrapText } from './units';
import { imageToPng, naturalSize } from './raster';

const K = PDF_SCALE;
const col = (hex: string) => { const c = hexToRgb01(hex); return rgb(c.r, c.g, c.b); };
const yPdf = (yUnits: number) => (SLIDE_H - yUnits) * K;

class FontBook {
  private cache = new Map<string, Promise<PDFFont>>();
  constructor(private pdf: PDFDocument) {}
  private load(key: string, f: () => Promise<PDFFont>) {
    let p = this.cache.get(key);
    if (!p) { p = f(); this.cache.set(key, p); }
    return p;
  }
  private bundled(url: string) {
    return this.load(url, async () => {
      const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
      return this.pdf.embedFont(bytes, { subset: true });
    });
  }
  private std(name: StandardFonts) { return this.load(name, () => this.pdf.embedFont(name)); }
  /** Map a theme font + weight to an embeddable font (system fonts → PDF standard 14). */
  get(family: string, weight: 'regular' | 'bold' | 'black', italic = false): Promise<PDFFont> {
    if (family === 'Archivo') return this.bundled(weight === 'black' ? archivo900 : weight === 'bold' ? archivo700 : archivo500);
    if (family === MONO_FONT) return this.bundled(weight === 'regular' ? mono400 : mono700);
    const bold = weight !== 'regular';
    if (family === 'Georgia' || family === 'Times New Roman') {
      return this.std(bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman);
    }
    if (family === 'Courier New') return this.std(bold ? StandardFonts.CourierBold : StandardFonts.Courier);
    return this.std(bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica);
  }
}

/** Standard fonts only encode WinAnsi; replace anything else so drawText never throws. */
function safeText(font: PDFFont, s: string): string {
  let set: Set<number> | null = null;
  try { set = new Set(font.getCharacterSet()); } catch { return s; }
  return Array.from(s).map((ch) => (set!.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

async function fontFor(book: FontBook, d: DeckData, el: TextEl): Promise<PDFFont> {
  const st = el.style;
  if (el.role === 'title') return book.get(st.font ?? d.theme.titleFont, st.bold === false ? 'bold' : 'black', st.italic);
  if (el.role === 'kicker') return book.get(st.font ?? MONO_FONT, st.bold ? 'bold' : 'regular', st.italic);
  return book.get(st.font ?? d.theme.bodyFont, st.bold ? 'bold' : 'regular', st.italic);
}

async function drawText(page: PDFPage, book: FontBook, d: DeckData, el: TextEl, ink: string) {
  if (!el.text.trim()) return;
  const font = await fontFor(book, d, el);
  const fsU = fontSizeOf(el);
  const ls = letterSpacingOf(el);
  const measure = (s: string) => {
    const t = safeText(font, s);
    return font.widthOfTextAtSize(t, fsU) + ls * Math.max(0, Array.from(t).length - 1);
  };
  const color = col(el.style.color ?? ink);
  const opacity = textOpacityOf(el);
  page.pushOperators(pushGraphicsState(), setCharacterSpacing(ls * K));
  for (const ln of layoutTextEl(el, measure)) {
    if (ln.bulletX !== undefined) page.drawText(safeText(font, '•'), { x: ln.bulletX * K, y: yPdf(ln.baseline), size: fsU * K, font, color, opacity });
    if (ln.text) page.drawText(safeText(font, ln.text), { x: ln.x * K, y: yPdf(ln.baseline), size: fsU * K, font, color, opacity });
    if (el.style.underline && ln.text) {
      const w = measure(ln.text);
      page.drawLine({ start: { x: ln.x * K, y: yPdf(ln.baseline + fsU * 0.1) }, end: { x: (ln.x + w) * K, y: yPdf(ln.baseline + fsU * 0.1) }, thickness: fsU * 0.05 * K, color, opacity });
    }
  }
  page.pushOperators(popGraphicsState());
}

async function drawImage(page: PDFPage, pdf: PDFDocument, doc: DeckDoc, el: ImageEl, cache: Map<string, PDFImage | null>) {
  if (!el.src) return;
  let img = cache.get(el.src);
  if (img === undefined) {
    const m = doc.media.get(el.src);
    img = null;
    if (m) {
      try {
        if (m.mime === 'image/png') img = await pdf.embedPng(m.bytes);
        else if (m.mime === 'image/jpeg') img = await pdf.embedJpg(m.bytes);
        else img = await pdf.embedPng(await imageToPng(m.url));
      } catch { img = null; }
    }
    cache.set(el.src, img);
  }
  if (!img) return;
  const nat = naturalSize(img.width, img.height, el);
  const r = rectToPdf(el);
  const box = rectToPdf(nat);
  page.pushOperators(pushGraphicsState(), rectangle(r.x, r.y, r.w, r.h), clip(), endPath());
  page.drawImage(img, { x: box.x, y: box.y, width: box.w, height: box.h });
  page.pushOperators(popGraphicsState());
}

async function drawEl(page: PDFPage, pdf: PDFDocument, book: FontBook, doc: DeckDoc, el: El, ink: string, imgs: Map<string, PDFImage | null>) {
  const d = doc.data;
  if (el.type === 'text') return drawText(page, book, d, el, ink);
  if (el.type === 'image') return drawImage(page, pdf, doc, el, imgs);
  if (el.type === 'shape') {
    const r = rectToPdf(el);
    const sw = el.strokeWidth * K;
    const fill = el.fill ? col(el.fill) : undefined;
    const stroke = el.stroke && sw > 0 ? col(el.stroke) : undefined;
    if (el.shape === 'rect') page.drawRectangle({ x: r.x + sw / 2, y: r.y + sw / 2, width: Math.max(0, r.w - sw), height: Math.max(0, r.h - sw), color: fill, borderColor: stroke, borderWidth: stroke ? sw : 0 });
    else if (el.shape === 'ellipse') page.drawEllipse({ x: r.x + r.w / 2, y: r.y + r.h / 2, xScale: Math.max(0, r.w / 2 - sw / 2), yScale: Math.max(0, r.h / 2 - sw / 2), color: fill, borderColor: stroke, borderWidth: stroke ? sw : 0 });
    else page.drawLine({ start: { x: el.x * K, y: yPdf(el.flip ? el.y + el.h : el.y) }, end: { x: (el.x + el.w) * K, y: yPdf(el.flip ? el.y : el.y + el.h) }, thickness: Math.max(sw, 0.5), color: col(el.stroke || ink) });
    return;
  }
  // table
  const rows = el.rows.length, cols = el.rows[0]?.length ?? 0;
  if (!rows || !cols) return;
  const cw = el.w / cols;
  const regular = await book.get(d.theme.bodyFont, 'regular');
  const bold = await book.get(d.theme.bodyFont, 'bold');
  const fs = el.fontSize;
  const lineH = fs * 1.3;
  let y = el.y;
  for (let r = 0; r < rows; r++) {
    const font = el.header && r === 0 ? bold : regular;
    const measure = (s: string) => font.widthOfTextAtSize(safeText(font, s), fs);
    const cells = el.rows[r].map((c) => wrapText(c, cw - 32, measure));
    const rh = Math.max(lineH + 20, ...cells.map((l) => l.length * lineH + 20));
    for (let c = 0; c < cols; c++) {
      const x = el.x + c * cw;
      page.drawRectangle({ x: x * K, y: yPdf(y + rh), width: cw * K, height: rh * K, borderColor: col(ink), borderOpacity: 0.2, borderWidth: 1, color: el.header && r === 0 ? col(ink) : undefined, opacity: el.header && r === 0 ? 0.08 : 0 });
      cells[c].forEach((ln, i) => {
        if (ln) page.drawText(safeText(font, ln), { x: (x + 16) * K, y: yPdf(y + 10 + i * lineH + fs * 0.95), size: fs * K, font, color: col(ink) });
      });
    }
    y += rh;
  }
}

async function drawFooter(page: PDFPage, book: FontBook, d: DeckData, i: number, total: number, ink: string) {
  const f = masterOf(d).footer;
  const font = await book.get(MONO_FONT, 'regular');
  const size = 26 * K;
  const y = 46 * K + 4;
  if (f.slideNumber) page.drawText(`${String(i + 1).padStart(2, '0')} / ${total}`, { x: 128 * K, y, size, font, color: col(ink), opacity: 0.5 });
  const right = [f.date ? new Date().toLocaleDateString() : '', f.showText ? f.text : ''].filter(Boolean).join(' · ');
  if (right) {
    const t = safeText(font, right);
    page.drawText(t, { x: (SLIDE_W - 128) * K - font.widthOfTextAtSize(t, size), y, size, font, color: col(ink), opacity: 0.5 });
  }
}

export async function exportPdf(doc: DeckDoc, title: string, slides: Slide[] = doc.data.slides): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setTitle(title);
  pdf.setCreator('Tone Deck');
  const book = new FontBook(pdf);
  const imgs = new Map<string, PDFImage | null>();
  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const page = pdf.addPage([SLIDE_W * K, SLIDE_H * K]);
    const ink = slideInk(doc.data, s);
    page.drawRectangle({ x: 0, y: 0, width: SLIDE_W * K, height: SLIDE_H * K, color: col(slideBg(doc.data, s)) });
    for (const el of s.elements) await drawEl(page, pdf, book, doc, el, ink, imgs);
    await drawFooter(page, book, doc.data, i, slides.length, ink);
  }
  return pdf.save();
}
