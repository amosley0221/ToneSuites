// Pivot builder: fields from the header row of the source range → rows / columns / values / filters, live preview.
import { useMemo, useState } from 'react';
import { Dialog } from '@/ui';
import { colToLetters, rangeToA1, type Range } from './address';
import { AGGS, buildPivot, fieldType, type Agg, type PivotConfig, type PivotValue } from './pivot';
import { formatNumber } from './numfmt';
import type { CellFormat, Workbook } from './model';
import { Check, Label, stopEditKeys } from './widgets';

type Zone = 'rows' | 'cols' | 'values' | 'filters';
const OPT = { color: 'var(--ink)', background: 'var(--bg1)' };

export function PivotDialog({ wb, onClose }: { wb: Workbook; onClose: () => void }) {
  const s = wb.sheet;
  const src: Range = useMemo(() => {
    const g = s.sel.range;
    return g.r0 === g.r1 && g.c0 === g.c1 ? wb.currentRegion(s, g.r0, g.c0) : wb.clampToUsed(s, g);
  }, [wb, s]);
  const { header, data } = useMemo(() => {
    const header: string[] = [];
    for (let c = src.c0; c <= src.c1; c++) header.push(wb.display(s, src.r0, c).text || `Column ${colToLetters(c)}`);
    const data: PivotValue[][] = [];
    const lim = Math.min(src.r1, src.r0 + 200000);
    for (let r = src.r0 + 1; r <= lim; r++) {
      const row: PivotValue[] = [];
      for (let c = src.c0; c <= src.c1; c++) {
        const v = wb.value(s, r, c);
        row.push(typeof v === 'number' ? v : v == null ? null : typeof v === 'string' ? v : wb.display(s, r, c).text);
      }
      data.push(row);
    }
    return { header, data };
  }, [wb, s, src]);
  const types = useMemo(() => header.map((_, i) => fieldType(data, i)), [header, data]);

  const [cfg, setCfg] = useState<PivotConfig>({ rows: [], cols: [], values: [], filters: [], grandTotals: true });
  const [place, setPlace] = useState<'new' | 'right'>('new');
  const [dragField, setDragField] = useState<{ field: number; from?: Zone } | null>(null);
  const result = useMemo(() => (cfg.values.length || cfg.rows.length ? buildPivot(header, data, cfg) : null), [header, data, cfg]);

  const removeFrom = (c: PivotConfig, zone: Zone, field: number): PivotConfig => {
    if (zone === 'values') return { ...c, values: c.values.filter((v) => v.field !== field) };
    if (zone === 'filters') return { ...c, filters: c.filters.filter((v) => v.field !== field) };
    return { ...c, [zone]: c[zone].filter((f) => f !== field) };
  };
  const addTo = (zone: Zone, field: number, from?: Zone) => setCfg((c0) => {
    let c = from ? removeFrom(c0, from, field) : c0;
    if (zone === 'values') {
      if (!c.values.some((v) => v.field === field)) c = { ...c, values: [...c.values, { field, agg: types[field] === 'num' ? 'sum' : 'count' }] };
    } else if (zone === 'filters') {
      if (!c.filters.some((v) => v.field === field)) c = { ...c, filters: [...c.filters, { field, value: '' }] };
    } else {
      // A field can't be both a row and a column
      c = removeFrom(removeFrom(c, 'rows', field), 'cols', field);
      c = { ...c, [zone]: [...c[zone], field] };
    }
    return c;
  });

  const quickAdd = (field: number) => addTo(types[field] === 'num' ? 'values' : cfg.rows.length ? (cfg.cols.length ? 'filters' : 'cols') : 'rows', field);

  const create = () => {
    if (!result) return;
    const cells = result.cells;
    const fmt = (i: number, j: number): CellFormat | undefined => {
      const head = i < result.headerRows;
      const total = result.hasTotalRow && i === cells.length - 1;
      const f: CellFormat = {};
      if (head || total) f.b = true;
      if (!head && j >= result.rowLabelCols && typeof cells[i][j] === 'number') f.nf = 'number';
      return Object.keys(f).length ? f : undefined;
    };
    wb.group(() => {
      if (place === 'new') {
        const name = wb.uniqueSheetName('Pivot');
        const ns = wb.addSheet(name, wb.active + 1);
        wb.writeGrid(ns, 0, 0, cells, fmt);
        wb.structural(() => {
          ns.freeze = { rows: result.headerRows, cols: 0 };
          ns.colWidths.set(0, 180);
        });
      } else {
        wb.writeGrid(s, src.r0, src.c1 + 2, cells, fmt);
      }
    });
    if (place === 'new') wb.select(0, 0);
    else wb.select(src.r0, src.c1 + 2, { r0: src.r0, c0: src.c1 + 2, r1: src.r0 + cells.length - 1, c1: src.c1 + 2 + cells[0].length - 1 });
    onClose();
  };

  const zoneBox = (zone: Zone, label: string) => {
    const items: { field: number; extra?: React.ReactNode }[] =
      zone === 'values' ? cfg.values.map((v, i) => ({
        field: v.field,
        extra: (
          <select value={v.agg} onClick={(e) => e.stopPropagation()} onChange={(e) => setCfg((c) => ({ ...c, values: c.values.map((x, k) => (k === i ? { ...x, agg: e.target.value as Agg } : x)) }))}
            style={{ background: 'transparent', border: 0, color: 'inherit', opacity: 0.6, font: 'inherit', fontWeight: 700, cursor: 'pointer', textTransform: 'uppercase' }}>
            {AGGS.map((a) => <option key={a} value={a} style={OPT}>{a.toUpperCase()}</option>)}
          </select>
        ),
      }))
      : zone === 'filters' ? cfg.filters.map((f, i) => ({
        field: f.field,
        extra: (
          <select value={f.value} onClick={(e) => e.stopPropagation()} onChange={(e) => setCfg((c) => ({ ...c, filters: c.filters.map((x, k) => (k === i ? { ...x, value: e.target.value } : x)) }))}
            style={{ background: 'transparent', border: 0, color: 'inherit', opacity: 0.7, font: 'inherit', fontWeight: 700, cursor: 'pointer', maxWidth: 100 }}>
            <option value="" style={OPT}>All</option>
            {[...new Set(data.map((r) => (r[f.field] == null ? '' : String(r[f.field]))))].filter((x) => x !== '').slice(0, 300).sort().map((x) => <option key={x} value={x} style={OPT}>{x}</option>)}
          </select>
        ),
      }))
      : cfg[zone].map((field) => ({ field }));
    return (
      <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (dragField) addTo(zone, dragField.field, dragField.from); setDragField(null); }}>
        <Label>{label}</Label>
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(({ field, extra }) => (
            <div key={field} draggable onDragStart={() => setDragField({ field, from: zone })}
              style={{ padding: '7px 10px', background: 'var(--ink)', color: 'var(--bg0)', fontWeight: 700, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, cursor: 'grab' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{header[field]}</span>
              {extra}
              <span title="Remove" onClick={() => setCfg((c) => removeFrom(c, zone, field))} style={{ opacity: 0.6, cursor: 'pointer', padding: '0 2px' }}>✕</span>
            </div>
          ))}
          <div style={{ padding: '7px 10px', border: '1px dashed var(--line)', color: 'var(--mute)' }}>Drop field</div>
        </div>
      </div>
    );
  };

  const fmtCell = (v: PivotValue) => (typeof v === 'number' ? formatNumber(v, 'number', 2) : v ?? '');
  const preview = result ? result.cells.slice(0, 60) : [];
  const ncols = preview[0]?.length ?? 0;

  return (
    <Dialog title="Pivot table" subtitle={`${s.name}!${rangeToA1(src)}`} width={1040} height={600} onClose={onClose}>
      <div onKeyDown={stopEditKeys} style={{ display: 'flex', flex: 1, minWidth: 0, font: 'var(--type-small)' }}>
        <div style={{ width: 220, borderRight: '1px solid var(--line)', padding: 14, overflowY: 'auto', flexShrink: 0 }}>
          <Label>Fields · {s.name}!{rangeToA1(src)}</Label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
            {data.length === 0 && <div className="empty-hint">Select a range with a header row and data below it.</div>}
            {data.length > 0 && header.map((h, i) => (
              <div key={i} draggable onDragStart={() => setDragField({ field: i })} onClick={() => quickAdd(i)} className="hov-border" title="Drag to a zone, or click to add"
                style={{ padding: '7px 10px', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', cursor: 'grab', gap: 8 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h}</span>
                <span style={{ color: 'var(--mute)', font: 'var(--type-mono)', fontSize: 10 }}>{types[i]}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ width: 240, borderRight: '1px solid var(--line)', padding: 14, display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto', flexShrink: 0 }}>
          {zoneBox('rows', 'Rows')}
          {zoneBox('cols', 'Columns')}
          {zoneBox('values', 'Values')}
          {zoneBox('filters', 'Filters')}
          <div style={{ marginTop: 'auto' }}><Check on={cfg.grandTotals} onChange={(v) => setCfg((c) => ({ ...c, grandTotals: v }))}>Show grand totals</Check></div>
        </div>
        <div style={{ flex: 1, padding: 14, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <Label>Preview</Label>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            {!result && <div className="empty-hint">Add a field to Rows and a field to Values to build the pivot.</div>}
            {result && (
              <div style={{ display: 'grid', gridTemplateColumns: `minmax(120px, 1.4fr) repeat(${Math.max(0, ncols - 1)}, minmax(90px, 1fr))`, font: 'var(--type-mono)', border: '1px solid var(--line)', width: 'max-content', minWidth: '100%' }}>
                {preview.flatMap((row, i) => row.map((v, j) => {
                  const head = i < result.headerRows;
                  const total = result.hasTotalRow && i === result.cells.length - 1;
                  const neg = typeof v === 'number' && v < 0;
                  return (
                    <div key={`${i}-${j}`} style={{
                      padding: '7px 10px', borderBottom: '1px solid var(--line)', borderRight: '1px solid var(--line)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      background: head || total ? 'var(--bg1)' : 'var(--bg0)', color: head ? 'var(--mute)' : neg ? 'var(--negative)' : 'var(--ink)',
                      fontWeight: head || total ? 700 : 400, textAlign: j < result.rowLabelCols ? 'left' : 'right',
                    }}>{fmtCell(v)}</div>
                  );
                }))}
              </div>
            )}
            {result && result.cells.length > preview.length && <div className="empty-hint">Preview shows the first {preview.length} of {result.cells.length} rows.</div>}
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
            <select value={place} onChange={(e) => setPlace(e.target.value as 'new' | 'right')}
              style={{ padding: '6px 12px', border: '1px solid var(--line)', background: 'var(--bg1)', color: 'var(--ink)', font: 'var(--type-label)', fontSize: 12, cursor: 'pointer' }}>
              <option value="new">Place on new sheet</option>
              <option value="right">Place right of the data</option>
            </select>
            <button type="button" onClick={create} disabled={!result}
              style={{ font: 'var(--type-label)', fontWeight: 800, padding: '8px 16px', background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: result ? 'pointer' : 'default', opacity: result ? 1 : 0.4 }}>Create pivot</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
