// Paper editor: tools row, thumbnail rail, continuous page view, inspector.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/ui';
import type { EditorProps } from '@/core/types';
import { PaperActions, preloadGeometry, viewSize } from './actions';
import { BASE_W, PaperCtx, usePaper as useCtx, type PaperCtxValue } from './context';
import { Inspector } from './Inspector';
import { TOOLS, type PaperModel } from './model';
import { PageView } from './PageView';
import { formFields, geom, geomSync, type FieldInfo, type Geom } from './render';
import { ensureStyles, useModel } from './styles';
import { Thumb } from './Thumb';

const LETTER_GEOM: Geom = { view: [0, 0, 612, 792], rotate: 0 };
const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function PaperEditor({ model, onChange, compact, api: coreApi }: EditorProps<PaperModel>) {
  ensureStyles();
  const version = useModel(model);
  const api = useMemo(() => ({ ...coreApi, markDirty: onChange }), [coreApi, onChange]);
  const actions = useMemo(() => new PaperActions(model, api), [model, api]);
  const ui = model.ui;

  const [fields, setFields] = useState<FieldInfo[]>([]);
  const firstBytes = model.sources[0]?.bytes;
  useEffect(() => { let live = true; void formFields(model).then((f) => { if (live) setFields(f); }); return () => { live = false; }; }, [model, firstBytes]);

  const [estimate, setEstimate] = useState<Geom>(() => (model.pages[0] && geomSync(model, model.pages[0])) || LETTER_GEOM);
  const [, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    if (model.pages[0]) void geom(model, model.pages[0]).then((g) => live && setEstimate(g)).catch(() => {});
    void preloadGeometry(model, () => live && setTick((t) => t + 1));
    return () => { live = false; };
  }, [model, model.pages.length]);

  const ctx: PaperCtxValue = useMemo(() => ({
    model, api, commit: actions.commit, fields, openSignature: actions.signature, estimate,
  }), [model, api, actions, fields, estimate]);

  // ---- scrolling / current page ----
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const pageEls = useRef(new Map<number, HTMLDivElement>());
  const registerEl = useCallback((i: number, el: HTMLDivElement | null) => { if (el) pageEls.current.set(i, el); else pageEls.current.delete(i); }, []);
  const anchor = useRef({ page: 0, frac: 0 });
  const raf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (!scroller) return;
      const probe = scroller.scrollTop + scroller.clientHeight * 0.35;
      let cur = 0;
      for (let i = 0; i < model.pages.length; i++) {
        const el = pageEls.current.get(i);
        if (!el) continue;
        if (el.offsetTop <= probe) cur = i; else break;
      }
      const el = pageEls.current.get(cur);
      if (el) anchor.current = { page: cur, frac: (scroller.scrollTop - el.offsetTop) / Math.max(1, el.offsetHeight) };
      if (cur !== model.ui.page) model.setUi({ page: cur });
    });
  };
  useEffect(() => {
    if (!scroller) return;
    const el = pageEls.current.get(ui.page);
    if (el) scroller.scrollTop = el.offsetTop - 24;
  }, [ui.scrollReq]);
  // Keep the same spot in view across zoom changes.
  useLayoutEffect(() => {
    const el = pageEls.current.get(anchor.current.page);
    if (scroller && el) scroller.scrollTop = el.offsetTop + anchor.current.frac * el.offsetHeight;
  }, [ui.zoom]);
  // Report size for fit-zoom; auto-fit narrow screens once.
  useEffect(() => {
    if (!scroller) return;
    const ro = new ResizeObserver(() => viewSize.set(model, { w: scroller.clientWidth, h: scroller.clientHeight }));
    ro.observe(scroller);
    viewSize.set(model, { w: scroller.clientWidth, h: scroller.clientHeight });
    if (scroller.clientWidth < BASE_W + 64 && model.ui.zoom === 1) actions.zoomTo((scroller.clientWidth - 24) / BASE_W);
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      actions.zoomTo(model.ui.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
    };
    scroller.addEventListener('wheel', wheel, { passive: false });
    return () => { ro.disconnect(); scroller.removeEventListener('wheel', wheel); };
  }, [scroller, model, actions]);

  // Status bar hint depends on page/tool, which aren't document edits — nudge the chrome.
  useEffect(() => { api.refreshChrome(); }, [api, ui.page, ui.tool, model.pages.length]);

  // ---- keyboard (module keys; menu shortcuts are handled by the core) ----
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    const take = () => e.preventDefault();
    if (k === 'Delete' || k === 'Backspace') { if (ui.selected) { take(); actions.deleteSelected(); } return; }
    if (k === 'Escape') { if (ui.search.open) actions.closeFind(); else model.setUi({ selected: null }); return; }
    if (k === 'PageDown') { take(); actions.goTo(ui.page + 1); return; }
    if (k === 'PageUp') { take(); actions.goTo(ui.page - 1); return; }
    if (k === 'Home') { take(); actions.goTo(0); return; }
    if (k === 'End') { take(); actions.goTo(model.pages.length - 1); return; }
    const map: Record<string, () => void> = {
      p: () => actions.setTool('Annotate', 'pen'), n: () => actions.setTool('Annotate', 'note'), s: () => actions.setTool('Annotate', 'stamp'),
      h: () => actions.setTool('Highlight'), r: () => actions.setTool('Redact', 'redact'), t: () => actions.setTool('Edit', 'text'),
      w: () => actions.setTool('Edit', 'whiteout'), f: () => actions.formBuilder(), o: () => actions.organize(),
    };
    if (ui.tool === 'Highlight') {
      Object.assign(map, {
        1: () => model.setUi({ sub: 'hl-text', hlColor: '#ffd400' }), 2: () => model.setUi({ sub: 'hl-text', hlColor: '#ff5a1f' }),
        3: () => model.setUi({ sub: 'strike' }), 4: () => model.setUi({ sub: 'hl-area' }),
      });
    }
    const fn = map[k.toLowerCase()];
    if (fn) { take(); fn(); }
  };
  const rootRef = useRef<HTMLDivElement>(null);
  const focusRoot = (e: React.PointerEvent) => { if (!isTyping(e.target) && !rootRef.current?.contains(document.activeElement)) rootRef.current?.focus({ preventScroll: true }); };

  const [saveMenu, setSaveMenu] = useState(false);
  const panels = compact && ui.panels;

  return (
    <PaperCtx.Provider value={ctx}>
      <div ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown} onPointerDown={focusRoot} className={compact ? 'compact' : ''}
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none' }}>
        <div className="toolbar" style={{ padding: '0 12px', gap: 4 }}>
          {TOOLS.map((t) => (
            <button key={t} type="button" className={'pp-tool' + (ui.tool === t ? ' on' : '')}
              onClick={() => { actions.setTool(t); if (t === 'Convert') api.runCommand('file.export'); }}>{t}</button>
          ))}
          <span style={{ flex: 1, minWidth: 8 }} />
          <Button size="sm" variant="ghost" onClick={actions.zoomOut} title="Zoom out (Ctrl -)">−</Button>
          <button type="button" className="hov-ink" onClick={() => actions.zoomTo(1)} title="Actual size (Ctrl 0)"
            style={{ border: 0, background: 'transparent', color: 'var(--mute)', font: 'var(--type-mono)', cursor: 'pointer', minWidth: 42 }}>{Math.round(ui.zoom * 100)}%</button>
          <Button size="sm" variant="ghost" onClick={actions.zoomIn} title="Zoom in (Ctrl =)">+</Button>
          {compact && <Button size="sm" active={ui.panels} onClick={() => model.setUi({ panels: !ui.panels })}>Panels</Button>}
          <div style={{ position: 'relative', marginLeft: 6 }}>
            <Button variant="primary" onClick={() => setSaveMenu(!saveMenu)}>Save / convert</Button>
            {saveMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onPointerDown={() => setSaveMenu(false)} />
                <div style={{ position: 'fixed', right: 12, marginTop: 4, width: 240, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 51, padding: '4px 0', font: 'var(--type-small)' }}>
                  {([['Save', 'Ctrl S', () => api.runCommand('file.save')], ['Save as…', 'Ctrl Shift S', () => api.runCommand('file.saveAs')], ['Convert & export…', 'Ctrl Shift E', () => api.runCommand('file.export')], ['Save compressed copy…', '', () => void actions.compress()]] as const).map(([l, s, go]) => (
                    <div key={l} className="hov-row" onClick={() => { setSaveMenu(false); go(); }} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', cursor: 'pointer' }}>
                      <span>{l}</span><span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{s}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
          {ui.thumbs && !compact && <ThumbRail actions={actions} />}
          <div style={{ flex: 1, minWidth: 0, position: 'relative', display: 'flex' }}>
            <div ref={setScroller} className="workarea" onScroll={onScroll} onPointerDown={(e) => { if (e.target === e.currentTarget) model.setUi({ selected: null }); }}
              style={{ padding: compact ? '12px 0 60px' : '32px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
              {model.pages.map((p, i) => (
                <PageView key={p.id} pageRef={p} index={i} zoom={ui.zoom} root={scroller} version={version} registerEl={registerEl} />
              ))}
            </div>
            {ui.search.open && <SearchBar actions={actions} />}
          </div>
          <Inspector actions={actions} open={panels} />
        </div>
      </div>
    </PaperCtx.Provider>
  );
}

function ThumbRail({ actions }: { actions: PaperActions }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { model } = useCtx();
  const cur = model.ui.page;
  useEffect(() => {
    const el = root?.querySelector<HTMLElement>(`[data-thumb="${cur}"]`);
    if (el && root && (el.offsetTop < root.scrollTop || el.offsetTop + el.offsetHeight > root.scrollTop + root.clientHeight)) root.scrollTop = el.offsetTop - 12;
  }, [cur, root]);
  return (
    <div ref={setRoot} style={{ width: 160, flexShrink: 0, borderRight: '1px solid var(--line)', background: 'var(--bg1)', overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, position: 'relative' }}>
      {model.pages.map((p, i) => (
        <div key={p.id} data-thumb={i} className={'pp-thumb' + (i === cur ? ' on' : '')} onClick={() => actions.goTo(i)}>
          <Thumb model={model} pageRef={p} width={132} root={root} />
          <div className="pp-num">{i + 1}</div>
        </div>
      ))}
    </div>
  );
}

function SearchBar({ actions }: { actions: PaperActions }) {
  const { model } = useCtx();
  const s = model.ui.search;
  const [q, setQ] = useState(s.query);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const change = (v: string) => { setQ(v); clearTimeout(timer.current); timer.current = setTimeout(() => void actions.search(v), 250); };
  return (
    <div style={{ position: 'absolute', top: 10, right: 18, zIndex: 20, display: 'flex', alignItems: 'center', gap: 6, padding: 6, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)' }}>
      <div className="field" style={{ width: 220 }}>
        <input autoFocus value={q} placeholder="Find in document" onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); if (q !== s.query) void actions.search(q); else actions.findStep(e.shiftKey ? -1 : 1); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); actions.closeFind(); }
          }} />
      </div>
      <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', minWidth: 54, textAlign: 'center' }}>
        {s.busy ? '…' : s.query ? (s.hits.length ? `${s.index + 1} / ${s.hits.length}` : '0 / 0') : ''}
      </span>
      <Button size="sm" variant="ghost" disabled={!s.hits.length} onClick={() => actions.findStep(-1)} title="Previous (Shift F3)">↑</Button>
      <Button size="sm" variant="ghost" disabled={!s.hits.length} onClick={() => actions.findStep(1)} title="Next (F3)">↓</Button>
      {model.ui.tool === 'Redact' && <Button size="sm" disabled={!s.hits.length || s.busy} onClick={actions.redactHits}>Redact all</Button>}
      <Button size="sm" variant="ghost" onClick={actions.closeFind} title="Close (Esc)">✕</Button>
    </div>
  );
}

