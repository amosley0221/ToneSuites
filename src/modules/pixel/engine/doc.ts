// The Pixel document model: layer stack, selection, history (copy-on-write snapshots), UI/tool state.
import type { AdjustSpec } from './adjust';
import type { BlendMode } from './blend';
import { cloneCanvas, ctx2d, maskToCanvas, newCanvas, type Cnv } from './canvas';
import type { Mask, Rect } from './mask';
import type { CombineOp } from './mask';
import type { ToolId } from './tooldefs';

export type LayerKind = 'pixel' | 'text' | 'shape' | 'group' | 'adjustment' | 'fill';

export interface DropShadow { enabled: boolean; color: string; opacity: number; angle: number; distance: number; size: number; blend: BlendMode }
export interface StrokeStyle { enabled: boolean; color: string; size: number; opacity: number }
export interface OuterGlow { enabled: boolean; color: string; opacity: number; size: number; blend: BlendMode }
export interface ColorOverlay { enabled: boolean; color: string; opacity: number }
export interface LayerStyles { dropShadow: DropShadow; stroke: StrokeStyle; outerGlow: OuterGlow; colorOverlay: ColorOverlay }

export interface TextData {
  text: string; font: string; size: number; weight: number; italic: boolean; color: string;
  align: 'left' | 'center' | 'right'; leading: number; tracking: number; underline: boolean;
}
export interface ShapeData {
  type: 'rect' | 'ellipse' | 'triangle' | 'polygon' | 'line';
  w: number; h: number; fill: string | null; stroke: string | null; strokeWidth: number; sides: number; radius: number;
  /** Line endpoints relative to the box origin. */
  x1?: number; y1?: number; x2?: number; y2?: number;
  /** Padding between canvas edge and shape box (for strokes). */
  pad: number;
}
export interface LayerMask { canvas: Cnv; x: number; y: number; enabled: boolean }

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  parentId: string | null;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  locked: boolean;
  x: number;
  y: number;
  canvas: Cnv | null;
  mask: LayerMask | null;
  styles: LayerStyles | null;
  text?: TextData;
  shape?: ShapeData;
  adjust?: AdjustSpec;
  fillColor?: string;
  collapsed?: boolean;
}

export interface Channel { id: string; name: string; mask: Mask }
export interface Guide { axis: 'h' | 'v'; pos: number }

export type PanelId = 'layers' | 'channels' | 'paths' | 'props' | 'adjust' | 'history' | 'brush' | 'type' | 'color' | 'actions';

export interface UIState {
  tool: ToolId;
  groupVariant: Record<string, ToolId>;
  fg: string;
  bg: string;
  brush: { size: number; hardness: number; opacity: number; flow: number; spacing: number; roundness: number; angle: number; pressureSize: boolean; pressureOpacity: boolean };
  retouch: { strength: number; sampleAll: boolean };
  tone: { exposure: number; range: 'shadows' | 'midtones' | 'highlights'; spongeMode: 'saturate' | 'desaturate' };
  wand: { tolerance: number; contiguous: boolean; sampleAll: boolean };
  bucket: { tolerance: number; contiguous: boolean; sampleAll: boolean; opacity: number };
  select: { mode: CombineOp; feather: number };
  gradient: { type: 'linear' | 'radial'; fade: 'fgbg' | 'fgclear'; opacity: number; reverse: boolean };
  shape: { mode: 'shape' | 'pixels'; strokeWidth: number; strokeOn: boolean; fillOn: boolean; sides: number; radius: number };
  type: TextData;
  move: { autoSelect: boolean };
  crop: { deletePixels: boolean };
  eyedropper: { sample: 1 | 3 | 5; source: 'layer' | 'all' };
  zoom: number;
  panX: number;
  panY: number;
  flipView: boolean;
  panel: PanelId;
  showRulers: boolean; showGuides: boolean; snap: boolean; showGrid: boolean; showPixelGrid: boolean;
  showExtras: boolean; showLayerEdges: boolean; lockGuides: boolean;
  showOptions: boolean; showTools: boolean;
  /** Painting targets the layer mask instead of pixels. */
  editMask: boolean;
  cloneSource: { x: number; y: number } | null;
  /** History index used as the History brush source. */
  historySource: number;
}

