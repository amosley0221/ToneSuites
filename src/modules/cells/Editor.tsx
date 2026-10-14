// Cells editor: format toolbar, formula bar, virtualised grid, sheet tabs + selection summary.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorProps } from '@/core/types';
import { MenuItem } from '@/ui';
import { MAX_COLS, MAX_ROWS } from './address';
import { ChartDialog } from './ChartDialog';
import { gotoAddress, selectionLabel } from './commands';
import { AcDropdown, useFormulaAssist } from './FormulaAssist';
import { Grid } from './Grid';
import { formatNumber, NUM_FMTS } from './numfmt';
import type { Workbook } from './model';
import { PopItem, Popover, Swatches, TB } from './widgets';

export function CellsEditor({ model: wb, onChange, compact, api }: EditorProps<Workbook>) {
  useSyncExternalStore(useCallback((fn) => wb.subscribe(fn), [wb]), () => wb.version);
  const [chartEdit, setChartEdit] = useState<string | null>(null);

  // Data changes mark the doc dirty; view changes (selection, sheet) refresh the status hint.
  useEffect(() => {
    let raf = 0;
    return wb.subscribe((data) => {
      if (data) onChange();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => api?.refreshChrome?.());
    });
  }, [wb, onChange, api]);

  const run = (id: string) => api.runCommand(id);

  return (
    <div className={compact ? 'compact' : ''} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--bg0)' }}>
      <Toolbar wb={wb} run={run} compact={compact} />
      <FormulaBar wb={wb} />
      <Grid wb={wb} onEditChart={setChartEdit} compact={compact} />
      <SheetTabs wb={wb} run={run} />
      {chartEdit && <ChartDialog wb={wb} chartId={chartEdit} onClose={() => { setChartEdit(null); wb.ui.focusGrid++; wb.emit(); }} />}
    </div>
  );
}

// ---------- toolbar ----------

type PopKind = 'nf' | 'align' | 'fill' | 'borders' | 'freeze' | 'export';

