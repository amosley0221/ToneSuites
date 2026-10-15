// Editing operations shared by command handlers and the Editor. Each mutates the DeckDoc and commits.
import type { DeckDoc } from './doc';
import {
  applyLayout, cloneSlide, newId, newSlide, SLIDE_H, SLIDE_W, slideBg, slideInk, textEl,
  type AnimEffect, type El, type LayoutId, type ShapeKind, type TableEl, type Transition,
} from './model';
import { nextAnimation } from './timelineMath';

export function addSlide(doc: DeckDoc, layoutId?: LayoutId) {
  const cur = doc.slide();
  // PowerPoint behaviour: a new slide after a Title slide gets Title + content, otherwise the same layout.
  const lid = layoutId ?? (cur ? (cur.layoutId === 'title' ? 'title-content' : cur.layoutId) : 'title');
  const s = newSlide(doc.data, lid);
  const at = doc.data.slides.length ? doc.ui.current + 1 : 0;
  doc.data.slides.splice(at, 0, s);
  doc.ui.current = at;
  doc.ui.selection = [];
  doc.commit();
}

export function duplicateSlide(doc: DeckDoc, i = doc.ui.current) {
  const s = doc.data.slides[i];
  if (!s) return;
  doc.data.slides.splice(i + 1, 0, cloneSlide(s));
  doc.ui.current = i + 1;
  doc.ui.selection = [];
  doc.commit();
}

export function deleteSlide(doc: DeckDoc, i = doc.ui.current) {
  if (!doc.data.slides[i]) return;
  doc.data.slides.splice(i, 1);
  // A deck always keeps at least one slide.
  if (!doc.data.slides.length) doc.data.slides.push(newSlide(doc.data, 'title'));
  doc.ui.current = Math.min(i, doc.data.slides.length - 1);
  doc.ui.selection = [];
  doc.commit();
}

export function moveSlide(doc: DeckDoc, from: number, to: number) {
  const ss = doc.data.slides;
  if (from === to || !ss[from]) return;
  const [s] = ss.splice(from, 1);
  ss.splice(Math.max(0, Math.min(to, ss.length)), 0, s);
  doc.ui.current = ss.indexOf(s);
  doc.commit();
}

export function setLayout(doc: DeckDoc, id: LayoutId) {
  const s = doc.slide();
  if (!s) return;
  applyLayout(doc.data, s, id);
  doc.commit();
}

export function setTransition(doc: DeckDoc, t: Transition, all = false) {
  for (const s of all ? doc.data.slides : [doc.slide()]) if (s) s.transition = t;
  doc.commit();
}

function insert(doc: DeckDoc, el: El) {
  const s = doc.slide();
  if (!s) return;
  s.elements.push(el);
  doc.ui.selection = [el.id];
  doc.commit();
}

export function insertText(doc: DeckDoc) {
  const el = textEl('text', { x: 560, y: 470, w: 800, h: 140 }, '');
  insert(doc, el);
  doc.ui.editing = el.id;
  doc.emit();
}

export function insertShape(doc: DeckDoc, shape: ShapeKind) {
  const s = doc.slide();
  // Avoid an invisible shape when the slide background is the accent colour.
  const accent = s && slideBg(doc.data, s).toLowerCase() === doc.data.theme.accent.toLowerCase() ? slideInk(doc.data, s) : doc.data.theme.accent;
  const rect = shape === 'line' ? { x: 660, y: 540, w: 600, h: 0 } : { x: 760, y: 340, w: 400, h: 400 };
  insert(doc, { id: newId(), type: 'shape', shape, fill: shape === 'line' ? '' : accent, stroke: shape === 'line' ? accent : '', strokeWidth: shape === 'line' ? 8 : 0, ...rect });
}

export function insertTable(doc: DeckDoc, rows = 3, cols = 3) {
  const el: TableEl = {
    id: newId(), type: 'table', rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')), header: true, fontSize: 32,
    x: 260, y: 300, w: 1400, h: 80 * rows,
  };
  insert(doc, el);
}

