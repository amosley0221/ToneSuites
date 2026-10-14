// Track changes: rewrites user transactions so inserted content carries an `insertion` mark and
// deleted content stays in the document with a `deletion` mark. Pure (no DOM) — unit tested.
import type { Mark, MarkType, Node as PMNode, Schema } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { AddMarkStep, RemoveMarkStep, ReplaceStep } from 'prosemirror-transform';
import { FORMAT_MARKS } from './schema';

export const SKIP_TRACK = 'wr-skip-track';

let seq = 0;
export function changeId(): string {
  seq = (seq + 1) % 1e6;
  return Date.now().toString(36) + seq.toString(36);
}

type PosMap = (p: number) => number;

/** Find an adjacent tracking mark by the same author so continuous typing forms one change. */
function adjacentAttrs(doc: PMNode, pos: number, type: MarkType, author: string): Record<string, unknown> | null {
  const $p = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  for (const n of [$p.nodeBefore, $p.nodeAfter]) {
    const m = n?.marks.find((mk) => mk.type === type && mk.attrs.author === author);
    if (m && Date.now() - (m.attrs.time as number) < 10 * 60_000) return m.attrs;
  }
  return null;
}

/**
 * Turn a transaction into its tracked equivalent. Returns null when the transaction should pass
 * through unchanged (no doc change, untracked meta, or structural steps we don't track).
 */
export function trackTransaction(state: EditorState, tr: Transaction, author: string): Transaction | null {
  if (!tr.docChanged || tr.getMeta(SKIP_TRACK) || tr.getMeta('history$')) return null;
  const steps = tr.steps;
  const supported = steps.every((s) => s instanceof ReplaceStep || s instanceof AddMarkStep || s instanceof RemoveMarkStep);
  if (!supported) return null;
  // Steps that only rearrange block structure (e.g. Enter split with no text) still go through this path fine.
  const schema = state.schema;
  const ins = schema.marks.insertion;
  const del = schema.marks.deletion;
  const fmt = schema.marks.formatChange;
  const out = state.tr;
  const time = Date.now();
  let map: PosMap = (p) => p;
  let lastSel: number | null = null;
  let bias: -1 | 1 = 1;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) {
      const s = step as unknown as { from: number; to: number; mark: Mark };
      const from = map(s.from);
      const to = map(s.to);
      out.step(step instanceof AddMarkStep ? new AddMarkStep(from, to, s.mark) : new RemoveMarkStep(from, to, s.mark));
      if (FORMAT_MARKS.includes(s.mark.type.name)) {
        const op = (step instanceof AddMarkStep ? '+' : '-') + s.mark.type.name;
        out.doc.nodesBetween(from, to, (node, pos) => {
          if (!node.isInline) return true;
          const a = Math.max(from, pos);
          const b = Math.min(to, pos + node.nodeSize);
          if (node.marks.some((m) => m.type === ins)) return false; // new text: formatting is part of the insertion
          const prev = node.marks.find((m) => m.type === fmt);
          const ops = mergeOps(prev ? String(prev.attrs.ops) : '', op);
          out.addMark(a, b, fmt.create({ id: prev?.attrs.id || changeId(), author, time, ops }));
          return false;
        });
      }
      continue;
    }
    const rs = step as ReplaceStep & { from: number; to: number; slice: import('prosemirror-model').Slice };
    const f2 = map(rs.from);
    const t2 = map(rs.to);
    let removed = 0;
    if (t2 > f2) {
      // Text that is itself a pending insertion is removed for real; other inline content gets a deletion mark.
      const kill: [number, number][] = [];
      let hasInline = false;
      out.doc.nodesBetween(f2, t2, (node, pos) => {
        if (!node.isInline) return true;
        hasInline = true;
        if (node.marks.some((m) => m.type === ins)) kill.push([Math.max(f2, pos), Math.min(t2, pos + node.nodeSize)]);
        return false;
      });
      if (!hasInline) {
        // Pure structural delete (joining blocks): let it through as-is.
        out.step(new ReplaceStep(f2, t2, rs.slice, (rs as unknown as { structure: boolean }).structure));
        const L0 = rs.slice.size;
        const prev = map;
        const from = rs.from, to = rs.to;
        map = (q) => (q < from ? prev(q) : q <= from + L0 ? f2 + (q - from) : prev(q - L0 + (to - from)) + L0 - (t2 - f2));
        lastSel = f2 + L0;
        continue;
      }
      for (let k = kill.length - 1; k >= 0; k--) {
        out.delete(kill[k][0], kill[k][1]);
        removed += kill[k][1] - kill[k][0];
      }
      const end = t2 - removed;
      if (end > f2) {
        const reuse = adjacentAttrs(out.doc, f2, del, author) ?? adjacentAttrs(out.doc, end, del, author);
        const attrs = reuse ?? { id: changeId(), author, time };
        out.doc.nodesBetween(f2, end, (node, pos) => {
          if (!node.isInline) return true;
          if (!node.marks.some((m) => m.type === del)) out.addMark(Math.max(f2, pos), Math.min(end, pos + node.nodeSize), del.create(attrs));
          return false;
        });
      }
    }
    const insertAt = t2 - removed;
    const L = rs.slice.size;
    let insertedLen = 0;
    if (L > 0) {
      const before = out.doc.content.size;
      out.replace(insertAt, insertAt, rs.slice);
      insertedLen = out.doc.content.size - before;
      const a = insertAt;
      const b = insertAt + insertedLen;
      out.removeMark(a, b, del);
      const reuse = adjacentAttrs(out.doc, a, ins, author) ?? adjacentAttrs(out.doc, b, ins, author);
      out.addMark(a, b, ins.create(reuse ?? { id: changeId(), author, time }));
    }
    const kept = t2 - f2 - removed;
    const prev = map;
    const from = rs.from, to = rs.to;
    map = (q) => (q < from ? prev(q) : q <= from + L ? insertAt + Math.min(q - from, insertedLen) : prev(q - L + (to - from)) - removed + insertedLen);
    // Cursor placement: after inserted text; for a pure backspace go before the struck text.
    if (L > 0) lastSel = insertAt + insertedLen;
    else {
      const sel = state.selection;
      const backspace = steps.length === 1 && sel.empty && sel.head === rs.to;
      lastSel = backspace ? f2 : f2 + kept;
      bias = backspace ? -1 : 1;
    }
  }
  if (steps.length > 1) lastSel = map(tr.selection.head);
  if (lastSel != null) {
    const p = Math.max(0, Math.min(lastSel, out.doc.content.size));
    try { out.setSelection(TextSelection.near(out.doc.resolve(p), bias)); } catch { /* keep mapped selection */ }
  }
  if (tr.storedMarks) out.setStoredMarks(tr.storedMarks.filter((m) => m.type !== ins && m.type !== del));
  if (tr.scrolledIntoView) out.scrollIntoView();
  for (const key of ['uiEvent', 'paste', 'addToHistory']) if (tr.getMeta(key) != null) out.setMeta(key, tr.getMeta(key));
  return out;
}

