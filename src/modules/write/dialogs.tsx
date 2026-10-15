// Write dialogs: Page setup, Table of contents, Footnote, Link, Comment, Word count.
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Checkbox, Dialog, Eyebrow, Input } from '@/ui';
import { insertFootnote, insertOrUpdateToc, tocEntries, type TocOptions } from './actions';
import { pageBox, PAPER_PX, type FootnoteNumbering, type PageSetup, type Paper, type WriteModel } from './model';
import { schema } from './schema';
import { docStats } from './stats';
import { footnoteLabel } from './util';

const col: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14 };
const paperPreview: CSSProperties = { background: 'var(--paper)', color: 'var(--paper-ink)' };

function Section({ label, children }: { label: string; children: ReactNode }) {
  return <div><Eyebrow>{label}</Eyebrow><div style={{ marginTop: 8 }}>{children}</div></div>;
}

function Chips<T extends string | number>({ value, options, onChange, mono }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {options.map((o) => (
        <Button key={String(o.value)} active={o.value === value} onClick={() => onChange(o.value)} style={mono ? { fontFamily: 'var(--font-mono)', fontSize: 11 } : undefined}>{o.label}</Button>
      ))}
    </div>
  );
}

// ---------- Page setup ----------

export function PageSetupDialog({ model, title, onClose, onApply }: { model: WriteModel; title: string; onClose: () => void; onApply: (p: PageSetup) => void }) {
  const [p, setP] = useState<PageSetup>(() => structuredClone(model.page));
  const box = pageBox(p);
  const scale = Math.min(170 / box.w, 220 / box.h);
  const pw = box.w * scale, ph = box.h * scale;
  const margin = (k: keyof PageSetup['margins'], label: string) => (
    <div style={{ border: '1px solid var(--line)', padding: '6px 8px' }}>
      <div style={{ color: 'var(--mute)', fontSize: 10 }}>{label}</div>
      <input type="number" min={0} max={3} step={0.1} value={p.margins[k]}
        onChange={(e) => { const v = Math.max(0, Math.min(3, parseFloat(e.target.value) || 0)); setP({ ...p, margins: { ...p.margins, [k]: v } }); }}
        style={{ width: '100%', background: 'transparent', border: 0, outline: 0, color: 'var(--ink)', font: 'var(--type-mono)', padding: 0 }} />
    </div>
  );
  const sizeLabel = `${PAPER_PX[p.paper].label}${p.orientation === 'landscape' ? ' landscape' : ''} · ${p.margins.top === p.margins.left && p.margins.left === p.margins.right && p.margins.right === p.margins.bottom ? `${p.margins.top} in margins` : 'custom margins'}`;
  return (
    <Dialog title="Page setup" subtitle={title} width={760} height={560} onClose={onClose}>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 24, fontSize: 12, overflow: 'auto' }}>
        <div style={{ ...col, flex: '1 1 300px', minWidth: 0 }}>
          <Section label="Paper"><Chips value={p.paper} options={(['Letter', 'A4', 'Legal'] as Paper[]).map((v) => ({ value: v, label: v }))} onChange={(v) => setP({ ...p, paper: v })} /></Section>
          <Section label="Orientation"><Chips value={p.orientation} options={[{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] as const} onChange={(v) => setP({ ...p, orientation: v })} /></Section>
          <Section label="Margins (in)">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {margin('top', 'Top')}{margin('bottom', 'Bottom')}{margin('left', 'Left')}{margin('right', 'Right')}
            </div>
          </Section>
          <Section label="Columns"><Chips value={p.columns} options={[{ value: 1, label: '1' }, { value: 2, label: '2' }] as const} onChange={(v) => setP({ ...p, columns: v })} /></Section>
          <Section label="Header & footer">
            <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr', gap: 6, alignItems: 'center' }}>
              <span style={{ color: 'var(--mute)' }}>Header</span>
              <Input value={p.header} onChange={(v) => setP({ ...p, header: v })} placeholder="Text at the top of each page" />
              <span style={{ color: 'var(--mute)' }}>Footer</span>
              <Input value={p.footer} onChange={(v) => setP({ ...p, footer: v })} placeholder="Use {page} and {pages} for numbers" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, color: 'var(--mute)' }}>
              <Checkbox checked={p.pageNumbers} onChange={(v) => setP({ ...p, pageNumbers: v })} label="Footer with page number" />
              <Checkbox checked={p.differentFirst} onChange={(v) => setP({ ...p, differentFirst: v })} label="Different first page (no header/footer)" />
            </div>
          </Section>
          <div style={{ marginTop: 'auto', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => onApply(p)}>Apply to document</Button>
          </div>
        </div>
        <div style={{ width: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0, margin: '0 auto' }}>
          <Eyebrow>Preview</Eyebrow>
          <div style={{ width: 220, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ ...paperPreview, width: pw, height: ph, position: 'relative', boxShadow: '0 10px 30px rgba(0,0,0,.4)' }}>
              <div style={{ position: 'absolute', left: box.left * scale, right: box.right * scale, top: box.top * scale, bottom: box.bottom * scale, border: '1px dashed #bbb', display: 'flex', gap: 6 * scale * 4 }}>
                {p.columns === 2 && <><div style={{ flex: 1, borderRight: '1px dashed #ddd' }} /><div style={{ flex: 1 }} /></>}
              </div>
              {p.header && <div style={{ position: 'absolute', top: Math.max(3, box.top * scale / 2 - 1), left: box.left * scale, right: box.right * scale, height: 3, background: '#ddd' }} />}
              {(p.footer || p.pageNumbers) && <div style={{ position: 'absolute', bottom: Math.max(3, box.bottom * scale / 2 - 1), left: '50%', width: p.footer ? 40 : 10, marginLeft: p.footer ? -20 : -5, height: 3, background: '#ddd' }} />}
            </div>
          </div>
          <div style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)', textAlign: 'center' }}>{sizeLabel}</div>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Table of contents ----------

