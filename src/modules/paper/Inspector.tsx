// Inspector (280px): active tool options, document actions, annotations list.
import { useEffect, useState } from 'react';
import { Badge, Eyebrow, Select, Slider } from '@/ui';
import type { PaperActions } from './actions';
import { usePaper } from './context';
import { editDetail, editLabel, type SubTool, type Tool } from './model';

const COLORS = ['#e5484d', '#ff5a1f', '#ffd400', '#2fb98a', '#1570ef', '#1a1a1a'];
const HL_COLORS = [['Yellow', '#ffd400'], ['Accent', '#ff5a1f'], ['Green', '#7ee08a'], ['Blue', '#8cc3ff'], ['Pink', '#ff9ad5']] as const;
const STAMPS = ['APPROVED', 'REVIEWED', 'DRAFT', 'CONFIDENTIAL', 'FINAL', 'VOID', 'NOT APPROVED', 'RECEIVED'] as const;
const TEXT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '24', '32'] as const;

interface Opt { name: string; hint?: string; on?: boolean; disabled?: boolean; go: () => void }

export function Inspector({ actions, open }: { actions: PaperActions; open: boolean }) {
  const { model, fields } = usePaper();
  const ui = model.ui;
  const tool = ui.tool;
  const sub = (s: SubTool, extra?: () => void) => () => { model.setUi({ sub: s, selected: null }); extra?.(); };
  const marked = model.edits.filter((e) => e.kind === 'redact' && !e.applied).length;
  const fieldCount = new Set(fields.map((f) => f.name)).size + model.newFields.length;

  const defs: Record<Tool, [string, Opt[]]> = {
    Annotate: ['Draw, comment and stamp on any page. Annotations are kept separately until you save the PDF.', [
      { name: 'Pen', hint: 'P', on: ui.sub === 'pen', go: sub('pen') },
      { name: 'Sticky note', hint: 'N', on: ui.sub === 'note', go: sub('note') },
      { name: 'Stamp', hint: 'S', on: ui.sub === 'stamp', go: sub('stamp') },
    ]],
    Highlight: ['Mark text in any color — select text, or drag over an area.', [
      { name: 'Yellow', hint: '1', on: ui.sub === 'hl-text' && ui.hlColor === '#ffd400', go: () => model.setUi({ sub: 'hl-text', hlColor: '#ffd400' }) },
      { name: 'Accent', hint: '2', on: ui.sub === 'hl-text' && ui.hlColor === '#ff5a1f', go: () => model.setUi({ sub: 'hl-text', hlColor: '#ff5a1f' }) },
      { name: 'Strikethrough', hint: '3', on: ui.sub === 'strike', go: sub('strike') },
      { name: 'Area highlight', hint: '4', on: ui.sub === 'hl-area', go: sub('hl-area') },
    ]],
    Sign: ['Draw, type or upload a signature, then click the page or a signature field to place it.', [
      { name: 'Draw signature', go: () => actions.signature() },
      { name: 'Type signature', go: () => actions.signature() },
      { name: 'Place signature', hint: ui.signature ? '' : 'none yet', on: ui.sub === 'place-sign', go: () => (ui.signature ? model.setUi({ sub: 'place-sign' }) : actions.signature()) },
      { name: 'Request signature', hint: 'planned', disabled: true, go: () => actions.api.toast('Requesting signatures by email is on the roadmap') },
    ]],
    'Fill form': [fieldCount ? `Detected ${fieldCount} field${fieldCount === 1 ? '' : 's'} on this document.` : 'No form fields detected. Add some with the form builder.', [
      { name: 'Open form builder…', hint: 'F', go: () => actions.formBuilder() },
      { name: 'Auto-fill from profile', hint: 'planned', disabled: true, go: () => actions.api.toast('Auto-fill from profile is on the roadmap') },
      { name: 'Flatten on save', hint: model.flattenForm ? 'on' : 'off', on: model.flattenForm, go: () => actions.toggleFlatten() },
    ]],
    Redact: ['Permanently remove text and images. Drag to mark areas, then apply.', [
      { name: 'Mark for redaction', hint: 'R', on: ui.sub === 'redact', go: sub('redact') },
      { name: 'Search & redact', hint: 'Ctrl F', go: () => { model.setUi({ sub: 'redact' }); actions.openFind(); } },
      { name: 'Apply redactions', hint: marked ? `${marked} marked` : '', go: () => actions.applyRedactions() },
    ]],
    Edit: ['Add text and cover content. Reflowing existing text in place is planned.', [
      { name: 'Add text', hint: 'T', on: ui.sub === 'text', go: sub('text') },
      { name: 'Whiteout', hint: 'W', on: ui.sub === 'whiteout', go: sub('whiteout') },
      { name: 'Edit existing text', hint: 'planned', disabled: true, go: () => actions.api.toast('Editing existing PDF text is on the roadmap') },
      { name: 'Add page', go: () => actions.insertBlank() },
    ]],
    Organize: ['Reorder, rotate, delete or extract pages.', [
      { name: 'Open page organizer…', hint: 'O', go: () => actions.organize() },
      { name: 'Rotate', hint: 'Ctrl R', go: () => actions.rotate(90) },
      { name: 'Insert from file', go: () => void actions.insertFromFile() },
    ]],
    Convert: ['Turn this PDF into an editable document or other formats.', [
      { name: 'To Write document', hint: 'html', go: () => void actions.toWrite() },
      { name: 'To image (PNG)', hint: 'this page', go: () => void actions.exportPng() },
      { name: 'To Cells table', hint: 'planned', disabled: true, go: () => actions.api.toast('Table detection is on the roadmap') },
      { name: 'All formats…', hint: 'Ctrl Shift E', go: () => actions.api.runCommand('file.export') },
    ]],
  };
  const [desc, opts] = defs[tool];

  return (
    <div className={'inspector' + (open ? ' open' : '')} style={{ padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 22 }}>
      <div>
        <Eyebrow>{tool}</Eyebrow>
        <div style={{ marginTop: 10, color: 'var(--mute)', lineHeight: 1.5, font: 'var(--type-small)' }}>{desc}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {opts.map((o) => (
            <button key={o.name} type="button" className={'pp-opt' + (o.on ? ' on' : '') + (o.disabled ? ' disabled' : '')} onClick={o.go}>
              <span>{o.name}</span>{o.hint && <span className="hint">{o.hint}</span>}
            </button>
          ))}
        </div>
        <ToolExtras />
      </div>
      <div>
        <Eyebrow>Document actions</Eyebrow>
        <div className="pp-grid" style={{ marginTop: 10 }}>
          <button type="button" className="pp-opt" onClick={() => void actions.merge()}>Merge</button>
          <button type="button" className="pp-opt" onClick={() => actions.split()}>Split</button>
          <button type="button" className="pp-opt" onClick={() => void actions.compress()} title="Re-save with object streams and unused objects removed (images are not re-encoded)">Compress</button>
          <button type="button" className="pp-opt" onClick={() => actions.ocr()}>OCR text</button>
          <button type="button" className="pp-opt disabled" onClick={() => actions.api.toast('Password protection is on the roadmap — the PDF writer has no encryption yet')} title="Planned">Protect</button>
          <button type="button" className="pp-opt" onClick={() => void actions.toWrite()}>To Write doc</button>
        </div>
      </div>
      <AnnotationList actions={actions} />
    </div>
  );
}

