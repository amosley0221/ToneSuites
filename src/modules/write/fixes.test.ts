// Regression tests for QA fixes: list joining, comment resolve + undo, Tab in tables/paragraphs.
import { describe, expect, it } from 'vitest';
import { TextSelection } from 'prosemirror-state';
import { undo } from 'prosemirror-history';
import { schema } from './schema';
import { addComment, removeComment, toggleList } from './actions';
import { serializeModel, WriteModel } from './model';

const p = (text: string) => schema.node('paragraph', null, text ? [schema.text(text)] : []);
const li = (text: string) => schema.node('list_item', null, [p(text)]);

function modelWith(nodes: ReturnType<typeof p>[], cursor: number, to = cursor) {
  const m = new WriteModel(schema.node('doc', null, nodes));
  m.apply(m.state.tr.setSelection(TextSelection.create(m.state.doc, cursor, to)));
  return m;
}

/** Run the editor keymap for a key, the way ProseMirror would on keydown. */
function press(m: WriteModel, key: string, shift = false): boolean {
  const view: { state: WriteModel['state']; dispatch: (tr: Parameters<WriteModel['apply']>[0]) => void } = { state: m.state, dispatch: (tr) => { m.apply(tr); view.state = m.state; } };
  const ev = { key, shiftKey: shift, ctrlKey: false, metaKey: false, altKey: false, keyCode: key === 'Tab' ? 9 : 0 } as KeyboardEvent;
  for (const pl of m.state.plugins) {
    const h = pl.props.handleKeyDown as ((v: unknown, e: KeyboardEvent) => boolean) | undefined;
    if (h && h(view, ev)) return true;
  }
  return false;
}

describe('lists', () => {
  it('a paragraph turned into a list joins the list right before it (numbering continues)', () => {
    const ol = schema.node('ordered_list', null, [li('one')]);
    const m = modelWith([ol, p('two')], ol.nodeSize + 1);
    toggleList(m, 'ordered');
    expect(m.state.doc.childCount).toBe(1);
    expect(m.state.doc.child(0).childCount).toBe(2);
  });
  it('does not join lists of a different type', () => {
    const ul = schema.node('bullet_list', null, [li('one')]);
    const m = modelWith([ul, p('two')], ul.nodeSize + 1);
    toggleList(m, 'ordered');
    expect(m.state.doc.childCount).toBe(2);
  });
});

describe('comments', () => {
  it('Undo after resolving a comment brings the comment back; saved files keep only anchored ones', () => {
    const m = modelWith([p('hello world')], 1, 6);
    expect(addComment(m, 'check')).toBe(true);
    const id = m.comments[0].id;
    removeComment(m, id);
    expect(JSON.parse(serializeModel(m)['settings.json']).comments).toHaveLength(0);
    m.exec(undo, false);
    expect(JSON.parse(serializeModel(m)['settings.json']).comments.map((c: { text: string }) => c.text)).toEqual(['check']);
  });
});

describe('Tab key', () => {
  it('inserts a tab character in a plain paragraph instead of leaving the editor', () => {
    const m = modelWith([p('ab')], 2);
    expect(press(m, 'Tab')).toBe(true);
    expect(m.state.doc.textContent).toBe('a\tb');
  });
  it('adds a row when pressed in the last table cell', () => {
    const cell = () => schema.nodes.table_cell.create(null, p(''));
    const table = schema.nodes.table.create(null, [schema.nodes.table_row.create(null, [cell(), cell()])]);
    const m = new WriteModel(schema.node('doc', null, [table, p('')]));
    // cursor in the last cell
    const last = table.nodeSize - 4;
    m.apply(m.state.tr.setSelection(TextSelection.create(m.state.doc, last)));
    expect(press(m, 'Tab')).toBe(true);
    expect(m.state.doc.child(0).childCount).toBe(2);
  });
});
