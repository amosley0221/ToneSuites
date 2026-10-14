// A1-style address helpers (0-based row/col internally).

export interface Range { r0: number; c0: number; r1: number; c1: number }
export interface CellAddr { r: number; c: number }

export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** 0 → "A", 25 → "Z", 26 → "AA". */
export function colToLetters(c: number): string {
  let s = '';
  let n = c + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** "A" → 0, "AA" → 26. Returns -1 for invalid input. */
export function lettersToCol(s: string): number {
  if (!/^[A-Za-z]{1,3}$/.test(s)) return -1;
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function toA1(r: number, c: number): string {
  return colToLetters(c) + (r + 1);
}

/** "C12" / "$C$12" → {r:11,c:2}; null when invalid. */
export function parseA1(s: string): CellAddr | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(s.trim());
  if (!m) return null;
  const c = lettersToCol(m[1]);
  const r = parseInt(m[2], 10) - 1;
  if (c < 0 || c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return null;
  return { r, c };
}

export function normRange(a: Range): Range {
  return { r0: Math.min(a.r0, a.r1), c0: Math.min(a.c0, a.c1), r1: Math.max(a.r0, a.r1), c1: Math.max(a.c0, a.c1) };
}

/** "A1:C5", "C3", "A:A", "2:4" → Range. */
export function parseRange(s: string): Range | null {
  const t = s.trim().replace(/\$/g, '');
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length === 1) {
    const a = parseA1(parts[0]);
    return a ? { r0: a.r, c0: a.c, r1: a.r, c1: a.c } : null;
  }
  if (parts.length !== 2) return null;
  const [x, y] = parts;
  if (/^[A-Za-z]{1,3}$/.test(x) && /^[A-Za-z]{1,3}$/.test(y)) {
    return normRange({ r0: 0, r1: MAX_ROWS - 1, c0: lettersToCol(x), c1: lettersToCol(y) });
  }
  if (/^\d+$/.test(x) && /^\d+$/.test(y)) {
    return normRange({ r0: +x - 1, r1: +y - 1, c0: 0, c1: MAX_COLS - 1 });
  }
  const a = parseA1(x);
  const b = parseA1(y);
  if (!a || !b) return null;
  return normRange({ r0: a.r, c0: a.c, r1: b.r, c1: b.c });
}

export function rangeToA1(g: Range): string {
  const n = normRange(g);
  if (n.r0 === n.r1 && n.c0 === n.c1) return toA1(n.r0, n.c0);
  return `${toA1(n.r0, n.c0)}:${toA1(n.r1, n.c1)}`;
}

/** Quote a sheet name for use in formulas / range strings when needed. */
export function quoteSheet(name: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
}

/** "'Sheet 1'!A1:B2" → { sheet: 'Sheet 1', range }. Sheet is null when absent. */
export function parseSheetRange(s: string): { sheet: string | null; range: Range } | null {
  const t = s.trim();
  const bang = t.lastIndexOf('!');
  if (bang < 0) {
    const range = parseRange(t);
    return range ? { sheet: null, range } : null;
  }
  let sheet = t.slice(0, bang);
  if (sheet.startsWith("'") && sheet.endsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
  const range = parseRange(t.slice(bang + 1));
  return range ? { sheet, range } : null;
}

export function inRange(g: Range, r: number, c: number): boolean {
  return r >= g.r0 && r <= g.r1 && c >= g.c0 && c <= g.c1;
}

export function intersects(a: Range, b: Range): boolean {
  return a.r0 <= b.r1 && b.r0 <= a.r1 && a.c0 <= b.c1 && b.c0 <= a.c1;
}

/** Numeric key for sparse cell maps (fits safely in a double). */
export const cellKey = (r: number, c: number) => r * MAX_COLS + c;
export const keyRow = (k: number) => Math.floor(k / MAX_COLS);
export const keyCol = (k: number) => k % MAX_COLS;

// ---------- Formula reference shifting ----------

const REF_RE = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![\w(!.])/g;

/**
 * Shift the relative A1 references inside a formula by (dr, dc) — used when copying, filling and
 * sorting formulas. Strings in double quotes are left untouched; absolute ($) parts stay fixed.
 * References that would move off the sheet become #REF!.
 */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (!formula.startsWith('=') || (dr === 0 && dc === 0)) return formula;
  let out = '';
  let i = 0;
  // Split on string literals so we only touch code segments.
  while (i < formula.length) {
    const q = formula.indexOf('"', i);
    const end = q < 0 ? formula.length : q;
    out += shiftSegment(formula.slice(i, end), dr, dc);
    if (q < 0) break;
    let j = q + 1;
    while (j < formula.length) {
      if (formula[j] === '"') {
        if (formula[j + 1] === '"') { j += 2; continue; }
        break;
      }
      j++;
    }
    out += formula.slice(q, j + 1);
    i = j + 1;
  }
  return out;
}

function shiftSegment(seg: string, dr: number, dc: number): string {
  return seg.replace(REF_RE, (m, d1: string, letters: string, d2: string, digits: string, off: number, whole: string) => {
    // Skip when part of a longer identifier (e.g. function names like LOG10 handled by lookahead; names like ABC1D).
    const prev = off > 0 ? whole[off - 1] : '';
    if (prev && /[A-Za-z0-9_.]/.test(prev)) return m;
    let c = lettersToCol(letters);
    let r = parseInt(digits, 10) - 1;
    if (!d1) c += dc;
    if (!d2) r += dr;
    if (c < 0 || r < 0 || c >= MAX_COLS || r >= MAX_ROWS) return '#REF!';
    return `${d1}${colToLetters(c)}${d2}${r + 1}`;
  });
}

// ---------- Range shifting for structural edits ----------

/** Adjust a range after inserting `count` rows (axis 'row') or columns at `at`. */
export function shiftRangeInsert(g: Range, axis: 'row' | 'col', at: number, count: number): Range {
  const n = { ...g };
  if (axis === 'row') {
    if (n.r0 >= at) n.r0 += count;
    if (n.r1 >= at) n.r1 += count;
  } else {
    if (n.c0 >= at) n.c0 += count;
    if (n.c1 >= at) n.c1 += count;
  }
  return n;
}

/** Adjust a range after deleting `count` rows/cols starting at `at`. Returns null if the range vanished. */
export function shiftRangeDelete(g: Range, axis: 'row' | 'col', at: number, count: number): Range | null {
  const [lo, hi] = axis === 'row' ? [g.r0, g.r1] : [g.c0, g.c1];
  const end = at + count - 1;
  let nlo = lo;
  let nhi = hi;
  if (lo > end) nlo = lo - count; else if (lo >= at) nlo = at;
  if (hi > end) nhi = hi - count; else if (hi >= at) nhi = at - 1;
  if (nhi < nlo) return null;
  return axis === 'row' ? { ...g, r0: nlo, r1: nhi } : { ...g, c0: nlo, c1: nhi };
}