function Toolbar({ wb, run, compact }: { wb: Workbook; run: (id: string) => void; compact: boolean }) {
  const [pop, setPop] = useState<{ kind: PopKind; anchor: HTMLElement } | null>(null);
  const s = wb.sheet;
  const f = wb.getCell(s, s.sel.r, s.sel.c)?.f ?? {};
  const nf = NUM_FMTS.find((n) => n.id === (f.nf ?? 'general'))!;
  const open = (kind: PopKind) => (e: React.MouseEvent<HTMLButtonElement>) => { const a = e.currentTarget; setPop((p) => (p?.kind === kind ? null : { kind, anchor: a })); };
  const pick = (id: string) => { setPop(null); run(id); };
  const merged = s.merges.some((m) => m.r0 <= s.sel.range.r1 && s.sel.range.r0 <= m.r1 && m.c0 <= s.sel.range.c1 && s.sel.range.c0 <= m.c1);
  const frozen = s.freeze.rows > 0 || s.freeze.cols > 0;
  const g = { display: 'flex', gap: 4, flexShrink: 0 } as const;
  return (
    <div className="toolbar" style={{ gap: 8, padding: '0 12px' }}>
      <div style={g}>
        <TB active={!!f.b} onClick={() => run('cells.format.bold')} title="Bold (Ctrl B)" style={{ fontWeight: 800 }}>B</TB>
        <TB active={!!f.i} onClick={() => run('cells.format.italic')} title="Italic (Ctrl I)" style={{ fontStyle: 'italic' }}>I</TB>
        <TB active={!!f.u} onClick={() => run('cells.format.underline')} title="Underline (Ctrl U)" style={{ textDecoration: 'underline' }}>U</TB>
      </div>
      <TB onClick={open('nf')} title="Number format" style={{ font: 'var(--type-mono)' }}>{nf.sample} ▾</TB>
      <div style={g}>
        <TB onClick={open('align')} title="Align" active={!!f.al}>≡</TB>
        <TB onClick={() => run(merged ? 'cells.format.unmerge' : 'cells.format.merge')} active={merged} title={merged ? 'Unmerge cells' : 'Merge cells'}>Merge</TB>
        <TB onClick={() => run('cells.format.wrap')} active={!!f.wrap} title="Wrap text">Wrap</TB>
        <TB onClick={open('fill')} title="Fill and text colour">
          {f.fill && <span style={{ display: 'inline-block', width: 8, height: 8, background: f.fill, marginRight: 6, border: '1px solid var(--line)' }} />}Fill ▾
        </TB>
        <TB onClick={open('borders')} title="Borders">Borders ▾</TB>
      </div>
      <div className="tsep" style={{ margin: '10px 0' }} />
      <div style={g}>
        <TB onClick={() => run('cells.insert.autosum')} title="AutoSum (Alt =)">Σ Sum</TB>
        <TB onClick={() => run('cells.insert.chart')} title="Insert chart">Chart</TB>
        <TB onClick={() => run('cells.insert.pivot')} title="Pivot table">Pivot</TB>
        <TB onClick={() => run('cells.format.condFormat')} title="Conditional formatting rules">Rules</TB>
        <TB onClick={() => run('cells.data.filter')} active={!!s.filter} title="AutoFilter (Ctrl Shift L)">Filter</TB>
        <TB onClick={open('freeze')} active={frozen} title="Freeze panes">Freeze</TB>
      </div>
      <div style={{ flex: 1, minWidth: compact ? 8 : 16 }} />
      <TB onClick={() => run('file.export')} title="Convert & export (Ctrl Shift E)" style={{ padding: '6px 12px' }}>Export ▾</TB>
      <button type="button" onClick={() => run('cells.file.share')} onPointerDown={(e) => e.preventDefault()}
        style={{ font: 'var(--type-label)', fontSize: 12, fontWeight: 800, padding: '6px 14px', background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer', flexShrink: 0 }}>Share</button>

      {pop?.kind === 'nf' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={240}>
          {NUM_FMTS.map((n) => <PopItem key={n.id} active={n.id === nf.id} onClick={() => pick('cells.format.nf.' + n.id)} right={n.id === 'general' || n.id === 'text' ? undefined : n.sample}>{n.label}</PopItem>)}
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <PopItem onClick={() => pick('cells.format.decInc')} right=".0→.00">Increase decimals</PopItem>
          <PopItem onClick={() => pick('cells.format.decDec')} right=".00→.0">Decrease decimals</PopItem>
        </Popover>
      )}
      {pop?.kind === 'align' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={160}>
          <PopItem active={f.al === 'left'} onClick={() => pick('cells.format.alignLeft')}>Left</PopItem>
          <PopItem active={f.al === 'center'} onClick={() => pick('cells.format.alignCenter')}>Center</PopItem>
          <PopItem active={f.al === 'right'} onClick={() => pick('cells.format.alignRight')}>Right</PopItem>
        </Popover>
      )}
      {pop?.kind === 'fill' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={186}>
          <div className="eyebrow" style={{ padding: '6px 10px 0' }}>Fill</div>
          <Swatches value={f.fill} onPick={(c) => { setPop(null); wb.commitEdit(); wb.formatRange(s, s.sel.range, { fill: c }); }} />
          <div className="eyebrow" style={{ padding: '6px 10px 0', borderTop: '1px solid var(--line)' }}>Text</div>
          <Swatches value={f.color} noneLabel="Automatic" onPick={(c) => { setPop(null); wb.commitEdit(); wb.formatRange(s, s.sel.range, { color: c }); }} />
        </Popover>
      )}
      {pop?.kind === 'borders' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={180}>
          <PopItem onClick={() => pick('cells.format.bd.all')}>All borders</PopItem>
          <PopItem onClick={() => pick('cells.format.bd.outer')}>Outside borders</PopItem>
          <PopItem onClick={() => pick('cells.format.bd.bottom')}>Bottom border</PopItem>
          <PopItem onClick={() => pick('cells.format.bd.none')}>No borders</PopItem>
        </Popover>
      )}
      {pop?.kind === 'freeze' && (
        <Popover anchor={pop.anchor} onClose={() => setPop(null)} width={200}>
          <PopItem active={s.freeze.rows === 1 && s.freeze.cols === 0} onClick={() => pick('cells.view.freezeRow')}>Top row</PopItem>
          <PopItem active={s.freeze.rows === 0 && s.freeze.cols === 1} onClick={() => pick('cells.view.freezeCol')}>First column</PopItem>
          <PopItem onClick={() => pick('cells.view.freezeSel')} right={selectionLabel(wb, s)}>At selection</PopItem>
          <PopItem onClick={() => pick('cells.view.unfreeze')}>Unfreeze</PopItem>
        </Popover>
      )}
    </div>
  );
}

// ---------- formula bar ----------