function mergeOps(prev: string, op: string): string {
  const set = new Set(prev.split(',').filter(Boolean));
  const opposite = (op[0] === '+' ? '-' : '+') + op.slice(1);
  if (set.has(opposite)) set.delete(opposite); else set.add(op);
  return [...set].join(',');
}

// ---------- Listing changes ----------

export type ChangeKind = 'insertion' | 'deletion' | 'format';
export interface Change {
  id: string;
  kind: ChangeKind;
  author: string;
  time: number;
  ranges: { from: number; to: number }[];
  text: string;
  /** Short context: preceding text of the same block */
  context: string;
  ops?: string;
}

const KIND: Record<string, ChangeKind> = { insertion: 'insertion', deletion: 'deletion', formatChange: 'format' };

export function listChanges(doc: PMNode): Change[] {
  const byKey = new Map<string, Change>();
  const order: Change[] = [];
  doc.descendants((node, pos) => {
    if (!node.isInline) return true;
    for (const m of node.marks) {
      const kind = KIND[m.type.name];
      if (!kind) continue;
      const key = kind + ':' + m.attrs.id;
      let c = byKey.get(key);
      const text = node.isText ? node.text! : node.type.name === 'image' ? '[image]' : node.type.name === 'footnote' ? '[footnote]' : node.type.name === 'hard_break' ? ' ' : '';
      if (!c) {
        const start = pos - doc.resolve(pos).parentOffset;
        const ctx = doc.textBetween(start, pos, ' ', ' ');
        c = { id: String(m.attrs.id), kind, author: String(m.attrs.author), time: Number(m.attrs.time), ranges: [], text: '', context: ctx, ops: m.attrs.ops };
        byKey.set(key, c);
        order.push(c);
      }
      const last = c.ranges[c.ranges.length - 1];
      if (last && last.to === pos) last.to = pos + node.nodeSize;
      else c.ranges.push({ from: pos, to: pos + node.nodeSize });
      c.text += text;
    }
    return false;
  });
  return order;
}

export function describeOps(ops: string): string {
  const names: Record<string, string> = { strong: 'Bold', em: 'Italic', underline: 'Underline', strike: 'Strikethrough', code: 'Code', textStyle: 'Font', highlight: 'Highlight', link: 'Link' };
  const parts = ops.split(',').filter(Boolean).map((o) => `${names[o.slice(1)] ?? o.slice(1)} ${o[0] === '+' ? 'added' : 'removed'}`);
  return parts.length ? parts.join(', ') : 'Formatting changed';
}

// ---------- Accept / reject ----------

/** Apply accept or reject for one change into `tr` (positions from tr.doc). */
export function resolveChange(tr: Transaction, change: Change, accept: boolean, schema: Schema): void {
  const ranges = [...change.ranges].sort((a, b) => b.from - a.from);
  const m = schema.marks;
  for (const r of ranges) {
    const from = tr.mapping.map(r.from);
    const to = tr.mapping.map(r.to, -1);
    if (to <= from) continue;
    if (change.kind === 'insertion') {
      if (accept) tr.removeMark(from, to, m.insertion);
      else tr.delete(from, to);
    } else if (change.kind === 'deletion') {
      if (accept) tr.delete(from, to);
      else tr.removeMark(from, to, m.deletion);
    } else {
      if (!accept) {
        for (const op of (change.ops ?? '').split(',').filter(Boolean)) {
          const type = m[op.slice(1)];
          if (!type) continue;
          if (op[0] === '+') tr.removeMark(from, to, type);
          else if (!type.spec.attrs || Object.values(type.spec.attrs).every((a) => 'default' in a)) tr.addMark(from, to, type.create());
        }
      }
      tr.removeMark(from, to, m.formatChange);
    }
  }
  tr.setMeta(SKIP_TRACK, true);
}

export function resolveAll(state: EditorState, accept: boolean, filter?: ChangeKind): Transaction {
  const tr = state.tr;
  const changes = listChanges(state.doc).filter((c) => !filter || c.kind === filter);
  for (const c of changes) resolveChange(tr, c, accept, state.schema);
  tr.setMeta(SKIP_TRACK, true);
  return tr;
}

/** Document with every pending change accepted (used for exports). */
export function acceptedDoc(doc: PMNode): PMNode {
  const changes = listChanges(doc);
  if (!changes.length) return doc;
  const state = EditorState.create({ doc });
  return resolveAll(state, true).doc;
}
