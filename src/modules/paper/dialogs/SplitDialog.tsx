// Split / Extract: page ranges or every-N → each part opens in a new Paper tab.
import { useState } from 'react';
import { Button, Dialog, DialogNav, Eyebrow, FormRow, Input } from '@/ui';
import type { PaperActions } from '../actions';
import type { PaperModel } from '../model';
import { parseRanges, splitEvery } from '../pageops';

type Mode = 'ranges' | 'every' | 'extract';

export function SplitDialog({ model, mode: initial, actions, onClose }: { model: PaperModel; mode: 'split' | 'extract'; actions: PaperActions; onClose: () => void }) {
  const total = model.pages.length;
  const [mode, setMode] = useState<Mode>(initial === 'extract' ? 'extract' : 'ranges');
  const [ranges, setRanges] = useState('');
  const [every, setEvery] = useState('1');
  let groups: number[][] = [];
  let error = '';
  try {
    if (mode === 'every') groups = splitEvery(parseInt(every, 10), total);
    else if (ranges.trim()) {
      groups = parseRanges(ranges, total);
      if (mode === 'extract') groups = [groups.flat()];
    }
  } catch (e) { error = (e as Error).message; }
  const fmt = (g: number[]) => {
    const parts: string[] = [];
    for (let i = 0; i < g.length; i++) {
      let j = i;
      while (j + 1 < g.length && g[j + 1] === g[j] + 1) j++;
      parts.push(j > i ? `${g[i] + 1}–${g[j] + 1}` : `${g[i] + 1}`);
      i = j;
    }
    return parts.join(', ');
  };
  const run = () => {
    if (!groups.length) return;
    actions.openParts(groups, mode === 'extract' ? 'extract' : 'part');
    onClose();
  };
  return (
    <Dialog title={mode === 'extract' ? 'Extract pages' : 'Split document'} subtitle={`${model.fileName} · ${total} pages`} width={720} height={420} onClose={onClose}
      footer={<>
        <span style={{ color: error ? 'var(--negative)' : 'var(--mute)', font: 'var(--type-small)' }}>{error || 'Each part opens in a new tab; this document is not changed.'}</span>
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!groups.length || !!error} onClick={run}>{groups.length > 1 ? `Open ${groups.length} parts` : 'Open in new tab'}</Button>
      </>}>
      <DialogNav<Mode> value={mode} onChange={setMode} items={[{ value: 'ranges', label: 'By page ranges' }, { value: 'every', label: 'Every N pages' }, { value: 'extract', label: 'Extract pages' }]} />
      <div style={{ flex: 1, padding: '16px 20px', overflow: 'auto' }}>
        {mode === 'every' ? (
          <FormRow label="Pages per file"><Input value={every} onChange={setEvery} mono style={{ width: 80 }} /></FormRow>
        ) : (
          <>
            <FormRow label={mode === 'extract' ? 'Pages to extract' : 'Ranges (one file each)'}>
              <Input value={ranges} onChange={setRanges} mono placeholder="1-3, 5, 8-" autoFocus style={{ width: 220 }} />
            </FormRow>
            <div className="empty-hint">Use commas to separate {mode === 'extract' ? 'pages' : 'files'}; "8-" means page 8 to the end.</div>
          </>
        )}
        <Eyebrow style={{ marginTop: 16, marginBottom: 8 }}>Result</Eyebrow>
        {groups.length === 0 ? <div className="empty-hint">Nothing yet.</div> : groups.slice(0, 200).map((g, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', font: 'var(--type-small)' }}>
            <span>{mode === 'extract' ? 'New document' : `Part ${i + 1}`}</span>
            <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>p. {fmt(g)} · {g.length} page{g.length > 1 ? 's' : ''}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
