// Floating find & replace panel (Ctrl F / Ctrl H). Highlights come from the find plugin's decorations.
import { useEffect, useRef, useState } from 'react';
import { TextSelection } from 'prosemirror-state';
import { Checkbox } from '@/ui';
import type { WriteModel } from './model';
import { findKey, type FindQuery } from './plugins';

export function FindPanel({ model, onChange }: { model: WriteModel; onChange: () => void }) {
  const st = findKey.getState(model.state);
  const [text, setText] = useState(st?.text || selectedText(model));
  const [repl, setRepl] = useState('');
  const [caseSensitive, setCase] = useState(st?.caseSensitive ?? false);
  const [wholeWord, setWhole] = useState(st?.wholeWord ?? false);
  const inputRef = useRef<HTMLInputElement>(null);
  const replace = model.ui.find === 'replace';
  const matches = st?.matches ?? [];
  const current = st?.current ?? 0;

  const setQuery = (q: Partial<FindQuery>) => {
    const base: FindQuery = { text, caseSensitive, wholeWord, current, ...q };
    model.apply(model.state.tr.setMeta(findKey, base).setMeta('addToHistory', false));
  };
  useEffect(() => { setQuery({ current: 0 }); }, [text, caseSensitive, wholeWord]);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, [model.ui.find]);
  useEffect(() => () => { model.apply(model.state.tr.setMeta(findKey, { text: '', caseSensitive: false, wholeWord: false, current: 0 })); }, [model]);

  const go = (i: number) => {
    const ms = findKey.getState(model.state)?.matches ?? [];
    if (!ms.length) return;
    const idx = (i + ms.length) % ms.length;
    const m = ms[idx];
    const tr = model.state.tr.setMeta(findKey, { text, caseSensitive, wholeWord, current: idx }).setSelection(TextSelection.create(model.state.doc, m.from, m.to)).scrollIntoView();
    model.apply(tr);
  };
  const replaceOne = () => {
    const m = matches[current];
    if (!m) return;
    model.apply(model.state.tr.insertText(repl, m.from, m.to));
    onChange();
    go(current);
  };
  const replaceAll = () => {
    if (!matches.length) return;
    const tr = model.state.tr;
    for (let i = matches.length - 1; i >= 0; i--) tr.insertText(repl, matches[i].from, matches[i].to);
    model.apply(tr);
    onChange();
  };
  const close = () => { model.setUI({ find: null }); model.view?.focus(); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); go(current + (e.shiftKey ? -1 : 1)); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  };
  const field = { padding: '6px 10px', background: 'var(--bg0)', color: 'var(--ink)', border: '1px solid var(--line)', outline: 'none', font: 'var(--type-label)', fontSize: 12, flex: 1, minWidth: 0 } as const;

  return (
    <div className="wr-find-panel" onKeyDown={key}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} placeholder="Find" style={field} />
        <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', minWidth: 54, textAlign: 'right' }}>{text ? (matches.length ? `${current + 1} of ${matches.length}` : '0 of 0') : ''}</span>
        <button type="button" className="wr-mini" title="Previous (Shift Enter)" onClick={() => go(current - 1)}>↑</button>
        <button type="button" className="wr-mini" title="Next (Enter)" onClick={() => go(current + 1)}>↓</button>
        <button type="button" className="wr-mini" title="Close (Esc)" onClick={close}>✕</button>
      </div>
      {replace && (
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={repl} onChange={(e) => setRepl(e.target.value)} placeholder="Replace with" style={field} />
          <button type="button" className="wr-mini" disabled={!matches.length} onClick={replaceOne}>Replace</button>
          <button type="button" className="wr-mini" disabled={!matches.length} onClick={replaceAll}>All</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, color: 'var(--mute)' }}>
        <Checkbox checked={caseSensitive} onChange={setCase} label="Match case" />
        <Checkbox checked={wholeWord} onChange={setWhole} label="Whole word" />
        {!replace && <span style={{ flex: 1, textAlign: 'right' }}><button type="button" className="wr-mini" onClick={() => model.setUI({ find: 'replace' })}>Replace…</button></span>}
      </div>
    </div>
  );
}

function selectedText(m: WriteModel): string {
  const { from, to, empty } = m.state.selection;
  if (empty) return '';
  const t = m.state.doc.textBetween(from, to, ' ');
  return t.length < 80 && !t.includes('\n') ? t : '';
}
