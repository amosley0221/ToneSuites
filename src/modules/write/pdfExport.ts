// Real text PDF export with pdf-lib: wraps and paginates using the page setup (size, margins,
// columns, header/footer), heading sizes, bold/italic, lists, quotes, tables, images, TOC, footnotes.
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFImage, type PDFPage, type RGB } from 'pdf-lib';
import type { Mark, Node as PMNode } from 'prosemirror-model';
import { pageBox, type WriteModel } from './model';
import { acceptedDoc } from './track';
import { footnoteLabel, parseDataUrl, sniffImage } from './util';

const PT = 0.75; // pt per CSS px

// WinAnsi (the standard fonts' encoding): Latin-1 + these extras. Everything else is substituted.
const WIN_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
const SUBST: Record<string, string> = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '×': 'x', '−': '-', '‐': '-', '‑': '-', '‒': '-', '―': '—', ' ': ' ', ' ': ' ', '​': '', '﻿': '', '\t': '    ', '✓': 'v', '✔': 'v', '☐': '[ ]', '☑': '[x]', '…': '...' };
export function sanitize(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_EXTRA.has(ch)) out += ch;
    else if (ch in SUBST) out += SUBST[ch];
    else if (c === 0x0a) out += ' ';
    else {
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      out += base.length === 1 && base.codePointAt(0)! < 0x7f ? base : '?';
    }
  }
  return out;
}

interface Fonts { [key: string]: PDFFont }
type Family = 'sans' | 'serif' | 'mono';

interface Seg { text: string; font: PDFFont; size: number; color: RGB; underline?: boolean; strike?: boolean; rise?: number; fn?: number; br?: boolean }
interface PlacedSeg { seg: Seg; x: number; w: number }
interface Line { segs: PlacedSeg[]; width: number; maxSize: number; fns: number[] }

type Item =
  | { kind: 'line'; line: Line; x: number; width: number; h: number; before: number; align: string | null; bar?: number; marker?: { text: string; x: number; font: PDFFont; size: number }; keepTop?: boolean }
  | { kind: 'image'; img: PDFImage; x: number; w: number; h: number; before: number }
  | { kind: 'rule'; x: number; w: number; h: number; before: number }
  | { kind: 'break'; h: 0; before: 0 }
  | { kind: 'row'; x: number; cells: { x: number; w: number; items: Item[]; h: number; header: boolean }[]; h: number; before: number };

const INK = rgb(0.1, 0.1, 0.1);
const MUTE = rgb(0.47, 0.47, 0.47);
const LINK = rgb(0.08, 0.44, 0.94);
const INS = rgb(0.08, 0.44, 0.94);
const DEL = rgb(0.71, 0.14, 0.09);

interface BlockStyle { size: number; lh: number; bold: boolean; before: number; color?: RGB; family?: Family }
const STYLES: Record<string, BlockStyle> = {
  paragraph: { size: 15 * PT, lh: 1.65, bold: false, before: 10 * PT },
  title: { size: 40 * PT, lh: 1.08, bold: true, before: 0 },
  h1: { size: 28 * PT, lh: 1.2, bold: true, before: 32 * PT },
  h2: { size: 22 * PT, lh: 1.25, bold: true, before: 28 * PT },
  h3: { size: 17 * PT, lh: 1.3, bold: true, before: 22 * PT },
  code: { size: 12.5 * PT, lh: 1.5, bold: false, before: 10 * PT, family: 'mono' },
  note: { size: 9, lh: 1.4, bold: false, before: 2 },
};

export interface PdfOptions { markup: boolean }

