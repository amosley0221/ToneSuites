// ProseMirror schema for Write: styles (Body/Title/H1–H3/Quote/Code), lists, tables, images,
// footnotes, TOC block, page breaks; marks incl. track-changes (insertion/deletion/formatChange) and comments.
import { Schema, type DOMOutputSpec, type Node as PMNode, type NodeSpec, type MarkSpec } from 'prosemirror-model';
import { tableNodes } from 'prosemirror-tables';

export type Align = 'left' | 'center' | 'right' | 'justify';

const blockAttrs = { align: { default: null as Align | null }, lineHeight: { default: null as number | null } };

function blockStyle(node: PMNode): string | undefined {
  const s: string[] = [];
  if (node.attrs.align && node.attrs.align !== 'left') s.push(`text-align:${node.attrs.align}`);
  if (node.attrs.lineHeight) s.push(`line-height:${node.attrs.lineHeight}`);
  return s.length ? s.join(';') : undefined;
}
function readBlockAttrs(dom: HTMLElement) {
  const a = dom.style.textAlign;
  const lh = parseFloat(dom.style.lineHeight);
  return {
    align: a === 'center' || a === 'right' || a === 'justify' ? a : null,
    lineHeight: Number.isFinite(lh) && lh > 0 && lh < 5 ? lh : null,
  };
}
function withStyle(tag: string, node: PMNode, extra: Record<string, string> = {}): DOMOutputSpec {
  const style = blockStyle(node);
  return [tag, style ? { ...extra, style } : extra, 0];
}

export interface TocEntry { level: number; text: string; page: number }

const nodes: Record<string, NodeSpec> = {
  doc: { content: 'block+' },
  paragraph: {
    group: 'block', content: 'inline*', attrs: blockAttrs,
    parseDOM: [{ tag: 'p', getAttrs: (d) => readBlockAttrs(d as HTMLElement) }],
    toDOM: (n) => withStyle('p', n),
  },
  title: {
    group: 'block', content: 'inline*', attrs: blockAttrs, defining: true,
    parseDOM: [{ tag: 'p.wr-title', priority: 60, getAttrs: (d) => readBlockAttrs(d as HTMLElement) }, { tag: 'h1.title', priority: 60 }, { tag: '.Title', priority: 60 }],
    toDOM: (n) => withStyle('p', n, { class: 'wr-title' }),
  },
  heading: {
    group: 'block', content: 'inline*', defining: true,
    attrs: { level: { default: 1 }, ...blockAttrs },
    parseDOM: [1, 2, 3, 4, 5, 6].map((l) => ({ tag: `h${l}`, getAttrs: (d: HTMLElement | string) => ({ level: Math.min(3, l), ...readBlockAttrs(d as HTMLElement) }) })),
    toDOM: (n) => withStyle(`h${n.attrs.level}`, n),
  },
  blockquote: {
    group: 'block', content: 'block+', defining: true,
    parseDOM: [{ tag: 'blockquote' }],
    toDOM: () => ['blockquote', 0],
  },
  code_block: {
    group: 'block', content: 'text*', marks: '', code: true, defining: true,
    parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
    toDOM: () => ['pre', ['code', 0]],
  },
  horizontal_rule: {
    group: 'block',
    parseDOM: [{ tag: 'hr' }],
    toDOM: () => ['hr'],
  },
  page_break: {
    group: 'block', atom: true, selectable: true,
    parseDOM: [{ tag: 'div.wr-page-break' }, { tag: 'hr.wr-page-break', priority: 60 }, { tag: 'div[style*="page-break-after"]' }, { tag: 'div[style*="break-after"]' }],
    toDOM: () => ['div', { class: 'wr-page-break', contenteditable: 'false' }, ['span', 'Page break']],
  },
  toc: {
    group: 'block', atom: true, selectable: true,
    attrs: {
      levels: { default: [1, 2] as number[] },
      style: { default: 'dotted' as 'dotted' | 'plain' | 'numbered' },
      pageNumbers: { default: true },
      links: { default: true },
      auto: { default: true },
      entries: { default: [] as TocEntry[] },
    },
    parseDOM: [{
      tag: 'div.wr-toc',
      getAttrs: (d) => {
        try { return JSON.parse((d as HTMLElement).getAttribute('data-toc') || '{}'); } catch { return {}; }
      },
    }],
    toDOM: (n) => tocDOM(n),
  },
  bullet_list: {
    group: 'block', content: 'list_item+',
    parseDOM: [{ tag: 'ul' }],
    toDOM: () => ['ul', 0],
  },
  ordered_list: {
    group: 'block', content: 'list_item+', attrs: { order: { default: 1 } },
    parseDOM: [{ tag: 'ol', getAttrs: (d) => ({ order: (d as HTMLElement).hasAttribute('start') ? +((d as HTMLElement).getAttribute('start') || 1) : 1 }) }],
    toDOM: (n) => (n.attrs.order === 1 ? ['ol', 0] : ['ol', { start: n.attrs.order }, 0]),
  },
  list_item: {
    content: 'paragraph block*', defining: true,
    parseDOM: [{ tag: 'li' }],
    toDOM: () => ['li', 0],
  },
  ...tableNodes({
    tableGroup: 'block',
    cellContent: 'block+',
    cellAttributes: {
      background: {
        default: null,
        getFromDOM: (dom) => dom.style.backgroundColor || null,
        setDOMAttr: (value, attrs) => { if (value) attrs.style = (attrs.style || '') + `background-color: ${value};`; },
      },
    },
  }),
  text: { group: 'inline' },
  image: {
    group: 'inline', inline: true, draggable: true,
    attrs: { src: {}, alt: { default: null }, title: { default: null }, width: { default: null as number | null }, height: { default: null as number | null } },
    parseDOM: [{
      tag: 'img[src]',
      getAttrs: (d) => {
        const el = d as HTMLImageElement;
        const w = parseInt(el.getAttribute('width') || '', 10);
        const h = parseInt(el.getAttribute('height') || '', 10);
        return { src: el.getAttribute('src'), alt: el.getAttribute('alt'), title: el.getAttribute('title'), width: w > 0 ? w : null, height: h > 0 ? h : null };
      },
    }],
    toDOM: (n) => ['img', { src: n.attrs.src, alt: n.attrs.alt, title: n.attrs.title, width: n.attrs.width ?? undefined, height: n.attrs.height ?? undefined }],
  },
  footnote: {
    group: 'inline', inline: true, atom: true, selectable: true,
    attrs: { text: { default: '' } },
    parseDOM: [{ tag: 'sup[data-footnote]', getAttrs: (d) => ({ text: (d as HTMLElement).getAttribute('data-footnote') || '' }) }],
    toDOM: (n) => ['sup', { class: 'wr-fn', 'data-footnote': n.attrs.text, title: n.attrs.text }],
  },
  hard_break: {
    group: 'inline', inline: true, selectable: false,
    parseDOM: [{ tag: 'br' }],
    toDOM: () => ['br'],
  },
};

