// Chart data extraction (from a sheet range) and SVG rendering for the chart editor + floating charts.
import { parseRange } from './address';
import type { ChartDef, ChartType, Workbook } from './model';

export const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: 'column', label: 'Column' }, { id: 'bar', label: 'Bar' },
  { id: 'line', label: 'Line' }, { id: 'area', label: 'Area' },
  { id: 'pie', label: 'Pie' }, { id: 'scatter', label: 'Scatter' },
  { id: 'stacked', label: 'Stacked' }, { id: 'combo', label: 'Combo' },
];

export const SERIES_COLORS = ['var(--accent)', 'var(--ink)', 'var(--mute)', 'var(--info)', 'var(--positive)', 'var(--negative)', '#b58cff', '#f5c542'];

export interface ChartSeries { name: string; values: (number | null)[] }
export interface ChartData { categories: string[]; series: ChartSeries[] }

/**
 * Turn a matrix of cell values into categories + series. A first row of non-numeric labels becomes
 * series names; a first column of non-numeric labels becomes categories. Series run down columns
 * (or across rows when `switchRC`).
 */
export function extractSeries(values: unknown[][], texts: string[][], switchRC = false): ChartData {
  let v = values;
  let t = texts;
  if (switchRC) {
    const tr = <T,>(m: T[][]) => (m[0] ?? []).map((_, j) => m.map((row) => row[j]));
    v = tr(v);
    t = tr(t);
  }
  const rows = v.length;
  const cols = rows ? v[0].length : 0;
  if (!rows || !cols) return { categories: [], series: [] };
  const isNum = (x: unknown) => typeof x === 'number';
  const nonNumOrEmpty = (x: unknown) => !isNum(x);
  // Header row: every cell after the first column is a label (or empty) and at least one is non-empty.
  const headerRow = rows > 1 && v[0].slice(cols > 1 ? 1 : 0).every(nonNumOrEmpty) && t[0].some((s) => s !== '');
  const r0 = headerRow ? 1 : 0;
  // Label column: first column is non-numeric in all data rows.
  const labelCol = cols > 1 && v.slice(r0).every((row) => nonNumOrEmpty(row[0]));
  const c0 = labelCol ? 1 : 0;
  const categories: string[] = [];
  for (let r = r0; r < rows; r++) categories.push(labelCol ? t[r][0] : String(r - r0 + 1));
  const series: ChartSeries[] = [];
  for (let c = c0; c < cols; c++) {
    series.push({
      name: headerRow ? t[0][c] || `Series ${c - c0 + 1}` : `Series ${c - c0 + 1}`,
      values: v.slice(r0).map((row) => (isNum(row[c]) ? (row[c] as number) : null)),
    });
  }
  return { categories, series };
}

export function chartDataFor(wb: Workbook, def: Pick<ChartDef, 'sheetId' | 'range' | 'switchRC'>): ChartData {
  const s = wb.sheetById(def.sheetId);
  const g0 = parseRange(def.range);
  if (!s || !g0) return { categories: [], series: [] };
  const g = wb.clampToUsed(s, g0);
  const rows = Math.min(g.r1 - g.r0 + 1, 2000);
  const cols = Math.min(g.c1 - g.c0 + 1, 50);
  const values: unknown[][] = [];
  const texts: string[][] = [];
  for (let i = 0; i < rows; i++) {
    const vr: unknown[] = [];
    const tr: string[] = [];
    for (let j = 0; j < cols; j++) {
      vr.push(wb.value(s, g.r0 + i, g.c0 + j));
      tr.push(wb.display(s, g.r0 + i, g.c0 + j).text);
    }
    values.push(vr);
    texts.push(tr);
  }
  return extractSeries(values, texts, def.switchRC);
}