export async function pdfBytes(model: WriteModel, opts: PdfOptions = { markup: false }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fonts: Fonts = {
    'sans': await pdf.embedFont(StandardFonts.Helvetica), 'sans-b': await pdf.embedFont(StandardFonts.HelveticaBold),
    'sans-i': await pdf.embedFont(StandardFonts.HelveticaOblique), 'sans-bi': await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
    'serif': await pdf.embedFont(StandardFonts.TimesRoman), 'serif-b': await pdf.embedFont(StandardFonts.TimesRomanBold),
    'serif-i': await pdf.embedFont(StandardFonts.TimesRomanItalic), 'serif-bi': await pdf.embedFont(StandardFonts.TimesRomanBoldItalic),
    'mono': await pdf.embedFont(StandardFonts.Courier), 'mono-b': await pdf.embedFont(StandardFonts.CourierBold),
    'mono-i': await pdf.embedFont(StandardFonts.CourierOblique), 'mono-bi': await pdf.embedFont(StandardFonts.CourierBoldOblique),
  };
  const doc = opts.markup ? model.state.doc : acceptedDoc(model.state.doc);
  const box = pageBox(model.page);
  const pageW = box.w * PT, pageH = box.h * PT;
  const mL = box.left * PT, mR = box.right * PT, mT = box.top * PT, mB = box.bottom * PT;
  const cols = model.page.columns;
  const gutter = 0.3 * 72;
  const colW = (pageW - mL - mR - gutter * (cols - 1)) / cols;
  const notesAtPage = model.footnotes.position === 'page';
  const numbering = model.footnotes.numbering;

  const images = new Map<string, PDFImage>();
  for (const src of collectImages(doc)) {
    const d = parseDataUrl(src);
    if (!d) continue;
    const mime = sniffImage(d.bytes) ?? d.mime;
    try {
      if (mime.includes('png')) images.set(src, await pdf.embedPng(d.bytes));
      else if (mime.includes('jpeg')) images.set(src, await pdf.embedJpg(d.bytes));
    } catch { /* unsupported image: skipped */ }
  }

  // Two passes: the first finds heading pages for the TOC.
  let headingPages: number[] = [];
  const headingLevels: number[] = [];
  doc.forEach((n) => { if (n.type.name === 'title') headingLevels.push(0); else if (n.type.name === 'heading') headingLevels.push(n.attrs.level); });
  if (hasToc(doc)) headingPages = layoutAndDraw(null).headingPages;
  layoutAndDraw(pdf);
  pdf.setTitle(sanitize(firstTitle(doc) || 'Document'));
  pdf.setProducer('Tone Write');
  pdf.setCreator('Tone Write');
  return pdf.save();

  function layoutAndDraw(target: PDFDocument | null): { headingPages: number[] } {
    const notes: string[] = [];
    const lay = new Layout(fonts, images, colW, notes, numbering, opts.markup, headingPages, headingLevels);
    const items: Item[] = [];
    const headingItemIdx: number[] = [];
    /** Heading start item → index after its last item (keep-with-next). */
    const headingEnd = new Map<number, number>();
    doc.forEach((n) => {
      const start = items.length;
      if (n.type.name === 'heading' || n.type.name === 'title') headingItemIdx.push(start);
      items.push(...lay.block(n, 0));
      if (n.type.name === 'heading' || n.type.name === 'title') headingEnd.set(start, items.length);
    });
    if (!notesAtPage && notes.length) {
      items.push({ kind: 'rule', x: 0, w: 120, h: 1, before: 24 });
      notes.forEach((t, i) => items.push(...lay.noteLines(i, t)));
    }
    // Paginate
    type PageItems = { col: number; y: number; item: Item }[];
    const pages: { items: PageItems; notes: number[] }[] = [{ items: [], notes: [] }];
    const itemPage: number[] = [];
    let col = 0, y = 0;
    const limit = pageH - mT - mB;
    const noteHeight = (idxs: number[]) => (idxs.length ? 14 + idxs.reduce((a, i) => a + lay.noteLines(i, notes[i]).reduce((s, it) => s + it.h + it.before, 0), 0) : 0);
    const newColumn = () => {
      col++;
      if (col >= cols) { col = 0; pages.push({ items: [], notes: [] }); }
      y = 0;
    };
    items.forEach((it, idx) => {
      // Keep a heading with the first line that follows it (no stranded headings at a page bottom).
      const hEnd = headingEnd.get(idx);
      if (hEnd != null && y > 0 && items[hEnd] && items[hEnd].kind !== 'break') {
        let need = 0;
        for (let k = idx; k <= hEnd; k++) need += (k === idx ? it.before : items[k].before) + items[k].h;
        const reserve0 = notesAtPage ? noteHeight(pages[pages.length - 1].notes) : 0;
        if (y + need > limit - reserve0 && need < limit) newColumn();
      }
      if (it.kind === 'break') { if (y > 0 || col > 0) { col = cols - 1; newColumn(); } itemPage.push(pages.length); return; }
      const fns = it.kind === 'line' ? it.line.fns : it.kind === 'row' ? rowNotes(it) : [];
      const cur = pages[pages.length - 1];
      const before = y === 0 ? 0 : it.before;
      const reserve = notesAtPage ? noteHeight([...cur.notes, ...fns]) : 0;
      if (y > 0 && y + before + it.h > limit - reserve) newColumn();
      const pg = pages[pages.length - 1];
      const b2 = y === 0 ? 0 : it.before;
      pg.items.push({ col, y: y + b2, item: it });
      if (notesAtPage) pg.notes.push(...fns);
      y += b2 + it.h;
      itemPage.push(pages.length);
    });
    const hp = headingItemIdx.map((i) => itemPage[i] ?? 1);
    if (!target) return { headingPages: hp };

    const total = pages.length;
    pages.forEach((pg, pi) => {
      const page = target.addPage([pageW, pageH]);
      for (const { col: c, y: yy, item } of pg.items) drawItem(page, item, mL + c * (colW + gutter), pageH - mT - yy);
      if (pg.notes.length) {
        let ny = mB + noteHeight(pg.notes) - 6;
        page.drawLine({ start: { x: mL, y: ny }, end: { x: mL + 90, y: ny }, thickness: 0.6, color: INK });
        ny -= 6;
        for (const i of pg.notes) for (const it of lay.noteLines(i, notes[i], pageW - mL - mR)) { ny -= it.before; drawItem(page, it, mL, ny); ny -= it.h; }
      }
      const first = pi === 0 && model.page.differentFirst;
      if (model.page.header && !first) {
        const t = sanitize(model.page.header.replace(/\{page\}/g, String(pi + 1)).replace(/\{pages\}/g, String(total)));
        const w = fonts.sans.widthOfTextAtSize(t, 8.5);
        page.drawText(t, { x: (pageW - w) / 2, y: pageH - mT / 2, size: 8.5, font: fonts.sans, color: MUTE });
      }
      if ((model.page.footer || model.page.pageNumbers) && !first) {
        let t = model.page.footer.replace(/\{page\}/g, String(pi + 1)).replace(/\{pages\}/g, String(total));
        if (model.page.pageNumbers && !/\{page\}/.test(model.page.footer)) t = (t ? t + '   ' : '') + String(pi + 1);
        t = sanitize(t);
        const w = fonts.sans.widthOfTextAtSize(t, 8.5);
        page.drawText(t, { x: (pageW - w) / 2, y: mB / 2 - 4, size: 8.5, font: fonts.sans, color: MUTE });
      }
    });
    return { headingPages: hp };
  }
}

