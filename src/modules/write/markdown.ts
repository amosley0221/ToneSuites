// Markdown import/export (prosemirror-markdown + markdown-it with GFM tables & strikethrough).
import MarkdownIt from 'markdown-it';
import { MarkdownParser, MarkdownSerializer } from 'prosemirror-markdown';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { schema } from './schema';
import { acceptedDoc } from './track';

type Tok = { type: string; tag: string; nesting: number; content: string; children: Tok[] | null; attrGet: (n: string) => string | null; constructor: new (type: string, tag: string, nesting: number) => Tok };

const md = new MarkdownIt('default', { html: true, linkify: false });

/** markdown-it emits inline content directly inside th/td; our cells need paragraphs. */
function fixTokens(tokens: Tok[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'html_block') {
      if (/pagebreak|page-break/i.test(t.content)) {
        const pb = new t.constructor('page_break', '', 0);
        out.push(pb);
      }
      continue;
    }
    if (t.type === 'inline' && t.children) t.children = t.children.filter((c) => c.type !== 'html_inline');
    out.push(t);
    if ((t.type === 'th_open' || t.type === 'td_open') && tokens[i + 1]?.type === 'inline') {
      out.push(new t.constructor('paragraph_open', 'p', 1), tokens[i + 1], new t.constructor('paragraph_close', 'p', -1));
      i++;
    }
  }
  return out;
}

const tokenizer = { parse: (src: string, env: object) => fixTokens(md.parse(src, env) as unknown as Tok[]) } as unknown as MarkdownIt;

const parser = new MarkdownParser(schema, tokenizer, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list' },
  ordered_list: { block: 'ordered_list', getAttrs: (tok) => ({ order: +(tok.attrGet('start') || 1) }) },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: Math.min(3, +tok.tag.slice(1)) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  page_break: { node: 'page_break' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({ src: tok.attrGet('src'), title: tok.attrGet('title') || null, alt: (tok.children && tok.children[0]?.content) || null }),
  },
  hardbreak: { node: 'hard_break' },
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strike' },
  link: { mark: 'link', getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null }) },
  code_inline: { mark: 'code', noCloseToken: true },
});

const FN_OPEN = '';
const FN_CLOSE = '';

export function parseMarkdown(text: string): PMNode {
  // Footnotes ([^id] + "[^id]: text" definitions) aren't in markdown-it core: lift them out first.
  const defs = new Map<string, string>();
  const body = text.replace(/\r\n?/g, '\n').replace(/^\[\^([^\]]+)\]:[ \t]*(.*)$/gm, (_m, id: string, def: string) => { defs.set(id, def.trim()); return ''; });
  const withRefs = defs.size ? body.replace(/\[\^([^\]]+)\]/g, (m, id: string) => (defs.has(id) ? FN_OPEN + id + FN_CLOSE : m)) : body;
  let doc = parser.parse(withRefs);
  if (defs.size) doc = replaceFootnoteMarkers(doc, defs);
  if (doc.childCount === 0) doc = schema.node('doc', null, [schema.node('paragraph')]);
  return doc;
}

function replaceFootnoteMarkers(doc: PMNode, defs: Map<string, string>): PMNode {
  const state = EditorState.create({ doc });
  const tr = state.tr;
  const hits: { from: number; to: number; text: string }[] = [];
  const re = new RegExp(`${FN_OPEN}([^${FN_CLOSE}]+)${FN_CLOSE}`, 'g');
  doc.descendants((n, pos) => {
    if (!n.isText) return true;
    for (const m of n.text!.matchAll(re)) hits.push({ from: pos + m.index!, to: pos + m.index! + m[0].length, text: defs.get(m[1]) ?? '' });
    return false;
  });
  for (let i = hits.length - 1; i >= 0; i--) tr.replaceWith(hits[i].from, hits[i].to, schema.nodes.footnote.create({ text: hits[i].text }));
  return tr.doc;
}

// ---------- Serializer ----------

function cellText(cell: PMNode): string {
  const inner = serializer.serialize(cell, { tightLists: true }).trim();
  return inner.replace(/\n+/g, ' ').replace(/\|/g, '\\|') || ' ';
}

let footnotes: string[] = [];

