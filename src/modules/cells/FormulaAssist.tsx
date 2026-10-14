// Formula autocomplete: HyperFormula function names + signatures, shared by the formula bar and in-cell editor.
import { useMemo, useState } from 'react';
import { HyperFormula } from 'hyperformula';
import type { Workbook } from './model';

interface FnInfo { name: string; desc: string }
let fnList: FnInfo[] | null = null;
const sigCache = new Map<string, string>();

export function functionList(wb: Workbook): FnInfo[] {
  if (!fnList) {
    const names = HyperFormula.getRegisteredFunctionNames('enGB');
    const desc = new Map<string, string>();
    try {
      for (const f of wb.hf.getAvailableFunctions()) desc.set(f.localizedName, (f.shortDescription ?? '').replace(/<br>/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
    } catch { /* older engines have no catalogue */ }
    fnList = [...new Set(names)].sort().map((name) => ({ name, desc: desc.get(name) ?? '' }));
  }
  return fnList;
}

export function signature(wb: Workbook, name: string): string {
  let s = sigCache.get(name);
  if (s === undefined) {
    s = name + '()';
    try {
      const d = wb.hf.getFunctionDetails(name);
      if (d) {
        const ps = d.parameters.map((p) => (p.optional ? `[${p.name}]` : p.name));
        if (d.repeatLastArgs > 0) ps.push('…');
        s = `${name}(${ps.join(', ')})`;
      }
    } catch { /* unknown */ }
    sigCache.set(name, s);
  }
  return s;
}

/** The identifier being typed at the caret inside a formula, if any. */
export function tokenAtCaret(text: string, caret: number): { start: number; token: string } | null {
  if (!text.startsWith('=')) return null;
  const before = text.slice(0, caret);
  // Not inside a string literal
  if ((before.match(/"/g) || []).length % 2) return null;
  const m = /([A-Za-z][A-Za-z0-9._]*)$/.exec(before);
  if (!m) return null;
  const start = caret - m[1].length;
  const prev = before[start - 1];
  if (prev && /[A-Za-z0-9_$:!'.]/.test(prev)) return null;
  // Looks like a cell reference already complete (e.g. "A1") → no suggestions
  if (/^[A-Za-z]{1,3}\d+$/.test(m[1])) return null;
  return { start, token: m[1] };
}

/** Name of the innermost function call enclosing the caret. */
export function enclosingFunction(text: string, caret: number): string | null {
  if (!text.startsWith('=')) return null;
  const before = text.slice(0, caret);
  let depth = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === ')') depth++;
    else if (ch === '(') {
      if (depth === 0) {
        const m = /([A-Za-z][A-Za-z0-9._]*)$/.exec(before.slice(0, i));
        return m ? m[1].toUpperCase() : null;
      }
      depth--;
    }
  }
  return null;
}

/** True when a cell reference can be inserted at the caret (formula "point mode"). */
export function canInsertRef(text: string, caret: number): boolean {
  if (!text.startsWith('=')) return false;
  const before = text.slice(0, caret).trimEnd();
  return /[=(,+\-*/^&<>:;]$/.test(before);
}

export function useFormulaAssist(wb: Workbook, text: string, caret: number) {
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const tok = tokenAtCaret(text, caret);
  const matches = useMemo(() => {
    if (!tok) return [];
    const up = tok.token.toUpperCase();
    return functionList(wb).filter((f) => f.name.startsWith(up)).slice(0, 8);
  }, [wb, tok?.token]);
  const key = tok ? `${tok.start}:${tok.token}` : null;
  const open = !!tok && matches.length > 0 && dismissed !== key;
  const fn = !open ? enclosingFunction(text, caret) : null;
  const hint = fn && functionList(wb).some((f) => f.name === fn) ? signature(wb, fn) : null;
  const sel = Math.min(index, Math.max(0, matches.length - 1));
  return {
    open, matches, sel, hint,
    move: (d: number) => setIndex((i) => (Math.min(i, matches.length - 1) + d + matches.length) % matches.length),
    dismiss: () => setDismissed(key),
    /** Returns the new text + caret after accepting the highlighted function. */
    accept: (i = sel): { text: string; caret: number } | null => {
      if (!tok || !matches[i]) return null;
      const name = matches[i].name;
      const after = text.slice(caret);
      const ins = after.startsWith('(') ? name : name + '(';
      setIndex(0);
      return { text: text.slice(0, tok.start) + ins + after, caret: tok.start + ins.length };
    },
    reset: () => setIndex(0),
  };
}

export function AcDropdown({ wb, assist, onPick, style }: {
  wb: Workbook; assist: ReturnType<typeof useFormulaAssist>; onPick: (i: number) => void; style?: React.CSSProperties;
}) {
  if (!assist.open && !assist.hint) return null;
  return (
    <div onPointerDown={(e) => e.preventDefault()}
      style={{ position: 'absolute', width: 520, maxWidth: 'calc(100vw - 24px)', background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 30, font: 'var(--type-small)', ...style }}>
      {assist.open ? (
        <>
          {assist.matches.map((m, i) => (
            <div key={m.name} onClick={() => onPick(i)} className={i === assist.sel ? '' : 'hov-row'}
              style={{ display: 'flex', gap: 12, padding: '9px 12px', borderBottom: '1px solid var(--line)', background: i === assist.sel ? 'var(--sel)' : 'transparent', alignItems: 'baseline', cursor: 'pointer' }}>
              <span style={{ font: '500 12px var(--font-mono)', width: 190, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i === assist.sel ? signature(wb, m.name) : m.name}</span>
              <span style={{ color: 'var(--mute)', fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.desc}</span>
            </div>
          ))}
          <div style={{ padding: '7px 12px', font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)', color: 'var(--mute)' }}>TAB TO ACCEPT · ↑↓ TO MOVE · ESC TO DISMISS</div>
        </>
      ) : (
        <div style={{ padding: '7px 12px', font: '500 12px var(--font-mono)', color: 'var(--mute)' }}>{assist.hint}</div>
      )}
    </div>
  );
}
