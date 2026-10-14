// Pure text layout for the PDF and PNG renderers (slide units; measure() returns widths in slide units).
import { fontSizeOf, type TextEl } from './model';
import { wrapText } from './units';

export interface LaidLine { text: string; x: number; baseline: number; bulletX?: number }

export function lineHeightOf(el: TextEl): number {
  return el.role === 'title' ? 0.95 : el.role === 'kicker' ? 1.4 : 1.45;
}
export function letterSpacingOf(el: TextEl): number {
  const fs = fontSizeOf(el);
  return el.role === 'title' ? -0.045 * fs : el.role === 'kicker' ? 0.02 * fs : 0;
}
export function textOpacityOf(el: TextEl): number {
  if (el.style.color) return 1;
  return el.role === 'kicker' ? 0.6 : el.role === 'body' ? 0.75 : 1;
}

/** Lay out a text element; lines beyond the box height are still returned (slides don't clip text). */
export function layoutTextEl(el: TextEl, measure: (s: string) => number, ascent = 0.8): LaidLine[] {
  const fs = fontSizeOf(el);
  const lh = lineHeightOf(el) * fs;
  const indent = el.bullets ? measure('•') + 0.55 * fs : 0;
  const out: LaidLine[] = [];
  let y = el.y + (lh - fs) / 2 + ascent * fs;
  for (const para of el.text.split('\n')) {
    const lines = wrapText(para, el.w - indent, measure);
    lines.forEach((ln, i) => {
      const w = measure(ln);
      const avail = el.w - indent;
      const align = el.style.align ?? 'left';
      const dx = align === 'center' ? (avail - w) / 2 : align === 'right' ? avail - w : 0;
      out.push({ text: ln, x: el.x + indent + dx, baseline: y, bulletX: el.bullets && i === 0 && para.trim() ? el.x : undefined });
      y += lh;
    });
  }
  return out;
}