/** "Nice" axis bounds and step for a value range. */
export function niceScale(min: number, max: number, ticks = 5): { min: number; max: number; step: number } {
  if (!isFinite(min) || !isFinite(max)) return { min: 0, max: 1, step: 0.2 };
  if (min === max) { if (min === 0) return { min: 0, max: 1, step: 0.2 }; min = Math.min(0, min); max = Math.max(0, max); }
  const span = max - min;
  const raw = span / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

const fmtTick = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return +(n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return +(n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return +(n / 1e3).toFixed(1) + 'k';
  return String(+n.toFixed(2));
};

const MONO = { fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--mute)' } as const;

export interface ChartOpts {
  type: ChartType; title: string; showTitle: boolean; legend: boolean; gridlines: boolean; labels: boolean; hidden: number[];
}

export function ChartSvg({ data, opts, width, height }: { data: ChartData; opts: ChartOpts; width: number; height: number }) {
  const visible = data.series.map((s, i) => ({ ...s, idx: i })).filter((s) => !opts.hidden.includes(s.idx));
  const color = (i: number) => SERIES_COLORS[i % SERIES_COLORS.length];
  const titleH = opts.showTitle && opts.title ? 30 : 6;
  const legendH = opts.legend ? 24 : 0;
  const W = Math.max(60, width);
  const H = Math.max(60, height);
  const empty = !visible.length || !data.categories.length;

  const legend = opts.legend && (
    <g transform={`translate(12, ${H - 16})`}>
      {(opts.type === 'pie' ? data.categories.map((c, i) => ({ name: c, idx: i })) : visible).slice(0, 12).map((s, i) => (
        <g key={i} transform={`translate(${i * Math.min(120, (W - 24) / Math.max(1, Math.min(12, opts.type === 'pie' ? data.categories.length : visible.length)))}, 0)`}>
          <rect width={10} height={10} y={-9} style={{ fill: color(s.idx) }} />
          <text x={14} y={0} style={{ ...MONO, fill: 'var(--ink)' }}>{truncate(s.name, 14)}</text>
        </g>
      ))}
    </g>
  );
  const title = opts.showTitle && opts.title && (
    <text x={12} y={21} style={{ fontFamily: 'var(--font-ui)', fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', fill: 'var(--ink)' }}>{truncate(opts.title, Math.floor(W / 9))}</text>
  );

  if (empty) {
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {title}
        <text x={W / 2} y={H / 2} textAnchor="middle" style={{ ...MONO, fontSize: 11 }}>Select a range with numbers to chart</text>
      </svg>
    );
  }

  if (opts.type === 'pie') return <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>{title}{pie(visible[0], W, H, titleH, legendH, opts.labels, color)}{legend}</svg>;

  const horizontal = opts.type === 'bar';
  const stacked = opts.type === 'stacked';
  const scatter = opts.type === 'scatter';
  const n = data.categories.length;
  // Value range
  let vmin = Infinity;
  let vmax = -Infinity;
  if (stacked) {
    for (let i = 0; i < n; i++) {
      let pos = 0; let neg = 0;
      for (const s of visible) { const v = s.values[i] ?? 0; if (v >= 0) pos += v; else neg += v; }
      vmax = Math.max(vmax, pos); vmin = Math.min(vmin, neg);
    }
  } else for (const s of visible) for (const v of s.values) if (v != null) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  if (!isFinite(vmin)) { vmin = 0; vmax = 1; }
  if (opts.type !== 'line' && opts.type !== 'scatter') { vmin = Math.min(0, vmin); vmax = Math.max(0, vmax); }
  const sc = niceScale(vmin, vmax);
  // X range for scatter
  const xs = data.categories.map((c, i) => { const x = Number(c); return isFinite(x) && c.trim() !== '' ? x : i + 1; });
  const xsc = scatter ? niceScale(Math.min(...xs), Math.max(...xs)) : null;

  const left = horizontal ? Math.min(110, 12 + Math.max(...data.categories.map((c) => Math.min(14, c.length))) * 6.2) : 46;
  const plot = { x: left, y: titleH + 10, w: W - left - 14, h: H - titleH - 10 - 22 - legendH };
  if (plot.w < 20 || plot.h < 20) return <svg width={W} height={H} />;
  const vToPix = (v: number) => horizontal
    ? plot.x + ((v - sc.min) / (sc.max - sc.min)) * plot.w
    : plot.y + plot.h - ((v - sc.min) / (sc.max - sc.min)) * plot.h;
  const ticks: number[] = [];
  for (let v = sc.min; v <= sc.max + sc.step / 2; v += sc.step) ticks.push(+v.toPrecision(12));
  const band = (horizontal ? plot.h : plot.w) / n;
  const catPos = (i: number) => (horizontal ? plot.y : plot.x) + band * i;
  const xToPix = (x: number) => (xsc ? plot.x + ((x - xsc.min) / (xsc.max - xsc.min || 1)) * plot.w : 0);

  const parts: React.ReactNode[] = [];
  // gridlines + value axis labels
  ticks.forEach((t, i) => {
    const p = vToPix(t);
    if (opts.gridlines || t === 0) {
      parts.push(horizontal
        ? <line key={'g' + i} x1={p} x2={p} y1={plot.y} y2={plot.y + plot.h} style={{ stroke: 'var(--line)' }} />
        : <line key={'g' + i} x1={plot.x} x2={plot.x + plot.w} y1={p} y2={p} style={{ stroke: t === 0 ? 'var(--mute)' : 'var(--line)', strokeWidth: 1 }} />);
    }
    parts.push(horizontal
      ? <text key={'t' + i} x={p} y={plot.y + plot.h + 14} textAnchor="middle" style={MONO}>{fmtTick(t)}</text>
      : <text key={'t' + i} x={plot.x - 6} y={p + 3} textAnchor="end" style={MONO}>{fmtTick(t)}</text>);
  });
  // category labels
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horizontal ? plot.h / 14 : plot.w / 56)))));
  if (!scatter) data.categories.forEach((c, i) => {
    if (i % every) return;
    const p = catPos(i) + band / 2;
    parts.push(horizontal
      ? <text key={'c' + i} x={plot.x - 6} y={p + 3} textAnchor="end" style={MONO}>{truncate(c, 14)}</text>
      : <text key={'c' + i} x={p} y={plot.y + plot.h + 14} textAnchor="middle" style={MONO}>{truncate(c, Math.max(3, Math.floor(band * every / 6.5)))}</text>);
  });
  else if (xsc) for (let x = xsc.min, i = 0; x <= xsc.max + xsc.step / 2; x += xsc.step, i++) {
    parts.push(<text key={'x' + i} x={xToPix(x)} y={plot.y + plot.h + 14} textAnchor="middle" style={MONO}>{fmtTick(+x.toPrecision(12))}</text>);
  }
  // axis baseline
  parts.push(horizontal
    ? <line key="ax" x1={plot.x} x2={plot.x} y1={plot.y} y2={plot.y + plot.h} style={{ stroke: 'var(--line)' }} />
    : <line key="ax" x1={plot.x} x2={plot.x + plot.w} y1={plot.y + plot.h} y2={plot.y + plot.h} style={{ stroke: 'var(--line)' }} />);

  const zero = vToPix(Math.max(sc.min, Math.min(sc.max, 0)));
  const label = (key: string, x: number, y: number, v: number, anchor: 'middle' | 'start' = 'middle') =>
    opts.labels ? <text key={key} x={x} y={y} textAnchor={anchor} style={{ ...MONO, fill: 'var(--ink)' }}>{fmtTick(v)}</text> : null;

  const barSeries = opts.type === 'combo' ? visible.slice(0, 1) : opts.type === 'column' || opts.type === 'bar' || stacked ? visible : [];
  const lineSeries = opts.type === 'combo' ? visible.slice(1) : opts.type === 'line' || opts.type === 'area' ? visible : [];

  if (barSeries.length) {
    const inner = band * 0.72;
    const gap = barSeries.length > 1 && !stacked ? 2 : 0;
    const bw = stacked ? inner : (inner - gap * (barSeries.length - 1)) / barSeries.length;
    for (let i = 0; i < n; i++) {
      let pos = 0; let neg = 0;
      barSeries.forEach((s, k) => {
        const v = s.values[i];
        if (v == null) return;
        const start = catPos(i) + (band - inner) / 2 + (stacked ? 0 : k * (bw + gap));
        let a: number; let b: number;
        if (stacked) { const base = v >= 0 ? pos : neg; a = vToPix(base); b = vToPix(base + v); if (v >= 0) pos += v; else neg += v; }
        else { a = zero; b = vToPix(v); }
        const lo = Math.min(a, b);
        const len = Math.max(1, Math.abs(b - a));
        parts.push(horizontal
          ? <rect key={`b${i}-${k}`} x={lo} y={start} width={len} height={Math.max(1, bw)} style={{ fill: color(s.idx) }} />
          : <rect key={`b${i}-${k}`} x={start} y={lo} width={Math.max(1, bw)} height={len} style={{ fill: color(s.idx) }} />);
        if (opts.labels && !stacked) parts.push(horizontal
          ? label(`l${i}-${k}`, Math.max(a, b) + 4, start + bw / 2 + 3, v, 'start')
          : label(`l${i}-${k}`, start + bw / 2, lo - 4, v));
      });
    }
  }
  for (const s of lineSeries) {
    const pts = s.values.map((v, i) => (v == null ? null : [catPos(i) + band / 2, vToPix(v)] as [number, number]));
    const segs: [number, number][][] = [];
    let cur: [number, number][] = [];
    for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
    if (cur.length) segs.push(cur);
    segs.forEach((seg, j) => {
      if (opts.type === 'area') {
        const d = `M${seg[0][0]},${zero} ` + seg.map((p) => `L${p[0]},${p[1]}`).join(' ') + ` L${seg[seg.length - 1][0]},${zero} Z`;
        parts.push(<path key={`a${s.idx}-${j}`} d={d} style={{ fill: color(s.idx), opacity: 0.22 }} />);
      }
      parts.push(<polyline key={`p${s.idx}-${j}`} points={seg.map((p) => p.join(',')).join(' ')} style={{ fill: 'none', stroke: color(s.idx), strokeWidth: 2 }} />);
    });
    pts.forEach((p, i) => {
      if (!p) return;
      if (n <= 40) parts.push(<rect key={`d${s.idx}-${i}`} x={p[0] - 2.5} y={p[1] - 2.5} width={5} height={5} style={{ fill: color(s.idx) }} />);
      const v = s.values[i];
      if (v != null) parts.push(label(`pl${s.idx}-${i}`, p[0], p[1] - 7, v));
    });
  }
  if (scatter) {
    for (const s of visible) s.values.forEach((v, i) => {
      if (v == null) return;
      const x = xToPix(xs[i]);
      const y = vToPix(v);
      parts.push(<circle key={`s${s.idx}-${i}`} cx={x} cy={y} r={3.5} style={{ fill: color(s.idx) }} />);
      parts.push(label(`sl${s.idx}-${i}`, x, y - 7, v));
    });
  }
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
      {title}
      {parts}
      {legend}
    </svg>
  );
}

