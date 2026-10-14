import { describe, expect, it } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from './schema';
import { parseMarkdown, toMarkdown } from './markdown';
import { countWords, docStats, outline, toToneOutline } from './stats';
import { acceptedDoc, listChanges, resolveAll, trackTransaction } from './track';
import { deserializeModel, serializeModel, WriteModel } from './model';
import { findMatches } from './plugins';

const p = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const h = (level: number, text: string) => schema.node('heading', { level }, [schema.text(text)]);

describe('markdown', () => {
  it('round-trips headings, lists, marks, tables and footnotes', () => {
    const src = [
      '# Plan',
      '',
      'Some **bold** and *italic* and ~~gone~~ text with a [link](https://example.com).',
      '',
      '## Steps',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '> quoted',
      '',
      '| a | b |',
      '| --- | --- |',
      '| c | d |',
      '',
      'Note here[^1].',
      '',
      '[^1]: The footnote text.',
      '',
    ].join('\n');
    const doc = parseMarkdown(src);
    expect(doc.child(0).type.name).toBe('heading');
    expect(doc.child(4).type.name).toBe('ordered_list');
    const table = doc.child(6);
    expect(table.type.name).toBe('table');
    expect(table.childCount).toBe(2);
    let fn = '';
    doc.descendants((n) => { if (n.type.name === 'footnote') fn = n.attrs.text; });
    expect(fn).toBe('The footnote text.');
    const out = toMarkdown(doc);
    expect(out).toBe(src);
    expect(toMarkdown(parseMarkdown(out))).toBe(out);
  });

  it('omits tracked deletions and keeps insertions as plain text', () => {
    const del = schema.marks.deletion.create({ id: 'a', author: 'You', time: 1 });
    const ins = schema.marks.insertion.create({ id: 'b', author: 'You', time: 1 });
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('keep '), schema.text('old', [del]), schema.text('new', [ins])])]);
    expect(toMarkdown(doc)).toBe('keep new\n');
  });
});

describe('stats', () => {
  it('counts words and skips deleted text', () => {
    expect(countWords("It's a well-known fact — 3.5 times.")).toBe(6);
    const del = schema.marks.deletion.create({ id: 'a', author: 'You', time: 1 });
    const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('one two '), schema.text('three', [del])])]);
    expect(docStats(doc).words).toBe(2);
  });

  it('builds an outline and a deck outline', () => {
    const doc = schema.node('doc', null, [
      schema.node('title', null, [schema.text('Report')]),
      p('Intro line.'),
      h(1, 'Background'),
      p('First para.'),
      schema.node('bullet_list', null, [schema.node('list_item', null, [p('point a')]), schema.node('list_item', null, [p('point b')])]),
      h(3, 'Detail'),
      h(2, 'Next'),
      p(''),
    ]);
    expect(outline(doc).map((o) => [o.level, o.text])).toEqual([[0, 'Report'], [1, 'Background'], [3, 'Detail'], [2, 'Next']]);
    const o = toToneOutline(doc, 'fallback');
    expect(o.title).toBe('Report');
    expect(o.slides).toEqual([
      { title: 'Report', body: ['Intro line.'] },
      { title: 'Background', body: ['First para.', 'point a', 'point b', 'Detail'] },
      { title: 'Next', body: [] },
    ]);
  });
});

describe('track changes', () => {
  const base = () => EditorState.create({ schema, doc: schema.node('doc', null, [p('Hello world')]) });

  it('marks typed text as insertion', () => {
    const s = base();
    const tr = s.tr.insertText(' big', 6);
    const t = trackTransaction(s, tr, 'You')!;
    const changes = listChanges(t.doc);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('insertion');
    expect(changes[0].text).toBe(' big');
  });

  it('keeps deleted text with a deletion mark, and accept/reject resolve it', () => {
    const s = base();
    const tr = s.tr.delete(6, 12); // " world"
    const t = trackTransaction(s, tr, 'You')!;
    expect(t.doc.textContent).toBe('Hello world');
    const [c] = listChanges(t.doc);
    expect(c.kind).toBe('deletion');
    expect(c.text).toBe(' world');
    const after = s.apply(t);
    expect(resolveAll(after, true).doc.textContent).toBe('Hello');
    expect(resolveAll(after, false).doc.textContent).toBe('Hello world');
    expect(listChanges(resolveAll(after, false).doc)).toHaveLength(0);
  });

  it('replacing a selection strikes old text and inserts new text after it', () => {
    let s = base();
    s = s.apply(s.tr.setSelection(TextSelection.create(s.doc, 7, 12)));
    const tr = s.tr.insertText('there');
    const t = trackTransaction(s, tr, 'You')!;
    expect(t.doc.textContent).toBe('Hello worldthere');
    expect(acceptedDoc(t.doc).textContent).toBe('Hello there');
    expect(listChanges(t.doc).map((c) => c.kind)).toEqual(['deletion', 'insertion']);
  });

  it('deleting your own pending insertion removes it for real', () => {
    let s = base();
    s = s.apply(trackTransaction(s, s.tr.insertText('XY', 6), 'You')!);
    const t = trackTransaction(s, s.tr.delete(6, 8), 'You')!;
    expect(t.doc.textContent).toBe('Hello world');
    expect(listChanges(t.doc)).toHaveLength(0);
  });

  it('records formatting changes and can reject them', () => {
    const s = base();
    const t = trackTransaction(s, s.tr.addMark(1, 6, schema.marks.strong.create()), 'You')!;
    const after = s.apply(t);
    const [c] = listChanges(after.doc);
    expect(c.kind).toBe('format');
    expect(c.ops).toBe('+strong');
    const rejected = resolveAll(after, false).doc;
    let bold = false;
    rejected.descendants((n) => { if (n.marks.some((m) => m.type.name === 'strong')) bold = true; });
    expect(bold).toBe(false);
  });
});

describe('model', () => {
  it('serializes and restores doc, settings and comments', () => {
    const m = new WriteModel(schema.node('doc', null, [h(1, 'Hi'), p('Body')]));
    m.page.paper = 'A4';
    m.tracking = true;
    m.comments.push({ id: 'c1', author: 'You', time: 5, text: 'check' });
    const files = serializeModel(m);
    const enc = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]));
    const back = deserializeModel(enc, 1);
    expect(back.state.doc.eq(m.state.doc)).toBe(true);
    expect(back.page.paper).toBe('A4');
    expect(back.tracking).toBe(true);
    expect(back.comments[0].text).toBe('check');
  });

  it('find matches respects case and whole word', () => {
    const doc = schema.node('doc', null, [p('Cat cat concat CAT')]);
    expect(findMatches(doc, { text: 'cat', caseSensitive: false, wholeWord: false, current: 0 })).toHaveLength(4);
    expect(findMatches(doc, { text: 'cat', caseSensitive: false, wholeWord: true, current: 0 })).toHaveLength(3);
    expect(findMatches(doc, { text: 'cat', caseSensitive: true, wholeWord: true, current: 0 })).toEqual([{ from: 5, to: 8 }]);
  });
});
