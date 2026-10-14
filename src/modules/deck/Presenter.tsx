// Slide show (F5) and presenter view: full-screen black overlay, transitions, timed builds, keys.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri, setFullscreen } from '@/core/platform';
import type { DeckDoc } from './doc';
import { SLIDE_H, SLIDE_W, slideTitle, type Slide } from './model';
import { useSize } from './parts';
import { SlideView } from './SlideView';
import { slideBuildTime } from './timelineMath';

const TRANS_DUR: Record<Slide['transition'], number> = { none: 0, fade: 0.5, push: 0.5, morph: 0.8 };
const MUTE = '#8d8d96', LINE = '#2b2b32', INK = '#f2f1ee';
const pad2 = (n: number) => String(n).padStart(2, '0');
const mmss = (ms: number) => { const s = Math.floor(ms / 1000); return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`; };

interface ShowState { index: number; prev: number | null; enteredAt: number; built: boolean; ended: boolean }

/** Renders the current slide with its incoming transition and build at time `now`. */
function Stage({ doc, st, now, width }: { doc: DeckDoc; st: ShowState; now: number; width: number }) {
  const d = doc.data;
  const s = d.slides[st.index];
  if (!s || width <= 0) return null;
  const media = (p: string) => doc.mediaUrl(p);
  const total = d.slides.length;
  const elapsed = (now - st.enteredAt) / 1000;
  const dur = st.prev !== null ? TRANS_DUR[s.transition] : 0;
  const p = dur > 0 ? Math.min(1, elapsed / dur) : 1;
  const animTime = st.built ? undefined : Math.max(0, elapsed - dur);
  const prev = st.prev !== null ? d.slides[st.prev] : undefined;
  const h = (width * SLIDE_H) / SLIDE_W;
  const cur = (style?: React.CSSProperties, morph?: { from: Slide; p: number }) => (
    <SlideView deck={d} slide={s} index={st.index} total={total} width={width} mediaUrl={media} animTime={animTime} morph={morph} style={style} />
  );
  if (!prev || p >= 1 || s.transition === 'none') return cur();
  if (s.transition === 'morph') return cur(undefined, { from: prev, p });
  const old = <SlideView deck={d} slide={prev} index={st.prev!} total={total} width={width} mediaUrl={media} />;
  const e = 1 - Math.pow(1 - p, 3);
  return (
    <div style={{ width, height: h, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, transform: s.transition === 'push' ? `translateX(${-e * 100}%)` : undefined }}>{old}</div>
      <div style={{ position: 'absolute', inset: 0, opacity: s.transition === 'fade' ? e : 1, transform: s.transition === 'push' ? `translateX(${(1 - e) * 100}%)` : undefined }}>{cur()}</div>
    </div>
  );
}

export function Presenter({ doc, onExit }: { doc: DeckDoc; onExit: (summary?: string) => void }) {
  const mode = doc.ui.presenting!;
  const d = doc.data;
  const n = d.slides.length;
  const [st, setSt] = useState<ShowState>(() => ({ index: doc.ui.presentFrom, prev: null, enteredAt: performance.now(), built: false, ended: false }));
  const [now, setNow] = useState(performance.now());
  const [blank, setBlank] = useState<null | 'black' | 'white'>(null);
  const startedAt = useRef(Date.now());
  const perSlide = useRef<number[]>(Array(n).fill(0));
  const slideStart = useRef(Date.now());
  const stRef = useRef(st);
  stRef.current = st;
  const [stageRef, stageSize] = useSize<HTMLDivElement>();

  // Animation clock
  useEffect(() => {
    let raf = 0;
    const tick = () => { setNow(performance.now()); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Full screen for the duration of the show; leaving browser full screen (Esc) ends it.
  useEffect(() => {
    void setFullscreen(true);
    const onFs = () => { if (!isTauri && !document.fullscreenElement) onExit(); };
    const t = setTimeout(() => document.addEventListener('fullscreenchange', onFs), 300);
    return () => { clearTimeout(t); document.removeEventListener('fullscreenchange', onFs); void setFullscreen(false); };
  }, [onExit]);

  const recordSlideTime = () => {
    const i = stRef.current.index;
    perSlide.current[i] = (perSlide.current[i] ?? 0) + (Date.now() - slideStart.current);
    slideStart.current = Date.now();
  };

  const finish = useCallback(() => {
    recordSlideTime();
    if (mode === 'rehearse') {
      const total = Date.now() - startedAt.current;
      const list = perSlide.current.map((ms, i) => `${i + 1}: ${mmss(ms)}`).join(' · ');
      onExit(`Rehearsal ${mmss(total)} — ${list}`);
    } else onExit();
  }, [mode, onExit]);

  const go = useCallback((delta: 1 | -1) => {
    const cur = stRef.current;
    setBlank(null);
    if (cur.ended) { if (delta === 1) finish(); else setSt({ ...cur, ended: false, built: true }); return; }
    if (delta === 1) {
      const s = d.slides[cur.index];
      const dur = cur.prev !== null ? TRANS_DUR[s.transition] : 0;
      const elapsed = (performance.now() - cur.enteredAt) / 1000;
      // First finish the running transition/build, then advance.
      if (!cur.built && elapsed < dur + slideBuildTime(s.elements)) { setSt({ ...cur, built: true, enteredAt: performance.now() - dur * 1000 }); return; }
      recordSlideTime();
      if (cur.index >= n - 1) { setSt({ ...cur, ended: true }); return; }
      setSt({ index: cur.index + 1, prev: cur.index, enteredAt: performance.now(), built: false, ended: false });
    } else {
      if (cur.index <= 0) return;
      recordSlideTime();
      setSt({ index: cur.index - 1, prev: null, enteredAt: performance.now(), built: true, ended: false });
    }
  }, [d, n, finish]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const k = e.key;
      let used = true;
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'Enter' || k === 'n') go(1);
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p') go(-1);
      else if (k === 'b' || k === 'B' || k === '.') setBlank((b) => (b === 'black' ? null : 'black'));
      else if (k === 'w' || k === 'W' || k === ',') setBlank((b) => (b === 'white' ? null : 'white'));
      else if (k === 'Escape') finish();
      else if (k === 'Home') { recordSlideTime(); setSt({ index: 0, prev: null, enteredAt: performance.now(), built: true, ended: false }); }
      else if (k === 'End') { recordSlideTime(); setSt({ index: n - 1, prev: null, enteredAt: performance.now(), built: true, ended: false }); }
      else used = false;
      if (used) { e.preventDefault(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [go, finish, n]);

  const fitW = (w: number, h: number) => Math.max(0, Math.floor(Math.min(w, (h * SLIDE_W) / SLIDE_H)));
  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, background: '#000', color: INK, zIndex: 1000, userSelect: 'none' };
  const blankLayer = blank && <div style={{ position: 'absolute', inset: 0, background: blank === 'black' ? '#000' : '#fff', zIndex: 2 }} />;
  const endLayer = st.ended && (
    <div style={{ position: 'absolute', inset: 0, background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', font: 'var(--type-mono)', color: MUTE, zIndex: 1 }}>
      End of slide show — click or press → to exit
    </div>
  );

  if (mode === 'present') {
    return (
      <div style={overlay} onClick={() => go(1)} onContextMenu={(e) => { e.preventDefault(); go(-1); }}>
        <div ref={stageRef} style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'none' }}>
          <Stage doc={doc} st={st} now={now} width={fitW(stageSize.w, stageSize.h)} />
        </div>
        {endLayer}{blankLayer}
      </div>
    );
  }

  const next = d.slides[st.index + 1];
  const elapsedMs = Date.now() - startedAt.current;
  const slideMs = Date.now() - slideStart.current;
  const clock = new Date();
  const btn: React.CSSProperties = { padding: '6px 12px', border: `1px solid ${LINE}`, background: 'transparent', color: INK, cursor: 'pointer', font: 'var(--type-label)', fontSize: 12, fontWeight: 700, textAlign: 'center' };
  const notes = d.slides[st.index]?.notes ?? '';
  return (
    <div style={{ ...overlay, display: 'grid', gridTemplateColumns: '1fr 360px', gridTemplateRows: '1fr 150px' }}>
      <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--type-mono)', fontSize: 12, color: MUTE }}>
          <span>{mode === 'rehearse' ? 'REHEARSING' : 'PRESENTING'} · {(doc.title || 'Deck').replace(/\.tone$/i, '').toUpperCase()}</span>
          <span>Slide {pad2(st.index + 1)} of {n}</span>
        </div>
        <div ref={stageRef} onClick={() => go(1)} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', cursor: 'pointer' }}>
          <Stage doc={doc} st={st} now={now} width={fitW(stageSize.w, stageSize.h)} />
          {endLayer}{blankLayer}
        </div>
      </div>
      <div style={{ padding: '32px 32px 0 0', display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0 }}>
        <div style={{ font: 'var(--type-mono)', fontSize: 12, color: MUTE }}>NEXT</div>
        {next
          ? <SlideView deck={d} slide={next} index={st.index + 1} total={n} width={328} mediaUrl={(p) => doc.mediaUrl(p)} />
          : <div style={{ aspectRatio: '16 / 9', border: `1px solid ${LINE}`, display: 'flex', alignItems: 'center', justifyContent: 'center', font: 'var(--type-mono)', color: MUTE }}>End of deck</div>}
        {next && <div style={{ font: 'var(--type-small)', color: MUTE, marginTop: -6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{slideTitle(next)}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
          {[['ELAPSED', mmss(elapsedMs)], mode === 'rehearse' ? ['THIS SLIDE', mmss(slideMs)] : ['CLOCK', `${pad2(clock.getHours())}:${pad2(clock.getMinutes())}`]].map(([l, v]) => (
            <div key={l} style={{ border: `1px solid ${LINE}`, padding: 14 }}>
              <div style={{ font: 'var(--type-mono)', fontSize: 10, color: MUTE }}>{l}</div>
              <div style={{ font: '500 30px var(--font-mono)', letterSpacing: '-0.03em', marginTop: 4, fontWeight: 800 }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingBottom: 0 }}>
          <button type="button" style={{ ...btn, flex: 1 }} onClick={() => go(-1)}>‹ Prev</button>
          <button type="button" style={{ ...btn, flex: 1 }} onClick={() => go(1)}>Next ›</button>
          <button type="button" style={{ ...btn, background: blank === 'black' ? INK : 'transparent', color: blank === 'black' ? '#000' : INK }} onClick={() => setBlank((b) => (b === 'black' ? null : 'black'))}>Black</button>
          <button type="button" style={{ ...btn, background: 'var(--accent)', color: 'var(--on-accent)', borderColor: 'var(--accent)', fontWeight: 800, padding: '8px 16px' }} onClick={finish}>End</button>
        </div>
      </div>
      <div style={{ gridColumn: 'span 2', borderTop: `1px solid ${LINE}`, padding: '20px 32px', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' }}>
        <div style={{ font: 'var(--type-mono)', fontSize: 11, color: MUTE }}>NOTES</div>
        <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.4, maxWidth: 900, whiteSpace: 'pre-wrap', color: notes ? INK : MUTE }}>{notes || 'No notes for this slide.'}</div>
      </div>
    </div>
  );
}
