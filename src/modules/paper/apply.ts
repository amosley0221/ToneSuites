// Applies a Paper model (sources + page ops + edit list) to produce new PDF bytes with pdf-lib.
// Pure pdf-lib: runs in node for tests. Redaction rasterizing is injected (needs pdf.js + canvas).
import {
  BlendMode, LineCapStyle, PDFArray, PDFCheckBox, PDFDict, PDFDocument, PDFDropdown, PDFHexString, PDFName, PDFNumber, PDFOptionList,
  PDFForm, PDFPage, PDFRadioGroup, PDFRef, PDFStream, PDFString, PDFTextField, StandardFonts, TextAlignment, degrees, rgb,
  type PDFFont, type PDFObject, type RGB,
} from 'pdf-lib';
import { LETTER, type Edit, type PaperData, type Rect, type SourceDoc } from './model';
import { makeViewport, normRot, type ViewBox } from './viewport';

/** Renders source page `index` unrotated with `boxes` painted opaque black; returns a PNG covering `view`. */
export type Rasterizer = (src: SourceDoc, index: number, boxes: Rect[]) => Promise<{ png: Uint8Array; view: ViewBox }>;

export interface BuildOptions {
  rasterize?: Rasterizer;
  /** Remove document info + XMP metadata. */
  stripMetadata?: boolean;
}
export interface BuildResult { bytes: Uint8Array; warnings: string[] }

export async function createBlankPdf(size: [number, number] = LETTER): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  d.addPage(size);
  return d.save();
}

export async function countPages(bytes: Uint8Array): Promise<number> {
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return d.getPageCount();
}

export function hexColor(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Replace characters the standard (WinAnsi) font can't encode. */
function safeText(font: PDFFont, s: string): string {
  let out = '';
  for (const ch of s) {
    try { font.encodeText(ch); out += ch; } catch { out += '?'; }
  }
  return out;
}

function pageView(p: PDFPage): ViewBox {
  const m = p.getMediaBox(), c = p.getCropBox();
  const x0 = Math.max(m.x, c.x), y0 = Math.max(m.y, c.y);
  const x1 = Math.min(m.x + m.width, c.x + c.width), y1 = Math.min(m.y + m.height, c.y + c.height);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1, y1] : [m.x, m.y, m.x + m.width, m.y + m.height];
}

const INHERITABLE = ['Resources', 'MediaBox', 'CropBox', 'Rotate'];

export async function buildPdf(data: PaperData, opts: BuildOptions = {}): Promise<BuildResult> {
  const burn = data.edits.filter((e) => e.kind === 'redact' && e.applied);
  if (opts.rasterize && burn.length) {
    // Two passes so redacted pages are rasterized *with* their form values, annotations and signatures:
    // 1) apply everything except applied redactions, 2) rasterize the redacted pages of that result.
    const burnIds = new Set(burn.map((e) => e.id));
    const p1 = await buildPdf({ ...data, edits: data.edits.filter((e) => !burnIds.has(e.id)) }, { stripMetadata: opts.stripMetadata });
    const mid: SourceDoc = { id: 'applied', name: 'applied.pdf', bytes: p1.bytes };
    const pages = data.pages.map((p, i) => ({ id: p.id, src: mid.id, index: i, rot: 0 as const }));
    const p2 = await buildPassTwo({ sources: [mid], pages, edits: burn, formValues: {}, newFields: [], flattenForm: false }, opts);
    return { bytes: p2.bytes, warnings: [...p1.warnings, ...p2.warnings] };
  }
  return buildPassTwo(data, opts);
}