/** Insert an image; fills an empty image placeholder on the slide if there is one. */
export function insertImage(doc: DeckDoc, bytes: Uint8Array, mime: string, natural?: { w: number; h: number }) {
  const s = doc.slide();
  if (!s) return;
  const src = doc.addMedia(bytes, mime);
  const target = s.elements.find((e) => e.type === 'image' && !e.src && (doc.ui.selection.includes(e.id) || e.ph === 'image'));
  if (target && target.type === 'image') {
    target.src = src;
    doc.ui.selection = [target.id];
    doc.commit();
    return;
  }
  let w = 960, h = 540;
  if (natural && natural.w > 0 && natural.h > 0) {
    const k = Math.min(1200 / natural.w, 800 / natural.h, 1);
    w = Math.round(natural.w * k); h = Math.round(natural.h * k);
  }
  insert(doc, { id: newId(), type: 'image', src, fit: 'contain', x: Math.round((SLIDE_W - w) / 2), y: Math.round((SLIDE_H - h) / 2), w, h });
}

export function deleteSelection(doc: DeckDoc) {
  const s = doc.slide();
  if (!s || !doc.ui.selection.length) return;
  const sel = new Set(doc.ui.selection);
  // Deleting a filled placeholder empties it (PowerPoint style); deleting an empty one removes it.
  s.elements = s.elements.flatMap((e) => {
    if (!sel.has(e.id)) return [e];
    if (e.ph && e.type === 'text' && e.text) return [{ ...e, text: '' }];
    if (e.ph && e.type === 'image' && e.src) return [{ ...e, src: '' }];
    return [];
  });
  doc.ui.selection = [];
  doc.commit();
}

export function duplicateSelection(doc: DeckDoc) {
  const s = doc.slide();
  if (!s) return;
  const copies = doc.selected().map((e) => ({ ...JSON.parse(JSON.stringify(e)), id: newId(), ph: undefined, phWas: undefined, x: e.x + 40, y: e.y + 40 }) as El);
  if (!copies.length) return;
  s.elements.push(...copies);
  doc.ui.selection = copies.map((c) => c.id);
  doc.commit();
}

export function copySelection(doc: DeckDoc) {
  doc.clipboard = JSON.parse(JSON.stringify(doc.selected()));
}
export function cutSelection(doc: DeckDoc) {
  copySelection(doc);
  const s = doc.slide();
  if (!s) return;
  const sel = new Set(doc.ui.selection);
  s.elements = s.elements.filter((e) => !sel.has(e.id));
  doc.ui.selection = [];
  doc.commit();
}

/** Clipboard format for elements copied out of a deck (so they paste into another deck, images included). */
export const CLIP_MIME = 'application/x-tone-deck';
interface ClipPayload { v: 1; els: El[]; media: Record<string, string> }

/** Serialize the selection for the system clipboard (images travel as data URLs). */
export function clipboardPayload(doc: DeckDoc): string | null {
  const els = doc.selected();
  if (!els.length) return null;
  const media: Record<string, string> = {};
  for (const e of els) if (e.type === 'image' && e.src && doc.media.has(e.src)) media[e.src] = doc.mediaUrl(e.src);
  return JSON.stringify({ v: 1, els, media } satisfies ClipPayload);
}

/** Plain-text version of the selection (text boxes and table cells). */
export function clipboardText(els: El[]): string {
  return els.map((e) => (e.type === 'text' ? e.text : e.type === 'table' ? e.rows.map((r) => r.join('\t')).join('\n') : '')).filter(Boolean).join('\n\n');
}