function ToolExtras() {
  const { model } = usePaper();
  const ui = model.ui;
  const swatches = (list: readonly string[], value: string, set: (c: string) => void) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {list.map((c) => <button key={c} type="button" className={'pp-swatch' + (c === value ? ' on' : '')} style={{ background: c }} onClick={() => set(c)} title={c} />)}
    </div>
  );
  const row = (label: string, el: React.ReactNode) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, font: 'var(--type-small)' }}><span style={{ color: 'var(--mute)' }}>{label}</span>{el}</div>
  );
  let body: React.ReactNode = null;
  if (ui.tool === 'Annotate') {
    body = <>
      {row('Color', swatches(COLORS, ui.color, (c) => model.setUi({ color: c })))}
      {ui.sub === 'pen' && <Slider label="Width" value={ui.penWidth} min={0.5} max={12} step={0.5} display={`${ui.penWidth} pt`} onChange={(v) => model.setUi({ penWidth: v })} />}
      {ui.sub === 'stamp' && row('Stamp', <Select value={ui.stampText} options={STAMPS} onChange={(v) => model.setUi({ stampText: v })} width={140} />)}
    </>;
  } else if (ui.tool === 'Highlight') {
    body = ui.sub === 'strike'
      ? row('Color', swatches(COLORS, ui.color, (c) => model.setUi({ color: c })))
      : row('Color', swatches(HL_COLORS.map((h) => h[1]), ui.hlColor, (c) => model.setUi({ hlColor: c })));
  } else if (ui.tool === 'Sign') {
    body = ui.signature
      ? <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', padding: 8, display: 'flex', justifyContent: 'center' }}><img src={ui.signature.url} alt="Your signature" style={{ maxWidth: '100%', maxHeight: 60 }} /></div>
      : <div className="empty-hint">No signature yet — draw or type one.</div>;
  } else if (ui.tool === 'Edit') {
    body = row('Text size', <Select value={String(ui.textSize)} options={TEXT_SIZES} onChange={(v) => model.setUi({ textSize: Number(v) })} width={80} mono />);
  } else if (ui.tool === 'Redact') {
    body = <div style={{ font: 'var(--type-small)', color: 'var(--mute)', lineHeight: 1.5, borderLeft: '2px solid var(--accent)', paddingLeft: 8 }} title="True redaction: pages with applied redactions are re-rendered as 150 dpi images with the boxes burnt in, and their original content streams are deleted from the saved file. Text on those pages is no longer selectable and their form fields become flat content. Document metadata is not scrubbed — use Protect › Save copy without metadata.">
      Applied redactions flatten the affected pages to 150 dpi images on save, so the text underneath is truly removed. Other pages keep their text.
    </div>;
  }
  return body ? <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>{body}</div> : null;
}

