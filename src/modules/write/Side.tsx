// Right-hand panels: Inspector (outline, document stats, comments) and the Review pane (tracked changes).
import { useDeferredValue, useMemo, useState } from 'react';
import { Eyebrow, Switch } from '@/ui';
import * as A from './actions';
import type { Markup, WriteModel } from './model';
import { schema } from './schema';
import { docStats, outline } from './stats';
import { describeOps, listChanges, type Change, type ChangeKind } from './track';

export function Inspector({ model, onChange, open }: { model: WriteModel; onChange: () => void; open: boolean }) {
  const doc = useDeferredValue(model.state.doc);
  const items = useMemo(() => outline(doc), [doc]);
  const stats = useMemo(() => docStats(doc), [doc]);
  const comments = useMemo(() => A.commentRanges(doc), [doc]);
  const sel = model.state.selection.from;
  let active = -1;
  items.forEach((it, i) => { if (it.pos <= sel) active = i; });
  const minLevel = Math.min(...items.map((i) => i.level), 3);
  const activeComments = new Set(model.state.selection.$from.marks().filter((m) => m.type === schema.marks.comment).map((m) => String(m.attrs.id)));
  const anchored = model.comments.filter((c) => comments.has(c.id));
  const headingFor = (pos: number) => { let t = ''; for (const it of items) if (it.pos <= pos) t = it.text; return t; };
  const size = `${model.page.paper}${model.page.orientation === 'landscape' ? ' ⟷' : ''}`;

  return (
    <div className={'inspector wr-side' + (open ? ' open' : '')} style={{ padding: '16px 14px', gap: 22, overflowY: 'auto' }}>
      <div>
        <Eyebrow>Outline</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 10 }}>
          {!items.length && <div className="empty-hint">Headings you add appear here.</div>}
          {items.map((it, i) => (
            <div key={i} className={'wr-outline-row' + (i === active ? ' on' : '')} style={{ paddingLeft: 8 + (it.level - minLevel) * 12 }}
              onMouseDown={(e) => { e.preventDefault(); A.scrollToPos(model, it.pos); }} title={it.text}>{it.text}</div>
          ))}
        </div>
      </div>
      <div>
        <Eyebrow>Document</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, fontSize: 12, color: 'var(--mute)' }}>
          <div className="wr-stat"><span>Words</span><b>{stats.words.toLocaleString()}</b></div>
          <div className="wr-stat"><span>Characters</span><b>{stats.characters.toLocaleString()}</b></div>
          <div className="wr-stat"><span>Pages</span><b>{model.ui.pages}</b></div>
          <div className="wr-stat"><span>Reading time</span><b>{stats.readingMinutes ? `${stats.readingMinutes} min` : '—'}</b></div>
          <div className="wr-stat"><span>Page size</span><span style={{ color: 'var(--ink)' }}>{size}</span></div>
        </div>
      </div>
      <div>
        <Eyebrow>Comments · {anchored.length}</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
          {!anchored.length && <div className="empty-hint">Select text and use Review › New comment.</div>}
          {anchored.map((c) => {
            const r = comments.get(c.id)!;
            const where = headingFor(r.from);
            return (
              <div key={c.id} className={'wr-comment-card' + (activeComments.has(c.id) ? ' on' : '')} onMouseDown={(e) => { e.preventDefault(); A.selectRange(model, r.from, r.to); }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span><b style={{ color: 'var(--ink)' }}>{c.author}</b>{where ? ` · ${where}` : ''}</span>
                  <button type="button" className="hov-ink" title="Resolve (delete) comment" style={{ border: 0, background: 'transparent', color: 'var(--mute)', cursor: 'pointer', padding: 0 }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); A.removeComment(model, c.id); onChange(); }}>✕</button>
                </div>
                <div style={{ color: 'var(--ink)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{c.text}</div>
                {r.text && <div style={{ marginTop: 4, font: 'var(--type-mono)', fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>“{r.text}”</div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const FILTERS: { id: ChangeKind | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'insertion', label: 'Insertions' }, { id: 'deletion', label: 'Deletions' }, { id: 'format', label: 'Format' },
];
const KIND_LABEL: Record<ChangeKind, [string, string]> = { insertion: ['Insertion', 'var(--info)'], deletion: ['Deletion', 'var(--negative)'], format: ['Format', 'var(--mute)'] };

export function ReviewPane({ model, onChange, open }: { model: WriteModel; onChange: () => void; open: boolean }) {
  const [filter, setFilter] = useState<ChangeKind | 'all'>('all');
  const doc = useDeferredValue(model.state.doc);
  const changes = useMemo(() => listChanges(doc), [doc]);
  const shown = filter === 'all' ? changes : changes.filter((c) => c.kind === filter);
  const act = (fn: () => void) => { fn(); onChange(); };
  const fresh = (c: Change) => listChanges(model.state.doc).find((x) => x.id === c.id && x.kind === c.kind);
  return (
    <div className={'inspector wr-side' + (open ? ' open' : '')}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderBottom: '1px solid var(--line)' }}>
        <Eyebrow>Changes · {changes.length}</Eyebrow>
        <div style={{ display: 'flex', gap: 4 }}>
          <button type="button" className="wr-mini" disabled={!changes.length} onClick={() => act(() => A.resolveEvery(model, true, filter === 'all' ? undefined : filter))}>Accept all</button>
          <button type="button" className="wr-mini" disabled={!changes.length} onClick={() => act(() => A.resolveEvery(model, false, filter === 'all' ? undefined : filter))}>Reject all</button>
        </div>
      </div>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {FILTERS.map((f) => <button key={f.id} type="button" className={'wr-mini' + (filter === f.id ? ' on' : '')} style={{ padding: '4px 8px' }} onClick={() => setFilter(f.id)}>{f.label}</button>)}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {!shown.length && (
          <div className="empty-hint" style={{ padding: 14 }}>
            {model.tracking ? 'No changes yet. Edits you make now are tracked.' : 'No tracked changes. Turn on tracking below to record edits.'}
          </div>
        )}
        {shown.map((c) => {
          const [label, color] = KIND_LABEL[c.kind];
          const when = new Date(c.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const ctx = c.context.trim();
          const snippet = c.text.length > 80 ? c.text.slice(0, 80) + '…' : c.text;
          return (
            <div key={c.kind + c.id} className="wr-card" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); A.selectRange(model, c.ranges[0].from, c.ranges[c.ranges.length - 1].to); } }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--mute)', font: 'var(--type-mono)', fontSize: 10 }}>
                <span style={{ color }}>{label}</span><span>{c.author} · {when}</span>
              </div>
              <div style={{ marginTop: 6, lineHeight: 1.5, wordBreak: 'break-word' }}>
                {c.kind === 'format'
                  ? <>“{snippet}” — {describeOps(c.ops ?? '')}</>
                  : c.kind === 'deletion'
                    ? <>“{snippet}” — removed{ctx ? <> from “{ctx.length > 30 ? '…' + ctx.slice(-30) : ctx}”</> : ''}</>
                    : <>“{snippet}” — added{ctx ? <> after “{ctx.length > 30 ? '…' + ctx.slice(-30) : ctx}”</> : ''}</>}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
                <button type="button" className="wr-mini" onClick={() => act(() => { const f = fresh(c); if (f) A.resolveOne(model, f, true); })}>Accept</button>
                <button type="button" className="wr-mini" onClick={() => act(() => { const f = fresh(c); if (f) A.resolveOne(model, f, false); })}>Reject</button>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--mute)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Track changes</span>
          <Switch on={model.tracking} onChange={(v) => { model.tracking = v; model.emit(); onChange(); }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Markup</span>
          <select className="wr-select" style={{ border: 0, background: 'transparent', padding: 0, textAlign: 'right' }} value={model.ui.markup} onChange={(e) => model.setUI({ markup: e.target.value as Markup })}>
            <option value="all">All markup</option>
            <option value="none">No markup</option>
            <option value="original">Original</option>
          </select>
        </div>
      </div>
    </div>
  );
}