function rowNotes(it: Extract<Item, { kind: 'row' }>): number[] {
  const out: number[] = [];
  for (const c of it.cells) for (const i of c.items) if (i.kind === 'line') out.push(...i.line.fns);
  return out;
}

function drawItem(page: PDFPage, it: Item, x0: number, top: number) {
  switch (it.kind) {
    case 'line': {
      const l = it.line;
      let dx = 0;
      if (it.align === 'center') dx = (it.width - l.width) / 2;
      else if (it.align === 'right') dx = it.width - l.width;
      const baseline = top - (it.h - l.maxSize) / 2 - l.maxSize * 0.8;
      if (it.marker) page.drawText(it.marker.text, { x: x0 + it.marker.x, y: baseline, size: it.marker.size, font: it.marker.font, color: INK });
      if (it.bar != null) page.drawLine({ start: { x: x0 + it.bar, y: top }, end: { x: x0 + it.bar, y: top - it.h }, thickness: 2, color: rgb(0.85, 0.85, 0.85) });
      for (const p of l.segs) {
        if (!p.seg.text.trim() && !p.seg.underline && !p.seg.strike) continue;
        const x = x0 + it.x + dx + p.x;
        const y = baseline + (p.seg.rise ?? 0);
        page.drawText(p.seg.text, { x, y, size: p.seg.size, font: p.seg.font, color: p.seg.color });
        if (p.seg.underline) page.drawLine({ start: { x, y: y - p.seg.size * 0.12 }, end: { x: x + p.w, y: y - p.seg.size * 0.12 }, thickness: Math.max(0.5, p.seg.size / 18), color: p.seg.color });
        if (p.seg.strike) page.drawLine({ start: { x, y: y + p.seg.size * 0.3 }, end: { x: x + p.w, y: y + p.seg.size * 0.3 }, thickness: Math.max(0.5, p.seg.size / 18), color: p.seg.color });
      }
      break;
    }
    case 'image': page.drawImage(it.img, { x: x0 + it.x, y: top - it.h, width: it.w, height: it.h }); break;
    case 'rule': page.drawLine({ start: { x: x0 + it.x, y: top - it.h / 2 }, end: { x: x0 + it.x + it.w, y: top - it.h / 2 }, thickness: 0.6, color: rgb(0.8, 0.8, 0.8) }); break;
    case 'row': {
      for (const c of it.cells) {
        const cx = x0 + it.x + c.x;
        if (c.header) page.drawRectangle({ x: cx, y: top - it.h, width: c.w, height: it.h, color: rgb(0.96, 0.96, 0.95) });
        page.drawRectangle({ x: cx, y: top - it.h, width: c.w, height: it.h, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 0.6 });
        let y = top - 4;
        for (const ci of c.items) { y -= ci.before; drawItem(page, ci, cx + 4, y); y -= ci.h; }
      }
      break;
    }
    case 'break': break;
  }
}

