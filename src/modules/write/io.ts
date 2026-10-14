// Foreign formats: import docx/html/md/txt, export html/txt. (docx/pdf exporters live in their own files.)
import { DOMParser as PMDOMParser, DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { WriteModel, pageBox, type FootnoteSettings, type PageSetup } from './model';
import { parseMarkdown } from './markdown';
import { schema } from './schema';
import { acceptedDoc } from './track';
import { footnoteLabel } from './util';

// ---------- Import ----------

export async function importFile(bytes: Uint8Array, filename: string): Promise<WriteModel> {
  const ext = filename.split('.').pop()!.toLowerCase();
  const text = () => new TextDecoder().decode(bytes);
  switch (ext) {
    case 'docx': return new WriteModel(await docxToDoc(bytes));
    case 'html': case 'htm': return new WriteModel(htmlToDoc(text()));
    case 'md': case 'markdown': return new WriteModel(parseMarkdown(text()));
    case 'txt': return new WriteModel(textToDoc(text()));
    default: throw new Error(`Write can't open .${ext} files`);
  }
}

export function textToDoc(src: string): PMNode {
  const t = src.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const blocks = /\n[ \t]*\n/.test(t) ? t.split(/\n[ \t]*\n+/) : t.split('\n');
  const paras = blocks.map((b) => {
    const lines = b.split('\n');
    const content: PMNode[] = [];
    lines.forEach((l, i) => {
      if (i > 0) content.push(schema.nodes.hard_break.create());
      if (l) content.push(schema.text(l));
    });
    return schema.node('paragraph', null, content);
  });
  return schema.node('doc', null, paras.length ? paras : [schema.node('paragraph')]);
}

/** Parse HTML (ours, mammoth's or anyone's) into the Write schema. */
export function htmlToDoc(html: string): PMNode {
  const dom = new window.DOMParser().parseFromString(html, 'text/html');
  liftNoteLists(dom);
  dom.querySelectorAll('script, style, ol.wr-footnotes, .wr-header, .wr-footer').forEach((e) => e.remove());
  const doc = PMDOMParser.fromSchema(schema).parse(dom.body);
  return doc.childCount ? doc : schema.node('doc', null, [schema.node('paragraph')]);
}

/** Mammoth (and many HTML exporters) emit footnotes as linked <sup>s + a list at the end: inline them. */
function liftNoteLists(dom: Document) {
  const refs = dom.querySelectorAll<HTMLAnchorElement>('a[href^="#footnote-"], a[href^="#endnote-"]');
  const used = new Set<Element>();
  refs.forEach((a) => {
    const id = a.getAttribute('href')!.slice(1);
    if (/-ref-/.test(id)) return;
    const li = dom.getElementById(id);
    if (!li) return;
    const clone = li.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('a[href*="-ref-"]').forEach((b) => b.remove());
    const sup = dom.createElement('sup');
    sup.setAttribute('data-footnote', (clone.textContent || '').replace(/\s+/g, ' ').trim());
    const host = a.closest('sup') ?? a;
    host.replaceWith(sup);
    used.add(li);
  });
  used.forEach((li) => {
    const list = li.parentElement;
    li.remove();
    if (list && !list.querySelector('li')) list.remove();
  });
}

async function docxToDoc(bytes: Uint8Array): Promise<PMNode> {
  const mammoth = (await import('mammoth')).default as unknown as {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer }, opts?: { styleMap?: string[] }) => Promise<{ value: string }>;
  };
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const res = await mammoth.convertToHtml({ arrayBuffer: buf }, {
    styleMap: [
      "p[style-name='Title'] => p.wr-title:fresh",
      "p[style-name='Subtitle'] => h3:fresh",
      "p[style-name='Quote'] => blockquote > p:fresh",
      "p[style-name='Intense Quote'] => blockquote > p:fresh",
      'u => u',
      'strike => s',
    ],
  });
  return htmlToDoc(res.value);
}

// ---------- HTML export ----------

export function docToHtml(doc: PMNode, title: string, page: PageSetup, notes: FootnoteSettings): string {
  const final = acceptedDoc(doc);
  const container = document.createElement('div');
  container.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(final.content));
  container.querySelectorAll('[contenteditable]').forEach((e) => e.removeAttribute('contenteditable'));
  const fns: string[] = [];
  container.querySelectorAll('sup.wr-fn').forEach((sup) => {
    fns.push(sup.getAttribute('data-footnote') || '');
    sup.textContent = footnoteLabel(fns.length, notes.numbering);
  });
  let body = container.innerHTML;
  if (fns.length) body += `\n<ol class="wr-footnotes">${fns.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`;
  const b = pageBox(page);
  const sizeName = page.paper === 'A4' ? 'A4' : page.paper === 'Legal' ? 'legal' : 'letter';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${sizeName} ${page.orientation}; margin: ${page.margins.top}in ${page.margins.right}in ${page.margins.bottom}in ${page.margins.left}in; }