function tocDOM(n: PMNode): DOMOutputSpec {
  const entries = n.attrs.entries as TocEntry[];
  const minLevel = Math.min(...entries.map((e) => e.level), 3);
  const counters = [0, 0, 0, 0];
  const rows: DOMOutputSpec[] = entries.length
    ? entries.map((e, i) => {
      counters[e.level] += 1;
      for (let l = e.level + 1; l < counters.length; l++) counters[l] = 0;
      const num = n.attrs.style === 'numbered' ? counters.slice(minLevel, e.level + 1).filter((c) => c > 0).join('.') + '  ' : '';
      const kids: DOMOutputSpec[] = [['span', { class: 'wr-toc-text' }, num + e.text]];
      if (n.attrs.style === 'dotted') kids.push(['span', { class: 'wr-toc-leader' }]);
      else kids.push(['span', { class: 'wr-toc-fill' }]);
      if (n.attrs.pageNumbers) kids.push(['span', { class: 'wr-toc-page' }, String(e.page)]);
      return ['div', { class: 'wr-toc-row', 'data-index': String(i), style: `padding-left:${(e.level - minLevel) * 16}px` }, ...kids] as DOMOutputSpec;
    })
    : [['div', { class: 'wr-toc-empty' }, 'No headings yet — apply Title or Heading styles, then update the table of contents.']];
  const data = JSON.stringify({ levels: n.attrs.levels, style: n.attrs.style, pageNumbers: n.attrs.pageNumbers, links: n.attrs.links, auto: n.attrs.auto, entries });
  return ['div', { class: 'wr-toc', contenteditable: 'false', 'data-toc': data }, ['div', { class: 'wr-toc-title' }, 'Contents'], ...rows];
}

const trackAttrs = { id: { default: '' }, author: { default: '' }, time: { default: 0 } };

