// Menu command handlers for Pixel.
import type { ReactNode } from 'react';
import type { CommandHandler, ModuleApi } from '@/core/types';
import { activeDoc } from '@/core/store';
import { autoColor, autoContrast, autoTone, equalize, type AdjustType } from './engine/adjust';
import { canvasToBytes } from './engine/canvas';
import type { PixelDoc } from './engine/doc';
import { FILTERS, defaultParams, filterById } from './engine/filters';
import { flatBytes } from './engine/io';
import * as ops from './engine/ops';
import { UserError } from './engine/ops';
import { growMask, maskBounds, similarMask } from './engine/mask';
import { contentBounds } from './engine/canvas';
import { rerender } from './engine/render';
import { AdjustDialog } from './dialogs/AdjustDialog';
import { FilterGalleryDialog, runFilter } from './dialogs/FilterGallery';
import { ImportPlaceDialog, pasteCanvases, placeAll, readClipboardImages } from './dialogs/ImportPlace';
import { LayerPropsDialog, LayerStyleDialog } from './dialogs/LayerDialogs';
import { CanvasSizeDialog, ImageSizeDialog } from './dialogs/SizeDialogs';
import {
  ColorRangeDialog, FillDialog, LoadSelectionDialog, NewGuideDialog, PromptDialog, StrokeDialog, TrimDialog,
} from './dialogs/SmallDialogs';

const ADJ_TYPES: AdjustType[] = ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 'hueSaturation', 'colorBalance', 'blackWhite', 'photoFilter', 'channelMixer', 'invert', 'posterize', 'threshold', 'gradientMap', 'desaturate'];
const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';