class Layout {
  constructor(private fonts: Fonts, private images: Map<string, PDFImage>, private width: number, private notes: string[],
    private numbering: WriteModel['footnotes']['numbering'], private markup: boolean, private headingPages: number[], private headingLevels: number[]) {}
  private noteCache = new Map<string, Item[]>();

  font(family: Family, bold: boolean, italic: boolean): PDFFont {
    return this.fonts[family + (bold || italic ? '-' + (bold ? 'b' : '') + (italic ? 'i' : '') : '')];
  }

  segments(node: PMNode, st: BlockStyle): (Seg | { image: PMNode })[] {
    const out: (Seg | { image: PMNode })[] = [];
    node.forEach((c) => {
      const marks = c.marks;
      const has = (n: string) => marks.some((m) => m.type.name === n);
      const ts = marks.find((m) => m.type.name === 'textStyle') as Mark | undefined;
      const family: Family = has('code') ? 'mono' : ts?.attrs.fontFamily ? familyOf(ts.attrs.fontFamily) : st.family ?? 'sans';
      const size = ts?.attrs.fontSize ? ts.attrs.fontSize : st.size;
      const font = this.font(family, st.bold || has('strong'), has('em'));
      let color = st.color ?? INK;
      if (ts?.attrs.color) color = parseColor(ts.attrs.color) ?? color;
      const link = has('link');
      if (link) color = LINK;
      const ins = this.markup && has('insertion');
      const del = this.markup && has('deletion');
      if (ins) color = INS;
      if (del) color = DEL;
      if (c.isText) out.push({ text: sanitize(c.text!), font, size, color, underline: has('underline') || link || ins, strike: has('strike') || del });
      else if (c.type.name === 'hard_break') out.push({ text: '', font, size, color, br: true });
      else if (c.type.name === 'footnote') {
        this.notes.push(String(c.attrs.text || ''));
        out.push({ text: sanitize(footnoteLabel(this.notes.length, this.numbering)), font: this.font(family, false, false), size: size * 0.65, color, rise: size * 0.35, fn: this.notes.length - 1 });
      } else if (c.type.name === 'image') out.push({ image: c });
    });
    return out;
  }