async function buildPassTwo(data: PaperData, opts: BuildOptions): Promise<BuildResult> {
  const warnings: string[] = [];
  const first = data.sources[0];
  const base = first ? await PDFDocument.load(first.bytes, { ignoreEncryption: true, updateMetadata: false }) : await PDFDocument.create();
  if (base.isEncrypted) throw new Error('This PDF is encrypted; Tone can display it but cannot write encrypted PDFs yet.');
  const loaded = new Map<string, PDFDocument>();
  if (first) loaded.set(first.id, base);
  const load = async (id: string) => {
    let d = loaded.get(id);
    if (!d) {
      const s = data.sources.find((x) => x.id === id);
      if (!s) throw new Error('A merged document is missing from this file');
      d = await PDFDocument.load(s.bytes, { ignoreEncryption: true, updateMetadata: false });
      if (d.isEncrypted) throw new Error(`${s.name} is encrypted and can't be merged`);
      loaded.set(id, d);
    }
    return d;
  };

  // 1. Form values + optional flatten — on the original document, before pages move.
  fillForm(base, data, warnings);

  // 2. Assemble output pages in order.
  const basePages = base.getPages();
  const usedBase = new Set<number>();
  const appliedRedactions = new Map<string, Rect[]>();
  let pendingMarks = 0;
  for (const e of data.edits) {
    if (e.kind !== 'redact') continue;
    if (!e.applied) { pendingMarks++; continue; }
    appliedRedactions.set(e.page, [...(appliedRedactions.get(e.page) ?? []), e.rect]);
  }
  if (pendingMarks) warnings.push(`${pendingMarks} redaction mark${pendingMarks > 1 ? 's were' : ' was'} not applied (use Apply redactions)`);

  const out: { page: PDFPage; rot: number }[] = [];
  for (const ref of data.pages) {
    if (!ref.src) {
      out.push({ page: base.addPage(ref.size ?? LETTER), rot: ref.rot });
      continue;
    }
    const redact = appliedRedactions.get(ref.id);
    const srcDoc = await load(ref.src);
    if (ref.index >= srcDoc.getPageCount()) { warnings.push('A page reference was out of range and was skipped'); continue; }
    const origRot = srcDoc.getPage(ref.index).getRotation().angle;
    if (redact && opts.rasterize) {
      // True redaction: replace the page with a raster of itself with the boxes burnt in.
      const src = data.sources.find((s) => s.id === ref.src)!;
      const { png, view } = await opts.rasterize(src, ref.index, redact);
      const p = base.addPage([view[2] - view[0], view[3] - view[1]]);
      p.setMediaBox(view[0], view[1], view[2] - view[0], view[3] - view[1]);
      const img = await base.embedPng(png);
      p.drawImage(img, { x: view[0], y: view[1], width: view[2] - view[0], height: view[3] - view[1] });
      out.push({ page: p, rot: origRot + ref.rot });
      continue;
    }
    if (redact) warnings.push('Redactions were drawn as black boxes only; the text underneath was not removed');
    let page: PDFPage;
    if (srcDoc === base && !usedBase.has(ref.index)) { page = basePages[ref.index]; usedBase.add(ref.index); }
    else [page] = await base.copyPages(srcDoc, [ref.index]);
    out.push({ page, rot: origRot + ref.rot });
  }

  // 3. Rebuild a flat page tree in the new order; strip pages that are no longer part of the document.
  const removedLeaves = new Set<PDFDict>();
  basePages.forEach((p, i) => { if (!usedBase.has(i)) removedLeaves.add(p.node); });
  for (const { page } of out) {
    for (const k of INHERITABLE) {
      const n = PDFName.of(k);
      if (!page.node.get(n)) { const v = page.node.getInheritableAttribute(n); if (v) page.node.set(n, v); }
    }
  }
  const pagesRef = base.catalog.get(PDFName.of('Pages')) as PDFRef;
  const root = base.catalog.Pages();
  root.set(PDFName.of('Kids'), base.context.obj(out.map((o) => o.page.ref)));
  root.set(PDFName.of('Count'), PDFNumber.of(out.length));
  for (const k of INHERITABLE) root.delete(PDFName.of(k));
  for (const { page } of out) page.node.setParent(pagesRef);
  (base as unknown as { pageCache: { invalidate: () => void } }).pageCache.invalidate();
  for (const leaf of removedLeaves) {
    // Removed or rasterized pages: drop their content so nothing under a redaction survives in the file.
    for (const k of ['Contents', 'Resources', 'Annots', 'Thumb']) leaf.delete(PDFName.of(k));
  }
  pruneFields(base, removedLeaves);
  out.forEach(({ page, rot }) => page.setRotation(degrees(normRot(rot))));

  // 4. Draw edits.
  const font = await base.embedFont(StandardFonts.Helvetica);
  const bold = await base.embedFont(StandardFonts.HelveticaBold);
  const index = new Map(data.pages.map((p, i) => [p.id, i]));
  const sigCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (const e of data.edits) {
    const i = index.get(e.page);
    if (i === undefined || !out[i]) continue;
    await drawEdit(base, out[i].page, e, { font, bold, sigCache });
  }

  // 5. New form fields from the Form builder.
  addNewFields(base, data, out.map((o) => o.page), index, font, warnings);

  if (opts.stripMetadata) {
    base.context.trailerInfo.Info = undefined;
    base.catalog.delete(PDFName.of('Metadata'));
    base.catalog.delete(PDFName.of('PieceInfo'));
  }

  await base.flush();
  collectGarbage(base);
  let bytes: Uint8Array;
  try {
    bytes = await base.save({ useObjectStreams: true });
  } catch (err) {
    warnings.push('Some form field appearances could not be regenerated');
    bytes = await base.save({ useObjectStreams: true, updateFieldAppearances: false });
    void err;
  }
  return { bytes, warnings };
}

