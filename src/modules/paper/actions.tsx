// Paper actions shared by menu commands, toolbar and inspector.
import type { ModuleApi } from '@/core/types';
import { BASE_W } from './context';
import { createBlankPdf, countPages } from './apply';
import { PaperModel, TOOLS, newId, type SubTool, type Tool } from './model';
import { blankPage, deletePages, insertAt, nextSourceId, rotatePages, sourcePages, subsetData } from './pageops';
import { applyModel, canvasPng, fitScale, geom, geomSync, pageText, renderBytesPage, bytesText } from './render';
import { findInItems, itemsToParagraphs, paragraphsToHtml } from './text';
import { makeViewport } from './viewport';
import { OrganizeDialog } from './dialogs/OrganizeDialog';
import { SplitDialog } from './dialogs/SplitDialog';
import { SignatureDialog } from './dialogs/SignatureDialog';
import { FormBuilderDialog } from './dialogs/FormBuilderDialog';
import { OcrDialog } from './dialogs/OcrDialog';
import { GoToDialog } from './dialogs/GoToDialog';

export const stem = (name: string) => name.replace(/\.(pdf|tone)$/i, '');

/** Default sub-tool when a tool is picked. */
export const TOOL_DEFAULT: Record<Tool, SubTool> = {
  Annotate: 'pen', Highlight: 'hl-text', Sign: 'place-sign', 'Fill form': 'none', Redact: 'redact', Edit: 'text', Organize: 'none', Convert: 'none',
};

/** Work-area size reported by the editor (for fit zoom). */
export const viewSize = new WeakMap<PaperModel, { w: number; h: number }>();

export class PaperActions {
  constructor(private model: PaperModel, readonly api: ModuleApi) {}
  private get m() { return this.model; }

  commit = (fn: (m: PaperModel) => void, coalesce?: string) => { this.m.mutate(fn, coalesce); this.api.markDirty(); };

  setTool = (tool: Tool, sub?: SubTool) => {
    this.m.setUi({ tool, sub: sub ?? TOOL_DEFAULT[tool], selected: null });
    if (tool === 'Sign' && (sub ?? 'place-sign') === 'place-sign' && !this.m.ui.signature) this.signature();
    if (tool === 'Organize' && !sub) this.organize();
  };
  cycleTool = () => { const i = TOOLS.indexOf(this.m.ui.tool); this.setTool(TOOLS[(i + 1) % TOOLS.length]); };

  undo = () => { if (this.m.undo()) this.api.markDirty(); };
  redo = () => { if (this.m.redo()) this.api.markDirty(); };

  // ---- navigation & view ----
  goTo = (i: number) => {
    const n = this.m.pages.length;
    if (!n) return;
    this.m.setUi({ page: Math.max(0, Math.min(n - 1, i)), scrollReq: this.m.ui.scrollReq + 1 });
  };
  zoomTo = (z: number) => this.m.setUi({ zoom: Math.max(0.25, Math.min(5, Math.round(z * 100) / 100)) });
  zoomIn = () => this.zoomTo(this.m.ui.zoom * 1.2);
  zoomOut = () => this.zoomTo(this.m.ui.zoom / 1.2);
  fitWidth = () => { const s = viewSize.get(this.m); if (s) this.zoomTo((s.w - 64) / BASE_W); };
  fitPage = () => {
    const s = viewSize.get(this.m);
    const ref = this.m.pages[this.m.ui.page];
    if (!s || !ref) return;
    const g = geomSync(this.m, ref);
    if (!g) return;
    const vp = makeViewport(g.view, (g.rotate + ref.rot) % 360, fitScale(g, ref, BASE_W));
    this.zoomTo(Math.min((s.w - 64) / vp.width, (s.h - 64) / vp.height));
  };
  goToDialog = () => this.api.openDialog((close) => <GoToDialog model={this.m} onGo={(i) => { this.goTo(i); close(); }} onClose={close} />);

