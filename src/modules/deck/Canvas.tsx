// Slide editing surface: select, move, resize (handles), marquee, snapping, inline text/table editing.
import React, { useRef, useState } from 'react';
import type { ModuleApi } from '@/core/types';
import { pickAndInsertImage, insertImageBytes } from './commands';
import type { DeckDoc } from './doc';
import { SLIDE_H, SLIDE_W, type El, type Rect, type TextEl } from './model';
import { useSize } from './parts';
import { SlideView } from './SlideView';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
export const DEFAULT_SLIDE_PX = 736;

interface Guide { axis: 'x' | 'y'; at: number }

/** Snap a moving box to slide edges/center and other elements. Returns the offset correction + guides. */
export function snapBox(box: Rect, targets: Rect[], tol: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [0, SLIDE_W / 2, SLIDE_W, ...targets.flatMap((t) => [t.x, t.x + t.w / 2, t.x + t.w])];
  const ys = [0, SLIDE_H / 2, SLIDE_H, ...targets.flatMap((t) => [t.y, t.y + t.h / 2, t.y + t.h])];
  const best = (vals: number[], cands: number[]) => {
    let r: { d: number; at: number } | null = null;
    for (const v of vals) for (const c of cands) {
      const d = c - v;
      if (Math.abs(d) <= tol && (!r || Math.abs(d) < Math.abs(r.d))) r = { d, at: c };
    }
    return r;
  };
  const bx = best([box.x, box.x + box.w / 2, box.x + box.w], xs);
  const by = best([box.y, box.y + box.h / 2, box.y + box.h], ys);
  const guides: Guide[] = [];
  if (bx) guides.push({ axis: 'x', at: bx.at });
  if (by) guides.push({ axis: 'y', at: by.at });
  return { dx: bx?.d ?? 0, dy: by?.d ?? 0, guides };
}

export function resizeRect(o: Rect, h: Handle, dx: number, dy: number, keepAspect: boolean, min: number): Rect {
  let { x, y, w, h: hh } = o;
  if (h.includes('e')) w = o.w + dx;
  if (h.includes('w')) { w = o.w - dx; x = o.x + dx; }
  if (h.includes('s')) hh = o.h + dy;
  if (h.includes('n')) { hh = o.h - dy; y = o.y + dy; }
  if (keepAspect && o.w > 0 && o.h > 0 && h.length === 2) {
    const k = Math.max(w / o.w, hh / o.h);
    const nw = o.w * k, nh = o.h * k;
    if (h.includes('w')) x = o.x + o.w - nw;
    if (h.includes('n')) y = o.y + o.h - nh;
    w = nw; hh = nh;
  }
  if (w < min) { if (h.includes('w')) x -= min - w; w = min; }
  if (hh < min) { if (h.includes('n')) y -= min - hh; hh = min; }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) };
}