function fillForm(doc: PDFDocument, data: PaperData, warnings: string[]) {
  const names = Object.keys(data.formValues);
  if (!names.length && !data.flattenForm) return;
  const form = doc.getForm();
  for (const name of names) {
    const v = data.formValues[name];
    try {
      const f = form.getFieldMaybe(name);
      if (!f) continue;
      if (f instanceof PDFTextField) {
        // Multiline fields with auto size (0 Tf), or a size too big for the box (pdf-lib writes e.g. 69 Tf when it
        // creates them), would show one huge line. Use a normal reading size instead.
        if (f.isMultiline()) {
          const size = Number(/([\d.]+)\s+Tf/.exec(f.acroField.getDefaultAppearance() ?? '')?.[1] ?? 0);
          const h = f.acroField.getWidgets()[0]?.getRectangle().height ?? 0;
          if (!size || (h && size > h / 2)) {
            try { f.setFontSize(Math.max(6, Math.min(10, h / 2 || 10))); } catch { /* keep auto size */ }
          }
        }
        f.setText(String(v ?? ''));
      }
      else if (f instanceof PDFCheckBox) (v === true || v === 'true' || v === 'On' || v === 'Yes') ? f.check() : f.uncheck();
      else if (f instanceof PDFRadioGroup) selectRadio(form, f, v);
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList) { if (typeof v === 'string' && v) f.select(v); else f.clear(); }
    } catch (e) {
      warnings.push(`Field "${name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (data.flattenForm) {
    try { form.flatten(); } catch (e) { warnings.push(`Flatten failed: ${e instanceof Error ? e.message : String(e)}`); }
    // pdf-lib deletes the widgets of kid-style fields but leaves their refs in /Annots (dangling objects).
    dropDanglingAnnots(doc);
  }
}

/**
 * Select a radio option. pdf.js reports the widget's appearance state ("on" value, e.g. "1" or "Choice2"),
 * while pdf-lib's select() wants the /Opt export value when the field has one — accept either.
 */
export function selectRadio(form: PDFForm, f: PDFRadioGroup, v: string | boolean) {
  if (typeof v !== 'string' || !v || v === 'Off') { f.clear(); return; }
  if (f.getOptions().includes(v)) { f.select(v); return; }
  const on = f.acroField.getOnValues().find((n) => n.decodeText() === v);
  if (!on) throw new Error(`"${v}" isn't one of its options`);
  f.acroField.setValue(on);
  form.markFieldAsDirty(f.ref);
}

/** Remove /Annots entries that point at objects which no longer exist. */
export function dropDanglingAnnots(doc: PDFDocument) {
  for (const p of doc.getPages()) {
    const annots = p.node.Annots();
    if (!annots) continue;
    for (let i = annots.size() - 1; i >= 0; i--) {
      const a = annots.get(i);
      if (a instanceof PDFRef && !doc.context.lookup(a)) annots.remove(i);
    }
  }
}

/** Remove AcroForm fields whose widgets all live on removed pages. */
function pruneFields(doc: PDFDocument, removed: Set<PDFDict>) {
  if (!removed.size) return;
  const af = doc.catalog.lookupMaybe(PDFName.of('AcroForm'), PDFDict);
  const fields = af?.lookupMaybe(PDFName.of('Fields'), PDFArray);
  if (!fields) return;
  const onRemoved = (o: PDFObject | undefined): boolean => {
    const d = o instanceof PDFRef ? doc.context.lookup(o) : o;
    if (!(d instanceof PDFDict)) return false;
    const kids = d.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids && kids.size()) { for (let i = 0; i < kids.size(); i++) if (!onRemoved(kids.get(i))) return false; return true; }
    const p = d.get(PDFName.of('P'));
    const leaf = p instanceof PDFRef ? doc.context.lookup(p) : p;
    return leaf instanceof PDFDict && removed.has(leaf);
  };
  for (let i = fields.size() - 1; i >= 0; i--) if (onRemoved(fields.get(i))) fields.remove(i);
}

/** Delete indirect objects that are no longer reachable from the trailer (removed pages, replaced content). */
export function collectGarbage(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<PDFRef>();
  const t = ctx.trailerInfo;
  const stack: PDFObject[] = [t.Root, t.Info, t.Encrypt, t.ID].filter(Boolean) as PDFObject[];
  while (stack.length) {
    const o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o)) continue;
      seen.add(o);
      const v = ctx.lookup(o);
      if (v) stack.push(v);
    } else if (o instanceof PDFDict) {
      for (const [, v] of o.entries()) stack.push(v);
    } else if (o instanceof PDFArray) {
      for (let i = 0; i < o.size(); i++) stack.push(o.get(i));
    } else if (o instanceof PDFStream) {
      stack.push(o.dict);
    }
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref)) ctx.delete(ref);
}