function FormulaBar({ wb }: { wb: Workbook }) {
  const s = wb.sheet;
  const edit = wb.ui.edit && wb.ui.edit.sheetId === s.id ? wb.ui.edit : null;
  const raw = wb.getCell(s, s.sel.r, s.sel.c)?.v ?? '';
  const text = edit ? edit.text : raw;
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState<string | null>(null);
  const [caret, setCaret] = useState(0);
  const assist = useFormulaAssist(wb, text, caret);
  const barFocused = edit?.source === 'bar';
  const pendingCaret = useRef<number | null>(null);

  useEffect(() => { if (wb.ui.focusNameBox) { nameRef.current?.focus(); nameRef.current?.select(); } }, [wb.ui.focusNameBox]);
  useEffect(() => {
    const el = inputRef.current;
    if (el && pendingCaret.current != null) { const p = pendingCaret.current; pendingCaret.current = null; el.setSelectionRange(p, p); setCaret(p); }
  });
  // When a cell edit loses the bar focus (e.g. source moved to the cell editor), blur.
  useEffect(() => { if (!edit && document.activeElement === inputRef.current) inputRef.current?.blur(); }, [edit]);

  const accept = (i?: number) => {
    const res = assist.accept(i);
    if (!res) return;
    pendingCaret.current = res.caret;
    wb.setEditText(res.text);
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (assist.open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); assist.move(1); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); assist.move(-1); return; }
      if (e.key === 'Tab') { e.preventDefault(); accept(); return; }
      if (e.key === 'Escape') { e.preventDefault(); assist.dismiss(); return; }
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      wb.commitEdit();
      wb.ui.focusGrid++;
      const r = Math.min(MAX_ROWS - 1, s.sel.r + (e.shiftKey ? -1 : 1));
      wb.select(Math.max(0, r), s.sel.c);
      return;
    }
    if (e.key === 'Tab') { e.preventDefault(); wb.commitEdit(); wb.ui.focusGrid++; wb.select(s.sel.r, Math.max(0, Math.min(MAX_COLS - 1, s.sel.c + (e.shiftKey ? -1 : 1)))); return; }
    if (e.key === 'Escape') { e.preventDefault(); wb.cancelEdit(); }
  };
  const onFocus = () => {
    if (!wb.ui.edit) wb.beginEdit(null, 'edit', 'bar');
    else if (wb.ui.edit.source !== 'bar') { wb.ui.edit = { ...wb.ui.edit, source: 'bar' }; wb.emit(); }
  };

  const label = name ?? selectionLabel(wb, s);
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 'var(--h-formula)', borderBottom: '1px solid var(--line)', background: 'var(--bg1)', font: '500 12px var(--font-mono)', flexShrink: 0, position: 'relative', zIndex: 4 }}>
      <input ref={nameRef} value={label} spellCheck={false} aria-label="Name box"
        onFocus={(e) => { setName(selectionLabel(wb, s)); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => setName(null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            if (gotoAddress(wb, name ?? '')) { setName(null); wb.ui.focusGrid++; wb.emit(); nameRef.current?.blur(); }
            else (e.target as HTMLInputElement).style.color = 'var(--negative)';
          } else if (e.key === 'Escape') { setName(null); wb.ui.focusGrid++; wb.emit(); nameRef.current?.blur(); }
          else (e.target as HTMLInputElement).style.color = '';
        }}
        style={{ width: 90, height: '100%', padding: '0 12px', border: 0, borderRight: '1px solid var(--line)', background: 'transparent', color: 'var(--ink)', font: 'inherit', outline: 'none', flexShrink: 0 }} />
      <div style={{ width: 36, textAlign: 'center', color: 'var(--mute)', fontStyle: 'italic', flexShrink: 0 }}>fx</div>
      <div style={{ flex: 1, height: '100%', position: 'relative', minWidth: 0 }}>
        <input ref={inputRef} value={text} spellCheck={false} aria-label="Formula"
          onFocus={onFocus}
          onChange={(e) => { setCaret(e.target.selectionStart ?? 0); assist.reset(); if (!wb.ui.edit) wb.beginEdit(e.target.value, 'edit', 'bar'); else wb.setEditText(e.target.value); }}
          onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          style={{ width: '100%', height: '100%', padding: '0 8px', border: 0, background: barFocused ? 'var(--sel)' : 'transparent', color: 'var(--ink)', font: 'inherit', outline: 'none', caretColor: 'var(--accent)' }} />
        {barFocused && <AcDropdown wb={wb} assist={assist} onPick={(i) => accept(i)} style={{ left: 0, top: 34 }} />}
      </div>
    </div>
  );
}

// ---------- sheet tabs + status ----------