function pie(s: ChartSeries & { idx: number }, W: number, H: number, titleH: number, legendH: number, labels: boolean, color: (i: number) => string) {
  const vals = s.values.map((v) => Math.max(0, v ?? 0));
  const total = vals.reduce((a, b) => a + b, 0);
  const cx = W / 2;
  const cy = titleH + (H - titleH - legendH) / 2;
  const r = Math.max(10, Math.min(W, H - titleH - legendH) / 2 - 16);
  if (!total) return <text x={cx} y={cy} textAnchor="middle" style={MONO}>No positive values</text>;
  let a0 = -Math.PI / 2;
  return vals.map((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rr = r) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const d = v >= total ? `M${cx - r},${cy} A${r},${r} 0 1 1 ${cx + r},${cy} A${r},${r} 0 1 1 ${cx - r},${cy} Z` : `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
    const mid = (a0 + a1) / 2;
    const [lx, ly] = p(mid, r * 0.68);
    a0 = a1;
    return (
      <g key={i}>
        <path d={d} style={{ fill: color(i), stroke: 'var(--bg1)', strokeWidth: 1 }} />
        {labels && v / total > 0.04 && <text x={lx} y={ly + 3} textAnchor="middle" style={{ ...MONO, fill: 'var(--bg0)', fontWeight: 700 }}>{Math.round((v / total) * 100)}%</text>}
      </g>
    );
  });
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s;
}