const serializer: MarkdownSerializer = new MarkdownSerializer({
  doc: (state, node) => state.renderContent(node),
  paragraph: (state, node) => { state.renderInline(node); state.closeBlock(node); },
  title: (state, node) => { state.write('# '); state.renderInline(node, false); state.closeBlock(node); },
  heading: (state, node) => { state.write(state.repeat('#', node.attrs.level) + ' '); state.renderInline(node, false); state.closeBlock(node); },
  blockquote: (state, node) => { state.wrapBlock('> ', null, node, () => state.renderContent(node)); },
  code_block: (state, node) => {
    const backticks = node.textContent.match(/`{3,}/gm);
    const fence = backticks ? backticks.sort().slice(-1)[0] + '`' : '```';
    state.write(fence + '\n');
    state.text(node.textContent, false);
    state.write('\n');
    state.write(fence);
    state.closeBlock(node);
  },
  horizontal_rule: (state, node) => { state.write('---'); state.closeBlock(node); },
  page_break: (state, node) => { state.write('<!-- pagebreak -->'); state.closeBlock(node); },
  toc: (state, node) => {
    state.write('**Contents**');
    state.closeBlock(node);
    for (const e of node.attrs.entries as { level: number; text: string }[]) {
      state.write(state.repeat('  ', Math.max(0, e.level - 1)) + '- ' + state.esc(e.text) + '\n');
    }
    state.closeBlock(node);
  },
  bullet_list: (state, node) => state.renderList(node, '  ', () => '- '),
  ordered_list: (state, node) => {
    const start = node.attrs.order || 1;
    const maxW = String(start + node.childCount - 1).length;
    const space = state.repeat(' ', maxW + 2);
    state.renderList(node, space, (i) => {
      const nStr = String(start + i);
      return state.repeat(' ', maxW - nStr.length) + nStr + '. ';
    });
  },
  list_item: (state, node) => state.renderContent(node),
  table: (state, node) => {
    const rows: string[][] = [];
    node.forEach((row) => { const cells: string[] = []; row.forEach((c) => cells.push(cellText(c))); rows.push(cells); });
    const cols = Math.max(...rows.map((r) => r.length));
    const line = (r: string[]) => '| ' + Array.from({ length: cols }, (_, i) => r[i] ?? ' ').join(' | ') + ' |';
    const out = [line(rows[0] ?? []), '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |', ...rows.slice(1).map(line)];
    state.write(out.join('\n'));
    state.closeBlock(node);
  },
  table_row: () => undefined,
  table_cell: (state, node) => state.renderContent(node),
  table_header: (state, node) => state.renderContent(node),
  image: (state, node) => {
    state.write('![' + state.esc(node.attrs.alt || '') + '](' + String(node.attrs.src).replace(/[()]/g, '\\$&') + (node.attrs.title ? ' "' + node.attrs.title.replace(/"/g, '\\"') + '"' : '') + ')');
  },
  footnote: (state, node) => {
    footnotes.push(node.attrs.text);
    state.write(`[^${footnotes.length}]`);
  },
  hard_break: (state, node, parent, index) => {
    for (let i = index + 1; i < parent.childCount; i++) if (parent.child(i).type !== node.type) { state.write('\\\n'); return; }
  },
  text: (state, node) => state.text(node.text!),
}, {
  em: { open: '*', close: '*', mixable: true, expelEnclosingWhitespace: true },
  strong: { open: '**', close: '**', mixable: true, expelEnclosingWhitespace: true },
  strike: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true },
  underline: { open: '', close: '' },
  textStyle: { open: '', close: '' },
  highlight: { open: '', close: '' },
  comment: { open: '', close: '' },
  insertion: { open: '', close: '' },
  deletion: { open: '', close: '' },
  formatChange: { open: '', close: '' },
  link: {
    open: () => '[',
    close: (_state, mark) => '](' + String(mark.attrs.href).replace(/[()"]/g, '\\$&') + (mark.attrs.title ? ` "${String(mark.attrs.title).replace(/"/g, '\\"')}"` : '') + ')',
  },
  code: {
    open: (_s, _m, parent, index) => backticksFor(parent.child(index), -1),
    close: (_s, _m, parent, index) => backticksFor(parent.child(index - 1), 1),
    escape: false,
  },
});

function backticksFor(node: PMNode, side: number): string {
  const ticks = /`+/g;
  let m: RegExpExecArray | null;
  let len = 0;
  if (node.isText) while ((m = ticks.exec(node.text!))) len = Math.max(len, m[0].length);
  let result = len > 0 && side > 0 ? ' `' : '`';
  for (let i = 0; i < len; i++) result += '`';
  if (len > 0 && side < 0) result += ' ';
  return result;
}

/** Serialize with all tracked changes accepted; footnotes become [^n] references. */
export function toMarkdown(doc: PMNode): string {
  footnotes = [];
  let out = serializer.serialize(acceptedDoc(doc), { tightLists: true });
  if (footnotes.length) out += '\n\n' + footnotes.map((t, i) => `[^${i + 1}]: ${t}`).join('\n');
  footnotes = [];
  return out.trimEnd() + '\n';
}
