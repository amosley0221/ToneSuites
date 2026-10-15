// Menu command handlers for Deck.
import { isTauri } from '@/core/platform';
import type { CommandHandler, ModuleApi } from '@/core/types';
import { DeckDoc, extMime, sniffMime } from './doc';
import { isEmptyEl, type LayoutId, type ShapeKind, type Transition } from './model';
import * as ops from './ops';
import { deckToMarkdown, outlineToDeck, parseOutline } from './outline';

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp'];
const LAYOUT_IDS: LayoutId[] = ['title', 'title-content', 'two-column', 'image-full', 'section', 'blank'];

/** True while the user types in a text field (let the browser handle clipboard/undo natively). */
export function typingInField(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

export async function pickAndInsertImage(doc: DeckDoc, api: ModuleApi) {
  const [f] = await api.pickFile(IMAGE_EXTS);
  if (!f) return;
  await insertImageBytes(doc, f.bytes, extMime(f.name.split('.').pop() ?? ''));
}

export async function insertImageBytes(doc: DeckDoc, bytes: Uint8Array, mime: string) {
  const { toDataUrl } = await import('./doc');
  mime = sniffMime(bytes) ?? mime;
  const { loadImage } = await import('./raster');
  let natural: { w: number; h: number } | undefined;
  try {
    const img = await loadImage(toDataUrl(bytes, mime));
    natural = { w: img.naturalWidth, h: img.naturalHeight };
  } catch {
    throw new Error('That image could not be decoded');
  }
  ops.insertImage(doc, bytes, mime, natural);
}

export function startPresenting(doc: DeckDoc, mode: 'present' | 'presenter' | 'rehearse', from: number) {
  doc.ui.presenting = mode;
  doc.ui.presentFrom = Math.max(0, Math.min(from, doc.data.slides.length - 1));
  doc.ui.editing = null;
  doc.emit();
}

export function deckCommands(getModel: () => DeckDoc | undefined, api: ModuleApi): Record<string, CommandHandler> {
  // Wrap a handler: resolve the model, run, mark the tab dirty if data changed.
  const w = (fn: (d: DeckDoc) => void | Promise<void>): CommandHandler => async () => {
    const d = getModel();
    // Shortcuts (Del, Ctrl D…) must not edit the slide hidden behind the Masters dialog or a running show.
    if (!d || d.ui.mastersOpen || d.ui.presenting) return;
    const v = d.version;
    await fn(d);
    if (d.version !== v) api.markDirty();
  };
  const ui = (fn: (d: DeckDoc) => void): CommandHandler => () => {
    const d = getModel();
    if (d) { fn(d); d.emit(); }
  };
  // The desktop/Android save path toasts "Exported …" itself; the browser download does not.
  const save = async (bytes: Uint8Array, name: string, ext: string) => {
    if (await api.saveBytes(bytes, name, [ext]) && !isTauri) api.toast(`Exported ${name}`);
  };
  const title = (d: DeckDoc) => deckTitle(d);

  const h: Record<string, CommandHandler> = {
    // File
    'deck.file.importOutline': w(async (d) => {
      const [f] = await api.pickFile(['toneoutline', 'json']);
      if (!f) return;
      const add = outlineToDeck(parseOutline(new TextDecoder().decode(f.bytes))).slides;
      if (!add.length) { api.toast('That outline has no slides', 'error'); return; }
      // A brand-new deck (one untouched slide) is replaced instead of keeping an empty first slide.
      const blank = d.data.slides.length === 1 && d.data.slides[0].elements.every(isEmptyEl) && !d.data.slides[0].notes.trim();
      if (blank) { d.data.slides = add; d.ui.current = 0; } else { d.data.slides.splice(d.ui.current + 1, 0, ...add); d.ui.current += 1; }
      d.ui.selection = [];
      d.commit();
      api.toast(`Imported ${add.length} slide${add.length === 1 ? '' : 's'}`);
    }),
    'deck.file.exportPdf': w(async (d) => { const { exportPdf } = await import('./exportPdf'); await save(await exportPdf(d, title(d)), `${title(d)}.pdf`, 'pdf'); }),
    'deck.file.exportPptx': w(async (d) => { const { exportPptx } = await import('./exportPptx'); await save(await exportPptx(d, title(d)), `${title(d)}.pptx`, 'pptx'); }),
    'deck.file.exportPng': w(async (d) => { const { exportSlidePng } = await import('./raster'); await save(await exportSlidePng(d), `${title(d)}-slide-${d.ui.current + 1}.png`, 'png'); }),
    'deck.file.exportOutline': w(async (d) => { await save(new TextEncoder().encode(deckToMarkdown(d.data, title(d))), `${title(d)}.md`, 'md'); }),

    // Edit
    'deck.edit.undo': w((d) => { if (typingInField()) document.execCommand('undo'); else d.undo(); }),
    'deck.edit.redo': w((d) => { if (typingInField()) document.execCommand('redo'); else d.redo(); }),
    // Copy/cut go through the browser clipboard event (the Editor puts the elements on the system clipboard);
    // the in-deck clipboard is the fallback.
    'deck.edit.cut': w((d) => {
      if (typingInField()) { document.execCommand('cut'); return; }
      try { document.execCommand('cut'); } catch { /* unsupported */ }
      if (d.ui.selection.length) ops.cutSelection(d);
    }),
    'deck.edit.copy': w((d) => {
      if (typingInField()) { document.execCommand('copy'); return; }
      try { document.execCommand('copy'); } catch { /* unsupported */ }
      ops.copySelection(d);
    }),
    'deck.edit.paste': w(async (d) => {
      if (typingInField()) return;
      if (ops.paste(d)) return;
      // Nothing copied inside Deck: try an image from the system clipboard.
      try {
        for (const item of await navigator.clipboard.read()) {
          const type = item.types.find((t) => t.startsWith('image/'));
          if (type) { await insertImageBytes(d, new Uint8Array(await (await item.getType(type)).arrayBuffer()), type); return; }
        }
      } catch { /* clipboard permission denied or unsupported */ }
    }),
    'deck.edit.duplicate': w((d) => { if (d.ui.selection.length) ops.duplicateSelection(d); else ops.duplicateSlide(d); }),
    'deck.edit.delete': w((d) => {
      if (typingInField()) return;
      if (d.ui.selection.length) ops.deleteSelection(d);
      else if (d.ui.focus === 'rail') ops.deleteSlide(d);
    }),
    'deck.edit.selectAll': w((d) => { if (typingInField()) document.execCommand('selectAll'); else ops.selectAll(d); }),
    'deck.edit.deselect': w((d) => d.select([])),

    // View
    'deck.view.normal': ui((d) => { d.ui.timeline = false; d.ui.showNotes = true; }),
    'deck.view.timeline': ui((d) => { d.ui.timeline = !d.ui.timeline; }),
    'deck.view.notes': ui((d) => { d.ui.showNotes = !d.ui.showNotes; if (d.ui.showNotes) d.ui.timeline = false; }),
    'deck.view.zoomFit': ui((d) => { d.ui.zoomFit = true; }),
    'deck.view.zoomDefault': ui((d) => { d.ui.zoomFit = false; }),

    // Insert
    'deck.insert.slideAuto': w((d) => ops.addSlide(d)),
    'deck.insert.text': w((d) => ops.insertText(d)),
    'deck.insert.image': w((d) => pickAndInsertImage(d, api)),
    'deck.insert.table': w((d) => ops.insertTable(d)),

    // Slide
    'deck.slide.new': w((d) => ops.addSlide(d)),
    'deck.slide.duplicate': w((d) => ops.duplicateSlide(d)),
    'deck.slide.delete': w((d) => ops.deleteSlide(d)),
    'deck.slide.masters': ui((d) => { d.ui.mastersOpen = true; }),
    'deck.slide.transition.applyAll': w((d) => { const t = d.slide()?.transition ?? 'none'; ops.setTransition(d, t, true); api.toast('Transition applied to all slides'); }),
    'deck.slide.animate': w((d) => { d.ui.timeline = true; ops.toggleAnimation(d); }),
    'deck.slide.present': w((d) => startPresenting(d, 'present', 0)),
    'deck.slide.presentCurrent': w((d) => startPresenting(d, 'present', d.ui.current)),
    'deck.slide.presenter': w((d) => startPresenting(d, 'presenter', d.ui.current)),
    'deck.slide.rehearse': w((d) => startPresenting(d, 'rehearse', 0)),

    // Arrange
    'deck.arrange.front': w((d) => ops.arrange(d, 'front')),
    'deck.arrange.forward': w((d) => ops.arrange(d, 'forward')),
    'deck.arrange.backward': w((d) => ops.arrange(d, 'backward')),
    'deck.arrange.back': w((d) => ops.arrange(d, 'back')),

    // Tools
    'deck.tools.previewAnim': ui((d) => { d.ui.timeline = true; d.ui.previewToken = (d.ui.previewToken ?? 0) + 1; }),
  };
  for (const id of LAYOUT_IDS) {
    h[`deck.insert.slide.${id}`] = w((d) => ops.addSlide(d, id));
    h[`deck.slide.layout.${id}`] = w((d) => ops.setLayout(d, id));
  }
  for (const s of ['rect', 'ellipse', 'line'] as ShapeKind[]) h[`deck.insert.shape.${s}`] = w((d) => ops.insertShape(d, s));
  for (const t of ['none', 'fade', 'push', 'morph'] as Transition[]) h[`deck.slide.transition.${t}`] = w((d) => ops.setTransition(d, t));
  for (const a of ['left', 'hcenter', 'right', 'top', 'vmiddle', 'bottom'] as ops.AlignMode[]) h[`deck.arrange.align.${a}`] = w((d) => ops.align(d, a));
  return h;
}

/** File-name-safe title used for exports. */
export function deckTitle(d: DeckDoc): string {
  const t = d.title?.trim();
  return (t || 'Deck').replace(/\.tone$/i, '').replace(/[\\/:*?"<>|]/g, '-');
}
