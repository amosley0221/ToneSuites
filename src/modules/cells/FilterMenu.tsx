// AutoFilter dropdown for one column: sort, live "contains" search, value checklist.
// Typing filters the sheet immediately (preview); OK, Enter or clicking outside keeps it, Cancel / Esc restores the previous filter.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Checkbox } from '@/ui';
import { filterKey, type Sheet, type Workbook } from './model';

export function FilterMenu({ wb, sheet, col, x, y, onClose }: { wb: Workbook; sheet: Sheet; col: number; x: number; y: number; onClose: () => void }) {
  const f = sheet.filter!;
  const original = useRef({ hidden: f.hidden[col] ?? [], contains: f.contains?.[col] ?? '' });
  const values = useMemo(() => {
    const set = new Set<string>();
    for (let r = f.range.r0 + 1; r <= f.range.r1; r++) set.add(wb.display(sheet, r, col).text);
    return [...set].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  }, [wb, sheet, col, f.range.r0, f.range.r1]);
  const [hidden, setHidden] = useState(() => new Set(original.current.hidden));
  const [q, setQ] = useState(original.current.contains);
  const total = f.range.r1 - f.range.r0;

  // Write this column's filter state onto the sheet and redraw (no undo step, not dirty: it's a preview).
  const preview = (contains: string, hiddenVals: string[]) => {
    if (!sheet.filter || !wb.sheets.includes(sheet)) return; // filter turned off / sheet deleted meanwhile
    sheet.filter.contains = { ...(sheet.filter.contains ?? {}), [col]: contains };
    sheet.filter.hidden = { ...sheet.filter.hidden, [col]: hiddenVals };
    sheet._hidden = undefined;
    wb.emit(false);
  };
  const restore = () => preview(original.current.contains, original.current.hidden);
  const closed = useRef(false);
  const mounted = useRef(false);
  const cancel = () => { closed.current = true; restore(); onClose(); };

  useEffect(() => { preview(q, [...hidden]); }, [q, hidden]);

  // Rows the sheet shows with this preview and every other column's filter (redrawn after each preview emit).
  const matches = total - (sheet.filter ? wb.hiddenRows(sheet).size : 0);

  useEffect(() => {
    mounted.current = true;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } };
    // Clicking or tapping outside keeps what the sheet already shows (the live preview); only Cancel / Esc undo it.
    const outside = () => applyRef.current();
    window.addEventListener('keydown', k, true);
    // Defer: the pointerdown that opened this menu is still bubbling to window.
    const t = setTimeout(() => window.addEventListener('pointerdown', outside));
    return () => {
      clearTimeout(t); window.removeEventListener('keydown', k, true); window.removeEventListener('pointerdown', outside);
      // Replaced by another column's menu (or the sheet changed): keep this column's live filter as a proper,
      // undoable step. Deferred so React's dev double-mount (StrictMode) doesn't count as closing.
      mounted.current = false;
      setTimeout(() => { if (!mounted.current && !closed.current) applyRef.current(); });
    };
  }, []);

  const key = filterKey(q);
  const shown = (key ? values.filter((v) => filterKey(v).includes(key)) : values).slice(0, 1000);
  const apply = () => {
    if (closed.current) return;
    closed.current = true;
    const next = { contains: q.trim(), hidden: [...hidden] };
    restore(); // so the undo step captures the state before this filter
    const changed = next.contains !== original.current.contains.trim() || next.hidden.length !== original.current.hidden.length || next.hidden.some((v) => !original.current.hidden.includes(v));
    if (changed && sheet.filter && wb.sheets.includes(sheet)) {
      wb.structural(() => {
        if (!sheet.filter) return;
        sheet.filter.contains = { ...(sheet.filter.contains ?? {}), [col]: next.contains };
        sheet.filter.hidden = { ...sheet.filter.hidden, [col]: next.hidden };
      });
    }
    onClose();
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const sort = (asc: boolean) => {
    closed.current = true;
    restore();
    wb.sortRange(sheet, f.range, col, asc, true);
    onClose();
  };
  const left = Math.min(x, window.innerWidth - 270);
  return (
    <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', left: Math.max(4, left), top: Math.min(y, window.innerHeight - 400), width: 260, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 60, display: 'flex', flexDirection: 'column', font: 'var(--type-small)' }}>
      <div className="hov-row" onClick={() => sort(true)} style={{ padding: '7px 12px', cursor: 'pointer' }}>Sort A → Z</div>
      <div className="hov-row" onClick={() => sort(false)} style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}>Sort Z → A</div>
      <div style={{ padding: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter rows containing…" autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } }}
          style={{ width: '100%', padding: '5px 8px', background: 'var(--bg0)', border: '1px solid var(--line)', color: 'var(--ink)', font: 'var(--type-mono)', outline: 'none' }} />
        <div style={{ font: 'var(--type-mono)', marginTop: 6, color: matches ? 'var(--mute)' : 'var(--negative)' }}>
          {matches ? `${matches.toLocaleString()} of ${total.toLocaleString()} rows` : 'No matches'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '0 8px 6px' }}>
        <Button size="sm" onClick={() => setHidden(new Set())}>Select all</Button>
        <Button size="sm" onClick={() => setHidden(new Set(values))}>Clear</Button>
        {(q || hidden.size > 0) && <Button size="sm" variant="ghost" onClick={() => { setQ(''); setHidden(new Set()); }}>Reset</Button>}
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '2px 12px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        {shown.map((v) => (
          <div key={v} style={{ padding: '3px 0' }}>
            <Checkbox checked={!hidden.has(v)} onChange={(on) => setHidden((h) => { const n = new Set(h); if (on) n.delete(v); else n.add(v); return n; })}
              label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, display: 'inline-block' }}>{v === '' ? '(Blanks)' : v}</span>} />
          </div>
        ))}
        {!shown.length && <div className="empty-hint">No values contain "{q}".</div>}
        {values.length > 1000 && shown.length === 1000 && <div className="empty-hint">Showing first 1,000 values — type to narrow.</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: 8 }}>
        <Button size="sm" onClick={cancel}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={apply}>OK</Button>
      </div>
    </div>
  );
}
