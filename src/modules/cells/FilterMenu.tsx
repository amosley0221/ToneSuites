// AutoFilter dropdown for one column: sort + value checklist.
import { useEffect, useMemo, useState } from 'react';
import { Button, Checkbox } from '@/ui';
import type { Sheet, Workbook } from './model';

export function FilterMenu({ wb, sheet, col, x, y, onClose }: { wb: Workbook; sheet: Sheet; col: number; x: number; y: number; onClose: () => void }) {
  const f = sheet.filter!;
  const values = useMemo(() => {
    const set = new Map<string, number>();
    for (let r = f.range.r0 + 1; r <= f.range.r1; r++) {
      const t = wb.display(sheet, r, col).text;
      set.set(t, (set.get(t) ?? 0) + 1);
    }
    return [...set.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  }, [wb, sheet, col, f.range.r0, f.range.r1]);
  const [hidden, setHidden] = useState(() => new Set(f.hidden[col] ?? []));
  const [q, setQ] = useState('');
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    const down = () => onClose();
    window.addEventListener('keydown', k, true);
    window.addEventListener('pointerdown', down);
    return () => { window.removeEventListener('keydown', k, true); window.removeEventListener('pointerdown', down); };
  }, [onClose]);
  const shown = values.filter((v) => v.toLowerCase().includes(q.toLowerCase())).slice(0, 1000);
  const apply = () => {
    wb.structural(() => {
      if (!sheet.filter) return;
      sheet.filter.hidden = { ...sheet.filter.hidden, [col]: [...hidden] };
    });
    onClose();
  };
  const sort = (asc: boolean) => {
    wb.sortRange(sheet, f.range, col, asc, true);
    onClose();
  };
  const left = Math.min(x, window.innerWidth - 270);
  return (
    <div onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', left: Math.max(4, left), top: Math.min(y, window.innerHeight - 380), width: 260, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 60, display: 'flex', flexDirection: 'column', font: 'var(--type-small)' }}>
      <div className="hov-row" onClick={() => sort(true)} style={{ padding: '7px 12px', cursor: 'pointer' }}>Sort A → Z</div>
      <div className="hov-row" onClick={() => sort(false)} style={{ padding: '7px 12px', cursor: 'pointer', borderBottom: '1px solid var(--line)' }}>Sort Z → A</div>
      <div style={{ padding: 8 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search values…" autoFocus
          style={{ width: '100%', padding: '5px 8px', background: 'var(--bg0)', border: '1px solid var(--line)', color: 'var(--ink)', font: 'var(--type-mono)', outline: 'none' }} />
      </div>
      <div style={{ display: 'flex', gap: 6, padding: '0 8px 6px' }}>
        <Button size="sm" onClick={() => setHidden(new Set())}>Select all</Button>
        <Button size="sm" onClick={() => setHidden(new Set(values))}>Clear</Button>
      </div>
      <div style={{ maxHeight: 220, overflowY: 'auto', padding: '2px 12px', borderTop: '1px solid var(--line)', borderBottom: '1px solid var(--line)' }}>
        {shown.map((v) => (
          <div key={v} style={{ padding: '3px 0' }}>
            <Checkbox checked={!hidden.has(v)} onChange={(on) => setHidden((h) => { const n = new Set(h); if (on) n.delete(v); else n.add(v); return n; })}
              label={<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200, display: 'inline-block' }}>{v === '' ? '(Blanks)' : v}</span>} />
          </div>
        ))}
        {values.length > shown.length && !q && <div className="empty-hint">Showing first 1,000 values</div>}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, padding: 8 }}>
        <Button size="sm" onClick={onClose}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={apply}>OK</Button>
      </div>
    </div>
  );
}
