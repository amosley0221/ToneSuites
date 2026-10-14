// Word (.docx) export via the `docx` library. Tracked changes become real Word revisions,
// comments become Word comments, footnotes become Word footnotes.
import {
  AlignmentType, BorderStyle, CommentRangeEnd, CommentRangeStart, CommentReference, DeletedTextRun, Document, ExternalHyperlink,
  Footer, FootnoteReferenceRun, Header, HeadingLevel, ImageRun, InsertedTextRun, LevelFormat, Packer, PageBreak, PageNumber,
  PageOrientation, Paragraph, ShadingType, Table, TableCell, TableRow, TabStopType, TextRun, WidthType, type IRunOptions,
  type ParagraphChild,
} from 'docx';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { pageBox, PAPER_PX, type WriteModel } from './model';
import { imageSize, parseDataUrl, sniffImage } from './util';

const TWIP = 15; // twips per CSS px (1440 / 96)

type Ctx = {
  footnotes: Record<string, { children: Paragraph[] }>;
  fnSeq: number;
  comments: Map<string, number>;
  revSeq: number;
  revIds: Map<string, number>;
  contentWidthPx: number;
  numberingInstance: number;
};

const ALIGN = { center: AlignmentType.CENTER, right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED, left: AlignmentType.LEFT } as const;

function runOptions(marks: readonly Mark[], extra: Partial<IRunOptions> = {}): IRunOptions {
  const o: Record<string, unknown> = { ...extra };
  for (const m of marks) {
    switch (m.type.name) {
      case 'strong': o.bold = true; break;
      case 'em': o.italics = true; break;
      case 'underline': o.underline = {}; break;
      case 'strike': o.strike = true; break;
      case 'code': o.font = 'Courier New'; break;
      case 'textStyle':
        if (m.attrs.fontFamily) o.font = m.attrs.fontFamily;
        if (m.attrs.fontSize) o.size = Math.round(m.attrs.fontSize * 2);
        if (m.attrs.color) { const hex = cssToHex(m.attrs.color); if (hex) o.color = hex; }
        break;
      case 'highlight': { const hex = cssToHex(m.attrs.color); if (hex) o.shading = { type: ShadingType.CLEAR, fill: hex, color: 'auto' }; break; }
      case 'link': o.style = 'Hyperlink'; break;
    }
  }
  return o as IRunOptions;
}