/** A transient replacement for a layer's pixels while a tool / preview is active. */
export interface LayerOverride {
  layerId: string;
  target: 'pixels' | 'mask';
  render: () => { canvas: Cnv; x: number; y: number } | null;
}

interface Snapshot {
  width: number;
  height: number;
  layers: Layer[];
  activeId: string | null;
  selection: Mask | null;
  channels: Channel[];
  guides: Guide[];
}
export interface HistoryEntry { label: string; time: number; state: Snapshot }

export const MAX_HISTORY = 60;
export const HISTORY_BYTES = 1024 * 1024 * 1024;

let seq = 0;
export const newId = () => Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 6);

export function defaultStyles(): LayerStyles {
  return {
    dropShadow: { enabled: false, color: '#000000', opacity: 0.35, angle: 120, distance: 12, size: 24, blend: 'multiply' },
    stroke: { enabled: false, color: '#000000', size: 2, opacity: 1 },
    outerGlow: { enabled: false, color: '#FFFFBE', opacity: 0.75, size: 20, blend: 'screen' },
    colorOverlay: { enabled: false, color: '#FF0000', opacity: 1 },
  };
}

export function hasStyles(s: LayerStyles | null): boolean {
  return !!s && (s.dropShadow.enabled || s.stroke.enabled || s.outerGlow.enabled || s.colorOverlay.enabled);
}

export function defaultUI(): UIState {
  return {
    tool: 'brush',
    groupVariant: {},
    fg: '#000000',
    bg: '#FFFFFF',
    brush: { size: 24, hardness: 80, opacity: 100, flow: 100, spacing: 12, roundness: 100, angle: 0, pressureSize: true, pressureOpacity: false },
    retouch: { strength: 50, sampleAll: false },
    tone: { exposure: 50, range: 'midtones', spongeMode: 'desaturate' },
    wand: { tolerance: 32, contiguous: true, sampleAll: false },
    bucket: { tolerance: 32, contiguous: true, sampleAll: false, opacity: 100 },
    select: { mode: 'replace', feather: 0 },
    gradient: { type: 'linear', fade: 'fgbg', opacity: 100, reverse: false },
    shape: { mode: 'shape', strokeWidth: 0, strokeOn: false, fillOn: true, sides: 6, radius: 0 },
    type: { text: '', font: 'Archivo', size: 48, weight: 700, italic: false, color: '#000000', align: 'left', leading: 1.2, tracking: 0, underline: false },
    move: { autoSelect: false },
    crop: { deletePixels: true },
    eyedropper: { sample: 1, source: 'all' },
    zoom: 1, panX: 0, panY: 0, flipView: false,
    panel: 'layers',
    showRulers: false, showGuides: true, snap: true, showGrid: false, showPixelGrid: true,
    showExtras: true, showLayerEdges: false, lockGuides: false,
    showOptions: true, showTools: true,
    editMask: false,
    cloneSource: null,
    historySource: 0,
  };
}

function cloneLayer(l: Layer): Layer {
  return {
    ...l,
    mask: l.mask ? { ...l.mask } : null,
    styles: l.styles ? structuredClone(l.styles) : null,
    text: l.text ? { ...l.text } : undefined,
    shape: l.shape ? { ...l.shape } : undefined,
    adjust: l.adjust ? structuredClone(l.adjust) : undefined,
  };
}

export class PixelDoc {
  width: number;
  height: number;
  ppi: number;
  layers: Layer[] = [];
  activeId: string | null = null;
  selection: Mask | null = null;
  /** Last non-null selection (Select › Reselect). */
  lastSelection: Mask | null = null;
  channels: Channel[] = [];
  guides: Guide[] = [];
  swatches: string[] = [];
  ui: UIState = defaultUI();

