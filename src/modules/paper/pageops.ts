// Pure page operations on the model data (organize, split, extract, merge).
import { LETTER, newId, type Edit, type NewField, type PageRef, type PaperData, type Rot, type SourceDoc } from './model';
import { normRot } from './viewport';

/**
 * Parse page ranges like "1-3, 5, 8-" (1-based, inclusive). Each comma part is one group.
 * Returns 0-based indices. Throws an Error with a user-facing message on bad input.
 */
export function parseRanges(input: string, total: number): number[][] {
  const parts = input.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('Enter page ranges, e.g. 1-3, 5');
  return parts.map((p) => {
    const m = /^(\d+)?\s*(?:(-|–)\s*(\d+)?)?$/.exec(p);
    if (!m || (!m[1] && !m[3])) throw new Error(`"${p}" isn't a page range`);
    const a = m[1] ? parseInt(m[1], 10) : 1;
    const b = m[2] ? (m[3] ? parseInt(m[3], 10) : total) : a;
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`"${p}" is outside 1–${total}`);
    const out: number[] = [];
    if (a <= b) for (let i = a; i <= b; i++) out.push(i - 1);
    else for (let i = a; i >= b; i--) out.push(i - 1);
    return out;
  });
}

/** Groups of `n` consecutive pages. */
export function splitEvery(n: number, total: number): number[][] {
  if (!(n >= 1)) throw new Error('Pages per file must be at least 1');
  const out: number[][] = [];
  for (let i = 0; i < total; i += n) out.push(Array.from({ length: Math.min(n, total - i) }, (_, k) => i + k));
  return out;
}

/** Move the pages with `ids` (keeping their relative order) so they start at `target` in the list without them. */
export function movePages(pages: PageRef[], ids: string[], target: number): PageRef[] {
  const set = new Set(ids);
  const moving = pages.filter((p) => set.has(p.id));
  const rest = pages.filter((p) => !set.has(p.id));
  const t = Math.max(0, Math.min(target, rest.length));
  return [...rest.slice(0, t), ...moving, ...rest.slice(t)];
}

/** Target index (in the list without the moved pages) for a drop before `beforeIndex` of the full list. */
export function dropTarget(pages: PageRef[], ids: string[], beforeIndex: number): number {
  const set = new Set(ids);
  return pages.slice(0, beforeIndex).filter((p) => !set.has(p.id)).length;
}

export function rotatePages(pages: PageRef[], ids: string[], delta: number): PageRef[] {
  const set = new Set(ids);
  return pages.map((p) => (set.has(p.id) ? { ...p, rot: normRot(p.rot + delta) as Rot } : p));
}

export function deletePages(data: Pick<PaperData, 'pages' | 'edits' | 'newFields'>, ids: string[]) {
  const set = new Set(ids);
  return {
    pages: data.pages.filter((p) => !set.has(p.id)),
    edits: data.edits.filter((e) => !set.has(e.page)),
    newFields: data.newFields.filter((f) => !set.has(f.page)),
  };
}

export function blankPage(size: [number, number] = LETTER): PageRef {
  return { id: newId('p'), src: null, index: 0, rot: 0, size };
}

export function insertAt(pages: PageRef[], at: number, add: PageRef[]): PageRef[] {
  const i = Math.max(0, Math.min(at, pages.length));
  return [...pages.slice(0, i), ...add, ...pages.slice(i)];
}

/** Page refs for every page of a newly merged source. */
export function sourcePages(src: SourceDoc, count: number): PageRef[] {
  return Array.from({ length: count }, (_, i) => ({ id: newId('p'), src: src.id, index: i, rot: 0 as Rot }));
}

/** Unique source id not used in `sources`. */
export function nextSourceId(sources: SourceDoc[]): string {
  let i = sources.length;
  while (sources.some((s) => s.id === `src${i}`)) i++;
  return `src${i}`;
}

/**
 * A new document made of the pages at `indices` (0-based, output order) — used by Split / Extract.
 * Page ids are re-minted and edits/fields are copied with them. Form values carry over only when the
 * original source is still used, since they belong to its AcroForm.
 */
export function subsetData(data: PaperData, indices: number[]): PaperData {
  const map = new Map<string, string>();
  const pages = indices.map((i) => {
    const p = data.pages[i];
    const id = newId('p');
    map.set(p.id, id);
    return { ...p, id };
  });
  const usedSrc = new Set(pages.map((p) => p.src).filter(Boolean) as string[]);
  const edits: Edit[] = data.edits.filter((e) => map.has(e.page)).map((e) => ({ ...e, id: newId('e'), page: map.get(e.page)! }));
  const newFields: NewField[] = data.newFields.filter((f) => map.has(f.page)).map((f) => ({ ...f, id: newId('f'), page: map.get(f.page)! }));
  return {
    sources: data.sources.filter((s) => usedSrc.has(s.id)),
    pages, edits, newFields,
    formValues: data.sources[0] && usedSrc.has(data.sources[0].id) ? { ...data.formValues } : {},
    flattenForm: data.flattenForm,
  };
}

/** Group pages so that each output part starts at one of `starts` (0-based, sorted, first is ignored). */
export function splitAt(total: number, starts: number[]): number[][] {
  const cuts = [...new Set(starts.filter((s) => s > 0 && s < total))].sort((a, b) => a - b);
  const out: number[][] = [];
  let prev = 0;
  for (const c of [...cuts, total]) {
    out.push(Array.from({ length: c - prev }, (_, k) => prev + k));
    prev = c;
  }
  return out;
}
