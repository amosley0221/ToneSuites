// Pure text helpers over pdf.js text items: search hit rects and paragraph extraction.
import type { Rect } from './model';

export interface TextItemLite { str: string; transform: number[]; width: number; height: number; hasEOL?: boolean }

function itemHeight(it: TextItemLite) {
  return it.height || Math.hypot(it.transform[2], it.transform[3]) || 10;
}

/** Rect (user space) covering characters [s, e) of a text item — proportional approximation. */
export function itemSliceRect(it: TextItemLite, s: number, e: number): Rect {
  const [a, b, , , x, y] = it.transform;
  const h = itemHeight(it);
  const len = Math.max(1, it.str.length);
  if (Math.abs(b) > Math.abs(a) * 0.1) {
    // Rotated text: fall back to the item's bounding box.
    const ang = Math.atan2(b, a), w = it.width;
    const xs = [x, x + w * Math.cos(ang), x - h * Math.sin(ang), x + w * Math.cos(ang) - h * Math.sin(ang)];
    const ys = [y, y + w * Math.sin(ang), y + h * Math.cos(ang), y + w * Math.sin(ang) + h * Math.cos(ang)];
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  const dir = a < 0 ? -1 : 1;
  const x0 = x + dir * (it.width * s) / len, x1 = x + dir * (it.width * e) / len;
  return { x: Math.min(x0, x1), y: y - h * 0.22, w: Math.abs(x1 - x0), h: h * 1.18 };
}

/** Case-insensitive search across items. Matches may span adjacent items; returns one rect list per match. */
export function findInItems(items: TextItemLite[], query: string): Rect[][] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  // Concatenate with a separator for EOL items so words across lines still match with a space.
  let text = '';
  const starts: number[] = [];
  items.forEach((it) => { starts.push(text.length); text += it.str + (it.hasEOL ? ' ' : ''); });
  const lower = text.toLowerCase();
  const out: Rect[][] = [];
  let pos = lower.indexOf(q);
  while (pos >= 0) {
    const end = pos + q.length;
    const rects: Rect[] = [];
    items.forEach((it, i) => {
      const s = starts[i], e = s + it.str.length;
      const a = Math.max(pos, s), b = Math.min(end, e);
      if (b > a && it.str.trim()) rects.push(itemSliceRect(it, a - s, b - s));
    });
    if (rects.length) out.push(rects);
    pos = lower.indexOf(q, end);
  }
  return out;
}

export interface Paragraph { text: string; heading: 0 | 1 | 2 }

/** Group items into lines, then lines into paragraphs using vertical gaps; large lines become headings. */
export function itemsToParagraphs(items: TextItemLite[]): Paragraph[] {
  interface Line { text: string; y: number; h: number }
  const lines: Line[] = [];
  let cur: Line | null = null;
  for (const it of items) {
    const y = it.transform[5], h = itemHeight(it);
    if (cur && (Math.abs(y - cur.y) > Math.max(cur.h, h) * 0.5)) { lines.push(cur); cur = null; }
    if (!cur) cur = { text: '', y, h };
    if (it.str) {
      cur.text += it.str;
      cur.h = Math.max(cur.h, h);
    }
    if (it.hasEOL) { lines.push(cur); cur = null; }
  }
  if (cur) lines.push(cur);
  const real = lines.filter((l) => l.text.trim());
  if (!real.length) return [];
  const hs = real.map((l) => l.h).sort((a, b) => a - b);
  const median = hs[Math.floor(hs.length / 2)];
  const paras: Paragraph[] = [];
  let buf: Line[] = [];
  const flush = () => {
    if (!buf.length) return;
    const h = Math.max(...buf.map((l) => l.h));
    const heading = h >= median * 1.6 ? 1 : h >= median * 1.25 ? 2 : 0;
    paras.push({ text: buf.map((l) => l.text.trim()).join(' ').replace(/\s+/g, ' '), heading });
    buf = [];
  };
  real.forEach((l, i) => {
    const prev = real[i - 1];
    if (prev) {
      const gap = Math.abs(prev.y - l.y);
      const sizeChange = Math.abs(prev.h - l.h) > median * 0.2;
      if (gap > Math.max(prev.h, l.h) * 1.7 || sizeChange) flush();
    }
    buf.push(l);
  });
  flush();
  return paras;
}

export function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function paragraphsToHtml(title: string, pages: Paragraph[][]): string {
  const body = pages.map((ps) => ps.map((p) => {
    const tag = p.heading === 1 ? 'h1' : p.heading === 2 ? 'h2' : 'p';
    return `<${tag}>${escapeHtml(p.text)}</${tag}>`;
  }).join('\n')).join('\n<hr>\n');
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>\n${body}\n</body></html>\n`;
}
