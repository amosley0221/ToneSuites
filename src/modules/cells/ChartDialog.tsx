// Chart editor dialog: type, data range, series, options, live preview → floating chart on the sheet.
import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/ui';
import { parseSheetRange, quoteSheet, rangeToA1 } from './address';
import { CHART_TYPES, ChartSvg, chartDataFor, SERIES_COLORS } from './chart';
import { DEFAULT_COL_W, DEFAULT_ROW_H, uid, type ChartDef, type ChartType, type Workbook } from './model';
import { Check, Label, monoInput, stopEditKeys } from './widgets';

export function ChartDialog({ wb, chartId, onClose }: { wb: Workbook; chartId?: string; onClose: () => void }) {
  const s = wb.sheet;
  const existing = chartId ? wb.sheets.flatMap((x) => x.charts).find((c) => c.id === chartId) : undefined;
  const initialRange = () => {
    if (existing) {
      const src = wb.sheetById(existing.sheetId);
      return `${quoteSheet(src?.name ?? s.name)}!${existing.range}`;
    }
    const g = s.sel.range;
    const rg = g.r0 === g.r1 && g.c0 === g.c1 ? wb.currentRegion(s, g.r0, g.c0) : wb.clampToUsed(s, g);
    return `${quoteSheet(s.name)}!${rangeToA1(rg)}`;
  };
  const [rangeText, setRangeText] = useState(initialRange);
  const [type, setType] = useState<ChartType>(existing?.type ?? 'column');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [switchRC, setSwitchRC] = useState(existing?.switchRC ?? false);
  const [showTitle, setShowTitle] = useState(existing?.showTitle ?? true);
  const [legend, setLegend] = useState(existing?.legend ?? true);
  const [gridlines, setGridlines] = useState(existing?.gridlines ?? false);
  const [labels, setLabels] = useState(existing?.labels ?? false);
  const [hidden, setHidden] = useState<number[]>(existing?.hidden ?? []);

  const parsed = parseSheetRange(rangeText);
  const srcSheet = parsed ? (parsed.sheet ? wb.sheetByName(parsed.sheet) : s) : undefined;
  const valid = !!parsed && !!srcSheet;
  const source = valid ? { sheetId: srcSheet!.id, range: rangeToA1(parsed!.range), switchRC } : null;
  const data = source ? chartDataFor(wb, source) : { categories: [], series: [] };

  const previewRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 560, h: 380 });
  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const insert = () => {
    if (!source) return;
    const props = { type, title, switchRC, showTitle, legend, gridlines, labels, hidden, sheetId: source.sheetId, range: source.range };
    if (existing) {
      wb.structural(() => {
        const c = wb.sheets.flatMap((x) => x.charts).find((x) => x.id === existing.id);
        if (c) Object.assign(c, props);
      });
    } else {
      // Place the chart to the right of the source range, on the active sheet.
      const g = parsed!.range;
      let x = 0;
      for (let c = 0; c <= Math.min(g.c1, 200); c++) x += s.colWidths.get(c) ?? DEFAULT_COL_W;
      let y = 0;
      for (let r = 0; r < Math.min(g.r0, 5000); r++) y += s.rowHeights.get(r) ?? DEFAULT_ROW_H;
      const chart: ChartDef = { id: uid(), ...props, x: x + 24, y, w: 520, h: 320 };
      wb.structural(() => { s.charts.push(chart); });
      wb.ui.selectedChart = chart.id;
    }
    onClose();
  };

  const subtitle = valid ? `${srcSheet!.name}!${rangeToA1(parsed!.range)}` : 'Invalid range';
  return (
    <Dialog title="Chart editor" subtitle={subtitle} width={900} height={560} onClose={onClose}>
      <div onKeyDown={stopEditKeys} style={{ display: 'flex', flex: 1, minWidth: 0 }}>
        <div style={{ width: 260, borderRight: '1px solid var(--line)', padding: 14, display: 'flex', flexDirection: 'column', gap: 14, font: 'var(--type-small)', overflow: 'auto', flexShrink: 0 }}>
          <div>
            <Label>Type</Label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4, marginTop: 8 }}>
              {CHART_TYPES.map((t) => {
                const on = t.id === type;
                return (
                  <div key={t.id} onClick={() => setType(t.id)} className={on ? '' : 'hov-border'}
                    style={{ padding: '8px 10px', border: '1px solid ' + (on ? 'var(--ink)' : 'var(--line)'), background: on ? 'var(--ink)' : 'transparent', color: on ? 'var(--bg0)' : 'var(--ink)', fontWeight: on ? 700 : 500, cursor: 'pointer' }}>{t.label}</div>
                );
              })}
            </div>
          </div>
          <div>
            <Label>Data range</Label>
            <input value={rangeText} onChange={(e) => setRangeText(e.target.value)} spellCheck={false}
              style={{ ...monoInput, marginTop: 8, borderColor: valid ? 'var(--line)' : 'var(--negative)' }} />
          </div>
          <div>
            <Label>Series</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {data.series.length === 0 && <div className="empty-hint">No numeric series in this range</div>}
              {data.series.map((ser, i) => {
                const off = hidden.includes(i);
                return (
                  <div key={i} onClick={() => setHidden((h) => (off ? h.filter((x) => x !== i) : [...h, i]))} className="hov-border" title={off ? 'Show series' : 'Hide series'}
                    style={{ padding: '7px 10px', border: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', color: off ? 'var(--mute)' : 'var(--ink)', textDecoration: off ? 'line-through' : 'none' }}>
                    <div style={{ width: 10, height: 10, background: off ? 'transparent' : SERIES_COLORS[i % SERIES_COLORS.length], border: off ? '1px solid var(--line)' : 0, flexShrink: 0 }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ser.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <Check on={switchRC} onChange={setSwitchRC}>Switch rows / columns</Check>
        </div>
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chart title"
            style={{ font: 'var(--type-title)', letterSpacing: '-0.02em', background: 'transparent', border: 0, borderBottom: '1px solid transparent', color: 'var(--ink)', outline: 'none', padding: 0 }}
            onFocus={(e) => (e.currentTarget.style.borderBottomColor = 'var(--line)')} onBlur={(e) => (e.currentTarget.style.borderBottomColor = 'transparent')} />
          <div ref={previewRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 0 }}>
              <ChartSvg data={data} width={size.w} height={size.h} opts={{ type, title: '', showTitle: false, legend, gridlines, labels, hidden }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <Check on={showTitle} onChange={setShowTitle}>Title</Check>
            <Check on={legend} onChange={setLegend}>Legend</Check>
            <Check on={gridlines} onChange={setGridlines}>Gridlines</Check>
            <Check on={labels} onChange={setLabels}>Data labels</Check>
            <div style={{ flex: 1 }} />
            <button type="button" onClick={insert} disabled={!valid}
              style={{ font: 'var(--type-label)', fontWeight: 800, padding: '8px 16px', background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: valid ? 'pointer' : 'default', opacity: valid ? 1 : 0.4 }}>
              {existing ? 'Update chart' : 'Insert chart'}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
