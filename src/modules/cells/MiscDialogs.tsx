// Find & replace, simple prompts, function list.
import { useMemo, useState } from 'react';
import { Button, Dialog } from '@/ui';
import { keyCol, keyRow, toA1 } from './address';
import { functionList, signature } from './FormulaAssist';
import type { Workbook } from './model';
import { Check, Label, monoInput, stopEditKeys } from './widgets';

export function PromptDialog({ title, subtitle, label, initial, onOk, onClose, mono = true }: {
  title: string; subtitle?: string; label: string; initial: string; onOk: (v: string) => string | null; onClose: () => void; mono?: boolean;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState<string | null>(null);
  const ok = () => { const e = onOk(v); if (e) setErr(e); else onClose(); };
  return (
    <Dialog title={title} subtitle={subtitle} width={420} height="auto" onClose={onClose}
      footer={<><div style={{ flex: 1, color: 'var(--negative)', font: 'var(--type-small)' }}>{err}</div><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={ok}>OK</Button></>}>
      <div onKeyDown={stopEditKeys} style={{ padding: 18, flex: 1 }}>
        <Label>{label}</Label>
        <input autoFocus value={v} onChange={(e) => { setV(e.target.value); setErr(null); }} onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } }}
          style={{ ...monoInput, marginTop: 8, ...(mono ? {} : { font: 'var(--type-label)' }) }} />
      </div>
    </Dialog>
  );
}

export function FindDialog({ wb, onClose, replaceMode }: { wb: Workbook; onClose: () => void; replaceMode?: boolean }) {
  const [find, setFind] = useState('');
  const [repl, setRepl] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [whole, setWhole] = useState(false);
  const [inFormulas, setInFormulas] = useState(false);
  const [status, setStatus] = useState('');
  const s = wb.sheet;

  const test = (hay: string) => {
    if (!find) return false;
    const a = matchCase ? hay : hay.toLowerCase();
    const b = matchCase ? find : find.toLowerCase();
    return whole ? a === b : a.includes(b);
  };
  const matches = () => {
    const out: { r: number; c: number }[] = [];
    for (const [k, cell] of s.cells) {
      if (cell.v === '') continue;
      const r = keyRow(k);
      const c = keyCol(k);
      const hay = inFormulas ? cell.v : wb.display(s, r, c).text;
      if (test(hay)) out.push({ r, c });
    }
    return out.sort((a, b) => a.r - b.r || a.c - b.c);
  };
  const next = () => {
    const m = matches();
    if (!m.length) { setStatus('No matches'); return; }
    const { r, c } = s.sel;
    let i = m.findIndex((x) => x.r > r || (x.r === r && x.c > c));
    if (i < 0) i = 0;
    wb.select(m[i].r, m[i].c);
    setStatus(`${i + 1} of ${m.length} · ${toA1(m[i].r, m[i].c)}`);
  };
  const replaceIn = (v: string) => {
    if (whole) return repl;
    const esc = find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return v.replace(new RegExp(esc, matchCase ? 'g' : 'gi'), () => repl);
  };
  const canReplace = (r: number, c: number) => {
    const cell = wb.getCell(s, r, c);
    // In value mode only plain inputs are replaced (formulas keep their logic).
    return !!cell && (inFormulas || !cell.v.startsWith('='));
  };
  const replaceOne = () => {
    const { r, c } = s.sel;
    const cell = wb.getCell(s, r, c);
    if (cell && canReplace(r, c) && test(inFormulas ? cell.v : wb.display(s, r, c).text)) wb.setInputs(s, [{ r, c, v: replaceIn(cell.v) }]);
    next();
  };
  const replaceAll = () => {
    const items = matches().filter(({ r, c }) => canReplace(r, c)).map(({ r, c }) => ({ r, c, v: replaceIn(wb.getCell(s, r, c)!.v) }));
    wb.setInputs(s, items);
    setStatus(`Replaced ${items.length} cell${items.length === 1 ? '' : 's'}`);
  };

  return (
    <Dialog title={replaceMode ? 'Find & replace' : 'Find & replace'} subtitle={s.name} width={560} height="auto" onClose={onClose}
      footer={<>
        <div style={{ flex: 1, font: 'var(--type-mono)', color: 'var(--mute)' }}>{status}</div>
        <Button onClick={replaceAll} disabled={!find}>Replace all</Button>
        <Button onClick={replaceOne} disabled={!find}>Replace</Button>
        <Button variant="primary" onClick={next} disabled={!find}>Find next</Button>
      </>}>
      <div onKeyDown={stopEditKeys} style={{ padding: 18, flex: 1, display: 'flex', flexDirection: 'column', gap: 12, font: 'var(--type-small)' }}>
        <div>
          <Label>Find</Label>
          <input autoFocus value={find} onChange={(e) => { setFind(e.target.value); setStatus(''); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); next(); } }} style={{ ...monoInput, marginTop: 8 }} />
        </div>
        <div>
          <Label>Replace with</Label>
          <input value={repl} onChange={(e) => setRepl(e.target.value)} style={{ ...monoInput, marginTop: 8 }} />
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
          <Check on={matchCase} onChange={setMatchCase}>Match case</Check>
          <Check on={whole} onChange={setWhole}>Entire cell</Check>
          <Check on={inFormulas} onChange={setInFormulas}>Search formulas</Check>
        </div>
      </div>
    </Dialog>
  );
}

export function FunctionListDialog({ wb, onClose }: { wb: Workbook; onClose: () => void }) {
  const all = useMemo(() => functionList(wb), [wb]);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const shown = all.filter((f) => f.name.includes(q.toUpperCase()) || f.desc.toLowerCase().includes(q.toLowerCase())).slice(0, 400);
  const insert = (name: string) => {
    wb.beginEdit(`=${name}(`, 'edit');
    onClose();
  };
  return (
    <Dialog title="Functions" subtitle={`${all.length} available`} width={720} height={520} onClose={onClose}>
      <div onKeyDown={stopEditKeys} style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--line)' }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search functions…" style={monoInput} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {shown.map((f) => (
            <div key={f.name} onClick={() => setSel(f.name)} onDoubleClick={() => insert(f.name)} className={sel === f.name ? '' : 'hov-row'}
              style={{ display: 'flex', gap: 12, padding: '8px 18px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: sel === f.name ? 'var(--sel)' : 'transparent', alignItems: 'baseline' }}>
              <span style={{ font: '500 12px var(--font-mono)', width: 260, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sel === f.name ? signature(wb, f.name) : f.name}</span>
              <span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>{f.desc}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 18px', borderTop: '1px solid var(--line)' }}>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!sel} onClick={() => sel && insert(sel)}>Insert in active cell</Button>
        </div>
      </div>
    </Dialog>
  );
}