function cssToHex(c: string): string | null {
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.slice(1).toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return c.slice(1).split('').map((x) => x + x).join('').toUpperCase();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? [m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('').toUpperCase() : null;
}

function revId(ctx: Ctx, key: string) {
  let id = ctx.revIds.get(key);
  if (id == null) { id = ++ctx.revSeq; ctx.revIds.set(key, id); }
  return id;
}

function inlineChildren(node: PMNode, ctx: Ctx, base: Partial<IRunOptions> = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let openComments: string[] = [];
  const closeComment = (id: string) => {
    const n = ctx.comments.get(id);
    if (n == null) return;
    out.push(new CommentRangeEnd(n), new TextRun({ children: [new CommentReference(n)] }));
  };
  node.forEach((child) => {
    const commentIds = child.marks.filter((m) => m.type.name === 'comment').map((m) => String(m.attrs.id)).filter((id) => ctx.comments.has(id));
    for (const id of openComments) if (!commentIds.includes(id)) closeComment(id);
    for (const id of commentIds) if (!openComments.includes(id)) out.push(new CommentRangeStart(ctx.comments.get(id)!));
    openComments = commentIds;

    const ins = child.marks.find((m) => m.type.name === 'insertion');
    const del = child.marks.find((m) => m.type.name === 'deletion');
    const link = child.marks.find((m) => m.type.name === 'link');
    const opts = runOptions(child.marks, base);
    let run: ParagraphChild | null = null;
    if (child.isText) {
      const text = child.text!;
      if (del) run = new DeletedTextRun({ ...opts, text, id: revId(ctx, 'd' + del.attrs.id), author: del.attrs.author || 'Tone', date: new Date(del.attrs.time || Date.now()).toISOString() });
      else if (ins) run = new InsertedTextRun({ ...opts, text, id: revId(ctx, 'i' + ins.attrs.id), author: ins.attrs.author || 'Tone', date: new Date(ins.attrs.time || Date.now()).toISOString() });
      else run = new TextRun({ ...opts, text });
    } else if (child.type.name === 'hard_break') {
      run = new TextRun({ ...opts, break: 1 });
    } else if (child.type.name === 'footnote') {
      const id = ++ctx.fnSeq;
      ctx.footnotes[id] = { children: [new Paragraph(String(child.attrs.text || ''))] };
      run = new FootnoteReferenceRun(id);
    } else if (child.type.name === 'image') {
      run = imageRun(child, ctx);
    }
    if (!run) return;
    if (link && !(del || ins)) out.push(new ExternalHyperlink({ link: String(link.attrs.href), children: [run as TextRun] }));
    else out.push(run);
  });
  for (const id of openComments) closeComment(id);
  return out;
}

function imageRun(node: PMNode, ctx: Ctx): ImageRun | null {
  const data = parseDataUrl(String(node.attrs.src));
  if (!data) return null;
  const mime = sniffImage(data.bytes) ?? data.mime;
  const type = mime.includes('png') ? 'png' : mime.includes('jpeg') ? 'jpg' : mime.includes('gif') ? 'gif' : mime.includes('bmp') ? 'bmp' : null;
  if (!type) return null;
  const nat = imageSize(data.bytes) ?? { w: node.attrs.width ?? 300, h: node.attrs.height ?? 200 };
  let w = node.attrs.width ?? nat.w;
  let h = node.attrs.height ?? Math.round((w * nat.h) / Math.max(1, nat.w));
  if (w > ctx.contentWidthPx) { h = Math.round((h * ctx.contentWidthPx) / w); w = ctx.contentWidthPx; }
  return new ImageRun({ type, data: data.bytes, transformation: { width: w, height: h }, altText: node.attrs.alt ? { name: 'image', description: node.attrs.alt, title: node.attrs.alt } : undefined });
}

type Block = Paragraph | Table;

function blocks(node: PMNode, ctx: Ctx, list?: { kind: 'bullet' | 'number'; level: number; instance: number }, quote = false): Block[] {
  const out: Block[] = [];
  const name = node.type.name;
  const pOpts = () => ({
    alignment: node.attrs?.align ? ALIGN[node.attrs.align as keyof typeof ALIGN] : undefined,
    spacing: node.attrs?.lineHeight ? { line: Math.round(node.attrs.lineHeight * 240) } : undefined,
    ...(quote ? { indent: { left: 720 }, border: { left: { style: BorderStyle.SINGLE, size: 12, color: 'BBBBBB', space: 8 } } } : {}),
  });
  switch (name) {
    case 'paragraph':
      out.push(new Paragraph({
        ...pOpts(), children: inlineChildren(node, ctx),
        ...(list ? list.kind === 'bullet' ? { bullet: { level: list.level } } : { numbering: { reference: 'wr-num', level: list.level, instance: list.instance } } : {}),
      }));
      break;
    case 'title': out.push(new Paragraph({ ...pOpts(), heading: HeadingLevel.TITLE, children: inlineChildren(node, ctx) })); break;
    case 'heading': out.push(new Paragraph({ ...pOpts(), heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][node.attrs.level - 1], children: inlineChildren(node, ctx) })); break;
    case 'blockquote': node.forEach((c) => out.push(...blocks(c, ctx, list, true))); break;
    case 'code_block':
      for (const line of node.textContent.split('\n')) out.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New', size: 20 })], shading: { type: ShadingType.CLEAR, fill: 'F5F5F3', color: 'auto' } }));
      break;
    case 'horizontal_rule': out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC', space: 1 } } })); break;
    case 'page_break': out.push(new Paragraph({ children: [new PageBreak()] })); break;
    case 'toc': {
      out.push(new Paragraph({ children: [new TextRun({ text: 'Contents', bold: true, size: 32 })] }));
      const right = Math.round(ctx.contentWidthPx * TWIP);
      for (const e of node.attrs.entries as { level: number; text: string; page: number }[]) {
        out.push(new Paragraph({
          indent: { left: Math.max(0, e.level - 1) * 360 },
          tabStops: node.attrs.pageNumbers ? [{ type: TabStopType.RIGHT, position: right, leader: node.attrs.style === 'dotted' ? 'dot' : 'none' }] : undefined,
          children: [new TextRun(e.text + (node.attrs.pageNumbers ? `\t${e.page}` : ''))],
        }));
      }
      break;
    }
    case 'bullet_list': case 'ordered_list': {
      const level = list ? list.level + 1 : 0;
      const instance = name === 'ordered_list' ? ++ctx.numberingInstance : 0;
      node.forEach((li) => li.forEach((c) => out.push(...blocks(c, ctx, { kind: name === 'bullet_list' ? 'bullet' : 'number', level: Math.min(level, 8), instance }, quote))));
      break;
    }
    case 'table': {
      const rows: TableRow[] = [];
      node.forEach((row, _o, ri) => {
        const cells: TableCell[] = [];
        row.forEach((cell) => {
          const kids: (Paragraph | Table)[] = [];
          cell.forEach((c) => kids.push(...blocks(c, ctx)));
          const bg = cell.attrs.background ? cssToHex(cell.attrs.background) : cell.type.name === 'table_header' ? 'F2F2F0' : null;
          cells.push(new TableCell({
            children: kids.length ? kids : [new Paragraph('')],
            columnSpan: cell.attrs.colspan > 1 ? cell.attrs.colspan : undefined,
            rowSpan: cell.attrs.rowspan > 1 ? cell.attrs.rowspan : undefined,
            shading: bg ? { type: ShadingType.CLEAR, fill: bg, color: 'auto' } : undefined,
          }));
        });
        rows.push(new TableRow({ children: cells, tableHeader: ri === 0 && row.firstChild?.type.name === 'table_header' }));
      });
      out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
      out.push(new Paragraph(''));
      break;
    }
    default:
      if (node.isTextblock) out.push(new Paragraph({ children: inlineChildren(node, ctx) }));
      else node.forEach((c) => out.push(...blocks(c, ctx, list, quote)));
  }
  return out;
}

