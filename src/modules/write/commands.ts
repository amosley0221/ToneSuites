// Command handlers for every Write menu id.
import { createElement } from 'react';
import { selectAll } from 'prosemirror-commands';
import { liftListItem, sinkListItem } from 'prosemirror-schema-list';
import {
  addColumnAfter, addColumnBefore, addRowAfter, addRowBefore, deleteColumn, deleteRow, deleteTable, mergeCells, splitCell, toggleHeaderRow,
} from 'prosemirror-tables';
import { useSettings } from '@/core/settings';
import type { CommandHandler, ModuleApi } from '@/core/types';
import * as A from './actions';
import { CommentDialog, LinkDialog, WordCountDialog } from './dialogs';
import type { WriteModel } from './model';
import { schema } from './schema';
import { listChanges } from './track';
import { dataUrlFor, imageSize } from './util';

const ZOOMS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2];

/** True when focus is in a text field outside the editor (then edit commands act natively). */
function foreignField(m: WriteModel): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || (m.view && m.view.dom.contains(a))) return false;
  return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable;
}

export function writeCommands(getModel: () => WriteModel | undefined, api: ModuleApi): Record<string, CommandHandler> {
  const w = (fn: (m: WriteModel) => void | Promise<void>, dirty = true): CommandHandler => async () => {
    const m = getModel();
    if (!m) return;
    m.author = authorName();
    await fn(m);
    if (dirty) api.markDirty();
  };
  const ui = (fn: (m: WriteModel) => void): CommandHandler => w(fn, false);
  const pm = (cmd: Parameters<WriteModel['exec']>[0], label?: string): CommandHandler => w((m) => {
    if (!m.exec(cmd) && label) api.toast(label);
  });
  const native = (cmd: string, fallback: (m: WriteModel) => void): CommandHandler => ui((m) => {
    if (foreignField(m)) { document.execCommand(cmd); return; }
    m.view?.focus();
    fallback(m);
  });

  const zoomStep = (m: WriteModel, dir: 1 | -1) => {
    const cur = m.ui.zoom || m.fitZoom || 1; // 0 = fit page width
    const next = dir > 0
      ? ZOOMS.find((z) => z > cur + 0.001) ?? ZOOMS[ZOOMS.length - 1]
      : [...ZOOMS].reverse().find((z) => z < cur - 0.001) ?? ZOOMS[0];
    m.setUI({ zoom: next });
  };

  const insertImage = w(async (m) => {
    const [file] = await api.pickFile(['png', 'jpg', 'jpeg', 'gif', 'webp']);
    if (!file) return;
    const src = dataUrlFor(file.bytes, file.name);
    const size = imageSize(file.bytes) ?? (await measureImage(src));
    let width = size?.w ?? null;
    let height = size?.h ?? null;
    const maxW = 624;
    if (width && height && width > maxW) { height = Math.round((height * maxW) / width); width = maxW; }
    A.insertImage(m, src, width, height, file.name.replace(/\.[^.]+$/, ''));
  });

  const comment = ui((m) => {
    if (m.state.selection.empty) { api.toast('Select the text you want to comment on first'); return; }
    api.openDialog((close) => createElement(CommentDialog, { onClose: close, onSave: (t: string) => { if (A.addComment(m, t)) api.markDirty(); close(); } }));
  });

  const wordCount = ui((m) => api.openDialog((close) => createElement(WordCountDialog, { model: m, onClose: close })));

  const table = (cmd: Parameters<WriteModel['exec']>[0]) => pm(cmd, 'Place the cursor in a table first');

  return {
    'write.file.pageSetup': ui((m) => m.setUI({ dialog: { kind: 'pageSetup' } })),

    'write.edit.undo': native('undo', (m) => m.exec(A.undoCmd)),
    'write.edit.redo': native('redo', (m) => m.exec(A.redoCmd)),
    'write.edit.cut': native('cut', () => document.execCommand('cut')),
    'write.edit.copy': native('copy', () => document.execCommand('copy')),
    'write.edit.paste': ui(async (m) => {
      if (foreignField(m)) { document.execCommand('paste'); return; }
      try { A.insertText(m, await navigator.clipboard.readText()); api.markDirty(); } catch { api.toast('Use Ctrl V to paste — clipboard access was blocked', 'error'); }
    }),
    'write.edit.pastePlain': ui(async (m) => {
      try { A.insertText(m, await navigator.clipboard.readText()); api.markDirty(); } catch { api.toast('Clipboard access was blocked', 'error'); }
    }),
    'write.edit.selectAll': ui((m) => {
      if (foreignField(m)) { (document.activeElement as HTMLInputElement).select?.(); return; }
      m.exec(selectAll);
    }),
    'write.edit.find': ui((m) => m.setUI({ find: 'find' })),
    'write.edit.replace': ui((m) => m.setUI({ find: 'replace' })),

    'write.view.zoomIn': ui((m) => zoomStep(m, 1)),
    'write.view.zoomOut': ui((m) => zoomStep(m, -1)),
    'write.view.zoom100': ui((m) => m.setUI({ zoom: 1 })),
    'write.view.zoomFit': ui((m) => m.setUI({ zoom: 0 })),
    'write.view.review': ui((m) => m.setUI({ review: !m.ui.review, focus: false })),
    'write.view.outline': ui((m) => m.setUI({ outline: !m.ui.outline, focus: false })),
    'write.view.focus': ui((m) => m.setUI({ focus: !m.ui.focus })),
    'write.view.markup.all': ui((m) => m.setUI({ markup: 'all' })),
    'write.view.markup.none': ui((m) => m.setUI({ markup: 'none' })),
    'write.view.markup.original': ui((m) => m.setUI({ markup: 'original' })),

    'write.insert.image': insertImage,
    'write.insert.table': w((m) => A.insertTable(m)),
    'write.insert.link': ui((m) => {
      const cur = A.linkAtSelection(m.state);
      api.openDialog((close) => createElement(LinkDialog, {
        initial: cur ?? '', hasSelection: !m.state.selection.empty, onClose: close,
        onSave: (href: string, text: string) => { A.setLink(m, href, text); api.markDirty(); close(); },
      }));
    }),
    'write.insert.footnote': ui((m) => m.setUI({ dialog: { kind: 'footnote' } })),
    'write.insert.toc': ui((m) => m.setUI({ dialog: { kind: 'toc', pos: A.findToc(m.state) ?? undefined } })),
    'write.insert.updateToc': w((m) => { if (!A.refreshTocs(m, true)) api.toast(A.findToc(m.state) == null ? 'No table of contents in this document' : 'Table of contents is up to date'); }),
    'write.insert.pageBreak': w((m) => A.insertPageBreak(m)),
    'write.insert.rule': w((m) => A.insertRule(m)),
    'write.insert.comment': comment,
    'write.insert.date': w((m) => A.insertDate(m)),

    'write.format.style.body': w((m) => A.setStyle(m, 'body')),
    'write.format.style.title': w((m) => A.setStyle(m, 'title')),
    'write.format.style.h1': w((m) => A.setStyle(m, 'h1')),
    'write.format.style.h2': w((m) => A.setStyle(m, 'h2')),
    'write.format.style.h3': w((m) => A.setStyle(m, 'h3')),
    'write.format.style.quote': w((m) => A.setStyle(m, 'quote')),
    'write.format.style.code': w((m) => A.setStyle(m, 'code')),
    'write.format.bold': w((m) => { A.toggle(m, 'strong'); }),
    'write.format.italic': w((m) => { A.toggle(m, 'em'); }),
    'write.format.underline': w((m) => { A.toggle(m, 'underline'); }),
    'write.format.strike': w((m) => { A.toggle(m, 'strike'); }),
    'write.format.code': w((m) => { A.toggle(m, 'code'); }),
    'write.format.highlight': w((m) => {
      const { from, to, empty } = m.state.selection;
      if (empty) { api.toast('Select text to highlight'); return; }
      const has = m.state.doc.rangeHasMark(from, to, schema.marks.highlight);
      m.apply(has ? m.state.tr.removeMark(from, to, schema.marks.highlight) : m.state.tr.addMark(from, to, schema.marks.highlight.create()));
    }),
    'write.format.align.left': w((m) => A.setAlign(m, 'left')),
    'write.format.align.center': w((m) => A.setAlign(m, 'center')),
    'write.format.align.right': w((m) => A.setAlign(m, 'right')),
    'write.format.align.justify': w((m) => A.setAlign(m, 'justify')),
    'write.format.lineSpacing.1': w((m) => A.setLineHeight(m, 1.2)),
    'write.format.lineSpacing.115': w((m) => A.setLineHeight(m, 1.38)),
    'write.format.lineSpacing.15': w((m) => A.setLineHeight(m, 1.8)),
    'write.format.lineSpacing.2': w((m) => A.setLineHeight(m, 2.4)),
    'write.format.lineSpacing.default': w((m) => A.setLineHeight(m, null)),
    'write.format.bullets': w((m) => A.toggleList(m, 'bullet')),
    'write.format.numbers': w((m) => A.toggleList(m, 'ordered')),
    'write.format.indent': pm(sinkListItem(schema.nodes.list_item), 'Indent works inside lists'),
    'write.format.outdent': pm(liftListItem(schema.nodes.list_item)),
    'write.format.clear': w((m) => A.clearFormatting(m)),

    'write.table.rowBefore': table(addRowBefore),
    'write.table.rowAfter': table(addRowAfter),
    'write.table.colBefore': table(addColumnBefore),
    'write.table.colAfter': table(addColumnAfter),
    'write.table.deleteRow': table(deleteRow),
    'write.table.deleteCol': table(deleteColumn),
    'write.table.delete': table(deleteTable),
    'write.table.merge': pm(mergeCells, 'Select several cells to merge'),
    'write.table.split': pm(splitCell, 'Select a merged cell to split'),
    'write.table.headerRow': table(toggleHeaderRow),

    'write.review.track': w((m) => {
      m.tracking = !m.tracking;
      m.emit();
      api.toast(m.tracking ? 'Track changes on' : 'Track changes off');
    }),
    'write.review.acceptNext': w((m) => { if (!A.resolveNext(m, true)) api.toast('No tracked changes'); }),
    'write.review.rejectNext': w((m) => { if (!A.resolveNext(m, false)) api.toast('No tracked changes'); }),
    'write.review.acceptAll': w((m) => { if (!listChanges(m.state.doc).length) api.toast('No tracked changes'); else A.resolveEvery(m, true); }),
    'write.review.rejectAll': w((m) => { if (!listChanges(m.state.doc).length) api.toast('No tracked changes'); else A.resolveEvery(m, false); }),
    'write.review.comment': comment,
    'write.review.deleteComments': w((m) => { for (const c of [...m.comments]) A.removeComment(m, c.id); }),
    'write.review.wordCount': wordCount,
    'write.tools.wordCount': wordCount,
  };
}

export function authorName(): string {
  return useSettings.getState().s.deviceName || 'You';
}

function measureImage(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => res(null);
    img.src = src;
  });
}
