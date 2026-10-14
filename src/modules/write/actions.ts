// Editing actions on a WriteModel — used by menu commands, the toolbar and dialogs.
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { redo, undo } from 'prosemirror-history';
import type { MarkType, Node as PMNode, NodeType } from 'prosemirror-model';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import { NodeSelection, TextSelection, type Command, type EditorState } from 'prosemirror-state';
import { isInTable } from 'prosemirror-tables';
import type { Comment, WriteModel } from './model';
import { schema, type Align, type TocEntry } from './schema';
import { outline } from './stats';
import { changeId, listChanges, resolveAll, resolveChange, SKIP_TRACK, type Change, type ChangeKind } from './track';

export type StyleName = 'body' | 'title' | 'h1' | 'h2' | 'h3' | 'quote' | 'code';
const N = schema.nodes;
const M = schema.marks;

// ---------- Queries ----------

export function currentStyle(state: EditorState): StyleName {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type === N.blockquote) return 'quote';
  const p = $from.parent;
  if (p.type === N.title) return 'title';
  if (p.type === N.heading) return (`h${p.attrs.level}`) as StyleName;
  if (p.type === N.code_block) return 'code';
  return 'body';
}

export function markActive(state: EditorState, type: MarkType): boolean {
  const { from, $from, to, empty } = state.selection;
  if (empty) return !!type.isInSet(state.storedMarks || $from.marks());
  return state.doc.rangeHasMark(from, to, type);
}

export function currentTextStyle(state: EditorState): { fontFamily: string | null; fontSize: number | null } {
  const marks = state.storedMarks || state.selection.$from.marks();
  const m = M.textStyle.isInSet(marks);
  return { fontFamily: m?.attrs.fontFamily ?? null, fontSize: m?.attrs.fontSize ?? null };
}

export function currentAlign(state: EditorState): Align {
  return (state.selection.$from.parent.attrs.align as Align) || 'left';
}

export function inList(state: EditorState): 'bullet' | 'ordered' | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const t = $from.node(d).type;
    if (t === N.bullet_list) return 'bullet';
    if (t === N.ordered_list) return 'ordered';
  }
  return null;
}

// ---------- Styles & formatting ----------

export function setStyle(m: WriteModel, style: StyleName) {
  const state = m.state;
  const inQuote = currentStyle(state) === 'quote';
  if (style === 'quote') { if (!inQuote) m.exec(wrapIn(N.blockquote)); return; }
  if (inQuote) m.exec(lift, false);
  const keep = (t: NodeType, attrs: Record<string, unknown> = {}) => {
    const p = m.state.selection.$from.parent;
    return setBlockType(t, { ...attrs, ...(t.spec.attrs?.align ? { align: p.attrs.align ?? null, lineHeight: p.attrs.lineHeight ?? null } : {}) });
  };
  switch (style) {
    case 'body': m.exec(keep(N.paragraph)); break;
    case 'title': m.exec(keep(N.title)); break;
    case 'h1': case 'h2': case 'h3': m.exec(keep(N.heading, { level: +style.slice(1) })); break;
    case 'code': m.exec(setBlockType(N.code_block)); break;
  }
}

export const toggle = (m: WriteModel, name: 'strong' | 'em' | 'underline' | 'strike' | 'code') => m.exec(toggleMark(M[name]));

