// Animation timeline (170px): one row per animated element, bars on a ruler, draggable delay/duration, playhead.
import React, { useEffect, useRef } from 'react';
import { Button, Eyebrow } from '@/ui';
import type { DeckDoc } from './doc';
import { ANIM_EFFECTS, elLabel, type El } from './model';
import * as ops from './ops';
import { dragAnim, pxToSec, rulerSeconds, rulerTicks, secToPct, slideBuildTime, type DragMode } from './timelineMath';

export function Timeline({ doc, playhead, setPlayhead }: { doc: DeckDoc; playhead: number | null; setPlayhead: (t: number | null) => void }) {
  const lane = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const slide = doc.slide();
  const animated = (slide?.elements.filter((e) => e.anim) ?? []).sort((a, b) => a.anim!.delay - b.anim!.delay);
  const ruler = rulerSeconds(animated.map((e) => e.anim!));
  const ticks = rulerTicks(ruler);
  const build = slide ? slideBuildTime(slide.elements) : 0;

  const stop = () => { cancelAnimationFrame(raf.current); raf.current = 0; };
  const preview = () => {
    stop();
    const t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (t >= build + 0.3) { setPlayhead(null); raf.current = 0; return; }
      setPlayhead(t);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  };
  useEffect(() => stop, []);
  // Tools › Preview animations
  const token = doc.ui.previewToken;
  useEffect(() => { if (token) preview(); }, [token]);

  const scrub = (e: React.PointerEvent) => {
    stop();
    const set = (x: number) => {
      const r = lane.current!.getBoundingClientRect();
      setPlayhead(Math.max(0, Math.min(ruler, pxToSec(x - r.left, r.width, ruler))));
    };
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const barDown = (e: React.PointerEvent, el: El, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();
    doc.select([el.id]);
    const orig = { ...el.anim! };
    const sx = e.clientX;
    const width = lane.current!.getBoundingClientRect().width;
    const move = (ev: PointerEvent) => {
      el.anim = dragAnim(orig, mode, pxToSec(ev.clientX - sx, width, ruler));
      doc.emit();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (el.anim!.delay !== orig.delay || el.anim!.duration !== orig.duration) doc.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const canAdd = doc.ui.selection.length > 0;
  const allAnimated = canAdd && doc.selected().every((e) => e.anim);

  return (
    <div style={{ height: 170, borderTop: '1px solid var(--line)', background: 'var(--bg1)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid var(--line)' }}>
        <Eyebrow>Animation timeline</Eyebrow>
        <span style={{ flex: 1 }} />
        <Button size="sm" disabled={!canAdd} title={canAdd ? '' : 'Select an element on the slide first'} onClick={() => ops.toggleAnimation(doc)}>
          {allAnimated ? '− Remove animation' : '+ Add animation'}
        </Button>
        <Button size="sm" disabled={!animated.length} onClick={() => (raf.current ? (stop(), setPlayhead(null)) : preview())}>{raf.current ? '■ Stop' : '▶ Preview'}</Button>
        <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>Slide {String(doc.ui.current + 1).padStart(2, '0')} · {build.toFixed(1)} s</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', flex: 1, overflowY: 'auto', overflowX: 'hidden', alignContent: 'start' }}>
        <div style={{ borderRight: '1px solid var(--line)' }}>
          <div style={{ height: 20 }} />
          {animated.map((el, i) => (
            <div key={el.id} onClick={() => doc.select([el.id])} className="hov-row"
              style={{ height: 26, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, borderTop: '1px solid var(--line)', font: 'var(--type-small)', cursor: 'pointer',
                color: doc.ui.selection.includes(el.id) ? 'var(--ink)' : 'var(--mute)', whiteSpace: 'nowrap', overflow: 'hidden' }}>
              <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{i + 1}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{elLabel(el)}</span>
            </div>
          ))}
          {!animated.length && <div className="empty-hint" style={{ padding: '8px 12px', fontSize: 11 }}>No animations on this slide</div>}
        </div>
        <div ref={lane} style={{ position: 'relative' }}>
          <div onPointerDown={scrub} style={{ height: 20, display: 'flex', font: 'var(--type-mono)', fontSize: 9, color: 'var(--mute)', cursor: 'ew-resize', touchAction: 'none' }}>
            {ticks.map((t, i) => <div key={i} style={{ width: `${100 / ticks.length}%`, paddingLeft: 4, borderLeft: '1px solid var(--line)', lineHeight: '20px' }}>{t}{i === ticks.length - 1 ? ' s' : ''}</div>)}
          </div>
          {animated.map((el) => {
            const a = el.anim!;
            const on = doc.ui.selection.includes(el.id);
            return (
              <div key={el.id} style={{ height: 26, borderTop: '1px solid var(--line)', position: 'relative' }}>
                <div onPointerDown={(e) => barDown(e, el, 'move')}
                  title={`${a.delay.toFixed(2)} s → ${(a.delay + a.duration).toFixed(2)} s`}
                  style={{ position: 'absolute', top: 5, height: 16, left: `${secToPct(a.delay, ruler)}%`, width: `max(${secToPct(a.duration, ruler)}%, 4px)`,
                    background: on ? 'var(--accent)' : 'var(--bg3)', color: on ? 'var(--on-accent)' : 'var(--ink)', font: '600 10px var(--font-ui)', padding: '0 6px',
                    display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', cursor: 'grab', touchAction: 'none' }}>
                  <span onPointerDown={(e) => barDown(e, el, 'start')} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }} />
                  {ANIM_EFFECTS.find((x) => x.id === a.effect)?.label}
                  <span onPointerDown={(e) => barDown(e, el, 'end')} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'ew-resize' }} />
                </div>
              </div>
            );
          })}
          {playhead !== null && <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${secToPct(playhead, ruler)}%`, width: 1, background: 'var(--accent)', pointerEvents: 'none' }} />}
        </div>
      </div>
    </div>
  );
}