function AnnotationList({ actions }: { actions: PaperActions }) {
  const { model } = usePaper();
  const list = model.liveEdits();
  const [limit, setLimit] = useState(200);
  useEffect(() => { setLimit(200); }, [model]);
  return (
    <div>
      <Eyebrow>Annotations · {list.length}</Eyebrow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10, font: 'var(--type-small)', color: 'var(--mute)' }}>
        {!list.length && <div className="empty-hint">None yet.</div>}
        {list.slice(0, limit).map((e) => {
          const on = model.ui.selected === e.id;
          const pi = model.pageIndex(e.page);
          return (
            <div key={e.id} className="hov-row" onClick={() => { model.setUi({ selected: e.id }); actions.goTo(pi); }}
              style={{ padding: '9px 10px', border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                <b style={{ color: 'var(--ink)' }}>{editLabel(e)}</b> · p.{pi + 1}{editDetail(e) ? ` · ${editDetail(e)}` : ''}
              </span>
              {e.kind === 'redact' && e.applied && <Badge tone="accent">applied</Badge>}
              <button type="button" title="Delete" className="hov-ink" onClick={(ev) => { ev.stopPropagation(); actions.deleteEdit(e.id); }}
                style={{ border: 0, background: 'transparent', color: 'var(--mute)', cursor: 'pointer', padding: '0 2px' }}>✕</button>
            </div>
          );
        })}
        {list.length > limit && <button type="button" className="pp-opt" onClick={() => setLimit(limit + 200)}>Show {Math.min(200, list.length - limit)} more</button>}
      </div>
    </div>
  );
}
