// Slide thumbnail rail: virtualized list, click to select, drag to reorder, context menu.
import React, { useRef, useState } from 'react';
import type { DeckDoc } from './doc';
import * as ops from './ops';
import { PopMenu } from './parts';
import { SlideView } from './SlideView';

const GAP = 10;

export function ThumbRail({ doc, width = 200 }: { doc: DeckDoc; width?: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(800);
  const [dragTo, setDragTo] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; i: number } | null>(null);
  const d = doc.data;
  const narrow = width < 150;
  const PAD = narrow ? 8 : 12, NUM_W = narrow ? 0 : 16;
  const thumbW = width - PAD * 2 - (narrow ? 0 : NUM_W + 8) - 1;
  const thumbH = Math.round((thumbW - 4) * 9 / 16) + 4;
  const item = thumbH + GAP;
  const n = d.slides.length;
  const first = Math.max(0, Math.floor((scrollTop - PAD) / item) - 2);
  const last = Math.min(n - 1, Math.ceil((scrollTop + viewH) / item) + 2);

  const indexAt = (clientY: number) => {
    const r = scroller.current!.getBoundingClientRect();
    const y = clientY - r.top + scroller.current!.scrollTop - PAD;
    return Math.max(0, Math.min(n, Math.round(y / item)));
  };

  const onDown = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0) return;
    const sy = e.clientY;
    let dragging = false;
    const move = (ev: PointerEvent) => {
      if (!dragging && Math.abs(ev.clientY - sy) < 5) return;
      dragging = true;
      setDragTo(indexAt(ev.clientY));
      // auto-scroll near the edges
      const r = scroller.current!.getBoundingClientRect();
      if (ev.clientY < r.top + 30) scroller.current!.scrollTop -= 12;
      if (ev.clientY > r.bottom - 30) scroller.current!.scrollTop += 12;
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDragTo(null);
      if (dragging) {
        const to = indexAt(ev.clientY);
        const target = to > i ? to - 1 : to;
        if (target !== i) { ops.moveSlide(doc, i, target); }
      } else doc.goTo(i);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const rows: React.ReactNode[] = [];
  for (let i = first; i <= last; i++) {
    const s = d.slides[i];
    const active = i === doc.ui.current;
    rows.push(
      <div key={s.id} onPointerDown={(e) => onDown(e, i)} onContextMenu={(e) => { e.preventDefault(); doc.goTo(i); setMenu({ x: e.clientX, y: e.clientY, i }); }}
        style={{ position: 'absolute', top: PAD + i * item, left: PAD, right: PAD, display: 'flex', gap: 8, cursor: 'pointer', touchAction: 'none' }}>
        {!narrow && <div style={{ width: NUM_W, font: 'var(--type-mono)', fontSize: 10, color: active ? 'var(--ink)' : 'var(--mute)', paddingTop: 2 }}>{String(i + 1).padStart(2, '0')}</div>}
        <div style={{ border: `2px solid ${active ? 'var(--accent)' : 'var(--line)'}`, lineHeight: 0 }}>
          <SlideView deck={d} slide={s} index={i} total={n} width={thumbW - 4} mediaUrl={(p) => doc.mediaUrl(p)} />
        </div>
      </div>,
    );
  }

  return (
    <div ref={scroller} onScroll={(e) => { setScrollTop(e.currentTarget.scrollTop); setViewH(e.currentTarget.clientHeight); }}
      onPointerEnter={(e) => setViewH(e.currentTarget.clientHeight)}
      style={{ width, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--bg1)', overflowY: 'auto', overflowX: 'hidden', position: 'relative' }}>
      <div style={{ height: PAD * 2 + n * item - GAP, position: 'relative' }}>
        {rows}
        {dragTo !== null && <div style={{ position: 'absolute', left: PAD + (narrow ? 0 : NUM_W + 8), right: PAD, top: PAD + dragTo * item - GAP / 2 - 1, height: 2, background: 'var(--accent)' }} />}
      </div>
      {menu && (
        <PopMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
          { label: 'New slide after', onClick: () => { ops.addSlide(doc); } },
          { label: 'Duplicate slide', hint: 'Ctrl D', onClick: () => { ops.duplicateSlide(doc, menu.i); } },
          { label: 'Delete slide', onClick: () => { ops.deleteSlide(doc, menu.i); } },
          '-',
          { label: 'Move up', disabled: menu.i === 0, onClick: () => { ops.moveSlide(doc, menu.i, menu.i - 1); } },
          { label: 'Move down', disabled: menu.i === n - 1, onClick: () => { ops.moveSlide(doc, menu.i, menu.i + 1); } },
        ]} />
      )}
    </div>
  );
}