  wrap(segs: Seg[], maxW: number): Line[] {
    const lines: Line[] = [];
    let cur: Line = { segs: [], width: 0, maxSize: 0, fns: [] };
    const push = () => { lines.push(cur); cur = { segs: [], width: 0, maxSize: 0, fns: [] }; };
    for (const s of segs) {
      if (s.br) { cur.maxSize = Math.max(cur.maxSize, s.size); push(); continue; }
      if (s.fn != null) cur.fns.push(s.fn);
      for (const tok of s.text.match(/\s+|[^\s]+/g) ?? []) {
        const space = /^\s/.test(tok);
        if (space && !cur.segs.length) continue;
        let w = s.font.widthOfTextAtSize(tok, s.size);
        if (!space && cur.width + w > maxW && cur.segs.length) {
          // Drop trailing spaces before wrapping.
          while (cur.segs.length && !cur.segs[cur.segs.length - 1].seg.text.trim()) cur.width -= cur.segs.pop()!.w;
          push();
        }
        let text = tok;
        while (!space && w > maxW && text.length > 1) {
          // A single word wider than the column: hard-split it.
          let n = text.length - 1;
          while (n > 1 && s.font.widthOfTextAtSize(text.slice(0, n), s.size) > maxW - cur.width) n--;
          const part = text.slice(0, n);
          const pw = s.font.widthOfTextAtSize(part, s.size);
          cur.segs.push({ seg: { ...s, text: part }, x: cur.width, w: pw });
          cur.width += pw; cur.maxSize = Math.max(cur.maxSize, s.size);
          push();
          text = text.slice(n);
          w = s.font.widthOfTextAtSize(text, s.size);
        }
        cur.segs.push({ seg: { ...s, text }, x: cur.width, w });
        cur.width += w;
        cur.maxSize = Math.max(cur.maxSize, s.rise ? s.size / 0.65 * 0.9 : s.size);
      }
    }
    if (cur.segs.length || !lines.length) { if (!cur.maxSize) cur.maxSize = segs[0]?.size ?? 11; push(); }
    for (const l of lines) if (!l.maxSize) l.maxSize = segs[0]?.size ?? 11;
    return lines;
  }

  textBlock(node: PMNode, st: BlockStyle, indent: number, width: number, extra: { marker?: string; bar?: number } = {}): Item[] {
    const items: Item[] = [];
    const parts = this.segments(node, st);
    const lh = node.attrs.lineHeight ? Math.max(1, node.attrs.lineHeight) * 1.1 : st.lh;
    let buf: Seg[] = [];
    let first = true;
    const flush = (force: boolean) => {
      if (!buf.length && !force) return;
      const lines = this.wrap(buf, width);
      lines.forEach((line) => {
        const markerFont = this.font('sans', false, false);
        items.push({
          kind: 'line', line, x: indent, width, h: line.maxSize * lh, before: first ? st.before : 0, align: node.attrs.align ?? null, bar: extra.bar,
          marker: first && extra.marker ? { text: extra.marker, x: indent - markerFont.widthOfTextAtSize(extra.marker, st.size) - 6, font: markerFont, size: st.size } : undefined,
        });
        first = false;
      });
      buf = [];
    };
    for (const p of parts) {
      if ('image' in p) {
        flush(false);
        const img = this.images.get(String(p.image.attrs.src));
        if (img) {
          let w = (p.image.attrs.width ?? img.width) * PT;
          let h = (p.image.attrs.height ?? (w / PT) * (img.height / img.width)) * PT;
          if (w > width) { h *= width / w; w = width; }
          items.push({ kind: 'image', img, x: indent + (node.attrs.align === 'center' ? (width - w) / 2 : node.attrs.align === 'right' ? width - w : 0), w, h, before: first ? st.before : 4 });
          first = false;
        }
      } else buf.push(p);
    }
    if (buf.length || !items.length) flush(true);
    return items;
  }