  // ---- search ----
  openFind = () => this.m.setUi({ search: { ...this.m.ui.search, open: true } });
  closeFind = () => this.m.setUi({ search: { open: false, query: '', hits: [], index: 0, busy: false } });
  private searchSeq = 0;
  search = async (query: string) => {
    const seq = ++this.searchSeq;
    this.m.setUi({ search: { ...this.m.ui.search, open: true, query, hits: [], index: 0, busy: !!query.trim() } });
    if (!query.trim()) return;
    const hits: { page: string; rects: import('./model').Rect[] }[] = [];
    for (let i = 0; i < this.m.pages.length; i++) {
      const ref = this.m.pages[i];
      const t = await pageText(this.m, ref).catch(() => null);
      if (seq !== this.searchSeq) return;
      if (t) for (const rects of findInItems(t.items, query, t.measure)) hits.push({ page: ref.id, rects });
      if (i % 10 === 9) this.m.setUi({ search: { ...this.m.ui.search, hits: [...hits] } });
    }
    const first = hits.findIndex((h) => this.m.pageIndex(h.page) >= this.m.ui.page);
    this.m.setUi({ search: { ...this.m.ui.search, hits, busy: false, index: Math.max(0, first) } });
    if (hits.length) this.goTo(this.m.pageIndex(hits[Math.max(0, first)].page));
  };
  findStep = (d: number) => {
    const s = this.m.ui.search;
    if (!s.open) { this.openFind(); return; }
    if (!s.hits.length) return;
    const index = (s.index + d + s.hits.length) % s.hits.length;
    this.m.setUi({ search: { ...s, index } });
    this.goTo(this.m.pageIndex(s.hits[index].page));
  };
  redactHits = () => {
    const hits = this.m.ui.search.hits;
    if (!hits.length) return;
    const now = Date.now();
    this.commit((m) => {
      m.edits = [...m.edits, ...hits.flatMap((h) => h.rects.map((r) => ({ id: newId(), page: h.page, created: now, kind: 'redact' as const, rect: { x: r.x - Math.max(1, r.h * 0.15), y: r.y - 1, w: r.w + 2 * Math.max(1, r.h * 0.15), h: r.h + 2 }, applied: false })))];
    });
    this.api.toast(`Marked ${hits.length} match${hits.length > 1 ? 'es' : ''} for redaction — review, then Apply redactions`);
  };

  // ---- edits ----
  deleteSelected = () => {
    const id = this.m.ui.selected;
    if (!id) return;
    this.commit((m) => { m.edits = m.edits.filter((e) => e.id !== id); });
    this.m.setUi({ selected: null });
  };
  deleteEdit = (id: string) => this.commit((m) => { m.edits = m.edits.filter((e) => e.id !== id); });
  clearAnnotations = () => {
    const n = this.m.edits.filter((e) => e.kind !== 'redact' || !e.applied).length;
    if (!n) { this.api.toast('No annotations to remove'); return; }
    this.commit((m) => { m.edits = m.edits.filter((e) => e.kind === 'redact' && e.applied); });
    this.api.toast(`Removed ${n} annotation${n > 1 ? 's' : ''} (Undo to restore)`);
  };
  applyRedactions = () => {
    const n = this.m.edits.filter((e) => e.kind === 'redact' && !e.applied).length;
    if (!n) { this.api.toast('No marked redactions — drag on the page with Redact to mark areas'); return; }
    this.commit((m) => { m.edits = m.edits.map((e) => (e.kind === 'redact' ? { ...e, applied: true } : e)); });
    this.api.toast(`${n} redaction${n > 1 ? 's' : ''} applied. On save, affected pages are flattened to images so the text underneath is removed.`);
  };
  toggleFlatten = () => {
    this.commit((m) => { m.flattenForm = !m.flattenForm; });
    this.api.toast(this.m.flattenForm ? 'Form will be flattened on save (fields become plain content)' : 'Form fields stay editable on save');
  };

  // ---- pages ----
  private current() { return this.m.pages[this.m.ui.page]; }
  rotate = (delta: number) => {
    const p = this.current();
    if (p) this.commit((m) => { m.pages = rotatePages(m.pages, [p.id], delta); });
  };
  deletePage = () => {
    const p = this.current();
    if (!p) return;
    if (this.m.pages.length < 2) { this.api.toast("A PDF needs at least one page", 'error'); return; }
    this.commit((m) => Object.assign(m, deletePages(m, [p.id])));
  };
  insertBlank = () => {
    const p = this.current();
    const g = p ? geomSync(this.m, p) : null;
    const size: [number, number] | undefined = g ? [g.view[2] - g.view[0], g.view[3] - g.view[1]] : undefined;
    const at = this.m.ui.page + 1;
    this.commit((m) => { m.pages = insertAt(m.pages, at, [blankPage(size)]); });
    this.goTo(at);
  };
  movePage = (d: number) => {
    const i = this.m.ui.page, j = i + d;
    if (j < 0 || j >= this.m.pages.length) return;
    this.commit((m) => { const ps = [...m.pages]; [ps[i], ps[j]] = [ps[j], ps[i]]; m.pages = ps; });
    this.goTo(j);
  };

