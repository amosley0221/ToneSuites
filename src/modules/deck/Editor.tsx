// Deck editor: toolbar, thumbnail rail, canvas + notes/timeline, inspector, masters dialog, presenter.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { moduleApi } from '@/core/documents';
import type { EditorProps, ModuleApi } from '@/core/types';
import { Button, Eyebrow } from '@/ui';
import { Canvas } from './Canvas';
import { insertImageBytes, pickAndInsertImage, startPresenting } from './commands';
import type { DeckDoc } from './doc';
import { Inspector } from './Inspector';
import { MastersDialog } from './MastersDialog';
import { masterOf, TRANSITIONS } from './model';
import * as ops from './ops';
import { DropButton, useDeck } from './parts';
import { Presenter } from './Presenter';
import { ThumbRail } from './ThumbRail';
import { Timeline } from './Timeline';

function Toolbar({ doc, api, compact }: { doc: DeckDoc; api: ModuleApi; compact: boolean }) {
  const s = doc.slide();
  const guard = (p: Promise<unknown>) => p.catch((e) => api.toast(String(e?.message ?? e), 'error'));
  return (
    <div className="toolbar">
      <DropButton label="+ New slide" width={180} items={() => masterOf(doc.data).layouts.map((l) => ({ label: l.name, onClick: () => ops.addSlide(doc, l.id) }))} />
      <Button onClick={() => { doc.ui.mastersOpen = true; doc.emit(); }}>Masters &amp; layouts</Button>
      <div className="tsep" />
      <Button onClick={() => ops.insertText(doc)}>Text</Button>
      <Button onClick={() => void guard(pickAndInsertImage(doc, api))}>Image</Button>
      <DropButton label="Shape" width={160} items={() => [
        { label: 'Rectangle', onClick: () => ops.insertShape(doc, 'rect') },
        { label: 'Ellipse', onClick: () => ops.insertShape(doc, 'ellipse') },
        { label: 'Line', onClick: () => ops.insertShape(doc, 'line') },
      ]} />
      <Button title="On the roadmap" onClick={() => api.runCommand('deck.insert.chart')}>Chart</Button>
      <Button onClick={() => ops.insertTable(doc)}>Table</Button>
      <Button title="On the roadmap" onClick={() => api.runCommand('deck.insert.embed')}>Embed</Button>
      <div className="tsep" />
      <DropButton label="Transition" width={180} items={() => [
        ...TRANSITIONS.map((t) => ({ label: t.label, checked: s?.transition === t.id, onClick: () => ops.setTransition(doc, t.id) })),
        '-' as const,
        { label: 'Apply to all slides', onClick: () => api.runCommand('deck.slide.transition.applyAll') },
      ]} />
      <Button active={doc.ui.timeline} onClick={() => { doc.ui.timeline = !doc.ui.timeline; doc.emit(); }}>Animate</Button>
      <span style={{ flex: 1 }} />
      {compact && <Button active={doc.ui.panelsOpen} onClick={() => { doc.ui.panelsOpen = !doc.ui.panelsOpen; doc.emit(); }}>Panels</Button>}
      <Button size="sm" style={{ fontSize: 12, padding: '4px 10px' }} onClick={() => startPresenting(doc, 'rehearse', 0)}>Rehearse</Button>
      <Button variant="primary" size="sm" style={{ fontSize: 12, padding: '4px 12px' }} title="Present (F5) · Presenter view (Alt F5)" onClick={() => startPresenting(doc, 'presenter', doc.ui.current)}>▶ Present</Button>
    </div>
  );
}