export function TocDialog({ model, pos, onClose, onDone }: { model: WriteModel; pos?: number; onClose: () => void; onDone: () => void }) {
  const existing = pos != null ? model.state.doc.nodeAt(pos) : null;
  const ex = existing?.type === schema.nodes.toc ? existing.attrs : null;
  const [o, setO] = useState<TocOptions>(() => ({
    levels: ex?.levels ?? [1, 2], style: ex?.style ?? 'dotted', pageNumbers: ex?.pageNumbers ?? true, links: ex?.links ?? true, auto: ex?.auto ?? true,
  }));
  const entries = useMemo(() => tocEntries(model.state.doc, o.levels, model.ui.blockPages), [model, o.levels]);
  const minLevel = Math.min(3, ...entries.map((e) => e.level));
  const lvl = (l: number) => (
    <Checkbox key={l} checked={o.levels.includes(l)} label={`Heading ${l}`}
      onChange={(v) => setO({ ...o, levels: v ? [...o.levels, l].sort() : o.levels.filter((x) => x !== l) })} />
  );
  const counters = [0, 0, 0, 0];
  return (
    <Dialog title="Table of contents" subtitle={ex ? 'Update existing' : 'Insert at cursor'} width={820} height={520} onClose={onClose}>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexWrap: 'wrap', gap: 24, fontSize: 12, minHeight: 0, overflow: 'auto' }}>
        <div style={{ ...col, flex: '0 1 260px', minWidth: 0 }}>
          <Section label="Include levels"><div style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--mute)' }}>{[1, 2, 3].map(lvl)}</div></Section>
          <Section label="Style">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {([['dotted', 'Dotted leaders'], ['plain', 'Plain'], ['numbered', 'Numbered']] as const).map(([v, l]) => (
                <Button key={v} active={o.style === v} onClick={() => setO({ ...o, style: v })} style={{ justifyContent: 'flex-start', padding: '7px 10px' }}>{l}</Button>
              ))}
            </div>
          </Section>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, color: 'var(--mute)' }}>
            <Checkbox checked={o.pageNumbers} onChange={(v) => setO({ ...o, pageNumbers: v })} label="Show page numbers" />
            <Checkbox checked={o.links} onChange={(v) => setO({ ...o, links: v })} label="Entries are links" />
            <Checkbox checked={o.auto} onChange={(v) => setO({ ...o, auto: v })} label="Update automatically" />
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', gap: 6 }}>
            <Button onClick={onClose} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Button>
            <Button variant="primary" onClick={() => { insertOrUpdateToc(model, o, ex ? pos : undefined); onDone(); }} style={{ flex: 1, justifyContent: 'center', padding: '8px 16px' }}>{ex ? 'Update TOC' : 'Insert TOC'}</Button>
          </div>
        </div>
        <div style={{ ...paperPreview, flex: '1 1 280px', minHeight: 200, padding: '28px 32px', fontSize: 13, lineHeight: 2, overflow: 'auto' }}>
          <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.2, marginBottom: 12 }}>Contents</div>
          {!entries.length && <div style={{ color: 'var(--paper-mute)', lineHeight: 1.5 }}>No headings at these levels yet. Apply Heading styles to your section titles and they will appear here.</div>}
          {entries.map((e, i) => {
            counters[e.level]++;
            for (let l = e.level + 1; l < 4; l++) counters[l] = 0;
            const num = o.style === 'numbered' ? counters.slice(minLevel, e.level + 1).filter(Boolean).join('.') + '  ' : '';
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 6, paddingLeft: (e.level - minLevel) * 16 }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{num}{e.text}</span>
                <span style={{ flex: 1, borderBottom: o.style === 'dotted' && o.pageNumbers ? '1px dotted #999' : 0, transform: 'translateY(-4px)' }} />
                {o.pageNumbers && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.page}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Footnote ----------

export function FootnoteDialog({ model, pos, onClose, onDone }: { model: WriteModel; pos?: number; onClose: () => void; onDone: () => void }) {
  const node = pos != null ? model.state.doc.nodeAt(pos) : null;
  const editing = node?.type === schema.nodes.footnote;
  const [text, setText] = useState<string>(editing ? node!.attrs.text : '');
  const [numbering, setNumbering] = useState<FootnoteNumbering>(model.footnotes.numbering);
  const [position, setPosition] = useState(model.footnotes.position);
  const index = useMemo(() => {
    let n = 0, at = 0;
    const target = editing ? pos! : model.state.selection.to;
    model.state.doc.descendants((c, p) => { if (c.type === schema.nodes.footnote) { if (p < target || (editing && p === target)) at = ++n; else n++; } return true; });
    return editing ? at : at + 1;
  }, [model, pos, editing]);
  const after = useMemo(() => {
    const { $from } = model.state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset, ' ', ' ').trim().split(/\s+/).pop();
    return before ? `After “${before.slice(0, 24)}”` : 'At cursor';
  }, [model]);
  const save = () => {
    model.footnotes = { numbering, position };
    insertFootnote(model, text.trim(), editing ? pos : undefined);
    onDone();
  };
  return (
    <Dialog title="Footnote" subtitle={editing ? `Editing note ${footnoteLabel(index, numbering)}` : after} width={720} height={520} onClose={onClose}>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12, minHeight: 0 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <Section label="Numbering">
              <Chips mono value={numbering} onChange={setNumbering} options={[{ value: 'decimal', label: '1, 2, 3' }, { value: 'roman', label: 'i, ii, iii' }, { value: 'alpha', label: 'a, b, c' }, { value: 'symbols', label: '* † ‡' }]} />
            </Section>
          </div>
          <div style={{ flex: 1 }}>
            <Section label="Position">
              <Chips value={position} onChange={setPosition} options={[{ value: 'page', label: 'Bottom of page' }, { value: 'end', label: 'End of document' }]} />
            </Section>
          </div>
        </div>
        <div style={{ color: 'var(--mute)' }}>Numbering is continuous through the document and applies to every footnote.</div>
        <Section label="Footnote text">
          <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }}
            placeholder="Type the note…"
            style={{ width: '100%', minHeight: 80, padding: 12, border: '1px solid var(--line)', background: 'var(--bg0)', color: 'var(--ink)', font: 'var(--type-label)', lineHeight: 1.5, resize: 'vertical', outline: 'none' }} />
        </Section>
        <div style={{ ...paperPreview, padding: '14px 20px', fontSize: 12, lineHeight: 1.6 }}>
          <div style={{ borderTop: '1px solid #333', width: 120, marginBottom: 6 }} />
          <div><sup>{footnoteLabel(index, numbering)}</sup> {text || <span style={{ color: 'var(--paper-mute)' }}>Footnote text</span>}</div>
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!text.trim()} onClick={save} style={{ padding: '8px 16px' }}>{editing ? 'Update footnote' : 'Insert footnote'}</Button>
        </div>
      </div>
    </Dialog>
  );
}

