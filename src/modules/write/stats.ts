// Pure document analysis: word counts, outline, toneoutline generation. No DOM.
import type { Node as PMNode } from 'prosemirror-model';

/** Visible text of an inline container, skipping tracked deletions. */
export function finalText(node: PMNode): string {
  let s = '';
  node.descendants((n) => {
    if (n.isText) { if (!n.marks.some((m) => m.type.name === 'deletion')) s += n.text; return false; }
    if (n.type.name === 'hard_break') s += ' ';
    return true;
  });
  return s;
}

const WORD = /[\p{L}\p{N}]+(?:['’\-.][\p{L}\p{N}]+)*/gu;

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

export interface DocStats { words: number; characters: number; charactersNoSpaces: number; paragraphs: number; readingMinutes: number }

export function docStats(doc: PMNode): DocStats {
  let words = 0, characters = 0, noSpace = 0, paragraphs = 0;
  doc.descendants((n) => {
    if (n.isTextblock) {
      const t = finalText(n);
      if (t.trim()) paragraphs++;
      words += countWords(t);
      characters += t.length;
      noSpace += t.replace(/\s/g, '').length;
      return false;
    }
    return true;
  });
  return { words, characters, charactersNoSpaces: noSpace, paragraphs, readingMinutes: words ? Math.max(1, Math.round(words / 238)) : 0 };
}

export interface OutlineItem { level: number; text: string; pos: number; index: number }

/** Title = level 0, headings 1–3. `index` = top-level block index (for pagination lookups). */
export function outline(doc: PMNode): OutlineItem[] {
  const out: OutlineItem[] = [];
  doc.forEach((n, pos, index) => {
    if (n.type.name === 'title' || n.type.name === 'heading') {
      const text = finalText(n).trim();
      if (text) out.push({ level: n.type.name === 'title' ? 0 : n.attrs.level, text, pos, index });
    }
  });
  return out;
}

export interface ToneOutline { title: string; slides: { title: string; body: string[] }[] }

/** One slide per Title/H1/H2; following paragraphs, list items and H3s become body lines. */
export function toToneOutline(doc: PMNode, fallbackTitle: string): ToneOutline {
  const slides: ToneOutline['slides'] = [];
  let title = '';
  let cur: ToneOutline['slides'][number] | null = null;
  const pushLine = (t: string) => {
    const line = t.replace(/\s+/g, ' ').trim();
    if (!line) return;
    if (!cur) { cur = { title: '', body: [] }; slides.push(cur); }
    cur.body.push(line);
  };
  const walk = (n: PMNode) => {
    const name = n.type.name;
    if (name === 'title' || (name === 'heading' && n.attrs.level <= 2)) {
      const t = finalText(n).trim();
      if (!t) return;
      if (name === 'title' && !title) title = t;
      cur = { title: t, body: [] };
      slides.push(cur);
      return;
    }
    if (n.isTextblock) { pushLine(finalText(n)); return; }
    if (name === 'list_item') {
      // A list item's first paragraph is the line; nested lists add their own lines.
      n.forEach((c) => (c.isTextblock ? pushLine(finalText(c)) : walk(c)));
      return;
    }
    if (name === 'table') {
      n.forEach((row) => {
        const cells: string[] = [];
        row.forEach((cell) => cells.push(finalText(cell).trim()));
        pushLine(cells.filter(Boolean).join(' · '));
      });
      return;
    }
    n.forEach((c) => walk(c));
  };
  doc.forEach((n) => walk(n));
  const firstHeading = (slides as { title: string }[]).find((s) => s.title)?.title;
  return { title: title || firstHeading || fallbackTitle, slides };
}
