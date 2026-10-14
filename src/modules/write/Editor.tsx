// Write editor: toolbar, paginated ProseMirror page(s), inspector / review pane, find panel, dialogs.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Node as PMNode } from 'prosemirror-model';
import { TextSelection } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import 'prosemirror-view/style/prosemirror.css';
import { useApp } from '@/core/store';
import { useSettings } from '@/core/settings';
import type { EditorProps } from '@/core/types';
import { refreshTocs, scrollToPos } from './actions';
import { FootnoteDialog, PageSetupDialog, TocDialog } from './dialogs';
import { FindPanel } from './FindPanel';
import { pageBox, type WriteModel } from './model';
import { pageKey, type Spacer } from './plugins';
import { schema } from './schema';
import { Inspector, ReviewPane } from './Side';
import { outline } from './stats';
import { Toolbar } from './Toolbar';
import { footnoteLabel } from './util';
import './write.css';

const GAP = 24; // px between sheets

export function WriteEditor({ doc, model, onChange, compact, api }: EditorProps<WriteModel>) {
  useSyncExternalStore(model.subscribe, model.getVersion);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const inspectorOpen = useApp((s) => s.inspectorOpen);
  const ui = model.ui;
  const done = () => { model.setUI({ dialog: null }); onChange(); };
  const close = () => model.setUI({ dialog: null });
  const side = ui.focus ? null : ui.review ? 'review' : ui.outline || compact ? 'inspector' : null;
  const sheetOpen = panelsOpen || inspectorOpen;

  return (
    <div className={compact ? 'compact' : undefined} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {!ui.focus && <Toolbar model={model} api={api} compact={compact} onPanels={() => setPanelsOpen((v) => !v)} />}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', position: 'relative' }}>
        <PageCanvas model={model} onChange={onChange} compact={compact} refresh={api.refreshChrome} />
        {ui.find && <FindPanel model={model} onChange={onChange} right={side && !compact ? 300 : 20} />}
        {side === 'review' && <ReviewPane model={model} onChange={onChange} open={sheetOpen} />}
        {side === 'inspector' && <Inspector model={model} onChange={onChange} open={sheetOpen} />}
        {ui.focus && (
          <button type="button" className="wr-chip" onClick={() => model.setUI({ focus: false })} style={{ position: 'absolute', top: 12, right: 20, zIndex: 20, background: 'var(--bg1)' }}>Exit focus mode</button>
        )}
      </div>
      {ui.dialog?.kind === 'pageSetup' && (
        <PageSetupDialog model={model} title={doc.title} onClose={close} onApply={(p) => { model.page = p; done(); }} />
      )}
      {ui.dialog?.kind === 'toc' && <TocDialog model={model} pos={ui.dialog.pos} onClose={close} onDone={done} />}
      {ui.dialog?.kind === 'footnote' && <FootnoteDialog model={model} pos={ui.dialog.pos} onClose={close} onDone={done} />}
    </div>
  );
}

interface Note { text: string; pos: number; block: number }

function collectNotes(doc: PMNode): Note[] {
  const out: Note[] = [];
  doc.forEach((top, offset, index) => {
    top.descendants((n, p) => {
      if (n.type === schema.nodes.footnote) out.push({ text: n.attrs.text, pos: offset + 1 + p, block: index });
      return true;
    });
  });
  return out;
}

interface Layout { pages: number; pageNotes: number[][]; endTop: number; contentBottom: number }

function sameSpacers(a: Spacer[], b: Spacer[]) {
  return a.length === b.length && a.every((s, i) => s.pos === b[i].pos && Math.abs(s.height - b[i].height) <= 1);
}

