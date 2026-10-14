// pdf.js integration: document cache, page geometry, canvas rendering, text, form fields, rasterizer.
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { buildPdf, type Rasterizer } from './apply';
import { LETTER, type PageRef, type PaperModel, type Rect, type SourceDoc } from './model';
import type { TextItemLite } from './text';
import { makeViewport, normRot, type ViewBox } from './viewport';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const docCache = new WeakMap<Uint8Array, Promise<PDFDocumentProxy>>();

/** Load (once) a pdf.js document for these bytes. pdf.js transfers its buffer, so it gets a copy. */
export function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  let p = docCache.get(bytes);
  if (!p) {
    const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, enableXfa: false });
    task.onPassword = () => { void task.destroy(); };
    p = task.promise.catch((e: unknown) => {
      docCache.delete(bytes);
      const name = (e as { name?: string })?.name;
      throw new Error(name === 'PasswordException' ? 'Password-protected PDFs are not supported yet' : `Couldn't read PDF: ${(e as Error)?.message ?? e}`);
    });
    docCache.set(bytes, p);
  }
  return p;
}

export async function pdfPageCount(bytes: Uint8Array) { return (await loadPdf(bytes)).numPages; }

async function pdfPage(model: PaperModel, ref: PageRef): Promise<PDFPageProxy | null> {
  const src = model.source(ref.src);
  if (!src) return null;
  const doc = await loadPdf(src.bytes);
  return doc.getPage(ref.index + 1);
}

export interface Geom { view: ViewBox; rotate: number }
const geomCache = new WeakMap<Uint8Array, Map<number, Geom>>();

/** Cached geometry, or null if not loaded yet. */
export function geomSync(model: PaperModel, ref: PageRef): Geom | null {
  if (!ref.src) { const s = ref.size ?? LETTER; return { view: [0, 0, s[0], s[1]], rotate: 0 }; }
  const src = model.source(ref.src);
  return src ? geomCache.get(src.bytes)?.get(ref.index) ?? null : null;
}

export async function geom(model: PaperModel, ref: PageRef): Promise<Geom> {
  const g = geomSync(model, ref);
  if (g) return g;
  const page = await pdfPage(model, ref);
  const src = model.source(ref.src)!;
  const v = page!.view as number[];
  const out: Geom = { view: [v[0], v[1], v[2], v[3]], rotate: page!.rotate };
  let m = geomCache.get(src.bytes);
  if (!m) { m = new Map(); geomCache.set(src.bytes, m); }
  m.set(ref.index, out);
  return out;
}

/** Total rotation shown for a page (own /Rotate + Paper rotation). */
export const shownRotation = (g: Geom, ref: PageRef) => normRot(g.rotate + ref.rot);

/** Scale so the page is `width` px wide at zoom 1. */
export function fitScale(g: Geom, ref: PageRef, width: number) {
  return width / makeViewport(g.view, shownRotation(g, ref), 1).width;
}

export interface RenderJob { promise: Promise<void>; cancel: () => void }

/** Render a page (no edits) into `canvas` at `scale` CSS px per point, honoring devicePixelRatio. */
export function renderPage(canvas: HTMLCanvasElement, model: PaperModel, ref: PageRef, scale: number, dpr = window.devicePixelRatio || 1): RenderJob {
  let cancelled = false;
  let task: { cancel: () => void } | null = null;
  const promise = (async () => {
    const g = await geom(model, ref);
    const vp = makeViewport(g.view, shownRotation(g, ref), scale);
    const w = Math.max(1, Math.floor(vp.width * dpr)), h = Math.max(1, Math.floor(vp.height * dpr));
    if (cancelled) return;
    const page = await pdfPage(model, ref);
    if (cancelled) return;
    // Render offscreen, then swap — avoids a white flash while zooming.
    const off = document.createElement('canvas');
    off.width = w; off.height = h;
    const ctx = off.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (page) {
      const viewport = page.getViewport({ scale: scale * dpr, rotation: shownRotation(g, ref) });
      const t = page.render({ canvas: off, canvasContext: ctx, viewport });
      task = t;
      try { await t.promise; } catch (e) { if ((e as { name?: string })?.name === 'RenderingCancelledException') return; throw e; }
    }
    if (cancelled) return;
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d')!.drawImage(off, 0, 0);
  })();
  return { promise, cancel: () => { cancelled = true; task?.cancel(); } };
}

