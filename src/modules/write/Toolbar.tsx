// Write toolbar (screenshot 14): styles · font/size · B I U · align/lists/link/image/table/TOC/footnote/page setup · track changes · export.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ModuleApi } from '@/core/types';
import { MenuItem } from '@/ui';
import { FontPicker } from '@/ui/FontPicker';
import * as A from './actions';
import { writeCommands } from './commands';
import type { WriteModel } from './model';
import { DEFAULT_FONT } from './fonts';
import { schema } from './schema';
import { listChanges } from './track';

const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72];
/** Default size (pt) of each paragraph style, for the size box when no explicit size is set. */
const STYLE_PT: Record<A.StyleName, number> = { body: 11, quote: 11, code: 10, title: 30, h1: 21, h2: 16.5, h3: 13 };

export function Toolbar({ model, api, compact, onPanels }: { model: WriteModel; api: ModuleApi; compact: boolean; onPanels: () => void }) {
  // Run handlers directly (synchronously) so a style chip applies before the next keystroke lands.
  const handlers = useMemo(() => writeCommands(() => model, api), [model, api]);
  const run = (id: string) => { const h = handlers[id]; if (h) void h({ doc: null, model }); else api.runCommand(id); };
  const state = model.state;
  const style = A.currentStyle(state);
  const ts = A.currentTextStyle(state);
  const changes = listChangesCached(model);
  const [pop, setPop] = useState<null | { kind: 'align' | 'list'; x: number; y: number }>(null);
  const openPop = (kind: 'align' | 'list', e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPop(pop?.kind === kind ? null : { kind, x: r.left, y: r.bottom + 4 });
  };
  const keep = (e: React.MouseEvent) => e.preventDefault(); // keep editor selection while clicking chrome
  const chip = (label: ReactNode, on: boolean, onClick: () => void, extra = '', title?: string) => (
    <button type="button" className={`wr-chip ${extra}${on ? ' on' : ''}`} onMouseDown={keep} onClick={onClick} title={title}>{label}</button>
  );
  const styleChip = (s: A.StyleName, label: string, cmd: string) => chip(label, style === s, () => run(cmd), '', `${label} style`);
  const fontValue = ts.fontFamily ?? DEFAULT_FONT;
  const sizeValue = ts.fontSize ?? STYLE_PT[style];
  const list = A.inList(state);

  return (
    <div className="toolbar" style={{ padding: '0 12px' }}>
      {compact && <>{chip('Panels', false, onPanels, '', 'Show outline, stats and comments')}<div className="tsep" /></>}
      <div style={{ display: 'flex', gap: 2 }}>
        {styleChip('body', 'Body', 'write.format.style.body')}
        {styleChip('title', 'Title', 'write.format.style.title')}
        {styleChip('h1', 'H1', 'write.format.style.h1')}
        {styleChip('h2', 'H2', 'write.format.style.h2')}
        {styleChip('quote', 'Quote', 'write.format.style.quote')}
      </div>
      <div className="tsep" />
      <FontPicker value={fontValue} width={150} style={{ padding: '4px 6px', background: 'var(--bg0)', font: '600 12px/1.3 var(--font-ui)' }}
        onChange={(f) => { A.setTextStyle(model, { fontFamily: f === DEFAULT_FONT ? null : f }); model.view?.focus(); }} />
      <select className="wr-select mono" value={String(sizeValue)} title="Size (pt)"
        onChange={(e) => { A.setTextStyle(model, { fontSize: +e.target.value === STYLE_PT[style] ? null : +e.target.value }); model.view?.focus(); }}>
        {!SIZES.includes(sizeValue) && <option value={String(sizeValue)}>{sizeValue}</option>}
        {SIZES.map((s) => <option key={s} value={String(s)}>{s}</option>)}
      </select>
      <div style={{ display: 'flex', gap: 2 }}>
        {chip(<span style={{ fontWeight: 800 }}>B</span>, A.markActive(state, schema.marks.strong), () => run('write.format.bold'), 'sq', 'Bold (Ctrl B)')}
        {chip(<span style={{ fontStyle: 'italic' }}>I</span>, A.markActive(state, schema.marks.em), () => run('write.format.italic'), 'sq', 'Italic (Ctrl I)')}
        {chip(<span style={{ textDecoration: 'underline' }}>U</span>, A.markActive(state, schema.marks.underline), () => run('write.format.underline'), 'sq', 'Underline (Ctrl U)')}
      </div>
      <div style={{ display: 'flex', gap: 2 }}>
        <button type="button" className="wr-chip sq" onMouseDown={keep} onClick={(e) => openPop('align', e)} title="Align">≡</button>
        <button type="button" className={'wr-chip sq' + (list ? ' on' : '')} onMouseDown={keep} onClick={(e) => openPop('list', e)} title="Lists">• List</button>
        {chip('Link', !!A.linkAtSelection(state), () => run('write.insert.link'), 'sq', 'Insert link')}
        {chip('Image', false, () => run('write.insert.image'), 'sq', 'Insert image')}
        {chip('Table', false, () => run('write.insert.table'), 'sq', 'Insert table')}
        {chip('TOC', false, () => run('write.insert.toc'), 'sq', 'Table of contents')}
        {chip('Footnote', false, () => run('write.insert.footnote'), 'sq', 'Insert footnote')}
        {chip('Page setup', false, () => run('write.file.pageSetup'), 'sq', 'Page setup')}
      </div>
      <div style={{ flex: 1, minWidth: 8 }} />
      <button type="button" className={'wr-chip' + (model.ui.review ? ' on' : '')} onMouseDown={keep}
        onClick={() => model.setUI({ review: !model.ui.review })} title={model.tracking ? 'Tracking changes — click to review' : 'Review changes'}>
        {model.tracking && <span style={{ width: 6, height: 6, background: 'var(--accent)', display: 'inline-block' }} />}
        Track changes · {changes}
      </button>
      <button type="button" className="wr-chip primary" onClick={() => run('file.export')} title="Convert & export (Ctrl Shift E)">Export ▾</button>
      {pop && <Popover x={pop.x} y={pop.y} onClose={() => setPop(null)}>
        {pop.kind === 'align' ? (
          (['left', 'center', 'right', 'justify'] as const).map((a) => (
            <MenuItem key={a} label={a[0].toUpperCase() + a.slice(1)} checked={A.currentAlign(state) === a} shortcut={{ left: 'Ctrl L', center: 'Ctrl E', right: 'Ctrl R', justify: 'Ctrl J' }[a]}
              onClick={() => { setPop(null); run(`write.format.align.${a}`); }} />
          ))
        ) : (
          <>
            <MenuItem label="Bulleted list" checked={list === 'bullet'} shortcut="Ctrl Shift 8" onClick={() => { setPop(null); run('write.format.bullets'); }} />
            <MenuItem label="Numbered list" checked={list === 'ordered'} shortcut="Ctrl Shift 7" onClick={() => { setPop(null); run('write.format.numbers'); }} />
            <MenuItem label="Increase indent" shortcut="Tab" disabled={!list} onClick={() => { setPop(null); run('write.format.indent'); }} />
            <MenuItem label="Decrease indent" shortcut="Shift Tab" disabled={!list} onClick={() => { setPop(null); run('write.format.outdent'); }} />
          </>
        )}
      </Popover>}
    </div>
  );
}

function Popover({ x, y, onClose, children }: { x: number; y: number; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  useLayoutEffect(() => {
    const w = ref.current?.offsetWidth ?? 200;
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - w - 8)), y });
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  }, [x, y, onClose]);
  return <div ref={ref} className="wr-pop" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.preventDefault()}>{children}</div>;
}

const countCache = new WeakMap<object, number>();
function listChangesCached(m: WriteModel): number {
  const d = m.state.doc;
  let n = countCache.get(d);
  if (n == null) { n = listChanges(d).length; countCache.set(d, n); }
  return n;
}