function PageCanvas({ model, onChange, compact, refresh }: { model: WriteModel; onChange: () => void; compact: boolean; refresh: () => void }) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const scrollRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [layout, setLayout] = useState<Layout>({ pages: 1, pageNotes: [], endTop: 0, contentBottom: 0 });
  const [avail, setAvail] = useState(0);
  const docNode = model.state.doc;
  const notes = useMemo(() => collectNotes(docNode), [docNode]);
  const box = pageBox(model.page);
  const period = box.h + GAP;
  const twoCol = model.page.columns === 2;
  const notesAtPage = model.footnotes.position === 'page';

  // ---- ProseMirror view lifecycle ----
  useEffect(() => {
    model.author = useSettings.getState().s.deviceName || 'You';
    const view = new EditorView({ mount: mountRef.current! }, {
      state: model.state,
      dispatchTransaction: (tr) => model.apply(tr),
      attributes: { class: 'wr-pm', spellcheck: 'true' },
      handleDoubleClickOn: (_v, _pos, node, nodePos) => {
        if (node.type === schema.nodes.footnote) { model.setUI({ dialog: { kind: 'footnote', pos: nodePos } }); return true; }
        if (node.type === schema.nodes.toc) { model.setUI({ dialog: { kind: 'toc', pos: nodePos } }); return true; }
        return false;
      },
      handleClickOn: (_v, _pos, node, _nodePos, event, direct) => {
        if (!direct || node.type !== schema.nodes.toc || !node.attrs.links) return false;
        const row = (event.target as HTMLElement).closest('.wr-toc-row');
        if (!row) return false;
        const idx = +(row.getAttribute('data-index') ?? -1);
        const target = outline(model.state.doc).filter((o) => (node.attrs.levels as number[]).includes(o.level))[idx];
        if (target) scrollToPos(model, target.pos);
        return true;
      },
    });
    model.view = view;
    model.onDocChange = () => onChangeRef.current();
    return () => {
      view.destroy();
      if (model.view === view) model.view = null;
      model.onDocChange = null;
    };
  }, [model]);

  // ---- Fit width ----
  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const fit = avail ? Math.max(0.25, (avail - (compact ? 16 : 48)) / box.w) : 1;
  const zoom = model.ui.zoom === 0 ? fit : compact ? Math.min(model.ui.zoom, fit) : model.ui.zoom;

  // ---- Pagination: measure natural block positions and insert spacer widgets at page breaks ----
  const measureRef2 = useRef<() => void>(() => {});
  measureRef2.current = () => {
    const view = model.view;
    if (!view || !view.dom.isConnected) return;
    const doc = view.state.doc;
    const cur = pageKey.getState(view.state)?.spacers ?? [];
    const noteEls = measureRef.current ? Array.from(measureRef.current.children) as HTMLElement[] : [];
    const noteH = noteEls.map((e) => e.offsetHeight);
    const blockNotes = new Map<number, number[]>();
    notes.forEach((n, i) => { if (!blockNotes.has(n.block)) blockNotes.set(n.block, []); blockNotes.get(n.block)!.push(i); });
    const spacers: Spacer[] = [];
    const blockPages: number[] = [];
    const pageNotes: number[][] = [];
    const reserve = (p: number, extra: number[]) => {
      const list = [...(pageNotes[p] ?? []), ...extra];
      return list.length ? 18 + list.reduce((a, i) => a + (noteH[i] ?? 20), 0) : 0;
    };
    const contentH = box.h - box.top - box.bottom;
    let shift = 0, si = 0, acc = 0, prevBottomPage = -1, forced = false, lastB = box.top;
    doc.forEach((node, offset, i) => {
      while (si < cur.length && cur[si].pos <= offset) { acc += cur[si].height; si++; }
      const el = view.nodeDOM(offset);
      if (!(el instanceof HTMLElement)) { blockPages.push(blockPages[blockPages.length - 1] ?? 1); return; }
      const natTop = el.offsetTop - acc;
      const natB = natTop + el.offsetHeight;
      if (twoCol) {
        blockPages.push(Math.floor((natTop - box.top) / (contentH * 2)) + 1);
        lastB = natB;
        return;
      }
      let T = natTop + shift, B = natB + shift;
      let p = Math.floor(T / period);
      const first = i === 0 || p > prevBottomPage;
      const mine = notesAtPage ? blockNotes.get(i) ?? [] : [];
      const end = (pp: number) => pp * period + box.h - box.bottom - reserve(pp, mine);
      if (i > 0 && (forced || T > end(p) || (!first && B > end(p)))) {
        const target = p + 1;
        const h = Math.round(target * period + box.top - T);
        spacers.push({ pos: offset, height: h, page: target });
        shift += h; T += h; B += h; p = target;
      }
      if (mine.length) (pageNotes[p] ??= []).push(...mine);
      blockPages.push(p + 1);
      prevBottomPage = Math.floor(B / period);
      lastB = B;
      forced = node.type === schema.nodes.page_break;
    });
    let endTop = lastB + 24;
    let bottom = lastB;
    if (!notesAtPage && notes.length && endRef.current) {
      const h = endRef.current.offsetHeight;
      const p = Math.floor(endTop / period);
      if (!twoCol && endTop + h > p * period + box.h - box.bottom && h < contentH) endTop = (p + 1) * period + box.top;
      bottom = endTop + h;
    }
    let pages: number;
    if (twoCol) pages = Math.max(1, Math.ceil((bottom - box.top) / (contentH * 2)));
    else pages = Math.max(1, Math.floor((bottom + box.bottom - 1) / period) + 1, pageNotes.length);
    if (!sameSpacers(cur, spacers)) {
      view.dispatch(view.state.tr.setMeta(pageKey, spacers).setMeta('addToHistory', false));
      schedule(16);
    }
    setLayout((prev) => (prev.pages === pages && prev.endTop === endTop && prev.contentBottom === bottom && JSON.stringify(prev.pageNotes) === JSON.stringify(pageNotes) ? prev : { pages, pageNotes, endTop, contentBottom: bottom }));
    const changed = model.ui.pages !== pages || model.ui.blockPages.length !== blockPages.length || model.ui.blockPages.some((v, i) => v !== blockPages[i]);
    if (changed) {
      model.ui = { ...model.ui, pages, blockPages };
      model.emit();
      refreshRef.current();
    }
    if (refreshTocs(model)) onChangeRef.current();
  };
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = (ms = 80) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; measureRef2.current(); }, ms);
  };

  useEffect(() => {
    let lastDoc = model.state.doc;
    let lastPage = JSON.stringify(model.page) + model.footnotes.position + model.footnotes.numbering;
    let lastCur = 0;
    const unsub = model.subscribe(() => {
      const pg = JSON.stringify(model.page) + model.footnotes.position + model.footnotes.numbering;
      if (model.state.doc !== lastDoc || pg !== lastPage) { lastDoc = model.state.doc; lastPage = pg; schedule(); }
      const idx = model.state.selection.$head.index(0);
      const cp = model.ui.blockPages[idx] ?? 1;
      if (cp !== lastCur) { lastCur = cp; model.ui.currentPage = cp; refreshRef.current(); }
    });
    const el = model.view?.dom;
    const onLoad = () => schedule();
    el?.addEventListener('load', onLoad, true);
    void document.fonts?.ready.then(() => schedule());
    schedule(0);
    return () => { unsub(); el?.removeEventListener('load', onLoad, true); if (timer.current) clearTimeout(timer.current); };
  }, [model]);

  // Spacers depend on padding & widths — remeasure when they change.
  useEffect(() => { schedule(0); }, [box.w, box.h, box.top, box.bottom, box.left, box.right, twoCol, notes.length]);

  const totalH = twoCol ? Math.max(box.h, layout.contentBottom + box.bottom) : layout.pages * period - GAP;
  const sheets = twoCol ? 1 : layout.pages;
  const pg = model.page;
  const hf = (t: string, n: number) => t.replace(/\{page\}/g, String(n)).replace(/\{pages\}/g, String(layout.pages));
  const fnClass = model.footnotes.numbering === 'decimal' ? '' : ` wr-fn-${model.footnotes.numbering}`;
  const markupClass = ` wr-markup-${model.ui.markup}`;

  return (
    <div ref={scrollRef} className={'workarea wr-work' + (compact ? ' compact-pad' : '')}
      onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); model.view?.focus(); } }}>
      <div className="wr-zoomwrap" style={{ width: box.w * zoom, height: totalH * zoom }}>
        <div className={'wr-pages' + fnClass + markupClass} style={{ width: box.w, height: totalH, transform: zoom === 1 ? undefined : `scale(${zoom})` }}>
          {Array.from({ length: sheets }, (_, i) => {
            const first = i === 0 && pg.differentFirst;
            const footer = (pg.footer || pg.pageNumbers) && !first ? (pg.footer ? hf(pg.footer, i + 1) : '') + (pg.pageNumbers && !/\{page\}/.test(pg.footer) ? (pg.footer ? '   ' : '') + (i + 1) : '') : '';
            return (
              <div key={i} className="wr-sheet" style={{ top: i * period, height: twoCol ? totalH : box.h }}
                onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); focusEnd(model); } }}>
                {pg.header && !first && <div className="wr-sheet-hf" style={{ top: Math.max(8, box.top / 2 - 7), paddingInline: box.left }}>{hf(pg.header, i + 1)}</div>}
                {footer && <div className="wr-sheet-hf" style={{ bottom: Math.max(8, box.bottom / 2 - 7), paddingInline: box.left }}>{footer}</div>}
                {!footer && sheets > 1 && <div className="wr-sheet-num">{i + 1}</div>}
              </div>
            );
          })}
          <div ref={mountRef} className={twoCol ? 'wr-cols-2' : undefined} style={{ padding: `${box.top}px ${box.right}px 0 ${box.left}px`, minHeight: box.h - box.bottom }} />
          {notesAtPage && layout.pageNotes.map((list, p) => list?.length ? (
            <div key={p} className="wr-notes-page" style={{ left: box.left, right: box.right, top: p * period + box.h - box.bottom - (18 + list.reduce((a, i) => a + ((measureRef.current?.children[i] as HTMLElement | undefined)?.offsetHeight ?? 20), 0)) + 6 }}>
              {list.map((i) => notes[i] && <NoteRow key={i} n={i} note={notes[i]} model={model} />)}
            </div>
          ) : null)}
          {!notesAtPage && notes.length > 0 && (
            <div ref={endRef} className="wr-notes-end" style={{ position: 'absolute', top: layout.endTop || undefined, left: box.left, right: box.right }}>
              {notes.map((n, i) => <NoteRow key={i} n={i} note={n} model={model} />)}
            </div>
          )}
          <div ref={measureRef} aria-hidden style={{ position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: box.left, width: box.w - box.left - box.right, top: 0, font: '500 12px/1.5 var(--font-ui)' }}>
            {notes.map((n, i) => <div key={i} className="wr-note"><sup>{footnoteLabel(i + 1, model.footnotes.numbering)}</sup><span>{n.text}</span></div>)}
          </div>
        </div>
      </div>
    </div>
  );
}

function NoteRow({ n, note, model }: { n: number; note: Note; model: WriteModel }) {
  return (
    <div className="wr-note" title="Edit footnote" onMouseDown={(e) => { e.preventDefault(); model.setUI({ dialog: { kind: 'footnote', pos: note.pos } }); }}>
      <sup>{footnoteLabel(n + 1, model.footnotes.numbering)}</sup><span>{note.text}</span>
    </div>
  );
}

function focusEnd(m: WriteModel) {
  const v = m.view;
  if (!v) return;
  const end = TextSelection.atEnd(v.state.doc);
  v.dispatch(v.state.tr.setSelection(end));
  v.focus();
}