export function pastePayload(doc: DeckDoc, json: string): boolean {
  let p: ClipPayload;
  try { p = JSON.parse(json); } catch { return false; }
  if (!p || p.v !== 1 || !Array.isArray(p.els) || !p.els.length) return false;
  const remap = new Map<string, string>();
  for (const [path, url] of Object.entries(p.media ?? {})) {
    if (doc.media.has(path)) continue;
    const m = /^data:([^;,]+);base64,(.*)$/.exec(url);
    if (m) remap.set(path, doc.addMedia(fromBase64(m[2]), m[1]));
  }
  const els = p.els.map((e) => (e.type === 'image' && remap.has(e.src) ? { ...e, src: remap.get(e.src)! } : e));
  return pasteEls(doc, els);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Paste copies of `els` onto the current slide; they shift only when they would land exactly on an existing element. */
export function pasteEls(doc: DeckDoc, els: El[]): boolean {
  const s = doc.slide();
  if (!s || !els.length) return false;
  const taken = (dx: number) => els.some((e) => s.elements.some((x) => x.type === e.type && x.x === e.x + dx && x.y === e.y + dx && x.w === e.w && x.h === e.h));
  let off = 0;
  while (taken(off) && off < 40 * 50) off += 40;
  const copies = els.map((e) => {
    const c = { ...JSON.parse(JSON.stringify(e)), id: newId(), x: e.x + off, y: e.y + off } as El;
    delete c.ph; delete c.phWas;
    return c;
  });
  s.elements.push(...copies);
  doc.ui.selection = copies.map((c) => c.id);
  doc.ui.editing = null;
  doc.commit();
  return true;
}

export function paste(doc: DeckDoc): boolean {
  return pasteEls(doc, doc.clipboard);
}

/** Pasted plain text becomes a new text box. */
export function pasteText(doc: DeckDoc, text: string): boolean {
  const t = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
  if (!t.trim()) return false;
  const lines = t.split('\n').length;
  const h = Math.min(SLIDE_H - 80, Math.round(lines * 39 * 1.45 + 20));
  const el = textEl('text', { x: 360, y: Math.max(40, Math.round((SLIDE_H - h) / 2)), w: 1200, h }, t);
  insert(doc, el);
  return true;
}

export type ZOrder = 'front' | 'back' | 'forward' | 'backward';
export function arrange(doc: DeckDoc, how: ZOrder) {
  const s = doc.slide();
  if (!s) return;
  const sel = new Set(doc.ui.selection);
  if (!sel.size) return;
  const els = s.elements;
  if (how === 'front') s.elements = [...els.filter((e) => !sel.has(e.id)), ...els.filter((e) => sel.has(e.id))];
  else if (how === 'back') s.elements = [...els.filter((e) => sel.has(e.id)), ...els.filter((e) => !sel.has(e.id))];
  else if (how === 'forward') {
    for (let i = els.length - 2; i >= 0; i--) if (sel.has(els[i].id) && !sel.has(els[i + 1].id)) [els[i], els[i + 1]] = [els[i + 1], els[i]];
  } else {
    for (let i = 1; i < els.length; i++) if (sel.has(els[i].id) && !sel.has(els[i - 1].id)) [els[i], els[i - 1]] = [els[i - 1], els[i]];
  }
  doc.commit();
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';
/** Align to the slide for a single element, to the selection bounds for several. */
export function align(doc: DeckDoc, mode: AlignMode) {
  const els = doc.selected();
  if (!els.length) return;
  const b = els.length === 1
    ? { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H }
    : (() => {
      const x = Math.min(...els.map((e) => e.x)), y = Math.min(...els.map((e) => e.y));
      return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => e.y + e.h)) - y };
    })();
  for (const e of els) {
    if (mode === 'left') e.x = b.x;
    if (mode === 'hcenter') e.x = Math.round(b.x + (b.w - e.w) / 2);
    if (mode === 'right') e.x = b.x + b.w - e.w;
    if (mode === 'top') e.y = b.y;
    if (mode === 'vmiddle') e.y = Math.round(b.y + (b.h - e.h) / 2);
    if (mode === 'bottom') e.y = b.y + b.h - e.h;
  }
  doc.commit();
}

export function nudge(doc: DeckDoc, dx: number, dy: number) {
  const els = doc.selected();
  if (!els.length) return;
  for (const e of els) { e.x += dx; e.y += dy; }
  doc.commit('nudge');
}

export function toggleAnimation(doc: DeckDoc, effect: AnimEffect = 'fade') {
  const s = doc.slide();
  const els = doc.selected();
  if (!s || !els.length) return;
  const allAnimated = els.every((e) => e.anim);
  for (const e of els) {
    if (allAnimated) delete e.anim;
    else if (!e.anim) e.anim = nextAnimation(s.elements.filter((x) => x.anim).map((x) => x.anim!), effect);
  }
  doc.commit();
}

export function setBackground(doc: DeckDoc, bg: string, ink: string, scope: 'slide' | 'theme') {
  if (scope === 'theme') {
    doc.data.theme.bg = bg;
    doc.data.theme.ink = ink;
    // A theme change resets per-slide overrides so the whole deck follows it.
    for (const s of doc.data.slides) { delete s.bg; delete s.ink; }
    const m = doc.data.masters[0];
    delete m.bg; delete m.ink;
  } else {
    const s = doc.slide();
    if (!s) return;
    s.bg = bg; s.ink = ink;
  }
  doc.commit();
}

export function selectAll(doc: DeckDoc) {
  doc.select(doc.slide()?.elements.map((e) => e.id) ?? []);
}
