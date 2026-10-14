// PowerPoint export via pptxgenjs (13.333×7.5 in "wide" layout). Positions mapped from slide units.
import PptxGenJS from 'pptxgenjs';
import type { DeckDoc } from './doc';
import { fontSizeOf, masterOf, MONO_FONT, slideBg, slideInk, type El, type TextEl } from './model';
import { loadImage, naturalSize } from './raster';
import { letterSpacingOf, lineHeightOf, textOpacityOf } from './textLayout';
import { hexNoHash, rectToPptx, unitsToPt } from './units';

const transparency = (opacity: number) => Math.round((1 - opacity) * 100);

/** pptxgenjs text options for a text element (exported for tests). */
export function pptxTextOptions(el: TextEl, theme: { titleFont: string; bodyFont: string }, ink: string) {
  const font = el.style.font ?? (el.role === 'title' ? theme.titleFont : el.role === 'kicker' ? MONO_FONT : theme.bodyFont);
  return {
    ...rectToPptx(el),
    fontFace: font,
    fontSize: unitsToPt(fontSizeOf(el)),
    bold: el.role === 'title' ? el.style.bold !== false : !!el.style.bold,
    italic: !!el.style.italic,
    underline: el.style.underline ? { style: 'sng' as const } : undefined,
    color: hexNoHash(el.style.color ?? ink),
    transparency: transparency(textOpacityOf(el)),
    align: el.style.align ?? 'left',
    valign: 'top' as const,
    margin: 0,
    charSpacing: unitsToPt(letterSpacingOf(el)),
    lineSpacingMultiple: lineHeightOf(el),
    fit: 'none' as const,
  };
}

async function addEl(doc: DeckDoc, slide: PptxGenJS.Slide, el: El, ink: string) {
  const d = doc.data;
  if (el.type === 'text') {
    if (!el.text.trim()) return;
    const opts = pptxTextOptions(el, d.theme, ink);
    if (el.bullets) {
      const runs = el.text.split('\n').map((t) => ({ text: t, options: { bullet: t.trim() ? true : false, breakLine: true } }));
      slide.addText(runs, opts);
    } else slide.addText(el.text, opts);
    return;
  }
  if (el.type === 'image') {
    const m = el.src ? doc.media.get(el.src) : undefined;
    if (!m) return;
    let r = rectToPptx(el);
    let sizing: PptxGenJS.ImageProps['sizing'];
    try {
      const img = await loadImage(m.url);
      if (el.fit === 'contain') r = rectToPptx(naturalSize(img.naturalWidth, img.naturalHeight, el));
      else {
        const nat = naturalSize(img.naturalWidth, img.naturalHeight, el);
        const box = rectToPptx(el);
        const n = rectToPptx(nat);
        r = { x: box.x, y: box.y, w: n.w, h: n.h };
        sizing = { type: 'cover', w: box.w, h: box.h };
      }
    } catch { /* keep box */ }
    slide.addImage({ data: m.url, ...r, sizing });
    return;
  }
  if (el.type === 'shape') {
    const r = rectToPptx(el);
    if (el.shape === 'line') {
      slide.addShape('line', { ...r, flipV: !!el.flip, line: { color: hexNoHash(el.stroke || ink), width: unitsToPt(el.strokeWidth) } });
      return;
    }
    slide.addShape(el.shape === 'rect' ? 'rect' : 'ellipse', {
      ...r,
      fill: el.fill ? { color: hexNoHash(el.fill) } : { type: 'none' },
      line: el.stroke && el.strokeWidth > 0 ? { color: hexNoHash(el.stroke), width: unitsToPt(el.strokeWidth) } : { type: 'none' },
    });
    return;
  }
  const cols = el.rows[0]?.length ?? 0;
  if (!cols) return;
  const r = rectToPptx(el);
  slide.addTable(
    el.rows.map((row, ri) => row.map((c) => ({ text: c, options: { bold: el.header && ri === 0, fill: el.header && ri === 0 ? { color: hexNoHash(ink), transparency: 92 } : undefined } }))),
    { x: r.x, y: r.y, w: r.w, colW: Array(cols).fill(r.w / cols), fontFace: d.theme.bodyFont, fontSize: unitsToPt(el.fontSize), color: hexNoHash(ink), border: { type: 'solid', pt: 1, color: hexNoHash(ink) } },
  );
}

export async function exportPptx(doc: DeckDoc, title: string): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = title;
  pptx.author = '';
  pptx.company = '';
  const d = doc.data;
  const footer = masterOf(d).footer;
  const total = d.slides.length;
  for (let i = 0; i < total; i++) {
    const s = d.slides[i];
    const slide = pptx.addSlide();
    const ink = slideInk(d, s);
    slide.background = { color: hexNoHash(slideBg(d, s)) };
    for (const el of s.elements) await addEl(doc, slide, el, ink);
    const fopts = { y: 6.95, h: 0.3, fontFace: MONO_FONT, fontSize: 13, color: hexNoHash(ink), transparency: 50, margin: 0 };
    if (footer.slideNumber) slide.addText(`${String(i + 1).padStart(2, '0')} / ${total}`, { ...fopts, x: 0.889, w: 3 });
    const right = [footer.date ? new Date().toLocaleDateString() : '', footer.showText ? footer.text : ''].filter(Boolean).join(' · ');
    if (right) slide.addText(right, { ...fopts, x: 6.444, w: 6, align: 'right' });
    if (s.notes.trim()) slide.addNotes(s.notes);
  }
  const out = await pptx.write({ outputType: 'uint8array' });
  return out as Uint8Array;
}