body { max-width: ${b.w - b.left - b.right}px; margin: 40px auto; padding: 0 16px; font: 15px/1.65 Archivo, Helvetica, Arial, sans-serif; color: #1a1a1a; background: #fff; }
.wr-title { font-size: 40px; font-weight: 900; letter-spacing: -0.04em; line-height: 1.05; margin: 0 0 20px; }
h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.2; }
h2 { font-size: 22px; font-weight: 800; letter-spacing: -0.03em; line-height: 1.25; }
h3 { font-size: 17px; font-weight: 800; line-height: 1.3; }
blockquote { margin: 12px 0; padding-left: 16px; border-left: 3px solid #ddd; color: #555; }
pre { background: #f5f5f3; padding: 10px 12px; font: 13px/1.5 "JetBrains Mono", monospace; white-space: pre-wrap; }
table { border-collapse: collapse; width: 100%; } td, th { border: 1px solid #ccc; padding: 6px 8px; vertical-align: top; } th { background: #f5f5f3; text-align: left; }
td p, th p { margin: 0; }
img { max-width: 100%; height: auto; }
hr { border: 0; border-top: 1px solid #ddd; margin: 20px 0; }
.wr-page-break { break-after: page; height: 0; overflow: hidden; }
.wr-page-break span { display: none; }
.wr-toc-title { font-weight: 900; font-size: 18px; margin-bottom: 8px; }
.wr-toc-row { display: flex; gap: 6px; align-items: baseline; } .wr-toc-leader { flex: 1; border-bottom: 1px dotted #999; } .wr-toc-fill { flex: 1; }
sup.wr-fn { font-size: 0.7em; }
ol.wr-footnotes { border-top: 1px solid #333; margin-top: 32px; padding-top: 8px; font-size: 13px; }
</style></head>
<body>
${body}
</body></html>
`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

// ---------- Plain text export ----------

export function docToText(doc: PMNode, notes: FootnoteSettings): string {
  const final = acceptedDoc(doc);
  const fns: string[] = [];
  const inline = (n: PMNode): string => {
    let s = '';
    n.forEach((c) => {
      if (c.isText) s += c.text;
      else if (c.type.name === 'hard_break') s += '\n';
      else if (c.type.name === 'footnote') { fns.push(c.attrs.text); s += `[${footnoteLabel(fns.length, notes.numbering)}]`; }
      else if (c.type.name === 'image') s += c.attrs.alt ? `[${c.attrs.alt}]` : '';
    });
    return s;
  };
  const out: string[] = [];
  const block = (n: PMNode, indent: string, bullet?: string) => {
    const name = n.type.name;
    if (n.isTextblock) { out.push(indent + (bullet ?? '') + inline(n)); return; }
    if (name === 'bullet_list' || name === 'ordered_list') {
      n.forEach((li, _o, i) => {
        const mark = name === 'bullet_list' ? '• ' : `${(n.attrs.order ?? 1) + i}. `;
        li.forEach((c, _o2, j) => block(c, j === 0 ? indent : indent + '   ', j === 0 ? mark : undefined));
      });
      return;
    }
    if (name === 'blockquote') { n.forEach((c) => block(c, indent + '> ')); return; }
    if (name === 'horizontal_rule') { out.push(indent + '———'); return; }
    if (name === 'page_break') { out.push('\f'); return; }
    if (name === 'toc') {
      out.push('Contents');
      for (const e of n.attrs.entries as { level: number; text: string; page: number }[]) out.push('  '.repeat(Math.max(0, e.level - 1)) + e.text + (n.attrs.pageNumbers ? `  ${e.page}` : ''));
      return;
    }
    if (name === 'table') {
      n.forEach((row) => { const cells: string[] = []; row.forEach((c) => cells.push(c.textContent)); out.push(indent + cells.join('\t')); });
      return;
    }
    n.forEach((c) => block(c, indent));
  };
  final.forEach((n) => block(n, ''));
  let s = out.join('\n\n');
  if (fns.length) s += '\n\n———\n' + fns.map((t, i) => `[${footnoteLabel(i + 1, notes.numbering)}] ${t}`).join('\n');
  return s.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