interface DrawCtx { font: PDFFont; bold: PDFFont; sigCache: Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>> }

async function drawEdit(doc: PDFDocument, page: PDFPage, e: Edit, c: DrawCtx) {
  const rot = page.getRotation().angle;
  const vp = makeViewport(pageView(page), rot, 1);
  switch (e.kind) {
    case 'highlight': {
      const color = hexColor(e.color);
      for (const r of e.rects) {
        if (e.style === 'strike') {
          const v = vp.rectToView(r);
          const [ax, ay] = vp.toPdf(v.left, v.top + v.height / 2), [bx, by] = vp.toPdf(v.left + v.width, v.top + v.height / 2);
          page.drawLine({ start: { x: ax, y: ay }, end: { x: bx, y: by }, thickness: Math.max(0.8, Math.min(v.width, v.height) * 0.08), color });
        } else {
          page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color, opacity: 0.4, blendMode: BlendMode.Multiply });
        }
      }
      break;
    }
    case 'ink': {
      const color = hexColor(e.color);
      for (const s of e.strokes) {
        if (s.length === 2) { page.drawCircle({ x: s[0], y: s[1], size: e.width / 2, color }); continue; }
        for (let i = 2; i < s.length; i += 2) {
          page.drawLine({ start: { x: s[i - 2], y: s[i - 1] }, end: { x: s[i], y: s[i + 1] }, thickness: e.width, color, lineCap: LineCapStyle.Round });
        }
      }
      break;
    }
    case 'note': {
      const ctx = doc.context;
      const annot = ctx.obj({
        Type: 'Annot', Subtype: 'Text', Rect: [e.x, e.y - 20, e.x + 20, e.y], Name: 'Comment', F: 4 | 8 | 16,
        Contents: PDFHexString.fromText(e.text), T: PDFString.of('Tone'), C: colorArray(e.color), Open: false,
        M: PDFString.fromDate(new Date(e.created)),
      });
      page.node.addAnnot(ctx.register(annot));
      break;
    }
    case 'text': drawTextBox(page, vp, e.rect, e.text, e.size, hexColor(e.color), c.font, rot); break;
    case 'stamp': {
      const color = hexColor(e.color);
      page.drawRectangle({ x: e.rect.x, y: e.rect.y, width: e.rect.w, height: e.rect.h, borderColor: color, borderWidth: 2, opacity: 0, borderOpacity: 0.9 });
      const v = vp.rectToView(e.rect);
      const text = safeText(c.bold, e.text.toUpperCase());
      const size = Math.max(6, Math.min(v.height * 0.5, (v.width - 12) / Math.max(1, c.bold.widthOfTextAtSize(text, 1))));
      const tw = c.bold.widthOfTextAtSize(text, size);
      const [x, y] = vp.toPdf(v.left + (v.width - tw) / 2, v.top + v.height / 2 + size * 0.35);
      page.drawText(text, { x, y, size, font: c.bold, color, opacity: 0.9, rotate: degrees(rot) });
      break;
    }
    case 'whiteout': page.drawRectangle({ x: e.rect.x, y: e.rect.y, width: e.rect.w, height: e.rect.h, color: rgb(1, 1, 1) }); break;
    case 'redact': if (e.applied) page.drawRectangle({ x: e.rect.x, y: e.rect.y, width: e.rect.w, height: e.rect.h, color: rgb(0, 0, 0) }); break;
    case 'signature': {
      let img = c.sigCache.get(e.image);
      if (!img) { img = await doc.embedPng(dataUrlBytes(e.image)); c.sigCache.set(e.image, img); }
      const v = vp.rectToView(e.rect);
      const [x, y] = vp.toPdf(v.left, v.top + v.height);
      page.drawImage(img, { x, y, width: v.width, height: v.height, rotate: degrees(rot) });
      break;
    }
  }
}