  history: HistoryEntry[] = [];
  histIndex = -1;
  lastFilter: { id: string; params: Record<string, number> } | null = null;

  override: LayerOverride | null = null;
  adjustOverride: { layerId: string; spec: AdjustSpec } | null = null;

  /** Bumped on any change (UI re-render). */
  version = 0;
  /** Bumped when pixels/layer structure change (composite cache key). */
  pixelRev = 0;
  onCommit: (() => void) | null = null;
  /** Set by the editor so commands can drive the viewport. */
  view: { fit: () => void; zoomTo: (z: number) => void; fitRect: (r: Rect) => void } | null = null;
  /** Set by the editor: start free transform / place etc. */
  editor: {
    startTransform: (opts?: { placed?: boolean }) => boolean;
    commitTransient: () => void;
    /** Programmatic scale/rotate of the active layer (Properties panel). */
    applyTransform: (fn: (p: { sx: number; sy: number; angle: number }, w: number, h: number) => void) => void;
  } | null = null;

  private listeners = new Set<() => void>();
  private paintListeners = new Set<() => void>();
  private frozen = new WeakSet<Cnv>();
  private selCache: { mask: Mask; canvas: Cnv } | null = null;

  constructor(width: number, height: number, ppi = 72) {
    this.width = width;
    this.height = height;
    this.ppi = ppi;
  }

  // ---------- change notification ----------

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getVersion = () => this.version;
  emit() { this.version++; for (const l of this.listeners) l(); }
  /** Pixels changed but no UI state did (live strokes, previews): only the viewport redraws. */
  repaint() { this.pixelRev++; for (const l of this.paintListeners) l(); }
  onPaint = (fn: () => void) => { this.paintListeners.add(fn); return () => { this.paintListeners.delete(fn); }; };
  touch() { this.repaint(); this.emit(); }

  // ---------- layers ----------

  layer(id: string | null | undefined): Layer | undefined {
    return id ? this.layers.find((l) => l.id === id) : undefined;
  }
  get active(): Layer | undefined { return this.layer(this.activeId); }

  /** Children of a group (or the root) bottom → top. */
  childrenOf(parentId: string | null): Layer[] {
    return this.layers.filter((l) => l.parentId === parentId);
  }

