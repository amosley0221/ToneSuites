// Tone Paper — PDF module (annotate, sign, fill, redact, organize, convert).
import type { CommandHandler, ModuleApi, ModuleDef } from '@/core/types';
import { useApp } from '@/core/store';
import { PaperActions, blankModel } from './actions';
import { BlankDialog } from './dialogs/BlankDialog';
import { PaperEditor } from './Editor';
import { paperExports } from './exporters';
import { paperMenus } from './menus';
import { PaperModel } from './model';
import { applyModel, pdfPageCount } from './render';
import { deserializeModel, serializeModel } from './serialize';

/** New Paper doc: ask to open a PDF (opened by the core so Save writes back to the .pdf) or start a blank PDF. */
function createBlank(): Promise<{ model: PaperModel; title: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { model: PaperModel; title: string } | null) => { if (!settled) { settled = true; resolve(v); } };
    useApp.getState().pushDialog((close) => (
      <BlankDialog
        onClose={() => { close(); finish(null); }}
        onBlank={() => { close(); void blankModel().then((model) => finish({ model, title: 'Untitled' })); }}
        onOpen={() => {
          close(); finish(null);
          void (async () => {
            const [docs, platform] = await Promise.all([import('@/core/documents'), import('@/core/platform')]);
            if (platform.isTauri) {
              for (const p of await platform.pickOpenPaths(['pdf'], true)) await docs.openPath(p);
            } else {
              for (const f of await platform.browserPickFiles(['pdf'], true)) {
                await docs.openBytes(f.bytes, f.name, null).catch((e: Error) => useApp.getState().toast(e.message, 'error'));
              }
            }
          })();
        }}
      />
    ));
  });
}

const actionsCache = new WeakMap<PaperModel, PaperActions>();

function commands(getModel: () => PaperModel | undefined, api: ModuleApi): Record<string, CommandHandler> {
  const A = (): PaperActions | null => {
    const m = getModel();
    if (!m) return null;
    let a = actionsCache.get(m);
    if (!a) { a = new PaperActions(m, api); actionsCache.set(m, a); }
    return a;
  };
  const c = (fn: (a: PaperActions) => unknown): CommandHandler => async () => { const a = A(); if (a) await fn(a); };
  return {
    'paper.file.createBlank': c((a) => a.createBlankDoc()),
    'paper.file.merge': c((a) => a.merge()),
    'paper.file.insertFromFile': c((a) => a.insertFromFile()),
    'paper.file.split': c((a) => a.split('split')),
    'paper.file.extract': c((a) => a.split('extract')),
    'paper.file.compress': c((a) => a.compress()),
    'paper.file.exportPng': c((a) => a.exportPng()),
    'paper.file.toWrite': c((a) => a.toWrite()),

    'paper.edit.undo': c((a) => a.undo()),
    'paper.edit.redo': c((a) => a.redo()),
    'paper.edit.find': c((a) => a.openFind()),
    'paper.edit.findNext': c((a) => a.findStep(1)),
    'paper.edit.findPrev': c((a) => a.findStep(-1)),
    'paper.edit.addText': c((a) => a.setTool('Edit', 'text')),
    'paper.edit.whiteout': c((a) => a.setTool('Edit', 'whiteout')),
    'paper.edit.deleteSelected': c((a) => a.deleteSelected()),
    'paper.edit.clearAnnotations': c((a) => a.clearAnnotations()),

    'paper.view.zoomIn': c((a) => a.zoomIn()),
    'paper.view.zoomOut': c((a) => a.zoomOut()),
    'paper.view.actualSize': c((a) => a.zoomTo(1)),
    'paper.view.fitWidth': c((a) => a.fitWidth()),
    'paper.view.fitPage': c((a) => a.fitPage()),
    'paper.view.thumbnails': () => { const m = getModel(); if (m) m.setUi({ thumbs: !m.ui.thumbs }); },
    'paper.view.firstPage': c((a) => a.goTo(0)),
    'paper.view.prevPage': () => { const m = getModel(); if (m) A()!.goTo(m.ui.page - 1); },
    'paper.view.nextPage': () => { const m = getModel(); if (m) A()!.goTo(m.ui.page + 1); },
    'paper.view.lastPage': () => { const m = getModel(); if (m) A()!.goTo(m.pages.length - 1); },
    'paper.view.goTo': c((a) => a.goToDialog()),

    'paper.page.rotateCw': c((a) => a.rotate(90)),
    'paper.page.rotateCcw': c((a) => a.rotate(-90)),
    'paper.page.delete': c((a) => a.deletePage()),
    'paper.page.insertBlank': c((a) => a.insertBlank()),
    'paper.page.moveUp': c((a) => a.movePage(-1)),
    'paper.page.moveDown': c((a) => a.movePage(1)),
    'paper.page.organize': c((a) => a.organize()),
    'paper.page.insertFromFile': c((a) => a.insertFromFile()),
    'paper.page.extract': c((a) => a.split('extract')),
    'paper.page.split': c((a) => a.split('split')),

    'paper.tool.pen': c((a) => a.setTool('Annotate', 'pen')),
    'paper.tool.note': c((a) => a.setTool('Annotate', 'note')),
    'paper.tool.stamp': c((a) => a.setTool('Annotate', 'stamp')),
    'paper.tool.hlText': c((a) => a.setTool('Highlight', 'hl-text')),
    'paper.tool.hlArea': c((a) => a.setTool('Highlight', 'hl-area')),
    'paper.tool.strike': c((a) => a.setTool('Highlight', 'strike')),
    'paper.tool.drawSignature': c((a) => a.signature()),
    'paper.tool.placeSignature': c((a) => a.setTool('Sign', 'place-sign')),
    'paper.tool.fillForm': c((a) => a.setTool('Fill form')),
    'paper.tool.formBuilder': c((a) => a.formBuilder()),
    'paper.tool.flatten': c((a) => a.toggleFlatten()),
    'paper.tool.markRedaction': c((a) => a.setTool('Redact', 'redact')),
    'paper.tool.searchRedact': c((a) => { a.setTool('Redact', 'redact'); a.openFind(); }),
    'paper.tool.applyRedactions': c((a) => a.applyRedactions()),
    'paper.tool.convert': () => api.runCommand('file.export'),

    'paper.protect.redact': c((a) => a.setTool('Redact', 'redact')),
    'paper.protect.applyRedactions': c((a) => a.applyRedactions()),
    'paper.protect.sanitize': c((a) => a.sanitize()),
  };
}

const paper: ModuleDef<PaperModel> = {
  id: 'paper',
  mark: 'Pp',
  name: 'Paper',
  description: 'PDF annotate, sign, OCR, merge',
  opens: ['pdf'],
  createBlank,
  openFile: async (bytes, filename) => {
    const n = await pdfPageCount(bytes);
    return PaperModel.fromPdf(bytes, filename, n);
  },
  serialize: async (m) => serializeModel(m),
  deserialize: async (files, v) => deserializeModel(files, v),
  saveForeign: async (m, format) => {
    if (format !== 'pdf') return null;
    const res = await applyModel(m);
    for (const w of [...new Set(res.warnings)].slice(0, 2)) useApp.getState().toast(w);
    return res.bytes;
  },
  exports: paperExports,
  menus: paperMenus,
  commands,
  Editor: PaperEditor,
  statusHint: (m) => `${m.fileName} · Page ${Math.min(m.ui.page + 1, m.pages.length)} of ${m.pages.length} · ${m.ui.tool}`,
};

export default paper;