function colorArray(hex: string) {
  const c = hexColor(hex);
  return [c.red, c.green, c.blue];
}

/** Word-wrap `text` to `maxW` at `size`. */
export function wrapLines(text: string, maxW: number, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const next = line + w;
      if (line && measure(next.trimEnd()) > maxW && w.trim()) { out.push(line.trimEnd()); line = w.trimStart(); }
      else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}

function drawTextBox(page: PDFPage, vp: ReturnType<typeof makeViewport>, rect: Rect, raw: string, size: number, color: RGB, font: PDFFont, rot: number) {
  const v = vp.rectToView(rect);
  const text = safeText(font, raw);
  const lines = wrapLines(text, Math.max(10, v.width - 4), (s) => font.widthOfTextAtSize(s, size));
  const lh = size * 1.25;
  lines.forEach((ln, i) => {
    const [x, y] = vp.toPdf(v.left + 2, v.top + 2 + size * 0.9 + i * lh);
    page.drawText(ln, { x, y, size, font, color, rotate: degrees(rot) });
  });
}

function addNewFields(doc: PDFDocument, data: PaperData, pages: PDFPage[], index: Map<string, number>, font: PDFFont, warnings: string[]) {
  if (!data.newFields.length) return;
  const form = doc.getForm();
  const taken = new Set(form.getFields().map((f) => f.getName()));
  const unique = (n: string) => {
    let name = n.replace(/\./g, '_').trim() || 'Field', k = 2;
    while (taken.has(name)) name = `${n} ${k++}`;
    taken.add(name);
    return name;
  };
  for (const f of data.newFields) {
    const i = index.get(f.page);
    if (i === undefined || !pages[i]) continue;
    const page = pages[i];
    const name = unique(f.name);
    const box = { x: f.rect.x, y: f.rect.y, width: f.rect.w, height: f.rect.h };
    try {
      if (f.type === 'checkbox') {
        const cb = form.createCheckBox(name);
        cb.addToPage(page, { ...box, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
        if (f.required) cb.enableRequired();
        if (data.formValues[f.name] === true) cb.check();
      } else if (f.type === 'signature') {
        // pdf-lib can't create signature fields, so write the /FT /Sig widget directly.
        const ctx = doc.context;
        const widget = ctx.obj({
          Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFString.of(name), F: 4,
          Rect: [box.x, box.y, box.x + box.width, box.y + box.height], P: page.ref,
          MK: { BC: [0.4, 0.4, 0.4] }, Ff: f.required ? 2 : 0,
        });
        const ref = ctx.register(widget);
        page.node.addAnnot(ref);
        form.acroForm.addField(ref);
      } else {
        const tf = form.createTextField(name);
        tf.addToPage(page, { ...box, font, borderColor: rgb(0.4, 0.4, 0.4), borderWidth: 1 });
        if (f.required) tf.enableRequired();
        if (f.type === 'number') tf.setAlignment(TextAlignment.Right);
        const v = data.formValues[f.name];
        if (typeof v === 'string' && v) tf.setText(v);
      }
    } catch (e) {
      warnings.push(`Field "${f.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
