// One page in the work area: lazy canvas + text layer, edit overlay and tool interactions.
import { memo, useEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { BASE_W, usePaper } from './context';
import { editBounds, newId, translateEdit, type Edit, type PageRef, type Rect, type SubTool } from './model';
import { fitScale, geom, geomSync, pageProxy, pdfjs, renderPage, shownRotation, type FieldInfo, type Geom } from './render';
import { makeViewport, type Viewport } from './viewport';

type Draft =
  | { kind: 'rect'; a: [number, number]; b: [number, number]; sub: SubTool }
  | { kind: 'ink'; pts: number[] }
  | { kind: 'move'; id: string; dx: number; dy: number }
  | { kind: 'resize'; id: string; left: number; top: number; w: number; h: number };

const DRAW_SUBS: SubTool[] = ['pen', 'note', 'stamp', 'hl-area', 'redact', 'text', 'whiteout', 'place-sign'];

interface Props { pageRef: PageRef; index: number; zoom: number; root: HTMLElement | null; version: number; registerEl: (i: number, el: HTMLDivElement | null) => void }

export const PageView = memo(function PageView({ pageRef, index, zoom, root, registerEl }: Props) {
  const { model, commit, fields, openSignature, estimate } = usePaper();
  const ui = model.ui;
  const [g, setG] = useState<Geom | null>(() => geomSync(model, pageRef));
  useEffect(() => {
    if (g) return;
    let live = true;
    geom(model, pageRef).then((x) => { if (live) setG(x); }).catch(() => {});
    return () => { live = false; };
  }, [model, pageRef, g]);
  const geo = g ?? estimate;
  const rotation = shownRotation(geo, pageRef);
  const scale = fitScale(geo, pageRef, BASE_W) * zoom;
  const vp = makeViewport(geo.view, rotation, scale);

  const outer = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    const el = outer.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { root, rootMargin: '900px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Canvas: render when visible; debounce re-renders on zoom; free memory when far away.
  const srcBytes = model.source(pageRef.src)?.bytes;
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    if (!visible || !g) { if (!visible) { c.width = 0; c.height = 0; } return; }
    let job: ReturnType<typeof renderPage> | null = null;
    const t = setTimeout(() => {
      job = renderPage(c, model, pageRef, scale);
      job.promise.catch((e) => console.warn('Paper render', e));
    }, c.width ? 120 : 0);
    return () => { clearTimeout(t); job?.cancel(); };
  }, [visible, g, scale, pageRef, model, srcBytes]);

  // Text layer (selection + highlight-by-selection).
  useEffect(() => {
    const div = textRef.current;
    if (!div || !visible || !g || !pageRef.src) return;
    let dead = false;
    let tl: InstanceType<typeof pdfjs.TextLayer> | null = null;
    const t = setTimeout(() => {
      void (async () => {
        const page = await pageProxy(model, pageRef);
        if (dead || !page) return;
        div.replaceChildren();
        const viewport = page.getViewport({ scale, rotation });
        tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport });
        await tl.render();
      })().catch(() => {});
    }, 160);
    return () => { dead = true; clearTimeout(t); tl?.cancel(); };
  }, [visible, g, scale, rotation, pageRef, model]);

  const sub = ui.sub;
  const drawing = DRAW_SUBS.includes(sub);
  const passive = sub === 'pen' || sub === 'hl-text' || sub === 'strike';
  const edits = model.edits.filter((e) => e.page === pageRef.id);

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = outer.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  /** Generic window-level drag: move/up callbacks receive view coords. */
  const drag = (onMove: (p: [number, number]) => void, onUp: (p: [number, number]) => void) => {
    const mv = (ev: PointerEvent) => onMove(local(ev));
    const up = (ev: PointerEvent) => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); onUp(local(ev)); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const addEdit = (e: Edit, select = true) => {
    commit((m) => { m.edits = [...m.edits, e]; });
    if (select) model.setUi({ selected: e.id, page: index });
  };

  const placeSignature = (at: [number, number], fit?: Rect) => {
    const sig = model.ui.signature;
    if (!sig) { openSignature(); return; }
    let rect: Rect;
    if (fit) {
      const fv = vp.rectToView(fit);
      let w = fv.width, h = w / sig.aspect;
      if (h > fv.height) { h = fv.height; w = h * sig.aspect; }
      rect = vp.rectFromView(fv.left + (fv.width - w) / 2, fv.top + (fv.height - h) / 2, fv.left + (fv.width + w) / 2, fv.top + (fv.height + h) / 2);
    } else {
      const w = 160 * scale, h = w / sig.aspect;
      rect = vp.rectFromView(at[0] - w / 2, at[1] - h / 2, at[0] + w / 2, at[1] + h / 2);
    }
    addEdit({ id: newId(), page: pageRef.id, created: Date.now(), kind: 'signature', rect, image: sig.url });
    model.setUi({ sub: 'none' });
  };

  const startDraw = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    // preventDefault keeps focus where it was, so finish an open note / text box explicitly.
    // With the note or text tool, that click only commits the open one (no new empty box).
    const ae = document.activeElement;
    if (ae instanceof HTMLElement && (ae.tagName === 'TEXTAREA' || ae.tagName === 'INPUT') && ae.closest('.pp-page')) {
      ae.blur();
      if (sub === 'note' || sub === 'text') return;
    }
    const p = local(e);
    model.setUi({ selected: null, page: index });
    const now = Date.now();
    if (sub === 'pen') {
      let pts = [p[0], p[1]];
      setDraft({ kind: 'ink', pts });
      drag((q) => {
        const lx = pts[pts.length - 2], ly = pts[pts.length - 1];
        if (Math.hypot(q[0] - lx, q[1] - ly) < 1.5) return;
        pts = [...pts, q[0], q[1]];
        setDraft({ kind: 'ink', pts });
      }, () => {
        setDraft(null);
        const stroke: number[] = [];
        for (let i = 0; i < pts.length; i += 2) stroke.push(...vp.toPdf(pts[i], pts[i + 1]));
        addEdit({ id: newId(), page: pageRef.id, created: now, kind: 'ink', strokes: [stroke], color: model.ui.color, width: model.ui.penWidth }, false);
      });
      return;
    }
    if (sub === 'note') {
      const [x, y] = vp.toPdf(p[0], p[1]);
      const id = newId();
      addEdit({ id, page: pageRef.id, created: now, kind: 'note', x, y, text: '', color: '#ffd400' });
      setEditing(id);
      return;
    }
    if (sub === 'stamp') {
      const w = 140 * scale, h = 40 * scale;
      addEdit({ id: newId(), page: pageRef.id, created: now, kind: 'stamp', rect: vp.rectFromView(p[0] - w / 2, p[1] - h / 2, p[0] + w / 2, p[1] + h / 2), text: model.ui.stampText, color: model.ui.color });
      return;
    }
    if (sub === 'place-sign') { placeSignature(p); return; }
    startRect(p, sub);
  };

  const startRect = (p: [number, number], kind: SubTool) => {
    const now = Date.now();
    let b = p;
    setDraft({ kind: 'rect', a: p, b, sub: kind });
    drag((q) => { b = q; setDraft({ kind: 'rect', a: p, b: q, sub: kind }); }, () => {
      setDraft(null);
      const big = Math.abs(b[0] - p[0]) > 4 && Math.abs(b[1] - p[1]) > 4;
      if (kind === 'text') {
        const r = big ? vp.rectFromView(p[0], p[1], b[0], b[1]) : vp.rectFromView(p[0], p[1], p[0] + 220 * scale, p[1] + 40 * scale);
        const id = newId();
        addEdit({ id, page: pageRef.id, created: now, kind: 'text', rect: r, text: '', size: model.ui.textSize, color: '#1a1a1a' });
        setEditing(id);
        return;
      }
      if (!big) return;
      const rect = vp.rectFromView(p[0], p[1], b[0], b[1]);
      if (kind === 'redact') addEdit({ id: newId(), page: pageRef.id, created: now, kind: 'redact', rect, applied: false });
      else if (kind === 'whiteout') addEdit({ id: newId(), page: pageRef.id, created: now, kind: 'whiteout', rect });
      else addEdit({ id: newId(), page: pageRef.id, created: now, kind: 'highlight', rects: [rect], color: model.ui.hlColor, style: kind === 'strike' ? 'strike' : 'highlight' }, false);
    });
  };

  // Highlight-by-selection: blank areas start an area highlight, text spans select text.
  const onRootDown = (e: RPointerEvent) => {
    if ((sub !== 'hl-text' && sub !== 'strike') || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.tagName === 'SPAN' || !outer.current?.contains(t)) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    startRect(local(e), sub === 'strike' ? 'strike' : 'hl-area');
  };
  const onRootUp = () => {
    if (sub !== 'hl-text' && sub !== 'strike') return;
    setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !textRef.current) return;
      const range = sel.getRangeAt(0);
      if (!textRef.current.contains(range.commonAncestorContainer)) return;
      const box = outer.current!.getBoundingClientRect();
      const rects = mergeLineRects([...range.getClientRects()]
        .filter((r) => r.width > 1 && r.height > 1)
        .map((r) => vp.rectFromView(r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top)));
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      sel.removeAllRanges();
      if (!rects.length) return;
      addEdit({ id: newId(), page: pageRef.id, created: Date.now(), kind: 'highlight', rects, color: sub === 'strike' ? model.ui.color : model.ui.hlColor, style: sub === 'strike' ? 'strike' : 'highlight', text: text.slice(0, 200) }, false);
    }, 0);
  };

  const startMove = (e: RPointerEvent, ed: Edit) => {
    if (e.button !== 0 || passive) return;
    e.stopPropagation(); e.preventDefault();
    model.setUi({ selected: ed.id, page: index });
    const p = local(e);
    let d: [number, number] = [0, 0];
    drag((q) => { d = [q[0] - p[0], q[1] - p[1]]; setDraft({ kind: 'move', id: ed.id, dx: d[0], dy: d[1] }); }, () => {
      setDraft(null);
      if (Math.hypot(d[0], d[1]) < 2) return;
      const [x0, y0] = vp.toPdf(0, 0), [x1, y1] = vp.toPdf(d[0], d[1]);
      commit((m) => { m.edits = m.edits.map((x) => (x.id === ed.id ? translateEdit(x, x1 - x0, y1 - y0) : x)); });
    });
  };

  const startResize = (e: RPointerEvent, ed: Edit & { rect: Rect }) => {
    e.stopPropagation(); e.preventDefault();
    const v = vp.rectToView(ed.rect);
    const p = local(e);
    let cur = { left: v.left, top: v.top, w: v.width, h: v.height };
    const keepAspect = ed.kind === 'signature';
    drag((q) => {
      let w = Math.max(8, v.width + q[0] - p[0]);
      let h = Math.max(8, v.height + q[1] - p[1]);
      if (keepAspect) h = w * (v.height / v.width);
      cur = { left: v.left, top: v.top, w, h };
      setDraft({ kind: 'resize', id: ed.id, ...cur });
    }, () => {
      setDraft(null);
      const rect = vp.rectFromView(cur.left, cur.top, cur.left + cur.w, cur.top + cur.h);
      commit((m) => { m.edits = m.edits.map((x) => (x.id === ed.id ? { ...x, rect } as Edit : x)); });
    });
  };

  const setText = (id: string, text: string) => commit((m) => { m.edits = m.edits.map((x) => (x.id === id && 'text' in x ? { ...x, text } as Edit : x)); }, 'text:' + id);
  const finishEditing = (id: string) => {
    setEditing(null);
    const ed = model.edits.find((x) => x.id === id);
    if (ed && (ed.kind === 'text' || ed.kind === 'note') && !ed.text.trim()) commit((m) => { m.edits = m.edits.filter((x) => x.id !== id); });
  };

  const pageFields = pageRef.src && pageRef.src === model.sources[0]?.id ? fields.filter((f) => f.page === pageRef.index) : [];
  const newFields = model.newFields.filter((f) => f.page === pageRef.id);
  const hits = ui.search.hits.map((h, i) => ({ h, i })).filter(({ h }) => h.page === pageRef.id);
  const totalScale = { '--total-scale-factor': String(scale) } as CSSProperties;

  return (
    <div ref={(el) => { outer.current = el; registerEl(index, el); }} data-page={index}
      className={'pp-page' + (drawing ? ' no-text' : '')}
      onPointerDown={onRootDown} onPointerUp={onRootUp}
      style={{ width: vp.width, height: vp.height, margin: '0 auto', ...totalScale }}>
      <canvas ref={canvasRef} className="pp-canvas" />
      <div ref={textRef} className="textLayer" />
      {drawing && (
        <div onPointerDown={startDraw} style={{ position: 'absolute', inset: 0, zIndex: 2, cursor: sub === 'place-sign' || sub === 'note' || sub === 'stamp' ? 'copy' : 'crosshair', touchAction: 'none' }} />
      )}
      <div className={'pp-overlay' + (passive ? ' passive' : '')} style={{ zIndex: 3 }}>
        {hits.map(({ h, i }) => h.rects.map((r, k) => {
          const v = vp.rectToView(r);
          const cur = i === ui.search.index;
          return <div key={`h${i}-${k}`} style={{ position: 'absolute', left: v.left - 1, top: v.top - 1, width: v.width + 2, height: v.height + 2, background: cur ? 'rgba(255,90,31,.35)' : 'rgba(255,90,31,.15)', outline: cur ? '1px solid var(--accent)' : 'none' }} />;
        }))}
        {edits.map((ed) => (
          <EditView key={ed.id} ed={ed} vp={vp} selected={ui.selected === ed.id} draft={draft} editing={editing === ed.id}
            onDown={(e) => startMove(e, ed)} onResize={(e) => 'rect' in ed && startResize(e, ed)}
            onDouble={() => { if (ed.kind === 'text' || ed.kind === 'note') setEditing(ed.id); }}
            onText={(t) => setText(ed.id, t)} onDone={() => finishEditing(ed.id)} />
        ))}
        {draft?.kind === 'rect' && (() => {
          const l = Math.min(draft.a[0], draft.b[0]), t = Math.min(draft.a[1], draft.b[1]);
          const w = Math.abs(draft.a[0] - draft.b[0]), h = Math.abs(draft.a[1] - draft.b[1]);
          const bg = draft.sub === 'redact' ? 'rgba(0,0,0,.55)' : draft.sub === 'whiteout' ? '#ffffff' : draft.sub === 'text' ? 'transparent' : hexA(model.ui.hlColor, 0.4);
          return <div style={{ position: 'absolute', left: l, top: t, width: w, height: h, background: bg, outline: '1px dashed var(--accent)' }} />;
        })()}
        {draft?.kind === 'ink' && (
          <svg width={vp.width} height={vp.height} style={{ position: 'absolute', inset: 0 }}>
            <polyline points={pairs(draft.pts)} fill="none" stroke={model.ui.color} strokeWidth={model.ui.penWidth * scale} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <FieldsLayer pageFields={pageFields} newFields={newFields} vp={vp} index={index} onSign={placeSignature} />
    </div>
  );
});