/** Merge attrs into the textStyle mark over the selection (or stored marks when collapsed). */
export function setTextStyle(m: WriteModel, patch: { fontFamily?: string | null; fontSize?: number | null; color?: string | null }) {
  m.exec((state, dispatch) => {
    const { from, to, empty } = state.selection;
    const tr = state.tr;
    if (empty) {
      const cur = M.textStyle.isInSet(state.storedMarks || state.selection.$from.marks());
      const attrs = { ...(cur?.attrs ?? {}), ...patch };
      tr.setStoredMarks([...(state.storedMarks || state.selection.$from.marks()).filter((x) => x.type !== M.textStyle), M.textStyle.create(attrs)]);
    } else {
      state.doc.nodesBetween(from, to, (node, pos) => {
        if (!node.isInline) return true;
        const cur = M.textStyle.isInSet(node.marks);
        const attrs = { ...(cur?.attrs ?? {}), ...patch };
        const a = Math.max(from, pos), b = Math.min(to, pos + node.nodeSize);
        if (Object.values(attrs).every((v) => v == null)) tr.removeMark(a, b, M.textStyle);
        else tr.addMark(a, b, M.textStyle.create(attrs));
        return false;
      });
    }
    dispatch?.(tr);
    return true;
  });
}

export function setAlign(m: WriteModel, align: Align) {
  setBlockAttr(m, 'align', align === 'left' ? null : align);
}
export function setLineHeight(m: WriteModel, lh: number | null) {
  setBlockAttr(m, 'lineHeight', lh);
}
function setBlockAttr(m: WriteModel, key: string, value: unknown) {
  m.exec((state, dispatch) => {
    const tr = state.tr;
    const { from, to } = state.selection;
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (node.isTextblock && node.type.spec.attrs && key in node.type.spec.attrs) tr.setNodeMarkup(pos, undefined, { ...node.attrs, [key]: value });
      return true;
    });
    dispatch?.(tr);
    return true;
  });
}

export function toggleList(m: WriteModel, kind: 'bullet' | 'ordered') {
  const cur = inList(m.state);
  const type = kind === 'bullet' ? N.bullet_list : N.ordered_list;
  if (cur === kind) { m.exec(liftListItem(N.list_item)); return; }
  if (cur) {
    // Switch list type in place.
    m.exec((state, dispatch) => {
      const { $from } = state.selection;
      for (let d = $from.depth; d > 0; d--) {
        const n = $from.node(d);
        if (n.type === N.bullet_list || n.type === N.ordered_list) { dispatch?.(state.tr.setNodeMarkup($from.before(d), type)); return true; }
      }
      return false;
    });
    return;
  }
  m.exec(wrapInList(type));
}

export function clearFormatting(m: WriteModel) {
  m.exec((state, dispatch) => {
    const { from, to } = state.selection;
    const tr = state.tr;
    for (const t of [M.strong, M.em, M.underline, M.strike, M.code, M.textStyle, M.highlight]) tr.removeMark(from, to, t);
    tr.setStoredMarks([]);
    dispatch?.(tr);
    return true;
  });
  setStyle(m, 'body');
}

// ---------- Inserts ----------

function insertBlocks(m: WriteModel, nodes: PMNode[]) {
  m.exec((state, dispatch) => {
    const { $from } = state.selection;
    const tr = state.tr;
    // Empty paragraph: replace it; otherwise insert after the current top-level block.
    if ($from.depth >= 1 && $from.parent.type === N.paragraph && $from.parent.content.size === 0 && $from.depth === 1) {
      tr.replaceWith($from.before(1), $from.after(1), nodes);
    } else {
      const at = $from.depth >= 1 ? $from.after(1) : $from.pos;
      tr.insert(at, nodes);
    }
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}

export function insertPageBreak(m: WriteModel) {
  insertBlocks(m, [N.page_break.create(), N.paragraph.create()]);
}
export function insertRule(m: WriteModel) {
  insertBlocks(m, [N.horizontal_rule.create(), N.paragraph.create()]);
}

export function insertTable(m: WriteModel, rows = 3, cols = 3) {
  const cell = (header: boolean) => (header ? N.table_header : N.table_cell).create(null, N.paragraph.create());
  const table = N.table.create(null, Array.from({ length: rows }, (_, r) => N.table_row.create(null, Array.from({ length: cols }, () => cell(r === 0)))));
  m.exec((state, dispatch) => {
    if (isInTable(state)) return false;
    const { $from } = state.selection;
    const at = $from.depth >= 1 ? $from.after(1) : $from.pos;
    const tr = state.tr.insert(at, [table, N.paragraph.create()]);
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 3)));
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}

export function insertImage(m: WriteModel, src: string, width: number | null, height: number | null, alt: string | null) {
  m.exec((state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(N.image.create({ src, width, height, alt })).scrollIntoView());
    return true;
  });
}

