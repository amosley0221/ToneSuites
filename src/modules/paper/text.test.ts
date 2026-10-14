import { describe, expect, it } from 'vitest';
import { findInItems, itemsToParagraphs, paragraphsToHtml, type TextItemLite } from './text';

const item = (str: string, x: number, y: number, h = 12, eol = false): TextItemLite => ({ str, transform: [h, 0, 0, h, x, y], width: str.length * 6, height: h, hasEOL: eol });

describe('text search', () => {
  it('finds case-insensitive matches with proportional rects', () => {
    const hits = findInItems([item('Hello World', 100, 700)], 'world');
    expect(hits.length).toBe(1);
    expect(hits[0][0].x).toBeCloseTo(136);
    expect(hits[0][0].w).toBeCloseTo(30);
  });
  it('matches across items and lines', () => {
    const hits = findInItems([item('total', 0, 700, 12, true), item('amount due', 0, 680)], 'total amount');
    expect(hits.length).toBe(1);
    expect(hits[0].length).toBe(2);
  });
});

describe('paragraphs', () => {
  it('groups lines and detects headings', () => {
    const ps = itemsToParagraphs([
      item('Big Title', 50, 750, 24, true),
      item('First line of a', 50, 700, 12, true),
      item('paragraph.', 50, 686, 12, true),
      item('Second paragraph.', 50, 640, 12, true),
    ]);
    expect(ps).toEqual([
      { text: 'Big Title', heading: 1 },
      { text: 'First line of a paragraph.', heading: 0 },
      { text: 'Second paragraph.', heading: 0 },
    ]);
    expect(paragraphsToHtml('x', [ps])).toContain('<h1>Big Title</h1>');
  });
});
