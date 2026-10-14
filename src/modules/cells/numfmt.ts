// Number formats: the small, named set Tone exposes in the toolbar, plus mapping to/from Excel codes.

export type NumFmt = 'general' | 'number' | 'integer' | 'currency' | 'percent' | 'date' | 'datetime' | 'text';

export const NUM_FMTS: { id: NumFmt; label: string; sample: string }[] = [
  { id: 'general', label: 'General', sample: 'General' },
  { id: 'currency', label: 'Currency', sample: '$ 1,234.00' },
  { id: 'number', label: 'Number', sample: '1,234.00' },
  { id: 'integer', label: 'Integer', sample: '1,234' },
  { id: 'percent', label: 'Percent', sample: '0.00%' },
  { id: 'date', label: 'Date', sample: '2026-01-31' },
  { id: 'datetime', label: 'Date & time', sample: '2026-01-31 14:05' },
  { id: 'text', label: 'Text', sample: 'Text' },
];

export function defaultDecimals(nf: NumFmt): number {
  return nf === 'integer' ? 0 : nf === 'number' || nf === 'currency' || nf === 'percent' ? 2 : 0;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function intl(dp: number, group = true): Intl.NumberFormat {
  const k = dp + (group ? 'g' : '');
  let f = nfCache.get(k);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp, useGrouping: group });
    nfCache.set(k, f);
  }
  return f;
}

/** Spreadsheet serial (days since 1899-12-30) → Date (UTC). */
export function serialToDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}
export function dateToSerial(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

const pad = (n: number) => String(n).padStart(2, '0');
export function formatDate(serial: number, withTime = false): string {
  const d = serialToDate(serial);
  const s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return withTime ? `${s} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : s;
}

/** "General" display: up to ~11 significant chars like Excel. */
export function formatGeneral(n: number): string {
  if (!isFinite(n)) return n > 0 ? '∞' : n < 0 ? '-∞' : '#NUM!';
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) return n.toExponential(5).replace(/\.?0+e/, 'e');
  const s = n.toPrecision(10);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** HyperFormula detailed number types we care about. */
export type NumKind = 'raw' | 'date' | 'datetime' | 'time' | 'percent' | 'currency';

export function formatNumber(n: number, nf: NumFmt | undefined, dp: number | undefined, kind: NumKind = 'raw', currency = '$'): string {
  let f: NumFmt = nf ?? 'general';
  if (f === 'general') {
    if (kind === 'date') f = 'date';
    else if (kind === 'datetime') f = 'datetime';
    else if (kind === 'percent') return formatPercent(n, dp ?? decimalsOf(n * 100));
    else if (kind === 'currency') f = 'currency';
    else if (kind === 'time') {
      const t = Math.round((n % 1) * 86400);
      return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}`;
    }
  }
  const d = dp ?? defaultDecimals(f);
  switch (f) {
    case 'general': return dp != null ? intl(dp, false).format(n) : formatGeneral(n);
    case 'number': return intl(d).format(n);
    case 'integer': return intl(dp ?? 0).format(n);
    case 'currency': return (n < 0 ? '-' : '') + currency + intl(d).format(Math.abs(n));
    case 'percent': return formatPercent(n, d);
    case 'date': return formatDate(n);
    case 'datetime': return formatDate(n, true);
    case 'text': return formatGeneral(n);
  }
}

function formatPercent(n: number, dp: number): string {
  return intl(dp, false).format(n * 100) + '%';
}

function decimalsOf(n: number): number {
  const s = formatGeneral(n);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(4, s.length - i - 1);
}

// ---------- Excel number-format codes ----------

/** Map an Excel numFmt code to Tone's format + decimals (best effort). */
export function fromExcelFormat(code: string | undefined): { nf: NumFmt; dp?: number; cur?: string } | null {
  if (!code || code === 'General') return null;
  const c = code.split(';')[0];
  if (c === '@') return { nf: 'text' };
  const dec = /\.(0+)/.exec(c);
  const dp = dec ? dec[1].length : 0;
  if (c.includes('%')) return { nf: 'percent', dp };
  const cleaned = c.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
  if (/[ymdhs]/i.test(cleaned) && !/[#0]/.test(cleaned)) return { nf: /[hs]/i.test(cleaned) ? 'datetime' : 'date' };
  const curMatch = /[$€£¥]/.exec(c);
  if (curMatch) return { nf: 'currency', dp, cur: curMatch[0] };
  if (/#,##0|0/.test(c)) return { nf: c.includes(',') ? (dp ? 'number' : 'integer') : dp ? 'number' : 'integer', dp };
  return null;
}

export function toExcelFormat(nf: NumFmt | undefined, dp: number | undefined, cur = '$'): string | undefined {
  if (!nf || nf === 'general') return dp != null ? (dp ? '0.' + '0'.repeat(dp) : '0') : undefined;
  const d = dp ?? defaultDecimals(nf);
  const frac = d > 0 ? '.' + '0'.repeat(d) : '';
  switch (nf) {
    case 'number': return '#,##0' + frac;
    case 'integer': return '#,##0' + frac;
    case 'currency': return `"${cur}"#,##0${frac}`;
    case 'percent': return '0' + frac + '%';
    case 'date': return 'yyyy-mm-dd';
    case 'datetime': return 'yyyy-mm-dd hh:mm';
    case 'text': return '@';
  }
}
