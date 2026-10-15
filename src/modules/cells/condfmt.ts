// Conditional formatting: rule evaluation (pure) + per-sheet preparation.
import { parseRange, type Range } from './address';
import type { CondKind, CondRule, Sheet, Workbook } from './model';

export const COND_KINDS: { id: CondKind; label: string; args: 0 | 1 | 2 }[] = [
  { id: 'gt', label: 'Greater than', args: 1 },
  { id: 'lt', label: 'Less than', args: 1 },
  { id: 'between', label: 'Between', args: 2 },
  { id: 'eq', label: 'Equal to', args: 1 },
  { id: 'contains', label: 'Text contains', args: 1 },
  { id: 'topN', label: 'Top N values', args: 1 },
  { id: 'scale', label: 'Color scale', args: 0 },
];

export interface CondStyle { b?: boolean; i?: boolean; color?: string; fill?: string }

export interface PreparedRule {
  rule: CondRule;
  range: Range;
  /** topN threshold or scale min/max */
  threshold?: number;
  min?: number;
  max?: number;
}

const toNum = (s: string | undefined): number | null => {
  if (s == null || s.trim() === '') return null;
  const n = Number(s.replace(/,/g, ''));
  return isFinite(n) ? n : null;
};

/** Parse "#rrggbb" → [r,g,b]. */
export function hexToRgb(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function lerpColor(a: string, b: string, t: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  if (!x || !y) return a;
  const k = Math.max(0, Math.min(1, t));
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * k));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** Evaluate one prepared rule against a cell value. Returns the style to apply or null. */
export function evalRule(p: PreparedRule, value: unknown, text: string): CondStyle | null {
  const { rule } = p;
  const n = typeof value === 'number' ? value : null;
  switch (rule.kind) {
    case 'gt': { const a = toNum(rule.a); return n != null && a != null && n > a ? rule.style : null; }
    case 'lt': { const a = toNum(rule.a); return n != null && a != null && n < a ? rule.style : null; }
    case 'between': {
      const a = toNum(rule.a);
      const b = toNum(rule.b);
      if (n == null || a == null || b == null) return null;
      return n >= Math.min(a, b) && n <= Math.max(a, b) ? rule.style : null;
    }
    case 'eq': {
      const a = toNum(rule.a);
      if (a != null && n != null) return n === a ? rule.style : null;
      return (rule.a ?? '').toLowerCase() === text.toLowerCase() && text !== '' ? rule.style : null;
    }
    case 'contains': return rule.a && text.toLowerCase().includes(rule.a.toLowerCase()) ? rule.style : null;
    case 'topN': return n != null && p.threshold != null && n >= p.threshold ? rule.style : null;
    case 'scale': {
      if (n == null || p.min == null || p.max == null) return null;
      const t = p.max === p.min ? 1 : (n - p.min) / (p.max - p.min);
      // A colour scale only fills (its editor has no text style; a style left over from another kind is ignored).
      return { fill: lerpColor(rule.scale?.min ?? '#ffffff', rule.scale?.max ?? '#2fb98a', t) };
    }
  }
}

/** Numbers in a range (sorted desc) for topN / scale statistics. */
export function statsFor(rule: CondRule, nums: number[]): Pick<PreparedRule, 'threshold' | 'min' | 'max'> {
  if (!nums.length) return {};
  if (rule.kind === 'topN') {
    const k = Math.max(1, Math.floor(toNum(rule.a) ?? 10));
    const sorted = [...nums].sort((a, b) => b - a);
    return { threshold: sorted[Math.min(k, sorted.length) - 1] };
  }
  if (rule.kind === 'scale') {
    let min = Infinity;
    let max = -Infinity;
    for (const v of nums) { if (v < min) min = v; if (v > max) max = v; }
    return { min, max };
  }
  return {};
}

const cache = new WeakMap<Sheet, { v: number; rules: PreparedRule[] }>();

export function prepareRules(wb: Workbook, s: Sheet): PreparedRule[] {
  const hit = cache.get(s);
  if (hit && hit.v === wb.dataVersion) return hit.rules;
  const rules: PreparedRule[] = [];
  for (const rule of s.condFormats) {
    const g = parseRange(rule.range);
    if (!g) continue;
    const p: PreparedRule = { rule, range: g };
    if (rule.kind === 'topN' || rule.kind === 'scale') {
      const nums: number[] = [];
      for (const [r, c] of wb.cellsIn(s, g)) { const n = wb.num(s, r, c); if (n != null) nums.push(n); }
      Object.assign(p, statsFor(rule, nums));
    }
    rules.push(p);
  }
  cache.set(s, { v: wb.dataVersion, rules });
  return rules;
}

/** Combined conditional style for a cell (later rules override earlier ones). */
export function condStyleAt(rules: PreparedRule[], r: number, c: number, value: unknown, text: string): CondStyle | null {
  let out: CondStyle | null = null;
  for (const p of rules) {
    const g = p.range;
    if (r < g.r0 || r > g.r1 || c < g.c0 || c > g.c1) continue;
    const st = evalRule(p, value, text);
    if (st) out = { ...(out ?? {}), ...st };
  }
  return out;
}

export function describeRule(rule: CondRule): string {
  const k = COND_KINDS.find((x) => x.id === rule.kind)?.label ?? rule.kind;
  switch (rule.kind) {
    case 'between': return `${k} ${rule.a ?? ''} and ${rule.b ?? ''}`;
    case 'scale': return `${k} ${rule.scale?.min ?? ''} → ${rule.scale?.max ?? ''}`;
    case 'topN': return `Top ${rule.a ?? '10'} values`;
    case 'contains': return `${k} “${rule.a ?? ''}”`;
    default: return `${k} ${rule.a ?? ''}`;
  }
}
