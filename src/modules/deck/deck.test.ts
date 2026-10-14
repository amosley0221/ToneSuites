import { describe, expect, it } from 'vitest';
import { DeckDoc } from './doc';
import {
  addPlaceholder, applyLayout, emptyDeck, layoutOf, newSlide, removePlaceholder, setPlaceholderRect, slideTitle, type TextEl,
} from './model';
import * as ops from './ops';
import { deckToMarkdown, deckToOutline, outlineToDeck, parseOutline } from './outline';
import { deserializeDeck, serializeDeck } from './serialize';
import { dragAnim, nextAnimation, progressAt, pxToSec, rulerSeconds, rulerTicks, slideBuildTime } from './timeline';
import { layoutTextEl } from './textLayout';
import { rectToPdf, rectToPptx, unitsToInX, unitsToInY, unitsToPt, wrapText } from './units';
import { resizeRect, snapBox } from './Canvas';

const texts = (els: unknown[]) => els.filter((e): e is TextEl => (e as TextEl).type === 'text');

describe('blank deck', () => {
  it('starts with one empty Title slide on the default master', () => {
    const d = emptyDeck();
    expect(d.slides).toHaveLength(1);
    expect(d.slides[0].layoutId).toBe('title');
    expect(d.masters).toHaveLength(1);
    expect(d.masters[0].layouts.map((l) => l.id)).toEqual(['title', 'title-content', 'two-column', 'image-full', 'section', 'blank']);
    // placeholders exist but hold no content (hints are only placeholder styling)
    expect(texts(d.slides[0].elements).every((e) => e.text === '')).toBe(true);
    expect(d.slides[0].elements.map((e) => e.ph)).toEqual(['kicker', 'title', 'body']);
  });
});

describe('.toneoutline → deck', () => {
  it('maps the first slide to Title and the rest to Title + content with bullets', () => {
    const o = parseOutline(JSON.stringify({ title: 'Q', slides: [{ title: 'Intro', body: ['sub'] }, { title: 'Points', body: ['a', 'b'] }, { title: 'Empty' }] }));
    const d = outlineToDeck(o);
    expect(d.slides.map((s) => s.layoutId)).toEqual(['title', 'title-content', 'title-content']);
    expect(d.slides.map(slideTitle)).toEqual(['Intro', 'Points', 'Empty']);
    const body = texts(d.slides[1].elements).find((e) => e.ph === 'body')!;
    expect(body.text).toBe('a\nb');
    expect(body.bullets).toBe(true);
    expect(texts(d.slides[2].elements).find((e) => e.ph === 'body')!.bullets).toBe(false);
  });
  it('rejects JSON without slides and tolerates junk entries', () => {
    expect(() => parseOutline('{"title":"x"}')).toThrow();
    const o = parseOutline(JSON.stringify({ slides: [{ title: 3, body: ['ok', 5] }] }));
    expect(o.slides[0]).toEqual({ title: '', body: ['ok'] });
  });
  it('round-trips through deckToOutline and renders Markdown', () => {
    const d = outlineToDeck({ title: 'T', slides: [{ title: 'One', body: [] }, { title: 'Two', body: ['x', 'y'] }] });
    d.slides[1].notes = 'say hi';
    expect(deckToOutline(d, 'T').slides[1]).toEqual({ title: 'Two', body: ['x', 'y'] });
    const md = deckToMarkdown(d, 'T');
    expect(md).toContain('## Two');
    expect(md).toContain('- x');
    expect(md).toContain('> say hi');
  });
});