  /** Every layer in panel order (top → bottom) with depth, honoring collapsed groups when `visibleOnly`. */
  panelOrder(visibleOnly = true): { layer: Layer; depth: number }[] {
    const out: { layer: Layer; depth: number }[] = [];
    const walk = (pid: string | null, depth: number) => {
      const kids = this.childrenOf(pid);
      for (let i = kids.length - 1; i >= 0; i--) {
        out.push({ layer: kids[i], depth });
        if (kids[i].kind === 'group' && (!visibleOnly || !kids[i].collapsed)) walk(kids[i].id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  descendants(id: string): Layer[] {
    const out: Layer[] = [];
    const walk = (pid: string) => { for (const c of this.childrenOf(pid)) { out.push(c); if (c.kind === 'group') walk(c.id); } };
    walk(id);
    return out;
  }

  isEffectivelyVisible(l: Layer): boolean {
    let cur: Layer | undefined = l;
    while (cur) { if (!cur.visible) return false; cur = this.layer(cur.parentId); }
    return true;
  }

  makeLayer(kind: LayerKind, name: string, init: Partial<Layer> = {}): Layer {
    return {
      id: newId(), name, kind, parentId: null, visible: true, opacity: 1, blend: 'normal', locked: false,
      x: 0, y: 0, canvas: null, mask: null, styles: null, ...init,
    };
  }

  newPixelLayer(name: string): Layer {
    return this.makeLayer('pixel', name, { canvas: newCanvas(this.width, this.height) });
  }

  /** Insert above `refId` (default: active layer) sharing its parent; groups insert inside when `inside`. */
  addLayer(layer: Layer, refId: string | null = this.activeId, inside = false) {
    const ref = this.layer(refId);
    if (!ref) { layer.parentId = null; this.layers.push(layer); }
    else if (inside && ref.kind === 'group') { layer.parentId = ref.id; const kids = this.childrenOf(ref.id); const last = kids[kids.length - 1] ?? ref; this.layers.splice(this.layers.indexOf(last) + 1, 0, layer); }
    else { layer.parentId = ref.parentId; this.layers.splice(this.layers.indexOf(ref) + 1, 0, layer); }
    this.activeId = layer.id;
  }

  removeLayer(id: string) {
    const ids = new Set([id, ...this.descendants(id).map((l) => l.id)]);
    const l = this.layer(id);
    const siblings = l ? this.childrenOf(l.parentId) : [];
    const idx = l ? siblings.indexOf(l) : -1;
    this.layers = this.layers.filter((x) => !ids.has(x.id));
    if (ids.has(this.activeId ?? '')) {
      const remaining = l ? this.childrenOf(l.parentId) : [];
      this.activeId = (remaining[Math.max(0, idx - 1)] ?? remaining[0] ?? this.layer(l?.parentId) ?? this.layers[this.layers.length - 1])?.id ?? null;
    }
  }

  /** Move among siblings: +1 up, -1 down, 'top', 'bottom'. */
  arrange(id: string, dir: 1 | -1 | 'top' | 'bottom') {
    const l = this.layer(id);
    if (!l) return;
    const sibs = this.childrenOf(l.parentId);
    const i = sibs.indexOf(l);
    const j = dir === 'top' ? sibs.length - 1 : dir === 'bottom' ? 0 : Math.max(0, Math.min(sibs.length - 1, i + dir));
    if (i === j) return;
    // move the layer (and its subtree position is resolved by parentId, so only the record moves)
    this.layers.splice(this.layers.indexOf(l), 1);
    const target = sibs[j];
    const ti = this.layers.indexOf(target);
    this.layers.splice(j > i ? ti + 1 : ti, 0, l);
  }

  /** Reparent `id` to sit just above `refId` (drag & drop in the Layers panel), or into a group. */
  moveTo(id: string, refId: string, into: boolean) {
    const l = this.layer(id), ref = this.layer(refId);
    if (!l || !ref || id === refId) return;
    if (this.descendants(id).some((d) => d.id === refId)) return;
    this.layers.splice(this.layers.indexOf(l), 1);
    if (into && ref.kind === 'group') { l.parentId = ref.id; this.layers.push(l); return; }
    l.parentId = ref.parentId;
    this.layers.splice(this.layers.indexOf(ref) + 1, 0, l);
  }

  /** Copy-on-write: get a canvas that is safe to draw into (not shared with a history snapshot). */
  writable(l: Layer): Cnv {
    if (!l.canvas) l.canvas = newCanvas(this.width, this.height);
    if (this.frozen.has(l.canvas)) l.canvas = cloneCanvas(l.canvas);
    return l.canvas;
  }

  writableMask(l: Layer): LayerMask {
    if (!l.mask) throw new Error('Layer has no mask');
    if (this.frozen.has(l.mask.canvas)) l.mask = { ...l.mask, canvas: cloneCanvas(l.mask.canvas) };
    return l.mask;
  }

  /** Grow the layer canvas so it covers the whole document (before painting). */
  expandToDoc(l: Layer) {
    if (!l.canvas) { l.canvas = newCanvas(this.width, this.height); l.x = 0; l.y = 0; return; }
    const x0 = Math.min(l.x, 0), y0 = Math.min(l.y, 0);
    const x1 = Math.max(l.x + l.canvas.width, this.width), y1 = Math.max(l.y + l.canvas.height, this.height);
    if (x0 === l.x && y0 === l.y && x1 - x0 === l.canvas.width && y1 - y0 === l.canvas.height) return;
    const c = newCanvas(x1 - x0, y1 - y0);
    ctx2d(c).drawImage(l.canvas, l.x - x0, l.y - y0);
    l.canvas = c;
    l.x = x0;
    l.y = y0;
  }

  /** Layer pixels re-framed to the document rect (for filters, sampling, export). */
  layerDocCanvas(l: Layer): Cnv {
    const c = newCanvas(this.width, this.height);
    if (l.canvas) ctx2d(c).drawImage(l.canvas, l.x, l.y);
    return c;
  }

  // ---------- selection ----------

  setSelection(m: Mask | null) {
    if (this.selection) this.lastSelection = this.selection;
    this.selection = m;
  }

  /** Alpha canvas of the selection (doc-sized), cached per mask object. */
  selectionCanvas(): Cnv | null {
    if (!this.selection) return null;
    if (this.selCache?.mask !== this.selection) this.selCache = { mask: this.selection, canvas: maskToCanvas(this.selection) };
    return this.selCache.canvas;
  }

  // ---------- history ----------

  private snapshot(): Snapshot {
    for (const l of this.layers) {
      if (l.canvas) this.frozen.add(l.canvas);
      if (l.mask) this.frozen.add(l.mask.canvas);
    }
    return {
      width: this.width, height: this.height, layers: this.layers.map(cloneLayer), activeId: this.activeId,
      selection: this.selection, channels: [...this.channels], guides: [...this.guides],
    };
  }

  private restore(s: Snapshot) {
    this.width = s.width;
    this.height = s.height;
    this.layers = s.layers.map(cloneLayer);
    this.activeId = s.activeId;
    this.selection = s.selection;
    this.channels = [...s.channels];
    this.guides = [...s.guides];
  }

  /** Reset history to a single base state (after open / new). */
  resetHistory(label: string) {
    this.history = [{ label, time: Date.now(), state: this.snapshot() }];
    this.histIndex = 0;
    this.ui.historySource = 0;
  }

  /** Record the current state as an undo step. */
  commit(label: string) {
    this.history = this.history.slice(0, this.histIndex + 1);
    this.history.push({ label, time: Date.now(), state: this.snapshot() });
    this.histIndex = this.history.length - 1;
    this.trimHistory();
    this.touch();
    this.onCommit?.();
  }

  private trimHistory() {
    const bytes = () => {
      const seen = new Set<Cnv>();
      let n = 0;
      for (const e of this.history) for (const l of e.state.layers) {
        for (const c of [l.canvas, l.mask?.canvas]) if (c && !seen.has(c)) { seen.add(c); n += c.width * c.height * 4; }
      }
      return n;
    };
    while (this.history.length > 2 && (this.history.length > MAX_HISTORY || bytes() > HISTORY_BYTES)) {
      this.history.shift();
      this.histIndex--;
      this.ui.historySource = Math.max(0, this.ui.historySource - 1);
    }
  }

  get canUndo() { return this.histIndex > 0; }
  get canRedo() { return this.histIndex < this.history.length - 1; }

  jump(i: number) {
    if (i < 0 || i >= this.history.length || i === this.histIndex) return;
    this.override = null;
    this.adjustOverride = null;
    this.restore(this.history[i].state);
    this.histIndex = i;
    this.touch();
    this.onCommit?.();
  }
  undo() { this.jump(this.histIndex - 1); }
  redo() { this.jump(this.histIndex + 1); }

  clearHistory() {
    this.resetHistory(this.history[this.histIndex]?.label ?? 'State');
    this.emit();
  }

  /** Layer state recorded at a history step (History brush source). */
  historyLayer(index: number, layerId: string): Layer | undefined {
    return this.history[index]?.state.layers.find((l) => l.id === layerId);
  }
}