const marks: Record<string, MarkSpec> = {
  // Track-changes + comments first so they wrap formatting marks.
  insertion: {
    attrs: trackAttrs, inclusive: false,
    parseDOM: [{ tag: 'ins', getAttrs: (d) => ({ id: (d as HTMLElement).getAttribute('data-id') || '', author: (d as HTMLElement).getAttribute('data-author') || '', time: +((d as HTMLElement).getAttribute('data-time') || 0) }) }],
    toDOM: (m) => ['ins', { class: 'wr-ins', 'data-id': m.attrs.id, 'data-author': m.attrs.author, 'data-time': String(m.attrs.time), title: `Inserted by ${m.attrs.author}` }, 0],
  },
  deletion: {
    attrs: trackAttrs, inclusive: false,
    parseDOM: [{ tag: 'del', getAttrs: (d) => ({ id: (d as HTMLElement).getAttribute('data-id') || '', author: (d as HTMLElement).getAttribute('data-author') || '', time: +((d as HTMLElement).getAttribute('data-time') || 0) }) }],
    toDOM: (m) => ['del', { class: 'wr-del', 'data-id': m.attrs.id, 'data-author': m.attrs.author, 'data-time': String(m.attrs.time), title: `Deleted by ${m.attrs.author}` }, 0],
  },
  formatChange: {
    attrs: { ...trackAttrs, ops: { default: '' } }, inclusive: false,
    parseDOM: [{ tag: 'span.wr-fmt', getAttrs: (d) => ({ id: (d as HTMLElement).getAttribute('data-id') || '', author: (d as HTMLElement).getAttribute('data-author') || '', time: +((d as HTMLElement).getAttribute('data-time') || 0), ops: (d as HTMLElement).getAttribute('data-ops') || '' }) }],
    toDOM: (m) => ['span', { class: 'wr-fmt', 'data-id': m.attrs.id, 'data-author': m.attrs.author, 'data-time': String(m.attrs.time), 'data-ops': m.attrs.ops }, 0],
  },
  comment: {
    attrs: { id: { default: '' } }, inclusive: false, excludes: '',
    parseDOM: [{ tag: 'span.wr-comment', getAttrs: (d) => ({ id: (d as HTMLElement).getAttribute('data-comment') || '' }) }],
    toDOM: (m) => ['span', { class: 'wr-comment', 'data-comment': m.attrs.id }, 0],
  },
  link: {
    attrs: { href: {}, title: { default: null } }, inclusive: false,
    parseDOM: [{ tag: 'a[href]', getAttrs: (d) => ({ href: (d as HTMLElement).getAttribute('href'), title: (d as HTMLElement).getAttribute('title') }) }],
    toDOM: (m) => ['a', { href: m.attrs.href, title: m.attrs.title, rel: 'noopener noreferrer' }, 0],
  },
  strong: {
    parseDOM: [
      { tag: 'strong' },
      { tag: 'b', getAttrs: (n) => (n as HTMLElement).style.fontWeight !== 'normal' && null },
      { style: 'font-weight=400', clearMark: (m) => m.type.name === 'strong' },
      { style: 'font-weight', getAttrs: (v) => /^(bold(er)?|[5-9]\d{2,})$/.test(v as string) && null },
    ],
    toDOM: () => ['strong', 0],
  },
  em: {
    parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }, { style: 'font-style=normal', clearMark: (m) => m.type.name === 'em' }],
    toDOM: () => ['em', 0],
  },
  underline: {
    parseDOM: [{ tag: 'u' }, { style: 'text-decoration=underline' }, { style: 'text-decoration-line=underline' }],
    toDOM: () => ['u', 0],
  },
  strike: {
    parseDOM: [{ tag: 's' }, { tag: 'strike' }, { style: 'text-decoration=line-through' }, { style: 'text-decoration-line=line-through' }],
    toDOM: () => ['s', 0],
  },
  code: {
    parseDOM: [{ tag: 'code' }],
    toDOM: () => ['code', 0],
  },
  textStyle: {
    attrs: { fontFamily: { default: null as string | null }, fontSize: { default: null as number | null }, color: { default: null as string | null } },
    parseDOM: [{
      tag: 'span[style]',
      getAttrs: (d) => {
        const st = (d as HTMLElement).style;
        const ff = st.fontFamily ? st.fontFamily.split(',')[0].replace(/["']/g, '').trim() : null;
        let fs: number | null = null;
        if (st.fontSize.endsWith('pt')) fs = parseFloat(st.fontSize);
        else if (st.fontSize.endsWith('px')) fs = Math.round(parseFloat(st.fontSize) * 0.75 * 2) / 2;
        const color = st.color || null;
        if (!ff && !fs && !color) return false;
        return { fontFamily: ff, fontSize: fs, color };
      },
    }],
    toDOM: (m) => {
      const s: string[] = [];
      if (m.attrs.fontFamily) s.push(`font-family:${cssFont(m.attrs.fontFamily)}`);
      if (m.attrs.fontSize) s.push(`font-size:${m.attrs.fontSize}pt`);
      if (m.attrs.color) s.push(`color:${m.attrs.color}`);
      return ['span', { style: s.join(';') }, 0];
    },
  },
  highlight: {
    attrs: { color: { default: '#fff3a3' } },
    parseDOM: [{ tag: 'mark', getAttrs: (d) => ({ color: (d as HTMLElement).style.backgroundColor || '#fff3a3' }) }],
    toDOM: (m) => ['mark', { style: `background-color:${m.attrs.color}` }, 0],
  },
};

/** CSS font stack for a family name chosen in the font picker. */
export function cssFont(name: string): string {
  const generic = /mono|courier|consolas/i.test(name) ? 'monospace' : /georgia|times|serif|garamond|cambria/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif';
  return `"${name}", ${generic}`;
}

export const schema = new Schema({ nodes, marks });

/** Marks that represent formatting (tracked as "Format" changes). */
export const FORMAT_MARKS = ['strong', 'em', 'underline', 'strike', 'code', 'textStyle', 'highlight', 'link'];