export function insertText(m: WriteModel, text: string) {
  m.exec((state, dispatch) => { dispatch?.(state.tr.insertText(text).scrollIntoView()); return true; });
}

export function setLink(m: WriteModel, href: string, text?: string) {
  m.exec((state, dispatch) => {
    const { from, to, empty } = state.selection;
    const tr = state.tr;
    if (!href) { tr.removeMark(from, to, M.link); dispatch?.(tr); return true; }
    const mark = M.link.create({ href });
    if (empty) {
      const t = text || href;
      tr.insert(from, schema.text(t, [...state.selection.$from.marks(), mark]));
    } else tr.addMark(from, to, mark);
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}

export function linkAtSelection(state: EditorState): string | null {
  const { $from, from, to } = state.selection;
  let href: string | null = M.link.isInSet($from.marks())?.attrs.href ?? null;
  if (!href) state.doc.nodesBetween(from, to, (n) => { const l = M.link.isInSet(n.marks); if (l) href = l.attrs.href; return !href; });
  return href;
}

export function insertFootnote(m: WriteModel, text: string, pos?: number) {
  m.exec((state, dispatch) => {
    if (pos != null) {
      const n = state.doc.nodeAt(pos);
      if (n?.type === N.footnote) { dispatch?.(state.tr.setNodeMarkup(pos, undefined, { text }).setMeta(SKIP_TRACK, true)); return true; }
    }
    const { to } = state.selection;
    const tr = state.tr.insert(to, N.footnote.create({ text }));
    tr.setSelection(TextSelection.create(tr.doc, to + 1));
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}

export interface TocOptions { levels: number[]; style: 'dotted' | 'plain' | 'numbered'; pageNumbers: boolean; links: boolean; auto: boolean }

export function tocEntries(doc: PMNode, levels: number[], blockPages: number[]): TocEntry[] {
  return outline(doc).filter((o) => levels.includes(o.level)).map((o) => ({ level: o.level, text: o.text, page: blockPages[o.index] ?? 1 }));
}

export function insertOrUpdateToc(m: WriteModel, opts: TocOptions, pos?: number) {
  const entries = tocEntries(m.state.doc, opts.levels, m.ui.blockPages);
  const attrs = { ...opts, entries };
  m.exec((state, dispatch) => {
    if (pos != null && state.doc.nodeAt(pos)?.type === N.toc) {
      dispatch?.(state.tr.setNodeMarkup(pos, undefined, attrs).setMeta(SKIP_TRACK, true));
      return true;
    }
    const { $from } = state.selection;
    const node = N.toc.create(attrs);
    const tr = state.tr;
    if ($from.depth === 1 && $from.parent.type === N.paragraph && $from.parent.content.size === 0) tr.replaceWith($from.before(1), $from.after(1), node);
    else tr.insert($from.depth >= 1 ? $from.before(1) : $from.pos, node);
    dispatch?.(tr.scrollIntoView());
    return true;
  });
}

/** Refresh every TOC whose entries are stale. `force` also updates TOCs with auto-update off. */
export function refreshTocs(m: WriteModel, force = false): boolean {
  const state = m.state;
  const tr = state.tr;
  state.doc.forEach((n, pos) => {
    if (n.type !== N.toc || (!n.attrs.auto && !force)) return;
    const entries = tocEntries(state.doc, n.attrs.levels, m.ui.blockPages);
    if (JSON.stringify(entries) !== JSON.stringify(n.attrs.entries)) tr.setNodeMarkup(pos, undefined, { ...n.attrs, entries });
  });
  if (!tr.docChanged) return false;
  tr.setMeta(SKIP_TRACK, true).setMeta('addToHistory', false);
  m.apply(tr);
  return true;
}

export function findToc(state: EditorState): number | null {
  let found: number | null = null;
  const sel = state.selection;
  if (sel instanceof NodeSelection && sel.node.type === N.toc) return sel.from;
  state.doc.forEach((n, pos) => { if (found == null && n.type === N.toc) found = pos; });
  return found;
}

export function insertDate(m: WriteModel) {
  insertText(m, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
}

// ---------- Comments ----------

export function addComment(m: WriteModel, text: string): boolean {
  const { from, to, empty } = m.state.selection;
  if (empty || !text.trim()) return false;
  const c: Comment = { id: changeId(), author: m.author, time: Date.now(), text: text.trim() };
  m.comments = [...m.comments, c];
  const tr = m.state.tr.addMark(from, to, M.comment.create({ id: c.id })).setMeta(SKIP_TRACK, true);
  m.apply(tr);
  return true;
}

export function removeComment(m: WriteModel, id: string) {
  m.comments = m.comments.filter((c) => c.id !== id);
  const tr = m.state.tr;
  m.state.doc.descendants((n, pos) => {
    const mk = n.marks.find((x) => x.type === M.comment && x.attrs.id === id);
    if (mk) tr.removeMark(pos, pos + n.nodeSize, mk);
    return true;
  });
  tr.setMeta(SKIP_TRACK, true);
  m.apply(tr);
}

export function commentRanges(doc: PMNode): Map<string, { from: number; to: number; text: string }> {
  const out = new Map<string, { from: number; to: number; text: string }>();
  doc.descendants((n, pos) => {
    for (const mk of n.marks) {
      if (mk.type !== M.comment) continue;
      const id = String(mk.attrs.id);
      const cur = out.get(id);
      if (cur) { cur.to = pos + n.nodeSize; cur.text += n.textContent; } else out.set(id, { from: pos, to: pos + n.nodeSize, text: n.isText ? n.text! : '' });
    }
    return !n.isInline;
  });
  return out;
}

// ---------- Review ----------

export function resolveOne(m: WriteModel, change: Change, accept: boolean) {
  const tr = m.state.tr;
  resolveChange(tr, change, accept, schema);
  m.apply(tr);
}

export function resolveEvery(m: WriteModel, accept: boolean, filter?: ChangeKind) {
  m.apply(resolveAll(m.state, accept, filter));
}

/** Accept/reject the first change at or after the cursor (wrapping around). */
export function resolveNext(m: WriteModel, accept: boolean): boolean {
  const changes = listChanges(m.state.doc);
  if (!changes.length) return false;
  const head = m.state.selection.from;
  const next = changes.find((c) => c.ranges[c.ranges.length - 1].to > head) ?? changes[0];
  resolveOne(m, next, accept);
  return true;
}

export function selectRange(m: WriteModel, from: number, to: number) {
  const tr = m.state.tr.setSelection(TextSelection.create(m.state.doc, from, to)).scrollIntoView();
  m.apply(tr);
  m.view?.focus();
}

export const undoCmd: Command = undo;
export const redoCmd: Command = redo;

/** Put the cursor at a block and scroll it to the top of the work area. */
export function scrollToPos(m: WriteModel, pos: number) {
  const v = m.view;
  if (!v) return;
  const node = v.state.doc.nodeAt(pos);
  const sel = node?.isTextblock ? TextSelection.create(v.state.doc, pos + 1) : node ? NodeSelection.create(v.state.doc, pos) : null;
  if (sel) v.dispatch(v.state.tr.setSelection(sel));
  const dom = v.nodeDOM(pos);
  if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start', behavior: 'smooth' });
  v.focus();
}