export function Canvas({ doc, api, animTime, pad = 32 }: { doc: DeckDoc; api: ModuleApi; animTime?: number; pad?: number }) {
  const [boxRef, size] = useSize<HTMLDivElement>();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [editingCell, setEditingCell] = useState<{ r: number; c: number } | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const slide = doc.slide();
  const d = doc.data;

  const availW = Math.max(120, size.w - pad * 2), availH = Math.max(68, size.h - pad * 2);
  const fit = Math.min(availW, (availH * SLIDE_W) / SLIDE_H);
  const width = Math.floor(doc.ui.zoomFit ? fit : Math.min(DEFAULT_SLIDE_PX, fit));
  const scale = width / SLIDE_W;
  if (!slide) return <div ref={boxRef} style={{ flex: 1 }} />;

  const toUnits = (clientX: number, clientY: number) => {
    const r = slideRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };

  const drag = (e: React.PointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onUp: (moved: boolean) => void) => {
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / scale, dy = (ev.clientY - sy) / scale;
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return;
      moved = true;
      onMove(dx, dy, ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      onUp(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onElPointerDown = (e: React.PointerEvent, el: El) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (doc.ui.editing === el.id) return;
    const wasOnlySelected = doc.ui.selection.length === 1 && doc.ui.selection[0] === el.id;
    if (doc.ui.editing) (document.activeElement as HTMLElement | null)?.blur();
    let sel = doc.ui.selection;
    if (e.shiftKey) sel = sel.includes(el.id) ? sel.filter((i) => i !== el.id) : [...sel, el.id];
    else if (!sel.includes(el.id)) sel = [el.id];
    doc.select(sel);
    setEditingCell(null);
    const moving = slide.elements.filter((x) => sel.includes(x.id));
    if (!moving.length) return;
    const orig = new Map(moving.map((m) => [m.id, { x: m.x, y: m.y }]));
    const others = slide.elements.filter((x) => !sel.includes(x.id));
    const bounds = boundsOf(moving);
    drag(e, (dx, dy, ev) => {
      let ddx = dx, ddy = dy;
      if (!ev.altKey) {
        const s = snapBox({ ...bounds, x: bounds.x + dx, y: bounds.y + dy }, others, 6 / scale);
        ddx += s.dx; ddy += s.dy;
        setGuides(s.guides);
      }
      for (const m of moving) { const o = orig.get(m.id)!; m.x = Math.round(o.x + ddx); m.y = Math.round(o.y + ddy); }
      doc.emit();
    }, (moved) => {
      setGuides([]);
      if (moved) doc.commit();
      // A second click on a selected text box starts editing it (PowerPoint behaviour).
      else if (el.type === 'text' && !e.shiftKey && (wasOnlySelected || (el.ph && !el.text.trim()))) { doc.ui.editing = el.id; doc.emit(); }
    });
  };

  const onHandleDown = (e: React.PointerEvent, el: El, h: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    const o: Rect = { x: el.x, y: el.y, w: el.w, h: el.h };
    const isLine = el.type === 'shape' && el.shape === 'line';
    drag(e, (dx, dy, ev) => {
      const keep = el.type === 'image' ? !ev.shiftKey : ev.shiftKey;
      Object.assign(el, resizeRect(o, h, dx, dy, keep, isLine ? 0 : 16));
      doc.emit();
    }, (moved) => { if (moved) doc.commit(); });
  };

  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (doc.ui.editing) (document.activeElement as HTMLElement | null)?.blur();
    setEditingCell(null);
    const start = toUnits(e.clientX, e.clientY);
    const additive = e.shiftKey;
    const base = additive ? doc.ui.selection : [];
    if (!additive) doc.select([]);
    drag(e, (dx, dy) => {
      const r = { x: Math.min(start.x, start.x + dx), y: Math.min(start.y, start.y + dy), w: Math.abs(dx), h: Math.abs(dy) };
      setMarquee(r);
      const hit = slide.elements.filter((el) => intersects(el, r)).map((el) => el.id);
      doc.select([...new Set([...base, ...hit])]);
    }, () => setMarquee(null));
  };

  const onElDoubleClick = (e: React.MouseEvent, el: El) => {
    e.stopPropagation();
    if (el.type === 'text') { doc.ui.editing = el.id; doc.ui.selection = [el.id]; doc.emit(); }
    else if (el.type === 'table') {
      const td = (e.target as HTMLElement).closest('td');
      const tr = td?.parentElement as HTMLTableRowElement | null;
      if (td && tr) { setEditingCell({ r: tr.rowIndex, c: (td as HTMLTableCellElement).cellIndex }); doc.ui.editing = el.id; doc.emit(); }
    } else if (el.type === 'image' && !el.src) {
      doc.ui.selection = [el.id];
      void pickAndInsertImage(doc, api).then(() => api.markDirty()).catch((err) => api.toast(String(err?.message ?? err), 'error'));
    }
  };

  const onTextInput = (el: TextEl, text: string) => { el.text = text; doc.commit('text:' + el.id); };
  const onTextBlur = (el: TextEl) => { if (doc.ui.editing === el.id) { doc.ui.editing = null; doc.emit(); } };
  const onCellInput = (id: string, r: number, c: number, text: string) => {
    const el = slide.elements.find((x) => x.id === id);
    if (el?.type === 'table' && el.rows[r]) { el.rows[r][c] = text; doc.commit(`cell:${id}:${r}:${c}`); }
  };

  const onDrop = async (e: React.DragEvent) => {
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault();
    try { await insertImageBytes(doc, new Uint8Array(await f.arrayBuffer()), f.type); api.markDirty(); } catch (err) { api.toast(String((err as Error).message), 'error'); }
  };

  const sel = slide.elements.filter((e) => doc.ui.selection.includes(e.id));
  const emptyPh = slide.elements.filter((e) => e.ph && ((e.type === 'text' && !e.text.trim()) || (e.type === 'image' && !e.src)) && !doc.ui.selection.includes(e.id));
  const height = (width * SLIDE_H) / SLIDE_W;

  return (
    <div ref={boxRef} onPointerDown={(e) => { if (e.target === e.currentTarget) onBackgroundDown(e); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={onDrop}
      style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', position: 'relative', background: 'var(--canvas)' }}>
      <div ref={slideRef} onPointerDown={onBackgroundDown} style={{ position: 'relative', width, height, boxShadow: 'var(--shadow-page)', flexShrink: 0, touchAction: 'none' }}>
        <SlideView deck={d} slide={slide} index={doc.ui.current} total={d.slides.length} width={width} mediaUrl={(p) => doc.mediaUrl(p)} hints
          animTime={animTime} editingId={doc.ui.editing} editingCell={editingCell}
          onElPointerDown={onElPointerDown} onElDoubleClick={onElDoubleClick} onTextInput={onTextInput} onTextBlur={onTextBlur} onCellInput={onCellInput}
          onCellBlur={() => { setEditingCell(null); if (doc.ui.editing) { doc.ui.editing = null; doc.emit(); } }} />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {emptyPh.map((el) => (
            <div key={'ph' + el.id} style={{ position: 'absolute', left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, border: '1px dashed rgba(128,128,128,.55)' }} />
          ))}
          {guides.map((g, i) => g.axis === 'x'
            ? <div key={i} style={{ position: 'absolute', left: g.at * scale, top: -2000, bottom: -2000, width: 1, background: 'var(--accent)' }} />
            : <div key={i} style={{ position: 'absolute', top: g.at * scale, left: -2000, right: -2000, height: 1, background: 'var(--accent)' }} />)}
          {sel.map((el) => (
            <div key={el.id} style={{ position: 'absolute', left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale, outline: '1px solid var(--accent)', outlineOffset: el.type === 'text' ? 4 : 0 }}>
              {sel.length === 1 && doc.ui.editing !== el.id && HANDLES.map((h) => (
                <div key={h} onPointerDown={(e) => onHandleDown(e, el, h)}
                  style={{ position: 'absolute', width: 8, height: 8, marginLeft: -4, marginTop: -4, background: '#fff', border: '1px solid var(--accent)', pointerEvents: 'auto', cursor: CURSOR[h], touchAction: 'none',
                    left: h.includes('w') ? (el.type === 'text' ? -4 : 0) : h.includes('e') ? `calc(100% + ${el.type === 'text' ? 4 : 0}px)` : '50%',
                    top: h.includes('n') ? (el.type === 'text' ? -4 : 0) : h.includes('s') ? `calc(100% + ${el.type === 'text' ? 4 : 0}px)` : '50%' }} />
              ))}
            </div>
          ))}
          {marquee && <div style={{ position: 'absolute', left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale, border: '1px solid var(--accent)', background: 'var(--sel)' }} />}
        </div>
      </div>
    </div>
  );
}

function boundsOf(els: Rect[]): Rect {
  const x = Math.min(...els.map((e) => e.x)), y = Math.min(...els.map((e) => e.y));
  return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => e.y + e.h)) - y };
}
function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + Math.max(a.w, 1) > b.x && a.y < b.y + b.h && a.y + Math.max(a.h, 1) > b.y;
}