/** Text content of one page (null for blank pages). */
export async function pageText(model: PaperModel, ref: PageRef): Promise<{ items: TextItemLite[]; raw: unknown } | null> {
  const page = await pdfPage(model, ref);
  if (!page) return null;
  const tc = await page.getTextContent();
  const items = (tc.items as unknown[]).filter((i): i is TextItemLite => typeof (i as TextItemLite).str === 'string');
  return { items, raw: tc };
}

/** The pdf.js page proxy (for the text layer). */
export const pageProxy = pdfPage;

export interface FieldInfo {
  name: string;
  type: 'text' | 'checkbox' | 'radiobutton' | 'combobox' | 'listbox' | 'signature' | 'button' | string;
  page: number;
  rect: Rect;
  value: string | boolean;
  exportValue?: string;
  options?: string[];
  multiline?: boolean;
  readOnly?: boolean;
}

const fieldCache = new WeakMap<Uint8Array, Promise<FieldInfo[]>>();

/** AcroForm widgets of the original document (sources[0]). */
export function formFields(model: PaperModel): Promise<FieldInfo[]> {
  const src = model.sources[0];
  if (!src) return Promise.resolve([]);
  let p = fieldCache.get(src.bytes);
  if (!p) {
    p = (async () => {
      const doc = await loadPdf(src.bytes);
      const objs = (await doc.getFieldObjects()) as Record<string, Record<string, unknown>[]> | null;
      if (!objs) return [];
      const out: FieldInfo[] = [];
      for (const [name, widgets] of Object.entries(objs)) {
        for (const w of widgets) {
          const r = w.rect as number[] | undefined;
          const type = String(w.type ?? '');
          if (!r || typeof w.page !== 'number' || w.page < 0 || type === 'button' || w.hidden) continue;
          const items = (w.items as { exportValue?: string; displayValue?: string }[] | undefined)?.map((i) => String(i.exportValue ?? i.displayValue ?? ''));
          out.push({
            name, type, page: w.page as number,
            rect: { x: Math.min(r[0], r[2]), y: Math.min(r[1], r[3]), w: Math.abs(r[2] - r[0]), h: Math.abs(r[3] - r[1]) },
            value: (w.value as string | boolean) ?? '', exportValue: w.exportValues as string | undefined,
            options: items, multiline: !!w.multiline, readOnly: !w.editable && w.editable !== undefined,
          });
        }
      }
      return out;
    })().catch(() => []);
    fieldCache.set(src.bytes, p);
  }
  return p;
}

/** True redaction helper: rasterize a source page at 150 dpi with black boxes burnt in. */
export const rasterizeForRedaction: Rasterizer = async (src: SourceDoc, index: number, boxes: Rect[]) => {
  const doc = await loadPdf(src.bytes);
  const page = await doc.getPage(index + 1);
  const scale = 150 / 72;
  const viewport = page.getViewport({ scale, rotation: 0 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  const v = page.view as number[];
  const view: ViewBox = [v[0], v[1], v[2], v[3]];
  const vp = makeViewport(view, 0, scale);
  ctx.fillStyle = '#000';
  for (const b of boxes) {
    const r = vp.rectToView(b);
    ctx.fillRect(Math.floor(r.left) - 1, Math.floor(r.top) - 1, Math.ceil(r.width) + 2, Math.ceil(r.height) + 2);
  }
  return { png: await canvasPng(canvas), view };
};

export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not encode PNG');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Apply all edits → PDF bytes (browser: with true redaction). */
export function applyModel(model: PaperModel, opts: { stripMetadata?: boolean } = {}) {
  return buildPdf(model.data(), { rasterize: rasterizeForRedaction, ...opts });
}

/** Render page `i` of arbitrary PDF bytes to a canvas at `scale`. */
export async function renderBytesPage(bytes: Uint8Array, i: number, scale: number): Promise<HTMLCanvasElement> {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(i + 1);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas;
  } finally { void task.destroy(); }
}

/** Text items of every page of arbitrary PDF bytes. */
export async function bytesText(bytes: Uint8Array): Promise<TextItemLite[][]> {
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const out: TextItemLite[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const tc = await (await doc.getPage(i)).getTextContent();
      out.push((tc.items as unknown[]).filter((x): x is TextItemLite => typeof (x as TextItemLite).str === 'string'));
    }
    return out;
  } finally { void task.destroy(); }
}

export { pdfjs };