  block(node: PMNode, indent: number, quote = false): Item[] {
    const w = this.width - indent;
    const name = node.type.name;
    const bar = quote ? indent - 10 : undefined;
    switch (name) {
      case 'paragraph': return this.textBlock(node, quote ? { ...STYLES.paragraph, color: rgb(0.33, 0.33, 0.33) } : STYLES.paragraph, indent, w, { bar });
      case 'title': return this.textBlock(node, STYLES.title, indent, w);
      case 'heading': return this.textBlock(node, STYLES['h' + node.attrs.level], indent, w);
      case 'code_block': {
        const st = STYLES.code;
        const segs: Seg[] = [];
        node.textContent.split('\n').forEach((line, i) => {
          if (i) segs.push({ text: '', font: this.fonts.mono, size: st.size, color: INK, br: true });
          segs.push({ text: sanitize(line), font: this.fonts.mono, size: st.size, color: INK });
        });
        return this.wrap(segs, w).map((line, i) => ({ kind: 'line', line, x: indent, width: w, h: line.maxSize * st.lh, before: i === 0 ? st.before : 0, align: null }) as Item);
      }
      case 'blockquote': {
        const out: Item[] = [];
        node.forEach((c) => out.push(...this.block(c, indent + 16, true)));
        return out;
      }
      case 'horizontal_rule': return [{ kind: 'rule', x: indent, w, h: 1, before: 16 }];
      case 'page_break': return [{ kind: 'break', h: 0, before: 0 }];
      case 'bullet_list': case 'ordered_list': {
        const out: Item[] = [];
        const listIndent = indent + 20;
        node.forEach((li, _o, i) => {
          const marker = name === 'bullet_list' ? '•' : `${(node.attrs.order ?? 1) + i}.`;
          li.forEach((c, _o2, j) => {
            if (j === 0 && c.isTextblock) {
              const its = this.textBlock(c, { ...STYLES.paragraph, before: i === 0 ? STYLES.paragraph.before : 2 }, listIndent, this.width - listIndent, { marker: sanitize(marker), bar });
              out.push(...its);
            } else out.push(...this.block(c, listIndent, quote));
          });
        });
        return out;
      }
      case 'toc': {
        const out: Item[] = [this.textBlock(node.type.schema.node('paragraph', null, [node.type.schema.text('Contents')]), { ...STYLES.h3, before: 0 }, indent, w)[0]];
        const entries = node.attrs.entries as { level: number; text: string; page: number }[];
        const minLevel = Math.min(3, ...entries.map((e) => e.level));
        const levels = node.attrs.levels as number[];
        const order = this.headingLevels.map((l, i) => [l, i]).filter(([l]) => levels.includes(l)).map(([, i]) => i);
        entries.forEach((e, i) => {
          const page = this.headingPages.length && order[i] != null ? (this.headingPages[order[i]] ?? e.page) : e.page;
          const x = indent + (e.level - minLevel) * 14;
          const font = this.fonts.sans;
          const size = 10.5;
          const num = node.attrs.pageNumbers ? String(page) : '';
          const nw = font.widthOfTextAtSize(num, size);
          let text = sanitize(e.text);
          const avail = w - (x - indent) - nw - 12;
          while (text.length > 3 && font.widthOfTextAtSize(text, size) > avail) text = text.slice(0, -2);
          const tw = font.widthOfTextAtSize(text, size);
          const segs: PlacedSeg[] = [{ seg: { text, font, size, color: INK }, x: 0, w: tw }];
          if (num) {
            const lead = node.attrs.style === 'dotted' ? ' ' + '.'.repeat(Math.max(0, Math.floor((w - (x - indent) - tw - nw - 8) / font.widthOfTextAtSize('.', size)))) : '';
            segs.push({ seg: { text: lead, font, size, color: MUTE }, x: tw, w: font.widthOfTextAtSize(lead, size) });
            segs.push({ seg: { text: num, font, size, color: INK }, x: w - (x - indent) - nw, w: nw });
          }
          out.push({ kind: 'line', line: { segs, width: w, maxSize: size, fns: [] }, x, width: w - (x - indent), h: size * 1.9, before: i === 0 ? 6 : 0, align: null });
        });
        return out;
      }
      case 'table': {
        const rows: Item[] = [];
        let colsN = 0;
        node.forEach((r) => { let c = 0; r.forEach((cell) => { c += cell.attrs.colspan ?? 1; }); colsN = Math.max(colsN, c); });
        const cw = w / Math.max(1, colsN);
        node.forEach((r, _o, ri) => {
          let cx = 0;
          const cells: Extract<Item, { kind: 'row' }>['cells'] = [];
          r.forEach((cell) => {
            const span = cell.attrs.colspan ?? 1;
            const cellW = cw * span;
            const sub = new Layout(this.fonts, this.images, cellW - 8, this.notes, this.numbering, this.markup, this.headingPages, this.headingLevels);
            const items: Item[] = [];
            cell.forEach((b) => items.push(...sub.block(b, 0)));
            if (items[0]) items[0] = { ...items[0], before: 0 } as Item;
            const h = items.reduce((s, it) => s + it.h + it.before, 0) + 8;
            cells.push({ x: cx, w: cellW, items, h, header: cell.type.name === 'table_header' });
            cx += cellW;
          });
          const h = Math.max(16, ...cells.map((c) => c.h));
          rows.push({ kind: 'row', x: indent, cells, h, before: ri === 0 ? 12 : 0 });
        });
        return rows;
      }
      default: {
        if (node.isTextblock) return this.textBlock(node, STYLES.paragraph, indent, w);
        const out: Item[] = [];
        node.forEach((c) => out.push(...this.block(c, indent, quote)));
        return out;
      }
    }
  }

