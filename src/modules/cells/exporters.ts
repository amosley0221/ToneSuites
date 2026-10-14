// Export formats: XLSX, CSV, TSV, PDF (opens in Paper), HTML table (opens in Write).
import type { ExportFormat } from '@/core/types';
import { cellKey } from './address';
import { DEFAULT_COL_W, DEFAULT_ROW_H, type Sheet, type Workbook } from './model';
import { sheetToDelimited, workbookToXlsx } from './io';
import { hexToRgb } from './condfmt';

const base = (title: string) => title.replace(/\.(tone|xlsx|csv|tsv)$/i, '') || 'Workbook';

/** Visible (non-filtered) rows / cols of the used range, plus merge lookups. */
function layout(wb: Workbook, s: Sheet) {
  const b = wb.bounds(s);
  const hidden = wb.hiddenRows(s);
  const rows: number[] = [];
  for (let r = 0; r < b.rows; r++) if (!hidden.has(r)) rows.push(r);
  const cols = Array.from({ length: b.cols }, (_, c) => c);
  return { rows, cols };
}

// ---------- HTML ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function workbookToHtml(wb: Workbook, title: string, which: 'active' | 'all'): string {
  const sheets = which === 'all' ? wb.sheets : [wb.sheet];
  const parts: string[] = [];
  for (const s of sheets) {
    const { rows, cols } = layout(wb, s);
    parts.push(`<h2>${esc(s.name)}</h2>`);
    if (!rows.length) { parts.push('<p><em>Empty sheet</em></p>'); continue; }
    const covered = new Set<number>();
    const spanAt = new Map<number, { rs: number; cs: number }>();
    for (const m of s.merges) {
      spanAt.set(cellKey(m.r0, m.c0), { rs: m.r1 - m.r0 + 1, cs: m.c1 - m.c0 + 1 });
      for (let r = m.r0; r <= m.r1; r++) for (let c = m.c0; c <= m.c1; c++) if (r !== m.r0 || c !== m.c0) covered.add(cellKey(r, c));
    }
    parts.push('<table>');
    if (s.colWidths.size) parts.push('<colgroup>' + cols.map((c) => `<col style="width:${s.colWidths.get(c) ?? DEFAULT_COL_W}px">`).join('') + '</colgroup>');
    for (const r of rows) {
      const tds: string[] = [];
      for (const c of cols) {
        const k = cellKey(r, c);
        if (covered.has(k)) continue;
        const d = wb.display(s, r, c);
        const f = wb.getCell(s, r, c)?.f;
        const st: string[] = [];
        if (f?.b || r < s.freeze.rows) st.push('font-weight:700');
        if (f?.i) st.push('font-style:italic');
        if (f?.u) st.push('text-decoration:underline');
        if (f?.color) st.push(`color:${f.color}`);
        else if (d.kind === 'num' && (d.num ?? 0) < 0) st.push('color:#e5484d');
        if (f?.fill) st.push(`background:${f.fill}`);
        const al = f?.al ?? (d.kind === 'num' ? 'right' : d.kind === 'bool' || d.kind === 'err' ? 'center' : undefined);
        if (al) st.push(`text-align:${al}`);
        if (d.kind === 'num') st.push('font-variant-numeric:tabular-nums');
        if (f?.wrap) st.push('white-space:pre-wrap');
        const span = spanAt.get(k);
        const attrs = (span ? `${span.rs > 1 ? ` rowspan="${span.rs}"` : ''}${span.cs > 1 ? ` colspan="${span.cs}"` : ''}` : '') + (st.length ? ` style="${st.join(';')}"` : '');
        const tag = r < s.freeze.rows ? 'th' : 'td';
        tds.push(`<${tag}${attrs}>${esc(d.text)}</${tag}>`);
      }
      parts.push(`<tr>${tds.join('')}</tr>`);
    }
    parts.push('</table>');
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font-family:Archivo,Helvetica,Arial,sans-serif;font-size:13px}table{border-collapse:collapse;margin-bottom:24px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}th{background:#f2f1ee}</style>
</head><body><h1>${esc(title)}</h1>
${parts.join('\n')}
</body></html>`;
}

// ---------- PDF ----------

/** pdf-lib's standard fonts only encode WinAnsi; replace anything else. */
const winAnsi = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF€]/g, '?');

export async function workbookToPdf(wb: Workbook, title: string, opts: { orientation: string; fit: string; sheets: string }): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(base(title));
  pdf.setCreator('Tone Cells');
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const landscape = opts.orientation !== 'Portrait';
  const [PW, PH] = landscape ? [792, 612] : [612, 792];
  const M = 36;
  const FS = 9;
  const sheets = opts.sheets === 'All sheets' ? wb.sheets : [wb.sheet];
  const color = (hex: string | undefined, fallback: [number, number, number]) => {
    const c = hex ? hexToRgb(hex) : null;
    const [r, g, b] = c ? c.map((v) => v / 255) : fallback;
    return rgb(r, g, b);
  };
  for (const s of sheets) {
    const { rows, cols } = layout(wb, s);
    const pxToPt = 0.75;
    const colW = cols.map((c) => (s.colWidths.get(c) ?? DEFAULT_COL_W) * pxToPt);
    const rowH = (r: number) => (s.rowHeights.get(r) ?? DEFAULT_ROW_H) * pxToPt;
    const availW = PW - 2 * M;
    const totalW = colW.reduce((a, b) => a + b, 0);
    const scale = opts.fit === 'Fit to page width' && totalW > availW ? availW / totalW : 1;
    // Split columns into horizontal page chunks (only when not fitting).
    const chunks: number[][] = [];
    let cur: number[] = [];
    let acc = 0;
    cols.forEach((c, i) => {
      const w = colW[i] * scale;
      if (cur.length && acc + w > availW + 0.01) { chunks.push(cur); cur = []; acc = 0; }
      cur.push(c); acc += w;
    });
    if (cur.length) chunks.push(cur);
    if (!rows.length || !chunks.length) {
      const page = pdf.addPage([PW, PH]);
      page.drawText(winAnsi(s.name), { x: M, y: PH - M, size: 12, font: bold });
      page.drawText('Empty sheet', { x: M, y: PH - M - 20, size: FS, font: italic, color: rgb(0.45, 0.45, 0.5) });
      continue;
    }
    const repeat = rows.filter((r) => r < s.freeze.rows);
    for (const chunk of chunks) {
      let i = 0;
      while (i < rows.length) {
        const page = pdf.addPage([PW, PH]);
        page.drawText(winAnsi(`${base(title)} · ${s.name}`).replace('·', '-'), { x: M, y: PH - M + 12, size: 8, font, color: rgb(0.45, 0.45, 0.5) });
        let y = PH - M - 6;
        const pageRows: number[] = [];
        if (i > 0) for (const r of repeat) pageRows.push(r);
        let used = pageRows.reduce((a, r) => a + rowH(r) * scale, 0);
        let added = 0;
        while (i < rows.length) {
          const h = rowH(rows[i]) * scale;
          if (added && used + h > PH - 2 * M - 10) break;
          pageRows.push(rows[i]); i++; added++; used += h;
        }
        for (const r of pageRows) {
          const h = rowH(r) * scale;
          let x = M;
          for (const c of chunk) {
            const w = colW[cols.indexOf(c)] * scale;
            const cell = wb.getCell(s, r, c);
            const f = cell?.f;
            if (f?.fill) page.drawRectangle({ x, y: y - h, width: w, height: h, color: color(f.fill, [1, 1, 1]) });
            else if (r < s.freeze.rows) page.drawRectangle({ x, y: y - h, width: w, height: h, color: rgb(0.95, 0.945, 0.93) });
            if (s.showGrid) page.drawRectangle({ x, y: y - h, width: w, height: h, borderColor: rgb(0.82, 0.82, 0.8), borderWidth: 0.5 });
            const d = wb.display(s, r, c);
            if (d.text) {
              const fnt = f?.b || r < s.freeze.rows ? bold : f?.i ? italic : font;
              const size = FS * Math.max(0.6, scale);
              let txt = winAnsi(d.text.replace(/\s*\n\s*/g, ' '));
              const maxW = w - 6 * scale;
              while (txt.length > 1 && fnt.widthOfTextAtSize(txt, size) > maxW) txt = txt.slice(0, -1);
              const tw = fnt.widthOfTextAtSize(txt, size);
              const al = f?.al ?? (d.kind === 'num' ? 'right' : d.kind === 'bool' || d.kind === 'err' ? 'center' : 'left');
              const tx = al === 'right' ? x + w - 3 * scale - tw : al === 'center' ? x + (w - tw) / 2 : x + 3 * scale;
              const neg = d.kind === 'num' && (d.num ?? 0) < 0;
              page.drawText(txt, { x: tx, y: y - h / 2 - size / 3, size, font: fnt, color: f?.color ? color(f.color, [0, 0, 0]) : neg ? rgb(0.9, 0.28, 0.3) : rgb(0.08, 0.08, 0.08) });
            }
            x += w;
          }
          y -= h;
        }
        page.drawText(`${pdf.getPageCount()}`, { x: PW - M - 10, y: M / 2, size: 8, font, color: rgb(0.45, 0.45, 0.5) });
      }
    }
  }
  return pdf.save();
}

// ---------- registry ----------

export const cellsExports: ExportFormat[] = [
  {
    id: 'pdf', name: 'PDF', ext: 'pdf', opensIn: 'paper',
    description: 'Table of the used range, paginated · opens in Paper',
    options: [
      { id: 'orientation', label: 'Orientation', choices: ['Landscape', 'Portrait'], default: 'Landscape' },
      { id: 'fit', label: 'Scale', choices: ['Fit to page width', 'Actual size'], default: 'Fit to page width' },
      { id: 'sheets', label: 'Sheets', choices: ['Active sheet', 'All sheets'], default: 'Active sheet' },
    ],
    run: async (model, opts, title) => ({
      kind: 'doc', mode: 'paper', filename: base(title) + '.pdf',
      bytes: await workbookToPdf(model as Workbook, title, { orientation: opts.orientation ?? 'Landscape', fit: opts.fit ?? 'Fit to page width', sheets: opts.sheets ?? 'Active sheet' }),
    }),
  },
  {
    id: 'xlsx', name: 'Excel workbook', ext: 'xlsx', description: 'All sheets · formulas, formats, merges and freeze panes preserved',
    run: async (model, _opts, title) => ({ kind: 'file', filename: base(title) + '.xlsx', bytes: await workbookToXlsx(model as Workbook) }),
  },
  {
    id: 'csv', name: 'CSV', ext: 'csv', description: 'Active sheet only · displayed values',
    run: async (model, _opts, title) => {
      const wb = model as Workbook;
      return { kind: 'file', filename: `${base(title)}.csv`, bytes: sheetToDelimited(wb, wb.sheet, ',') };
    },
  },
  {
    id: 'tsv', name: 'TSV', ext: 'tsv', description: 'Active sheet only · tab separated',
    run: async (model, _opts, title) => {
      const wb = model as Workbook;
      return { kind: 'file', filename: `${base(title)}.tsv`, bytes: sheetToDelimited(wb, wb.sheet, '\t') };
    },
  },
  {
    id: 'html', name: 'HTML table', ext: 'html', opensIn: 'write',
    description: 'Formatted table · opens in Write',
    options: [{ id: 'sheets', label: 'Sheets', choices: ['Active sheet', 'All sheets'], default: 'Active sheet' }],
    run: async (model, opts, title) => ({
      kind: 'doc', mode: 'write', filename: base(title) + '.html',
      bytes: new TextEncoder().encode(workbookToHtml(model as Workbook, base(title), opts.sheets === 'All sheets' ? 'all' : 'active')),
    }),
  },
];