function SheetTabs({ wb, run }: { wb: Workbook; run: (id: string) => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const summary = useSelectionSummary(wb);
  const commitRename = () => {
    const s = wb.sheets.find((x) => x.id === renaming);
    if (s && draft.trim() && draft.trim() !== s.name && !wb.renameSheet(s, draft)) { /* invalid name: keep old */ }
    setRenaming(null);
    wb.ui.focusGrid++;
    wb.emit();
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 34, borderTop: '1px solid var(--line)', background: 'var(--bg1)', padding: '0 8px', gap: 2, font: 'var(--type-small)', flexShrink: 0, minWidth: 0 }}>
      <div style={{ display: 'flex', gap: 2, overflowX: 'auto', minWidth: 0, flexShrink: 1 }}>
        {wb.sheets.map((sh, i) => {
          const on = i === wb.active;
          if (renaming === sh.id) {
            return (
              <input key={sh.id} autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commitRename} onFocus={(e) => e.target.select()}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenaming(null); } }}
                style={{ width: Math.max(80, draft.length * 8 + 28), padding: '5px 12px', background: 'var(--bg0)', color: 'var(--ink)', border: '1px solid var(--accent)', font: 'inherit', fontWeight: 700, outline: 'none' }} />
            );
          }
          return (
            <div key={sh.id} onClick={() => wb.setActiveSheet(i)} onDoubleClick={() => { setDraft(sh.name); setRenaming(sh.id); }}
              onContextMenu={(e) => { e.preventDefault(); wb.setActiveSheet(i); setMenu({ x: e.clientX, y: e.clientY }); }}
              className={on ? '' : 'hov-ink'}
              style={{ padding: '6px 14px', cursor: 'pointer', whiteSpace: 'nowrap', background: on ? 'var(--bg0)' : 'transparent', fontWeight: on ? 700 : 500, color: on ? 'var(--ink)' : 'var(--mute)', boxShadow: on ? 'inset 0 2px 0 var(--accent)' : 'none' }}>
              {sh.name}
            </div>
          );
        })}
      </div>
      <div onClick={() => run('cells.insert.sheet')} title="Add sheet" className="hov-ink" style={{ padding: '6px 10px', color: 'var(--mute)', cursor: 'pointer', flexShrink: 0 }}>+</div>
      <div style={{ flex: 1 }} />
      <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingLeft: 12 }}>{summary}</div>
      {menu && (
        <div onPointerDown={(e) => e.stopPropagation()}
          style={{ position: 'fixed', left: menu.x, top: Math.max(4, menu.y - 190), width: 200, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 60, padding: '4px 0' }}>
          <MenuItem label="Rename…" onClick={() => { setMenu(null); setDraft(wb.sheet.name); setRenaming(wb.sheet.id); }} />
          <MenuItem label="Duplicate" onClick={() => { setMenu(null); run('cells.sheet.duplicate'); }} />
          <MenuItem label="Move left" disabled={wb.active === 0} onClick={() => { setMenu(null); run('cells.sheet.moveLeft'); }} />
          <MenuItem label="Move right" disabled={wb.active === wb.sheets.length - 1} onClick={() => { setMenu(null); run('cells.sheet.moveRight'); }} />
          <div style={{ height: 1, background: 'var(--line)', margin: '4px 0' }} />
          <MenuItem label="Delete" disabled={wb.sheets.length <= 1} onClick={() => { setMenu(null); run('cells.sheet.delete'); }} />
        </div>
      )}
    </div>
  );
}

function useSelectionSummary(wb: Workbook): string {
  const s = wb.sheet;
  const g = s.sel.range;
  return useMemo(() => {
    if (g.r0 === g.r1 && g.c0 === g.c1) {
      const d = wb.display(s, g.r0, g.c0);
      return d.text ? `Value ${d.text} · 1 cell` : 'Ready';
    }
    const cl = wb.clampToUsed(s, g);
    let sum = 0;
    let nums = 0;
    let count = 0;
    const hidden = wb.hiddenRows(s);
    for (const [r, c, cell] of wb.cellsIn(s, cl)) {
      if (cell.v === '' || hidden.has(r)) continue;
      count++;
      const n = wb.num(s, r, c);
      if (n != null) { sum += n; nums++; }
    }
    const cells = (g.r1 >= MAX_ROWS - 1 || g.c1 >= MAX_COLS - 1) ? count : (g.r1 - g.r0 + 1) * (g.c1 - g.c0 + 1);
    if (!nums) return `Count ${count.toLocaleString('en-US')} · ${cells.toLocaleString('en-US')} cells`;
    const f = (n: number) => formatNumber(n, 'number', 2);
    return `Sum ${f(sum)} · Avg ${f(sum / nums)} · Count ${count.toLocaleString('en-US')}`;
  }, [wb.version]); // eslint-disable-line react-hooks/exhaustive-deps
}