  noteLines(i: number, text: string, width = this.width): Item[] {
    const key = i + ':' + width;
    const hit = this.noteCache.get(key);
    if (hit) return hit;
    const st = STYLES.note;
    const label = sanitize(footnoteLabel(i + 1, this.numbering));
    const segs: Seg[] = [
      { text: label + ' ', font: this.fonts.sans, size: st.size * 0.8, color: INK, rise: 2 },
      { text: sanitize(text), font: this.fonts.sans, size: st.size, color: INK },
    ];
    const items = this.wrap(segs, width).map((line, j) => ({ kind: 'line', line, x: 0, width, h: st.size * st.lh, before: j === 0 ? st.before : 0, align: null }) as Item);
    this.noteCache.set(key, items);
    return items;
  }
}

function familyOf(name: string): Family {
  if (/mono|courier|consolas/i.test(name)) return 'mono';
  if (/georgia|times|garamond|cambria|serif/i.test(name) && !/sans/i.test(name)) return 'serif';
  return 'sans';
}

function parseColor(c: string): RGB | null {
  let m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) { const n = parseInt(m[1], 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
  m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c);
  return m ? rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255) : null;
}

function collectImages(doc: PMNode): string[] {
  const out = new Set<string>();
  doc.descendants((n) => { if (n.type.name === 'image') out.add(String(n.attrs.src)); return true; });
  return [...out];
}

function hasToc(doc: PMNode) { let t = false; doc.forEach((n) => { if (n.type.name === 'toc') t = true; }); return t; }

function firstTitle(doc: PMNode): string {
  let t = '';
  doc.forEach((n) => { if (!t && (n.type.name === 'title' || n.type.name === 'heading')) t = n.textContent; });
  return t;
}