describe('layout application', () => {
  it('moves placeholders to the new layout and keeps content', () => {
    const d = emptyDeck();
    const s = d.slides[0];
    texts(s.elements).find((e) => e.ph === 'title')!.text = 'Hello';
    applyLayout(d, s, 'title-content');
    const title = texts(s.elements).find((e) => e.ph === 'title')!;
    expect(title.text).toBe('Hello');
    expect({ x: title.x, y: title.y }).toEqual({ x: layoutOf(d, 'title-content').placeholders[0].rect.x, y: 110 });
    // empty kicker dropped, body kept as placeholder
    expect(s.elements.map((e) => e.ph).sort()).toEqual(['body', 'title']);
  });
  it('keeps filled placeholders that have no target as free elements', () => {
    const d = emptyDeck();
    const s = d.slides[0];
    texts(s.elements).find((e) => e.ph === 'kicker')!.text = 'RESULTS';
    applyLayout(d, s, 'blank');
    expect(s.elements).toHaveLength(1);
    expect((s.elements[0] as TextEl).text).toBe('RESULTS');
    expect(s.elements[0].ph).toBeUndefined();
  });
  it('creates an empty image placeholder for Image full bleed', () => {
    const d = emptyDeck();
    applyLayout(d, d.slides[0], 'image-full');
    const img = d.slides[0].elements.find((e) => e.type === 'image');
    expect(img).toMatchObject({ ph: 'image', src: '', x: 0, y: 0, w: 1920, h: 1080 });
  });
  it('propagates master placeholder edits to untouched slide placeholders only', () => {
    const d = emptyDeck();
    const a = d.slides[0];
    const b = newSlide(d, 'title');
    d.slides.push(b);
    texts(b.elements).find((e) => e.ph === 'title')!.x = 300; // moved by hand
    setPlaceholderRect(d, 'title', 'title', { x: 200, y: 200, w: 1000, h: 200 });
    expect(texts(a.elements).find((e) => e.ph === 'title')).toMatchObject({ x: 200, y: 200, w: 1000, h: 200 });
    expect(texts(b.elements).find((e) => e.ph === 'title')!.x).toBe(300);
  });
  it('adds and removes layout placeholders on slides', () => {
    const d = emptyDeck();
    addPlaceholder(d, 'title', 'image');
    expect(d.slides[0].elements[0]).toMatchObject({ type: 'image', ph: 'image' });
    removePlaceholder(d, 'title', 'image');
    expect(d.slides[0].elements.some((e) => e.ph === 'image')).toBe(false);
  });
});

describe('editing ops + undo', () => {
  it('adds, reorders and deletes slides with undo/redo', () => {
    const doc = new DeckDoc();
    ops.addSlide(doc);
    expect(doc.data.slides[1].layoutId).toBe('title-content');
    ops.addSlide(doc, 'section');
    ops.moveSlide(doc, 2, 0);
    expect(doc.data.slides[0].layoutId).toBe('section');
    expect(doc.ui.current).toBe(0);
    doc.undo();
    expect(doc.data.slides[2].layoutId).toBe('section');
    doc.redo();
    expect(doc.data.slides[0].layoutId).toBe('section');
    ops.deleteSlide(doc, 0); ops.deleteSlide(doc, 0); ops.deleteSlide(doc, 0);
    expect(doc.data.slides).toHaveLength(1); // never empty
  });
  it('arranges z-order and aligns', () => {
    const doc = new DeckDoc();
    ops.insertShape(doc, 'rect');
    const id = doc.ui.selection[0];
    ops.arrange(doc, 'back');
    expect(doc.slide()!.elements[0].id).toBe(id);
    ops.align(doc, 'left');
    expect(doc.slide()!.elements[0].x).toBe(0);
    ops.align(doc, 'vmiddle');
    expect(doc.slide()!.elements[0].y).toBe((1080 - 400) / 2);
  });
  it('coalesces typing into one undo step', () => {
    const doc = new DeckDoc();
    const t = texts(doc.slide()!.elements).find((e) => e.ph === 'title')!;
    for (const s of ['H', 'He', 'Hey']) { t.text = s; doc.commit('text:' + t.id); }
    doc.undo();
    expect(texts(doc.slide()!.elements).find((e) => e.ph === 'title')!.text).toBe('');
  });
});

describe('native serialization', () => {
  it('stores images as media files and restores them', async () => {
    const doc = new DeckDoc();
    ops.insertImage(doc, new Uint8Array([137, 80, 78, 71]), 'image/png', { w: 100, h: 50 });
    const files = await serializeDeck(doc);
    const img = doc.slide()!.elements.find((e) => e.type === 'image')!;
    expect(img.type === 'image' && img.src.startsWith('media/')).toBe(true);
    const enc = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? new TextEncoder().encode(v) : v]));
    expect(Object.keys(enc).sort()).toEqual(['deck.json', (img as { src: string }).src].sort());
    const back = await deserializeDeck(enc, 1);
    expect(back.data.slides[0].elements).toHaveLength(doc.data.slides[0].elements.length);
    expect(back.mediaUrl((img as { src: string }).src)).toMatch(/^data:image\/png;base64,/);
    await expect(deserializeDeck(enc, 2)).rejects.toThrow();
  });
});

