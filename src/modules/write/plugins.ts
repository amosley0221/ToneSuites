// Editor plugins: history, keymaps, tables, pagination spacers, find highlights.
import { baseKeymap, chainCommands, exitCode, toggleMark } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Node as PMNode } from 'prosemirror-model';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { Plugin, PluginKey, type Command } from 'prosemirror-state';
import { columnResizing, goToNextCell, tableEditing } from 'prosemirror-tables';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { schema } from './schema';

// ---------- Pagination ----------

export interface Spacer { pos: number; height: number; page: number }
export const pageKey = new PluginKey<{ spacers: Spacer[]; deco: DecorationSet }>('wr-pages');

function spacerDeco(doc: PMNode, spacers: Spacer[]): DecorationSet {
  return DecorationSet.create(doc, spacers.map((s) => Decoration.widget(s.pos, () => {
    const el = document.createElement('div');
    el.className = 'wr-spacer';
    el.contentEditable = 'false';
    el.style.height = s.height + 'px';
    return el;
  }, { side: -1, key: `sp${s.pos}:${s.height}`, ignoreSelection: true })));
}

const pagination = new Plugin<{ spacers: Spacer[]; deco: DecorationSet }>({
  key: pageKey,
  state: {
    init: () => ({ spacers: [] as Spacer[], deco: DecorationSet.empty }),
    apply(tr, prev) {
      const meta = tr.getMeta(pageKey) as Spacer[] | undefined;
      if (meta) return { spacers: meta, deco: spacerDeco(tr.doc, meta) };
      if (!tr.docChanged) return prev;
      const spacers = prev.spacers.map((s) => ({ ...s, pos: tr.mapping.map(s.pos, -1) }));
      return { spacers, deco: prev.deco.map(tr.mapping, tr.doc) };
    },
  },
  props: { decorations: (state) => pageKey.getState(state)?.deco },
});

// ---------- Find ----------

export interface FindQuery { text: string; caseSensitive: boolean; wholeWord: boolean; current: number }
export interface FindState extends FindQuery { matches: { from: number; to: number }[]; deco: DecorationSet }
export const findKey = new PluginKey<FindState>('wr-find');

export function findMatches(doc: PMNode, q: FindQuery): { from: number; to: number }[] {
  if (!q.text) return [];
  const out: { from: number; to: number }[] = [];
  const esc = q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(q.wholeWord ? `(?<![\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])` : esc, q.caseSensitive ? 'gu' : 'giu');
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Non-text inline nodes have size 1; a placeholder char keeps offsets aligned with positions.
    let text = '';
    node.forEach((c) => { text += c.isText ? c.text! : '￼'; });
    for (const m of text.matchAll(re)) if (m[0].length) out.push({ from: pos + 1 + m.index!, to: pos + 1 + m.index! + m[0].length });
    return false;
  });
  return out;
}

function findDeco(doc: PMNode, matches: FindState['matches'], current: number) {
  return DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'wr-find wr-find-cur' : 'wr-find' })));
}

const find = new Plugin<FindState>({
  key: findKey,
  state: {
    init: () => ({ text: '', caseSensitive: false, wholeWord: false, current: 0, matches: [], deco: DecorationSet.empty }),
    apply(tr, prev) {
      const meta = tr.getMeta(findKey) as FindQuery | undefined;
      if (!meta && !tr.docChanged) return prev;
      const q = meta ?? prev;
      if (!q.text) return { ...q, matches: [], deco: DecorationSet.empty };
      const matches = findMatches(tr.doc, q);
      const current = Math.min(q.current, Math.max(0, matches.length - 1));
      return { ...q, current, matches, deco: findDeco(tr.doc, matches, current) };
    },
  },
  props: { decorations: (state) => findKey.getState(state)?.deco },
});

// ---------- Keymaps ----------

const hardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
  dispatch?.(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
  return true;
});

export function buildPlugins(): Plugin[] {
  const li = schema.nodes.list_item;
  return [
    history(),
    keymap({
      'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
      'Mod-b': toggleMark(schema.marks.strong), 'Mod-i': toggleMark(schema.marks.em), 'Mod-u': toggleMark(schema.marks.underline),
      'Mod-`': toggleMark(schema.marks.code),
      'Shift-Enter': hardBreak, 'Mod-Enter': (state, dispatch) => {
        // Ctrl Enter = page break (Word convention).
        const { $from } = state.selection;
        if ($from.depth < 1) return false;
        const after = $from.after(1);
        dispatch?.(state.tr.insert(after, [schema.nodes.page_break.create(), schema.nodes.paragraph.create()]).scrollIntoView());
        return true;
      },
      Enter: splitListItem(li),
      Tab: chainCommands(goToNextCell(1), sinkListItem(li)),
      'Shift-Tab': chainCommands(goToNextCell(-1), liftListItem(li)),
      'Mod-[': liftListItem(li), 'Mod-]': sinkListItem(li),
    }),
    keymap(baseKeymap),
    columnResizing(),
    tableEditing(),
    pagination,
    find,
  ];
}