function pairs(pts: number[]) {
  const out: string[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(`${pts[i]},${pts[i + 1]}`);
  return out.join(' ');
}

export function hexA(hex: string, a: number) {
  const n = parseInt(hex.replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Merge selection rects that sit on the same line (client rects come per text span). */
function mergeLineRects(rs: Rect[]): Rect[] {
  const out: Rect[] = [];
  for (const r of rs.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - r.y) < r.h * 0.5 && Math.abs(last.h - r.h) < r.h * 0.5 && r.x <= last.x + last.w + 4) {
      const x1 = Math.max(last.x + last.w, r.x + r.w);
      last.w = x1 - last.x;
      last.y = Math.min(last.y, r.y);
      last.h = Math.max(last.h, r.h);
    } else out.push({ ...r });
  }
  return out;
}

interface EditViewProps {
  ed: Edit; vp: Viewport; selected: boolean; draft: Draft | null; editing: boolean;
  onDown: (e: RPointerEvent) => void; onResize: (e: RPointerEvent) => void; onDouble: () => void; onText: (t: string) => void; onDone: () => void;
}

function EditView({ ed, vp, selected, draft, editing, onDown, onResize, onDouble, onText, onDone }: EditViewProps) {
  const moving = draft?.kind === 'move' && draft.id === ed.id ? draft : null;
  const resizing = draft?.kind === 'resize' && draft.id === ed.id ? draft : null;
  const shift: CSSProperties = moving ? { transform: `translate(${moving.dx}px, ${moving.dy}px)` } : {};
  const sel = selected ? { outline: '1px solid var(--accent)', outlineOffset: 2 } : {};
  const common = { className: 'pp-hit', onPointerDown: onDown, onDoubleClick: onDouble };
  const box = (r: Rect) => {
    const v = vp.rectToView(r);
    if (resizing) return { left: resizing.left, top: resizing.top, width: resizing.w, height: resizing.h };
    return v;
  };
  const handle = selected && 'rect' in ed && ed.kind !== 'redact' || (selected && ed.kind === 'redact' && !ed.applied)
    ? (() => { const v = box((ed as { rect: Rect }).rect); return <div onPointerDown={onResize} style={{ position: 'absolute', left: v.left + v.width - 4, top: v.top + v.height - 4, width: 8, height: 8, background: 'var(--accent)', cursor: 'nwse-resize', pointerEvents: 'auto', ...shift }} />; })()
    : null;
  const scale = vp.scale;

  switch (ed.kind) {
    case 'highlight':
      return (<>{ed.rects.map((r, i) => {
        const v = vp.rectToView(r);
        const style: CSSProperties = ed.style === 'strike'
          ? { position: 'absolute', left: v.left, top: v.top, width: v.width, height: v.height, background: `linear-gradient(transparent calc(50% - ${Math.max(1, v.height * 0.04)}px), ${ed.color} 0 calc(50% + ${Math.max(1, v.height * 0.04)}px), transparent 0)` }
          : { position: 'absolute', left: v.left, top: v.top, width: v.width, height: v.height, background: hexA(ed.color, 0.4), mixBlendMode: 'multiply' };
        return <div key={i} {...common} title={ed.text} style={{ ...style, ...(i === 0 ? sel : {}), ...shift }} />;
      })}</>);
    case 'ink': {
      const b = vp.rectToView(editBounds(ed));
      return (
        <svg width={vp.width} height={vp.height} style={{ position: 'absolute', inset: 0, overflow: 'visible', ...shift }}>
          {ed.strokes.map((s, i) => {
            const pts: number[] = [];
            for (let k = 0; k < s.length; k += 2) pts.push(...vp.toView(s[k], s[k + 1]));
            return <polyline key={i} className="pp-hit" onPointerDown={onDown} points={pairs(pts)} fill="none" stroke={ed.color} strokeWidth={Math.max(ed.width * scale, 1)} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: 'stroke' }} />;
          })}
          {selected && <rect x={b.left - 3} y={b.top - 3} width={b.width + 6} height={b.height + 6} fill="none" stroke="var(--accent)" strokeWidth={1} />}
        </svg>
      );
    }
    case 'note': {
      const [x, y] = vp.toView(ed.x, ed.y);
      return (
        <>
          <div {...common} title={ed.text} style={{ position: 'absolute', left: x, top: y, width: 18, height: 18, background: ed.color, border: '1px solid rgba(0,0,0,.35)', boxShadow: '0 2px 6px rgba(0,0,0,.25)', ...sel, ...shift }} />
          {(selected || editing) && (
            <div style={{ position: 'absolute', left: x + 24, top: y, width: 220, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', padding: 8, pointerEvents: 'auto', zIndex: 6, ...shift }} onPointerDown={(e) => e.stopPropagation()}>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Note</div>
              <textarea autoFocus={editing} value={ed.text} placeholder="Type a note…" onChange={(e) => onText(e.target.value)} onBlur={onDone}
                style={{ width: '100%', height: 80, resize: 'none', background: 'var(--bg0)', color: 'var(--ink)', border: '1px solid var(--line)', outline: 'none', font: 'var(--type-small)', padding: 6 }} />
            </div>
          )}
        </>
      );
    }
    case 'text': {
      const v = box(ed.rect);
      const st: CSSProperties = { position: 'absolute', left: v.left, top: v.top, width: v.width, minHeight: v.height, color: ed.color, font: `400 ${ed.size * scale}px/1.25 Helvetica, Arial, sans-serif`, padding: 2 * scale, whiteSpace: 'pre-wrap', wordBreak: 'break-word', ...shift };
      if (editing) {
        return <textarea autoFocus value={ed.text} onChange={(e) => onText(e.target.value)} onBlur={onDone} onPointerDown={(e) => e.stopPropagation()} placeholder="Type…"
          style={{ ...st, height: v.height, pointerEvents: 'auto', background: 'rgba(255,255,255,.6)', border: '1px dashed var(--accent)', outline: 'none', resize: 'none', zIndex: 6 }} />;
      }
      return <>{<div {...common} style={{ ...st, ...(selected ? sel : { outline: '1px dashed rgba(0,0,0,.15)' }) }}>{ed.text}</div>}{handle}</>;
    }
    case 'stamp': {
      const v = box(ed.rect);
      return (<>
        <div {...common} style={{ position: 'absolute', left: v.left, top: v.top, width: v.width, height: v.height, border: `${Math.max(1, 2 * scale)}px solid ${ed.color}`, color: ed.color, display: 'flex', alignItems: 'center', justifyContent: 'center', font: `800 ${Math.min(v.height * 0.5, v.width / Math.max(4, ed.text.length * 0.7))}px Helvetica, Arial, sans-serif`, letterSpacing: '0.04em', opacity: 0.9, ...sel, ...shift }}>{ed.text.toUpperCase()}</div>
        {handle}
      </>);
    }
    case 'whiteout': {
      const v = box(ed.rect);
      return <>{<div {...common} style={{ position: 'absolute', left: v.left, top: v.top, width: v.width, height: v.height, background: '#ffffff', outline: selected ? '1px solid var(--accent)' : '1px dashed rgba(0,0,0,.12)', ...shift }} />}{handle}</>;
    }
    case 'redact': {
      const v = box(ed.rect);
      return <>{<div {...common} title={ed.applied ? 'Applied — burnt in on save' : 'Marked — use Apply redactions'} style={{ position: 'absolute', left: v.left, top: v.top, width: v.width, height: v.height, background: ed.applied ? '#000000' : 'rgba(0,0,0,.55)', outline: ed.applied ? (selected ? '1px solid var(--accent)' : 'none') : '1px solid var(--accent)', ...shift }} />}{handle}</>;
    }
    case 'signature': {
      const v = box(ed.rect);
      return <>{<img {...common} src={ed.image} alt="Signature" draggable={false} style={{ position: 'absolute', left: v.left, top: v.top, width: v.width, height: v.height, ...sel, ...shift }} />}{handle}</>;
    }
  }
}

function FieldsLayer({ pageFields, newFields, vp, index, onSign }: {
  pageFields: FieldInfo[]; newFields: { id: string; rect: Rect; type: string; name: string }[]; vp: Viewport; index: number; onSign: (at: [number, number], fit?: Rect) => void;
}) {
  const { model, commit } = usePaper();
  const tool = model.ui.tool;
  const fill = tool === 'Fill form';
  const sign = tool === 'Sign';
  const set = (name: string, v: string | boolean, key?: string) => commit((m) => { m.formValues = { ...m.formValues, [name]: v }; }, key);
  if (!pageFields.length && !newFields.length) return null;
  const fs = (h: number) => Math.max(8, Math.min(h * 0.62, 14 * vp.scale));
  const sigBox = (key: string, v: { left: number; top: number; width: number; height: number }, r: Rect) => (
    <div key={key} onPointerDown={(e) => { if (!sign) return; e.stopPropagation(); onSign([0, 0], r); model.setUi({ page: index }); }}
      style={{ position: 'absolute', ...v, border: '1px dashed var(--accent)', background: 'rgba(255,90,31,.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', font: '500 10px var(--font-mono)', color: 'var(--accent)', pointerEvents: sign ? 'auto' : 'none', cursor: sign ? 'pointer' : 'default', zIndex: 4, overflow: 'hidden', whiteSpace: 'nowrap' }}>
      {sign ? '[ signature field — click to sign ]' : '[ signature field ]'}
    </div>
  );
  return (
    <>
      {pageFields.map((f, i) => {
        const v = vp.rectToView(f.rect);
        const key = `${f.name}#${i}`;
        const val = f.name in model.formValues ? model.formValues[f.name] : f.value;
        const edited = f.name in model.formValues;
        if (f.type === 'signature') return sigBox(key, v, f.rect);
        if (!fill && !edited) return null;
        const pe: CSSProperties = fill && !f.readOnly ? {} : { pointerEvents: 'none', border: '1px solid transparent', background: 'transparent' };
        if (f.type === 'checkbox' || f.type === 'radiobutton') {
          const on = f.type === 'checkbox' ? val === true || (typeof val === 'string' && val !== '' && val !== 'Off') : val === f.exportValue;
          return (
            <button key={key} type="button" className="pp-input" onClick={() => set(f.name, f.type === 'checkbox' ? !on : (f.exportValue ?? 'On'))}
              style={{ ...v, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: fs(v.height) * 1.1, fontWeight: 800, cursor: 'pointer', ...pe }}>{on ? (f.type === 'checkbox' ? '✓' : '●') : ''}</button>
          );
        }
        if ((f.type === 'combobox' || f.type === 'listbox') && f.options?.length) {
          return (
            <select key={key} className="pp-input" value={String(val ?? '')} onChange={(e) => set(f.name, e.target.value)} style={{ ...v, fontSize: fs(v.height), ...pe }}>
              <option value="" />
              {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        }
        const common = { className: 'pp-input', value: String(val ?? ''), onChange: (e: { target: { value: string } }) => set(f.name, e.target.value, 'field:' + f.name), style: { ...v, fontSize: fs(f.multiline ? Math.min(v.height, 20 * vp.scale) : v.height), ...pe } };
        return f.multiline ? <textarea key={key} {...common} style={{ ...common.style, resize: 'none' }} /> : <input key={key} {...common} />;
      })}
      {newFields.map((f) => {
        const v = vp.rectToView(f.rect);
        if (f.type === 'signature') return sigBox(f.id, v, f.rect);
        const val = model.formValues[f.name];
        if (fill) {
          if (f.type === 'checkbox') {
            return <button key={f.id} type="button" className="pp-input" onClick={() => set(f.name, val !== true)} style={{ ...v, padding: 0, fontWeight: 800 }}>{val === true ? '✓' : ''}</button>;
          }
          return <input key={f.id} className="pp-input" placeholder={f.name} inputMode={f.type === 'number' ? 'decimal' : undefined} type={f.type === 'date' ? 'date' : 'text'}
            value={typeof val === 'string' ? val : ''} onChange={(e) => set(f.name, e.target.value, 'field:' + f.name)} style={{ ...v, fontSize: fs(v.height) }} />;
        }
        return (
          <div key={f.id} style={{ position: 'absolute', ...v, border: '1px dashed var(--info)', font: '500 9px var(--font-mono)', color: 'var(--info)', padding: '0 4px', display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap', zIndex: 4, pointerEvents: 'none' }}>
            {typeof val === 'string' && val ? <span style={{ color: 'var(--paper-ink)', font: `500 ${fs(v.height)}px var(--font-ui)` }}>{val}</span> : f.type === 'checkbox' ? (val === true ? '✓' : '') : f.name}
          </div>
        );
      })}
    </>
  );
}