describe('pptx / pdf coordinate mapping', () => {
  it('maps 1920×1080 units to 13.333×7.5 in', () => {
    expect(rectToPptx({ x: 0, y: 0, w: 1920, h: 1080 })).toEqual({ x: 0, y: 0, w: 13.333, h: 7.5 });
    expect(unitsToInX(960)).toBeCloseTo(6.6665, 4);
    expect(unitsToInY(540)).toBe(3.75);
    expect(rectToPptx({ x: 128, y: 652, w: 1400, h: 170 })).toEqual({ x: 0.8889, y: 4.5278, w: 9.7220, h: 1.1806 });
  });
  it('maps font units to points (1080 units = 540 pt)', () => {
    expect(unitsToPt(141)).toBe(70.5);
    expect(unitsToPt(39)).toBe(19.5);
  });
  it('flips y for PDF', () => {
    expect(rectToPdf({ x: 100, y: 0, w: 200, h: 100 })).toEqual({ x: 50, y: 490, w: 100, h: 50 });
  });
});

describe('timeline math', () => {
  it('ruler is at least 3 s with quarter ticks', () => {
    expect(rulerSeconds([])).toBe(3);
    expect(rulerSeconds([{ effect: 'fade', delay: 2.8, duration: 0.6 }])).toBe(4);
    expect(rulerTicks(3)).toEqual([0, 0.75, 1.5, 2.25]);
    expect(pxToSec(100, 400, 3)).toBe(0.75);
  });
  it('drags bars: move, resize end, resize start', () => {
    const a = { effect: 'fade' as const, delay: 0.5, duration: 1 };
    expect(dragAnim(a, 'move', 0.27)).toEqual({ ...a, delay: 0.75 });
    expect(dragAnim(a, 'move', -2)).toEqual({ ...a, delay: 0 });
    expect(dragAnim(a, 'end', -5)).toEqual({ ...a, duration: 0.1 });
    expect(dragAnim(a, 'start', 0.5)).toEqual({ ...a, delay: 1, duration: 0.5 });
    expect(dragAnim(a, 'start', 3)).toEqual({ ...a, delay: 1.4, duration: 0.1 });
  });
  it('chains new animations and computes progress', () => {
    const n = nextAnimation([{ effect: 'fade', delay: 0, duration: 0.5 }, { effect: 'appear', delay: 0.6, duration: 0.4 }]);
    expect(n.delay).toBe(1);
    expect(progressAt({ effect: 'fade', delay: 1, duration: 1 }, 1.5)).toBe(0.5);
    expect(progressAt({ effect: 'appear', delay: 1, duration: 1 }, 1.01)).toBe(1);
    expect(progressAt({ effect: 'fly-in', delay: 1, duration: 1 }, 0.5)).toBe(0);
    const doc = new DeckDoc();
    doc.slide()!.elements[0].anim = { effect: 'fade', delay: 0.2, duration: 1.3 };
    expect(slideBuildTime(doc.slide()!.elements)).toBe(1.5);
  });
});

describe('text layout & geometry helpers', () => {
  const mono = (s: string) => s.length * 10;
  it('wraps words and hard-breaks long ones', () => {
    expect(wrapText('aa bb cc', 50, mono)).toEqual(['aa bb', 'cc']);
    expect(wrapText('abcdefghij', 40, mono)).toEqual(['abcd', 'efgh', 'ij']);
    expect(wrapText('one\n\ntwo', 100, mono)).toEqual(['one', '', 'two']);
  });
  it('lays out centered bullet lines', () => {
    const el: TextEl = { id: 'x', type: 'text', role: 'body', text: 'ab', bullets: true, style: { align: 'center', fontSize: 10 }, x: 0, y: 0, w: 100, h: 50 };
    const [l] = layoutTextEl(el, mono);
    expect(l.bulletX).toBe(0);
    expect(l.x).toBeCloseTo(10 + 5.5 + (100 - 15.5 - 20) / 2);
  });
  it('snaps to slide center and resizes with aspect lock', () => {
    const s = snapBox({ x: 755, y: 0, w: 400, h: 100 }, [], 8);
    expect(s.dx).toBe(5);
    expect(s.guides[0]).toEqual({ axis: 'x', at: 960 });
    expect(resizeRect({ x: 0, y: 0, w: 200, h: 100 }, 'se', 100, 0, true, 10)).toEqual({ x: 0, y: 0, w: 300, h: 150 });
    expect(resizeRect({ x: 0, y: 0, w: 200, h: 100 }, 'w', 250, 0, false, 10)).toEqual({ x: 190, y: 0, w: 10, h: 100 });
  });
});
