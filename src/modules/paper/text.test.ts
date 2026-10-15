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

describe('measured search rects', () => {
  it('places a match by measured width, not character count', () => {
    // "iiii" is narrow, "WWWW" wide: with real metrics the match sits much further left than 50%.
    const it0: TextItemLite = { str: 'iiiiWWWW', transform: [10, 0, 0, 10, 0, 0], width: 100, height: 10 };
    const measure = (s: string) => [...s].reduce((a, c) => a + (c === 'i' ? 1 : 4), 0);
    const [[r]] = findInItems([it0], 'WWWW', measure);
    expect(r.x).toBeCloseTo(20);
    expect(r.w).toBeCloseTo(80);
    expect(findInItems([it0], 'WWWW')[0][0].x).toBeCloseTo(50);
  });
});
