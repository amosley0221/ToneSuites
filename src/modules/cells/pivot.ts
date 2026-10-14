// Pivot table aggregation (pure).

export type Agg = 'sum' | 'count' | 'avg' | 'min' | 'max';
export const AGGS: Agg[] = ['sum', 'count', 'avg', 'min', 'max'];

export type PivotValue = string | number | null;

export interface PivotConfig {
  rows: number[];
  cols: number[];
  values: { field: number; agg: Agg }[];
  /** field → the single allowed value ('' = all). */
  filters: { field: number; value: string }[];
  grandTotals: boolean;
}

export interface PivotResult {
  /** Output grid: header rows first, data rows, then the grand total row (when enabled). */
  cells: PivotValue[][];
  headerRows: number;
  rowLabelCols: number;
  hasTotalRow: boolean;
}

const keyOf = (v: PivotValue) => (v == null ? '' : String(v));
const SEP = '\u0001';

interface Acc { sum: number; count: number; n: number; min: number; max: number }
const newAcc = (): Acc => ({ sum: 0, count: 0, n: 0, min: Infinity, max: -Infinity });

function add(acc: Acc, v: PivotValue) {
  if (v == null || v === '') return;
  acc.count++;
  const n = typeof v === 'number' ? v : Number(v);
  if (typeof v === 'number' || (v.trim() !== '' && isFinite(n))) {
    acc.n++; acc.sum += n;
    if (n < acc.min) acc.min = n;
    if (n > acc.max) acc.max = n;
  }
}

function result(acc: Acc | undefined, agg: Agg): number | null {
  if (!acc) return null;
  switch (agg) {
    case 'sum': return acc.n ? acc.sum : acc.count ? 0 : null;
    case 'count': return acc.count;
    case 'avg': return acc.n ? acc.sum / acc.n : null;
    case 'min': return acc.n ? acc.min : null;
    case 'max': return acc.n ? acc.max : null;
  }
}

function compareKeys(a: string, b: string): number {
  const pa = a.split(SEP);
  const pb = b.split(SEP);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '';
    const y = pb[i] ?? '';
    if (x === y) continue;
    if (x === '') return 1;
    if (y === '') return -1;
    const nx = Number(x);
    const ny = Number(y);
    if (isFinite(nx) && isFinite(ny)) return nx - ny;
    return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
  }
  return 0;
}

export const aggLabel = (a: Agg) => ({ sum: 'Sum', count: 'Count', avg: 'Average', min: 'Min', max: 'Max' })[a];

/** Build a pivot from a header row + data rows. */
export function buildPivot(header: string[], data: PivotValue[][], cfg: PivotConfig): PivotResult {
  const rowsIn = data.filter((row) => cfg.filters.every((f) => f.value === '' || keyOf(row[f.field]) === f.value));
  const values = cfg.values.length ? cfg.values : [];
  const rowKeys = new Set<string>();
  const colKeys = new Set<string>();
  // cell accumulators keyed by rowKey + SEP2 + colKey, one per value field
  const acc = new Map<string, Acc[]>();
  const SEP2 = '\u0002';
  const get = (rk: string, ck: string) => {
    const k = rk + SEP2 + ck;
    let a = acc.get(k);
    if (!a) { a = values.map(newAcc); acc.set(k, a); }
    return a;
  };
  const TOTAL = '\u0003';
  for (const row of rowsIn) {
    const rk = cfg.rows.map((f) => keyOf(row[f])).join(SEP);
    const ck = cfg.cols.map((f) => keyOf(row[f])).join(SEP);
    rowKeys.add(rk);
    colKeys.add(ck);
    const targets = [get(rk, ck), get(rk, TOTAL), get(TOTAL, ck), get(TOTAL, TOTAL)];
    values.forEach((v, i) => { for (const t of targets) add(t[i], row[v.field]); });
  }
  const rk = [...rowKeys].sort(compareKeys);
  const ck = [...colKeys].sort(compareKeys);
  const hasCols = cfg.cols.length > 0;
  const rowLabelCols = Math.max(1, cfg.rows.length);
  const cells: PivotValue[][] = [];
  const valueName = (i: number) => (values[i].agg === 'sum' ? header[values[i].field] : `${aggLabel(values[i].agg)} of ${header[values[i].field]}`);

  // Header rows
  const rowLabels = cfg.rows.length ? cfg.rows.map((f) => header[f]) : [''];
  if (hasCols) {
    const top: PivotValue[] = [...rowLabels.map(() => null)];
    top[0] = cfg.cols.map((f) => header[f]).join(' / ');
    const second: PivotValue[] = [...rowLabels];
    for (const c of ck) for (let i = 0; i < values.length; i++) {
      top.push(i === 0 ? c.split(SEP).join(' / ') || '(blank)' : null);
      second.push(valueName(i));
    }
    if (cfg.grandTotals) for (let i = 0; i < values.length; i++) { top.push(i === 0 ? 'Grand total' : null); second.push(valueName(i)); }
    cells.push(top, second);
  } else {
    cells.push([...rowLabels, ...values.map((_, i) => valueName(i))]);
  }
  const headerRows = cells.length;

  const colList = hasCols ? [...ck, ...(cfg.grandTotals ? [TOTAL] : [])] : [TOTAL];
  const line = (rowKey: string, labels: PivotValue[]) => {
    const out: PivotValue[] = [...labels];
    for (const c of colList) {
      const a = acc.get(rowKey + SEP2 + c);
      values.forEach((v, i) => out.push(result(a?.[i], v.agg)));
    }
    return out;
  };
  if (cfg.rows.length) {
    for (const r of rk) {
      const labels = r.split(SEP).map((x) => (x === '' ? '(blank)' : isFinite(Number(x)) && x.trim() !== '' ? Number(x) : x));
      cells.push(line(r, labels));
    }
  }
  const hasTotalRow = cfg.grandTotals || !cfg.rows.length;
  if (hasTotalRow) {
    const labels: PivotValue[] = rowLabels.map(() => null);
    labels[0] = cfg.rows.length ? 'Grand total' : 'Total';
    cells.push(line(TOTAL, labels));
  }
  return { cells, headerRows, rowLabelCols, hasTotalRow };
}

/** Classify a column as numeric if most non-empty values are numbers. */
export function fieldType(data: PivotValue[][], field: number): 'num' | 'text' {
  let nums = 0;
  let total = 0;
  for (const row of data) {
    const v = row[field];
    if (v == null || v === '') continue;
    total++;
    if (typeof v === 'number') nums++;
    if (total > 200) break;
  }
  return total > 0 && nums / total >= 0.6 ? 'num' : 'text';
}