// ---------- Small dialogs (opened through api.openDialog) ----------

export function LinkDialog({ initial, hasSelection, onClose, onSave }: { initial: string; hasSelection: boolean; onClose: () => void; onSave: (href: string, text: string) => void }) {
  const [href, setHref] = useState(initial);
  const [text, setText] = useState('');
  const go = () => onSave(normalizeUrl(href), text);
  const key = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
  return (
    <Dialog title="Link" subtitle={hasSelection ? 'Selected text' : 'Insert at cursor'} width={480} height="auto" onClose={onClose}
      footer={<>{initial && <Button variant="ghost" onClick={() => onSave('', '')}>Remove link</Button>}<span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!href.trim()} onClick={go}>Apply</Button></>}>
      <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section label="Address"><Input autoFocus value={href} onChange={setHref} onKeyDown={key} placeholder="https://" style={{ width: '100%' }} /></Section>
        {!hasSelection && <Section label="Text to display"><Input value={text} onChange={setText} onKeyDown={key} placeholder="Defaults to the address" style={{ width: '100%' }} /></Section>}
      </div>
    </Dialog>
  );
}

function normalizeUrl(u: string): string {
  const t = u.trim();
  if (!t) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('#') || t.startsWith('/')) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'mailto:' + t;
  return 'https://' + t;
}