export async function docxBytes(model: WriteModel): Promise<Uint8Array> {
  const page = model.page;
  const box = pageBox(page);
  const ctx: Ctx = { footnotes: {}, fnSeq: 0, comments: new Map(), revSeq: 0, revIds: new Map(), contentWidthPx: box.w - box.left - box.right, numberingInstance: 0 };
  // Only comments still anchored in the text are exported.
  const anchored = new Set<string>();
  model.state.doc.descendants((n) => { for (const m of n.marks) if (m.type.name === 'comment') anchored.add(String(m.attrs.id)); return true; });
  const comments = model.comments.filter((c) => anchored.has(c.id));
  comments.forEach((c, i) => ctx.comments.set(c.id, i));

  const children: Block[] = [];
  model.state.doc.forEach((n) => children.push(...blocks(n, ctx)));

  const portrait = PAPER_PX[page.paper];
  const headerPara = (text: string) => new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, color: '777777', size: 18 })] });
  const footerChildren: ParagraphChild[] = [];
  if (page.footer) footerChildren.push(new TextRun({ text: page.footer + (page.pageNumbers ? '   ' : ''), color: '777777', size: 18 }));
  if (page.pageNumbers) footerChildren.push(new TextRun({ children: [PageNumber.CURRENT], color: '777777', size: 18 }));

  const doc = new Document({
    creator: model.author,
    comments: { children: comments.map((c, i) => ({ id: i, author: c.author, date: new Date(c.time), children: [new Paragraph(c.text)] })) },
    footnotes: ctx.footnotes,
    features: { trackRevisions: model.tracking },
    numbering: {
      config: [{
        reference: 'wr-num',
        levels: Array.from({ length: 9 }, (_, level) => ({
          level,
          format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [{
      properties: {
        titlePage: page.differentFirst,
        page: {
          size: { width: portrait.w * TWIP, height: portrait.h * TWIP, orientation: page.orientation === 'landscape' ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
          margin: { top: Math.round(page.margins.top * 1440), bottom: Math.round(page.margins.bottom * 1440), left: Math.round(page.margins.left * 1440), right: Math.round(page.margins.right * 1440) },
        },
        column: page.columns > 1 ? { count: page.columns, space: 432 } : undefined,
      },
      headers: page.header ? { default: new Header({ children: [headerPara(page.header)] }), ...(page.differentFirst ? { first: new Header({ children: [] }) } : {}) } : undefined,
      footers: footerChildren.length ? { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: footerChildren })] }), ...(page.differentFirst ? { first: new Footer({ children: [] }) } : {}) } : undefined,
      children,
    }],
  });
  const blob = await Packer.toBlob(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