  /** Pick PDFs and insert their pages at `at` (default: end = merge). */
  insertFiles = async (at?: number) => {
    const files = await this.api.pickFile(['pdf'], true);
    if (!files.length) return 0;
    let added = 0;
    const where = at ?? this.m.pages.length;
    const srcs: { id: string; name: string; bytes: Uint8Array; count: number }[] = [];
    for (const f of files) {
      try {
        const count = await countPages(f.bytes);
        srcs.push({ id: '', name: f.name, bytes: f.bytes, count });
      } catch (e) { this.api.toast(`${f.name}: ${(e as Error).message}`, 'error'); }
    }
    if (!srcs.length) return 0;
    this.commit((m) => {
      let pos = where;
      for (const s of srcs) {
        const src = { id: nextSourceId(m.sources), name: s.name, bytes: s.bytes };
        m.sources = [...m.sources, src];
        const pages = sourcePages(src, s.count);
        m.pages = insertAt(m.pages, pos, pages);
        pos += pages.length; added += pages.length;
      }
    });
    this.api.toast(`Added ${added} page${added === 1 ? '' : 's'} from ${srcs.map((s) => s.name).join(', ')}`);
    return added;
  };
  merge = () => this.insertFiles();
  insertFromFile = () => this.insertFiles(this.m.ui.page + 1);

  organize = () => this.api.openDialog((close) => <OrganizeDialog model={this.m} actions={this} onClose={close} />);
  split = (mode: 'split' | 'extract' = 'split') => this.api.openDialog((close) => <SplitDialog model={this.m} mode={mode} actions={this} onClose={close} />);
  /** Open the pages at `groups` as new Paper tabs. */
  openParts = (groups: number[][], label = 'part', pages = this.m.pages) => {
    const base = stem(this.m.fileName);
    groups.forEach((g, i) => {
      if (!g.length) return;
      const data = subsetData({ ...this.m.data(), pages }, g);
      const name = groups.length > 1 ? `${base}-${label}${i + 1}.pdf` : `${base}-${label}.pdf`;
      const model = new PaperModel(name, data);
      this.api.openNewDoc('paper', model, name, undefined, 'pdf');
    });
  };

  // ---- sign / form / ocr ----
  signature = () => this.api.openDialog((close) => <SignatureDialog onClose={close} pickFile={this.api.pickFile} onUse={(sig) => {
    this.m.setUi({ signature: sig, tool: 'Sign', sub: 'place-sign' });
    close();
    this.api.toast('Click on the page or a signature field to place your signature');
  }} />);
  formBuilder = () => this.api.openDialog((close) => <FormBuilderDialog model={this.m} actions={this} onClose={close} />);
  ocr = () => this.api.openDialog((close) => <OcrDialog model={this.m} actions={this} onClose={close} />);

  // ---- output ----
  applied = async (opts: { stripMetadata?: boolean } = {}) => {
    const res = await applyModel(this.m, opts);
    for (const w of [...new Set(res.warnings)].slice(0, 2)) this.api.toast(w);
    return res.bytes;
  };
  compress = async () => {
    const before = this.m.sources.reduce((a, s) => a + s.bytes.length, 0);
    const bytes = await this.applied();
    const ok = await this.api.saveBytes(bytes, `${stem(this.m.fileName)}-compressed.pdf`, ['pdf']);
    if (ok) this.api.toast(`Saved ${fmtBytes(bytes.length)} (source ${fmtBytes(before)}). Rebuilt with object streams and unused objects removed; images are not re-encoded.`);
  };
  sanitize = async () => {
    const bytes = await this.applied({ stripMetadata: true });
    await this.api.saveBytes(bytes, `${stem(this.m.fileName)}-clean.pdf`, ['pdf']);
  };
  pagePng = async (scale = 2) => {
    const bytes = await this.applied();
    const canvas = await renderBytesPage(bytes, this.m.ui.page, scale);
    return canvasPng(canvas);
  };
  exportPng = async () => {
    const png = await this.pagePng();
    await this.api.saveBytes(png, `${stem(this.m.fileName)}-p${this.m.ui.page + 1}.png`, ['png']);
  };
  writeHtml = async () => {
    const bytes = await this.applied();
    const pages = await bytesText(bytes);
    return new TextEncoder().encode(paragraphsToHtml(stem(this.m.fileName), pages.map(itemsToParagraphs)));
  };
  toWrite = async () => {
    const html = await this.writeHtml();
    await this.api.openBytesAsDoc(html, `${stem(this.m.fileName)}.html`);
  };
  createBlankDoc = async () => {
    const model = await blankModel();
    this.api.openNewDoc('paper', model, 'Untitled', undefined, 'pdf');
  };
}

export async function blankModel(): Promise<PaperModel> {
  const bytes = await createBlankPdf();
  return PaperModel.fromPdf(bytes, 'Untitled.pdf', 1);
}

export function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Warm geometry for every page in the background (stable layout for long documents). */
export async function preloadGeometry(model: PaperModel, onProgress: () => void) {
  let n = 0;
  for (const p of model.pages) {
    if (geomSync(model, p)) continue;
    try { await geom(model, p); } catch { /* ignore */ }
    if (++n % 25 === 0) onProgress();
  }
  if (n) onProgress();
}