export function CommentDialog({ onClose, onSave }: { onClose: () => void; onSave: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <Dialog title="New comment" subtitle="On selected text" width={480} height="auto" onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!text.trim()} onClick={() => onSave(text)}>Comment</Button></>}>
      <div style={{ flex: 1, padding: 20 }}>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a comment…"
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim()) { e.preventDefault(); onSave(text); } }}
          style={{ width: '100%', minHeight: 96, padding: 10, border: '1px solid var(--line)', background: 'var(--bg0)', color: 'var(--ink)', font: 'var(--type-label)', resize: 'vertical', outline: 'none' }} />
      </div>
    </Dialog>
  );
}

export function WordCountDialog({ model, onClose }: { model: WriteModel; onClose: () => void }) {
  const all = docStats(model.state.doc);
  const { from, to, empty } = model.state.selection;
  const selWords = empty ? null : docStats(schema.node('doc', null, [schema.node('paragraph', null, model.state.doc.textBetween(from, to, ' ', ' ') ? [schema.text(model.state.doc.textBetween(from, to, ' ', ' '))] : [])])).words;
  const row = (k: string, v: string | number) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid var(--line)', font: 'var(--type-small)' }}>
      <span style={{ color: 'var(--mute)' }}>{k}</span><span style={{ font: 'var(--type-mono)' }}>{typeof v === 'number' ? v.toLocaleString() : v}</span>
    </div>
  );
  return (
    <Dialog title="Word count" subtitle={model.page.paper} width={420} height="auto" onClose={onClose} footer={<><span style={{ flex: 1 }} /><Button variant="primary" onClick={onClose}>Done</Button></>}>
      <div style={{ flex: 1, padding: '12px 20px' }}>
        {selWords != null && row('Words in selection', selWords)}
        {row('Words', all.words)}
        {row('Characters (with spaces)', all.characters)}
        {row('Characters (no spaces)', all.charactersNoSpaces)}
        {row('Paragraphs', all.paragraphs)}
        {row('Pages', model.ui.pages)}
        {row('Reading time', all.readingMinutes ? `${all.readingMinutes} min` : '—')}
      </div>
    </Dialog>
  );
}