export function commands(getModel: () => PixelDoc | undefined, api: ModuleApi): Record<string, CommandHandler> {
  const h: Record<string, CommandHandler> = {};

  /** Run an edit with pending transforms committed and errors shown as toasts. */
  const edit = (id: string, fn: (doc: PixelDoc) => void | Promise<void>) => {
    h[id] = async () => {
      const doc = getModel();
      if (!doc) return;
      try {
        await fn(doc);
        api.markDirty();
      } catch (e) {
        if (e instanceof UserError) api.toast(e.message, 'error');
        else throw e;
      }
    };
  };
  const pre = (doc: PixelDoc) => doc.editor?.commitTransient();
  const dialog = (id: string, render: (doc: PixelDoc, close: () => void) => ReactNode, guard?: (doc: PixelDoc) => void) =>
    edit(id, (doc) => { pre(doc); guard?.(doc); api.openDialog((close) => render(doc, () => { close(); doc.emit(); })); });
  const view = (id: string, fn: (doc: PixelDoc) => void) => {
    h[id] = () => { const doc = getModel(); if (!doc) return; fn(doc); doc.emit(); api.refreshChrome?.(); };
  };

  // ---------- File ----------
  dialog('pixel.file.importPlace', (doc, close) => <ImportPlaceDialog doc={doc} api={api} onClose={close} />);
  dialog('pixel.file.placeEmbedded', (doc, close) => <ImportPlaceDialog doc={doc} api={api} onClose={close} />);
  edit('pixel.file.pasteClipboard', async (doc) => {
    pre(doc);
    const cs = await readClipboardImages();
    if (!cs.length) throw new UserError('No image on the clipboard');
    placeAll(doc, cs.map((c, i) => ({ canvas: c, name: cs.length > 1 ? `Pasted ${i + 1}` : 'Pasted' })));
  });
  edit('pixel.file.quickPng', async (doc) => {
    pre(doc);
    const name = activeDoc()?.title ?? 'image';
    await api.saveBytes(await flatBytes(doc, 'png'), `${name.replace(/\.[^.]+$/, '')}.png`, ['png']);
  });

  // ---------- Edit ----------
  edit('pixel.edit.undo', (doc) => { doc.editor?.commitTransient(); doc.undo(); });
  edit('pixel.edit.redo', (doc) => doc.redo());
  edit('pixel.edit.toggleLast', (doc) => { if (doc.canRedo) doc.redo(); else doc.undo(); });
  edit('pixel.edit.copy', async (doc) => { pre(doc); await toSystemClipboard(ops.copyPixels(doc, false).canvas); });
  edit('pixel.edit.copyMerged', async (doc) => { pre(doc); await toSystemClipboard(ops.copyPixels(doc, true).canvas); });
  edit('pixel.edit.cut', async (doc) => { pre(doc); const c = ops.copyPixels(doc, false); ops.clearPixels(doc, 'Cut'); await toSystemClipboard(c.canvas); });
  const paste = (mode: 'center' | 'inPlace' | 'into') => async (doc: PixelDoc) => {
    pre(doc);
    if (mode === 'into' && !doc.selection) throw new UserError('Make a selection to paste into');
    pasteCanvases(doc, await readClipboardImages(), mode);
  };
  edit('pixel.edit.paste', paste('center'));
  edit('pixel.edit.pasteInPlace', paste('inPlace'));
  edit('pixel.edit.pasteInto', paste('into'));
  edit('pixel.edit.clear', (doc) => { pre(doc); ops.clearPixels(doc); });
  dialog('pixel.edit.fill', (doc, close) => <FillDialog doc={doc} onClose={close} />, (doc) => ops.requirePixelLayer(doc));
  dialog('pixel.edit.stroke', (doc, close) => <StrokeDialog doc={doc} onClose={close} />, (doc) => { ops.requirePixelLayer(doc); if (!doc.selection) throw new UserError('Make a selection first'); });
  const freeT = (doc: PixelDoc) => { if (!doc.editor?.startTransform()) throw new UserError('Open the canvas to transform'); };
  edit('pixel.edit.freeTransform', freeT);
  edit('pixel.edit.transformScale', freeT);
  edit('pixel.edit.transformRotate', freeT);
  edit('pixel.edit.rotate180', (doc) => { pre(doc); ops.transformLayerSimple(doc, 'r180'); });
  edit('pixel.edit.rotate90cw', (doc) => { pre(doc); ops.transformLayerSimple(doc, 'r90'); });
  edit('pixel.edit.rotate90ccw', (doc) => { pre(doc); ops.transformLayerSimple(doc, 'r270'); });
  edit('pixel.edit.flipH', (doc) => { pre(doc); ops.transformLayerSimple(doc, 'flipH'); });
  edit('pixel.edit.flipV', (doc) => { pre(doc); ops.transformLayerSimple(doc, 'flipV'); });
  edit('pixel.edit.purgeHistory', (doc) => { doc.clearHistory(); api.toast('History cleared'); });
  edit('pixel.edit.purgeClipboard', () => { ops.setInternalClip(null as any); api.toast('Clipboard cleared'); });

  // ---------- Image ----------
  view('pixel.image.mode.rgb', () => api.toast('Documents are RGB · 8 bits/channel. Other modes are on the roadmap.'));
  view('pixel.image.mode.8bit', () => api.toast('Documents are RGB · 8 bits/channel. 16/32-bit are on the roadmap.'));
  for (const t of ADJ_TYPES) {
    const instant = t === 'invert' || t === 'desaturate';
    if (instant) edit(`pixel.adj.${t}`, (doc) => { pre(doc); ops.applyAdjustDestructive(doc, ops.adjustDefaults(doc, t)); });
    else dialog(`pixel.adj.${t}`, (doc, close) => <AdjustDialog doc={doc} mode="pixels" initial={ops.adjustDefaults(doc, t)} onClose={close} />, (doc) => ops.requirePixelLayer(doc));
    if (t === 'invert') edit(`pixel.adjLayer.${t}`, (doc) => { pre(doc); ops.addAdjustmentLayer(doc, ops.adjustDefaults(doc, t)); });
    else if (t !== 'desaturate') dialog(`pixel.adjLayer.${t}`, (doc, close) => <AdjustDialog doc={doc} mode="newLayer" initial={ops.adjustDefaults(doc, t)} onClose={close} />);
  }
  edit('pixel.adj.equalize', (doc) => { pre(doc); ops.applyPixels(doc, 'Equalize', equalize, 0); });
  edit('pixel.image.autoTone', (doc) => { pre(doc); ops.applyPixels(doc, 'Auto tone', autoTone, 0); });
  edit('pixel.image.autoContrast', (doc) => { pre(doc); ops.applyPixels(doc, 'Auto contrast', autoContrast, 0); });
  edit('pixel.image.autoColor', (doc) => { pre(doc); ops.applyPixels(doc, 'Auto color', autoColor, 0); });
  dialog('pixel.image.imageSize', (doc, close) => <ImageSizeDialog doc={doc} onClose={close} />);
  dialog('pixel.image.canvasSize', (doc, close) => <CanvasSizeDialog doc={doc} onClose={close} />);
  edit('pixel.image.rotate180', (doc) => { pre(doc); ops.rotateCanvas(doc, 2); doc.view?.fit(); });
  edit('pixel.image.rotate90cw', (doc) => { pre(doc); ops.rotateCanvas(doc, 1); doc.view?.fit(); });
  edit('pixel.image.rotate90ccw', (doc) => { pre(doc); ops.rotateCanvas(doc, 3); doc.view?.fit(); });
  dialog('pixel.image.rotateArbitrary', (doc, close) => <PromptDialog title="Rotate canvas" label="Angle (clockwise)" kind="number" min={-359} max={359} step={0.1} unit="°" initial={0}
    onOk={(v) => { const n = parseFloat(v); if (n) { ops.rotateArbitrary(doc, n); doc.view?.fit(); api.markDirty(); } }} onClose={close} />);
  edit('pixel.image.flipH', (doc) => { pre(doc); ops.flipCanvas(doc, true); });
  edit('pixel.image.flipV', (doc) => { pre(doc); ops.flipCanvas(doc, false); });
  edit('pixel.image.crop', (doc) => {
    pre(doc);
    const b = doc.selection && maskBounds(doc.selection);
    if (!b) throw new UserError('Make a selection to crop to (or use the Crop tool, C)');
    ops.cropTo(doc, b, doc.ui.crop.deletePixels);
    doc.selection = null;
    doc.view?.fit();
  });
  dialog('pixel.image.trim', (doc, close) => <TrimDialog onOk={(b) => { try { ops.trim(doc, b); doc.view?.fit(); api.markDirty(); } catch (e) { api.toast((e as Error).message, 'error'); } }} onClose={close} />);
  edit('pixel.image.revealAll', (doc) => { pre(doc); ops.revealAll(doc); doc.view?.fit(); });
  dialog('pixel.image.duplicate', (doc, close) => <PromptDialog title="Duplicate image" label="As" initial="Copy" onClose={close}
    onOk={async (name) => {
      const { serialize, deserialize } = await import('./engine/io');
      const files = await serialize(doc);
      const bytes: Record<string, Uint8Array> = {};
      for (const [k, v] of Object.entries(files)) bytes[k] = typeof v === 'string' ? new TextEncoder().encode(v) : v;
      api.openNewDoc('pixel', await deserialize(bytes, 1), name || 'Copy');
    }} />);

  // ---------- Layer ----------
  edit('pixel.layer.newLayer', (doc) => { pre(doc); ops.newLayer(doc); });
  edit('pixel.layer.newGroup', (doc) => { pre(doc); ops.newGroup(doc); });
  edit('pixel.layer.viaCopy', (doc) => { pre(doc); ops.layerViaCopy(doc, false); });
  edit('pixel.layer.viaCut', (doc) => { pre(doc); ops.layerViaCopy(doc, true); });
  edit('pixel.layer.backgroundFromLayer', (doc) => {
    pre(doc);
    const l = doc.active;
    if (!l || l.kind !== 'pixel') throw new UserError('Select a pixel layer');
    l.name = 'Background'; l.parentId = null; l.opacity = 1; l.blend = 'normal';
    doc.layers.splice(doc.layers.indexOf(l), 1);
    doc.layers.unshift(l);
    doc.commit('Background from layer');
  });
  edit('pixel.layer.duplicate', (doc) => { pre(doc); ops.duplicateLayer(doc); });
  edit('pixel.layer.deleteLayer', (doc) => { pre(doc); ops.deleteLayer(doc); });
  edit('pixel.layer.deleteHidden', (doc) => {
    pre(doc);
    const hidden = doc.layers.filter((l) => !l.visible);
    if (!hidden.length) throw new UserError('No hidden layers');
    if (hidden.length >= doc.layers.length) throw new UserError('A document needs at least one layer');
    for (const l of hidden) if (doc.layer(l.id)) doc.removeLayer(l.id);
    doc.commit('Delete hidden layers');
  });
  dialog('pixel.layer.rename', (doc, close) => <PromptDialog title="Rename layer" label="Name" initial={doc.active!.name} onClose={close}
    onOk={(v) => { const l = doc.active; if (l && v.trim()) { l.name = v.trim(); doc.commit('Rename layer'); api.markDirty(); } }} />, (doc) => { if (!doc.active) throw new UserError('Select a layer'); });
  const needLayer = (doc: PixelDoc) => { if (!doc.active) throw new UserError('Select a layer'); };
  dialog('pixel.layer.blendingOptions', (doc, close) => <LayerPropsDialog doc={doc} layer={doc.active!} onClose={close} />, needLayer);
  for (const s of ['stroke', 'colorOverlay', 'outerGlow', 'dropShadow']) {
    dialog(`pixel.layer.style.${s}`, (doc, close) => <LayerStyleDialog doc={doc} layer={doc.active!} initial={s} onClose={close} />, needLayer);
  }
  edit('pixel.layer.style.copy', (doc) => { ops.copyStyle(doc); api.toast('Layer style copied'); });
  edit('pixel.layer.style.paste', (doc) => ops.pasteStyle(doc));
  edit('pixel.layer.style.clear', (doc) => ops.clearStyle(doc));
  edit('pixel.layer.fill.solid', (doc) => { pre(doc); ops.addFillLayer(doc, doc.ui.fg); });
  dialog('pixel.layer.contentOptions', (doc, close) => {
    const l = doc.active!;
    return <AdjustDialog doc={doc} mode="editLayer" layer={l} initial={structuredClone(l.adjust!)} onClose={close} />;
  }, (doc) => {
    const l = doc.active;
    if (l?.kind === 'fill') throw new UserError('Change a fill layer’s color in the Properties panel');
    if (l?.kind !== 'adjustment') throw new UserError('Select an adjustment layer');
  });
  edit('pixel.layer.mask.revealAll', (doc) => ops.addMask(doc, 'reveal'));
  edit('pixel.layer.mask.hideAll', (doc) => ops.addMask(doc, 'hide'));
  edit('pixel.layer.mask.revealSelection', (doc) => ops.addMask(doc, 'revealSelection'));
  edit('pixel.layer.mask.hideSelection', (doc) => ops.addMask(doc, 'hideSelection'));
  edit('pixel.layer.mask.fromTransparency', (doc) => ops.addMask(doc, 'transparency'));
  edit('pixel.layer.mask.delete', (doc) => ops.deleteMask(doc));
  edit('pixel.layer.mask.apply', (doc) => ops.applyMask(doc));
  edit('pixel.layer.mask.toggle', (doc) => ops.toggleMask(doc));
  const rast = (id: string, kinds: string[], label: string) => edit(id, (doc) => {
    pre(doc);
    const l = doc.active;
    if (!l || !kinds.includes(l.kind)) throw new UserError(`Select a ${label} layer`);
    ops.rasterize(doc, l, `Rasterize ${label}`);
  });
  rast('pixel.layer.rasterize.type', ['text'], 'type');
  rast('pixel.type.rasterize', ['text'], 'type');
  rast('pixel.layer.rasterize.shape', ['shape'], 'shape');
  rast('pixel.layer.rasterize.fill', ['fill'], 'fill');
  rast('pixel.layer.rasterize.layer', ['text', 'shape', 'fill', 'pixel'], 'type, shape or fill');
  edit('pixel.layer.rasterize.style', (doc) => { pre(doc); ops.bakeLayer(doc, doc.active!); });
  edit('pixel.layer.rasterize.all', (doc) => {
    pre(doc);
    let n = 0;
    for (const l of doc.layers) if (l.kind === 'text' || l.kind === 'shape') { l.kind = 'pixel'; l.text = undefined; l.shape = undefined; n++; }
    if (!n) throw new UserError('No type or shape layers to rasterize');
    doc.commit('Rasterize all layers');
  });
  edit('pixel.layer.group', (doc) => { pre(doc); ops.groupLayers(doc); });
  edit('pixel.layer.ungroup', (doc) => { pre(doc); ops.ungroup(doc); });
  edit('pixel.layer.hide', (doc) => { const l = doc.active; if (!l) return; l.visible = !l.visible; doc.commit(l.visible ? 'Show layer' : 'Hide layer'); });
  edit('pixel.layer.front', (doc) => { if (doc.active) { doc.arrange(doc.active.id, 'top'); doc.commit('Bring to front'); } });
  edit('pixel.layer.forward', (doc) => { if (doc.active) { doc.arrange(doc.active.id, 1); doc.commit('Bring forward'); } });
  edit('pixel.layer.backward', (doc) => { if (doc.active) { doc.arrange(doc.active.id, -1); doc.commit('Send backward'); } });
  edit('pixel.layer.back', (doc) => { if (doc.active) { doc.arrange(doc.active.id, 'bottom'); doc.commit('Send to back'); } });
  edit('pixel.layer.reverse', (doc) => {
    const l = doc.active;
    const sibs = doc.childrenOf(l?.parentId ?? null);
    const idx = sibs.map((s) => doc.layers.indexOf(s));
    const rev = [...sibs].reverse();
    idx.forEach((i, k) => { doc.layers[i] = rev[k]; });
    doc.commit('Reverse');
  });
  for (const a of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const) edit(`pixel.layer.align.${a}`, (doc) => { pre(doc); ops.alignLayer(doc, a); });
  edit('pixel.layer.lock', (doc) => { const l = doc.active; if (!l) return; l.locked = !l.locked; doc.commit(l.locked ? 'Lock layer' : 'Unlock layer'); });
  edit('pixel.layer.mergeDown', (doc) => { pre(doc); ops.mergeDown(doc); });
  edit('pixel.layer.mergeVisible', (doc) => { pre(doc); ops.mergeVisible(doc); });
  edit('pixel.layer.flatten', (doc) => { pre(doc); ops.flatten(doc); });

  // ---------- Type ----------
  view('pixel.type.character', (doc) => { doc.ui.panel = 'type'; });
  view('pixel.type.paragraph', (doc) => { doc.ui.panel = 'type'; });
  view('pixel.type.aa.smooth', () => api.toast('Type is anti-aliased (smooth). Other modes are on the roadmap.'));
  view('pixel.type.horizontal', () => api.toast('Type is horizontal. Vertical type is on the roadmap.'));
  edit('pixel.type.updateAll', (doc) => { for (const l of doc.layers) if (l.kind === 'text') rerender(l); doc.commit('Update text layers'); });
  edit('pixel.type.lorem', (doc) => {
    const l = doc.active;
    if (l?.kind !== 'text' || !l.text) throw new UserError('Select a type layer (or click with the Type tool) first');
    l.text = { ...l.text, text: l.text.text ? `${l.text.text}\n${LOREM}` : LOREM };
    rerender(l);
    doc.commit('Paste lorem ipsum');
  });

  // ---------- Select ----------
  edit('pixel.select.all', (doc) => { pre(doc); ops.selectAll(doc); });
  edit('pixel.select.deselect', (doc) => { pre(doc); ops.deselect(doc); });
  edit('pixel.select.reselect', (doc) => ops.reselect(doc));
  edit('pixel.select.inverse', (doc) => ops.inverse(doc));
  dialog('pixel.select.colorRange', (doc, close) => <ColorRangeDialog doc={doc} onClose={close} />);
  const modify = (id: string, kind: 'expand' | 'contract' | 'feather' | 'border' | 'smooth', title: string, label: string, init: number) =>
    dialog(id, (doc, close) => <PromptDialog title={title} label={label} kind="number" min={kind === 'feather' ? 0.1 : 1} max={500} step={kind === 'feather' ? 0.1 : 1} unit="px" initial={init} onClose={close}
      onOk={(v) => { try { ops.modifySelection(doc, kind, parseFloat(v) || init); api.markDirty(); } catch (e) { api.toast((e as Error).message, 'error'); } }} />,
    (doc) => { if (!doc.selection) throw new UserError('Make a selection first'); });
  modify('pixel.select.expand', 'expand', 'Expand selection', 'Expand by', 4);
  modify('pixel.select.contract', 'contract', 'Contract selection', 'Contract by', 4);
  modify('pixel.select.feather', 'feather', 'Feather selection', 'Feather radius', 4);
  modify('pixel.select.border', 'border', 'Border selection', 'Width', 8);
  modify('pixel.select.smooth', 'smooth', 'Smooth selection', 'Sample radius', 4);
  edit('pixel.select.grow', (doc) => {
    if (!doc.selection) throw new UserError('Make a selection first');
    doc.setSelection(growMask(ops.sampleImage(doc, doc.ui.wand.sampleAll), doc.selection, doc.ui.wand.tolerance));
    doc.commit('Grow');
  });
  edit('pixel.select.similar', (doc) => {
    if (!doc.selection) throw new UserError('Make a selection first');
    doc.setSelection(similarMask(ops.sampleImage(doc, doc.ui.wand.sampleAll), doc.selection, doc.ui.wand.tolerance));
    doc.commit('Similar');
  });
  dialog('pixel.select.load', (doc, close) => <LoadSelectionDialog doc={doc} onClose={close} />);
  dialog('pixel.select.save', (doc, close) => <PromptDialog title="Save selection" label="Channel name" initial={`Alpha ${doc.channels.length + 1}`} onClose={close}
    onOk={(v) => { ops.saveSelectionChannel(doc, v); api.markDirty(); }} />, (doc) => { if (!doc.selection) throw new UserError('Make a selection first'); });

  // ---------- Filter ----------
  dialog('pixel.filter.gallery', (doc, close) => <FilterGalleryDialog doc={doc} onClose={close} />, (doc) => ops.requirePixelLayer(doc));
  edit('pixel.filter.last', (doc) => {
    pre(doc);
    const lf = doc.lastFilter;
    if (!lf) throw new UserError('No filter used yet');
    runFilter(doc, filterById(lf.id)!, lf.params, Math.floor(Math.random() * 1e9));
  });
  for (const f of FILTERS) {
    if (f.planned) continue;
    const id = `pixel.filter.f.${f.id}`;
    if (!f.params.length) edit(id, (doc) => { pre(doc); runFilter(doc, f, defaultParams(f), Math.floor(Math.random() * 1e9)); });
    else dialog(id, (doc, close) => <FilterGalleryDialog doc={doc} initial={f.id} galleryOnly={false} onClose={close} />, (doc) => ops.requirePixelLayer(doc));
  }

  // ---------- View ----------
  view('pixel.view.zoomIn', (doc) => doc.view?.zoomTo(doc.ui.zoom * 1.25));
  view('pixel.view.zoomOut', (doc) => doc.view?.zoomTo(doc.ui.zoom / 1.25));
  view('pixel.view.fit', (doc) => doc.view?.fit());
  view('pixel.view.fitLayers', (doc) => {
    const l = doc.active;
    const b = l?.canvas ? contentBounds(l.canvas) : null;
    if (l && b) doc.view?.fitRect({ x: l.x + b.x, y: l.y + b.y, w: b.w, h: b.h }); else doc.view?.fit();
  });
  view('pixel.view.actual', (doc) => doc.view?.zoomTo(1));
  view('pixel.view.zoom200', (doc) => doc.view?.zoomTo(2));
  view('pixel.view.printSize', (doc) => doc.view?.zoomTo(96 / (doc.ppi || 72)));
  view('pixel.view.aspectSquare', () => {});
  view('pixel.view.flipH', (doc) => { doc.ui.flipView = !doc.ui.flipView; });
  view('pixel.view.screen.standard', () => {});
  view('pixel.view.extras', (doc) => { doc.ui.showExtras = !doc.ui.showExtras; });
  view('pixel.view.show.layerEdges', (doc) => { doc.ui.showLayerEdges = !doc.ui.showLayerEdges; });
  view('pixel.view.show.selectionEdges', (doc) => { doc.ui.showExtras = !doc.ui.showExtras; });
  view('pixel.view.show.grid', (doc) => { doc.ui.showGrid = !doc.ui.showGrid; });
  view('pixel.view.show.guides', (doc) => { doc.ui.showGuides = !doc.ui.showGuides; });
  view('pixel.view.show.pixelGrid', (doc) => { doc.ui.showPixelGrid = !doc.ui.showPixelGrid; });
  view('pixel.view.show.brushPreview', () => api.toast('The brush outline follows the pointer for painting tools'));
  view('pixel.view.show.all', (doc) => Object.assign(doc.ui, { showExtras: true, showGrid: true, showGuides: true, showPixelGrid: true, showLayerEdges: true }));
  view('pixel.view.show.none', (doc) => Object.assign(doc.ui, { showGrid: false, showGuides: false, showPixelGrid: false, showLayerEdges: false }));
  view('pixel.view.rulers', (doc) => { doc.ui.showRulers = !doc.ui.showRulers; });
  view('pixel.view.snap', (doc) => { doc.ui.snap = !doc.ui.snap; api.toast(doc.ui.snap ? 'Snap on' : 'Snap off'); });
  view('pixel.view.snapTo.guides', (doc) => { doc.ui.snap = true; doc.ui.showGuides = true; });
  view('pixel.view.snapTo.bounds', (doc) => { doc.ui.snap = true; });
  view('pixel.view.snapTo.all', (doc) => { doc.ui.snap = true; doc.ui.showGuides = true; });
  view('pixel.view.snapTo.none', (doc) => { doc.ui.snap = false; });
  view('pixel.view.lockGuides', (doc) => { doc.ui.lockGuides = !doc.ui.lockGuides; api.toast(doc.ui.lockGuides ? 'Guides locked' : 'Guides unlocked'); });
  edit('pixel.view.clearGuides', (doc) => { if (!doc.guides.length) return; doc.guides = []; doc.commit('Clear guides'); });
  dialog('pixel.view.newGuide', (doc, close) => <NewGuideDialog doc={doc} onClose={close} />);
  edit('pixel.view.guidesFromShape', (doc) => {
    const l = doc.active;
    const b = l?.canvas ? contentBounds(l.canvas) : null;
    if (!l || !b) throw new UserError('Select a layer with content');
    const x = l.x + b.x, y = l.y + b.y;
    doc.guides = [...doc.guides, { axis: 'v', pos: x }, { axis: 'v', pos: x + b.w }, { axis: 'v', pos: Math.round(x + b.w / 2) }, { axis: 'h', pos: y }, { axis: 'h', pos: y + b.h }, { axis: 'h', pos: Math.round(y + b.h / 2) }];
    doc.ui.showGuides = true;
    doc.commit('New guides from shape');
  });

  // ---------- Window ----------
  const panel = (id: string, p: PixelDoc['ui']['panel']) => view(id, (doc) => { doc.ui.panel = p; });
  panel('pixel.window.actions', 'actions');
  panel('pixel.window.adjustments', 'adjust');
  panel('pixel.window.brushSettings', 'brush');
  panel('pixel.window.brushes', 'brush');
  panel('pixel.window.channels', 'channels');
  panel('pixel.window.character', 'type');
  panel('pixel.window.paragraph', 'type');
  panel('pixel.window.color', 'color');
  panel('pixel.window.swatches', 'color');
  panel('pixel.window.history', 'history');
  panel('pixel.window.layers', 'layers');
  panel('pixel.window.paths', 'paths');
  panel('pixel.window.properties', 'props');
  dialog('pixel.window.styles', (doc, close) => <LayerStyleDialog doc={doc} layer={doc.active!} initial="blending" onClose={close} />, needLayer);
  view('pixel.window.options', (doc) => { doc.ui.showOptions = !doc.ui.showOptions; });
  view('pixel.window.tools', (doc) => { doc.ui.showTools = !doc.ui.showTools; });
  view('pixel.window.ws.essentials', () => {});
  view('pixel.window.ws.reset', (doc) => Object.assign(doc.ui, { showOptions: true, showTools: true, panel: 'layers' }));

  return h;
}


async function toSystemClipboard(c: HTMLCanvasElement) {
  try {
    const bytes = await canvasToBytes(c);
    const Item = (window as any).ClipboardItem;
    if (Item && navigator.clipboard?.write) await navigator.clipboard.write([new Item({ 'image/png': new Blob([bytes as BlobPart], { type: 'image/png' }) })]);
  } catch { /* internal clipboard still holds it */ }
}