function Notes({ doc }: { doc: DeckDoc }) {
  const s = doc.slide();
  if (!s) return null;
  return (
    <div style={{ height: 92, borderTop: '1px solid var(--line)', background: 'var(--bg1)', padding: '12px 16px', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      <Eyebrow>Speaker notes</Eyebrow>
      <textarea key={s.id} value={s.notes} placeholder="Click to add notes"
        onChange={(e) => { s.notes = e.target.value; doc.commit('notes:' + s.id); }}
        style={{ flex: 1, marginTop: 6, resize: 'none', background: 'transparent', border: 0, outline: 'none', padding: 0, color: 'var(--ink)', font: 'var(--type-body)', lineHeight: 1.5 }} />
    </div>
  );
}

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
};

export function Editor({ doc: tab, model: doc, onChange, compact }: EditorProps<DeckDoc>) {
  useDeck(doc);
  const api = useMemo(() => moduleApi(tab.id), [tab.id]);
  const [playhead, setPlayhead] = useState<number | null>(null);
  doc.title = tab.title;
  useEffect(() => {
    doc.onEdit = onChange;
    return () => { if (doc.onEdit === onChange) doc.onEdit = null; };
  }, [doc, onChange]);
  // Leaving the slide or closing the timeline resets the scrubbed playhead.
  useEffect(() => setPlayhead(null), [doc.ui.current, doc.ui.timeline]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isEditable(e.target) || doc.ui.presenting) return;
    const sel = doc.ui.selection;
    const step = e.shiftKey ? 50 : 10;
    let used = true;
    switch (e.key) {
      case 'Delete': case 'Backspace': if (sel.length) ops.deleteSelection(doc); else ops.deleteSlide(doc); break;
      case 'ArrowLeft': if (sel.length) ops.nudge(doc, -step, 0); else doc.goTo(doc.ui.current - 1); break;
      case 'ArrowRight': if (sel.length) ops.nudge(doc, step, 0); else doc.goTo(doc.ui.current + 1); break;
      case 'ArrowUp': if (sel.length) ops.nudge(doc, 0, -step); else doc.goTo(doc.ui.current - 1); break;
      case 'ArrowDown': if (sel.length) ops.nudge(doc, 0, step); else doc.goTo(doc.ui.current + 1); break;
      case 'PageUp': doc.goTo(doc.ui.current - 1); break;
      case 'PageDown': doc.goTo(doc.ui.current + 1); break;
      case 'Home': if (!sel.length) doc.goTo(0); else used = false; break;
      case 'End': if (!sel.length) doc.goTo(doc.data.slides.length - 1); else used = false; break;
      case 'Escape': if (sel.length) doc.select([]); else used = false; break;
      case 'Enter': {
        const el = doc.selected()[0];
        if (sel.length === 1 && el?.type === 'text') { doc.ui.editing = el.id; doc.emit(); } else used = false;
        break;
      }
      case 'Tab': {
        const els = doc.slide()?.elements ?? [];
        if (!els.length) { used = false; break; }
        const i = els.findIndex((x) => x.id === sel[sel.length - 1]);
        const n = (i + (e.shiftKey ? -1 : 1) + els.length) % els.length;
        doc.select([els[i < 0 ? 0 : n].id]);
        break;
      }
      default: used = false;
    }
    if (used) e.preventDefault();
  };

  const onPaste = (e: React.ClipboardEvent) => {
    if (isEditable(e.target)) return;
    const f = Array.from(e.clipboardData.files).find((x) => x.type.startsWith('image/'));
    if (f) {
      e.preventDefault();
      void f.arrayBuffer().then((b) => insertImageBytes(doc, new Uint8Array(b), f.type)).catch((err) => api.toast(String(err?.message ?? err), 'error'));
    } else if (doc.clipboard.length) { e.preventDefault(); ops.paste(doc); }
  };

  const exitShow = useCallback((summary?: string) => {
    doc.ui.presenting = null;
    doc.emit();
    if (summary) api.toast(summary);
  }, [doc, api]);

  return (
    <div tabIndex={-1} onKeyDown={onKeyDown} onPaste={onPaste} className={compact ? 'compact' : undefined}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', outline: 'none', background: 'var(--bg0)' }}>
      <Toolbar doc={doc} api={api} compact={compact} />
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <ThumbRail doc={doc} width={compact ? 96 : 200} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <Canvas doc={doc} api={api} pad={compact ? 12 : 32} animTime={doc.ui.timeline && playhead !== null ? playhead : undefined} />
          {doc.ui.timeline
            ? <Timeline doc={doc} playhead={playhead} setPlayhead={setPlayhead} />
            : doc.ui.showNotes && <Notes doc={doc} />}
        </div>
        <Inspector doc={doc} api={api} compact={compact} />
      </div>
      {doc.ui.mastersOpen && <MastersDialog doc={doc} onClose={() => { doc.ui.mastersOpen = false; doc.emit(); }} />}
      {doc.ui.presenting && <Presenter doc={doc} onExit={exitShow} />}
    </div>
  );
}
