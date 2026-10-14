// Organize pages: 6-column grid, multi-select, rotate/delete/extract/insert/split/merge, drag to reorder.
import { useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react';
import { Button, Dialog } from '@/ui';
import type { PaperActions } from '../actions';
import { fmtBytes } from '../actions';
import { countPages } from '../apply';
import type { PageRef, PaperModel } from '../model';
import { blankPage, dropTarget, insertAt, movePages, nextSourceId, rotatePages, sourcePages, splitAt } from '../pageops';
import { geomSync } from '../render';
import { Thumb } from '../Thumb';

export function OrganizeDialog({ model, actions, onClose }: { model: PaperModel; actions: PaperActions; onClose: () => void }) {
  const [pages, setPages] = useState<PageRef[]>(model.pages);
  const [sel, setSel] = useState<string[]>(() => (model.pages[model.ui.page] ? [model.pages[model.ui.page].id] : []));
  const [anchor, setAnchor] = useState<number>(model.ui.page);
  const [drop, setDrop] = useState<number | null>(null);
  const dragIds = useRef<string[]>([]);
  const gridRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  const selSet = useMemo(() => new Set(sel), [sel]);
  const selIdx = pages.map((p, i) => (selSet.has(p.id) ? i : -1)).filter((i) => i >= 0);
  const changed = pages !== model.pages;

  const click = (e: MouseEvent, i: number, checkbox = false) => {
    const id = pages[i].id;
    if (e.shiftKey) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      setSel(pages.slice(a, b + 1).map((p) => p.id));
      return;
    }
    if (checkbox || e.ctrlKey || e.metaKey) setSel(selSet.has(id) ? sel.filter((x) => x !== id) : [...sel, id]);
    else setSel([id]);
    setAnchor(i);
  };

  const rotate = (d: number) => setPages(rotatePages(pages, sel, d));
  const remove = () => {
    if (sel.length >= pages.length) { actions.api.toast('A PDF needs at least one page', 'error'); return; }
    setPages(pages.filter((p) => !selSet.has(p.id)));
    setSel([]);
  };
  const insertBlankAfter = () => {
    const at = selIdx.length ? selIdx[selIdx.length - 1] + 1 : pages.length;
    const ref = pages[at - 1];
    const g = ref ? geomSync(model, ref) : null;
    const b = blankPage(g ? [g.view[2] - g.view[0], g.view[3] - g.view[1]] : undefined);
    setPages(insertAt(pages, at, [b]));
    setSel([b.id]);
  };
  const insertFile = async (atEnd = false) => {
    const files = await actions.api.pickFile(['pdf'], true);
    let at = !atEnd && selIdx.length ? selIdx[selIdx.length - 1] + 1 : pages.length;
    let next = pages;
    const added: string[] = [];
    for (const f of files) {
      try {
        const n = await countPages(f.bytes);
        // Sources are kept on the model right away; unreferenced ones are dropped on save.
        const src = { id: nextSourceId(model.sources), name: f.name, bytes: f.bytes };
        model.sources = [...model.sources, src];
        const ps = sourcePages(src, n);
        next = insertAt(next, at, ps);
        at += ps.length;
        added.push(...ps.map((p) => p.id));
      } catch (e) { actions.api.toast(`${f.name}: ${(e as Error).message}`, 'error'); }
    }
    if (added.length) { setPages(next); setSel(added); }
  };
  const extract = () => {
    if (!selIdx.length) return;
    actions.openParts([selIdx], 'extract', pages);
  };
  const splitHere = () => {
    if (!selIdx.length || selIdx[0] === 0) { actions.api.toast('Select the first page of the second part'); return; }
    actions.openParts(splitAt(pages.length, [selIdx[0]]), 'part', pages);
  };

  const onDragStart = (e: DragEvent, id: string) => {
    dragIds.current = selSet.has(id) ? pages.filter((p) => selSet.has(p.id)).map((p) => p.id) : [id];
    if (!selSet.has(id)) setSel([id]);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };
  const onDragOver = (e: DragEvent, i: number) => {
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDrop(e.clientX - r.left > r.width / 2 ? i + 1 : i);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (drop === null || !dragIds.current.length) return;
    setPages(movePages(pages, dragIds.current, dropTarget(pages, dragIds.current, drop)));
    setDrop(null);
    dragIds.current = [];
  };

  const apply = () => {
    if (changed) {
      const keep = new Set(pages.map((p) => p.id));
      actions.commit((m) => {
        m.pages = pages;
        m.edits = m.edits.filter((x) => keep.has(x.page));
        m.newFields = m.newFields.filter((x) => keep.has(x.page));
      });
    }
    onClose();
  };

  const size = model.sources.reduce((a, s) => a + (pages.some((p) => p.src === s.id) ? s.bytes.length : 0), 0);
  return (
    <Dialog title="Organize pages" subtitle={model.fileName} width={1040} height={680} onClose={onClose}
      footer={<>
        <span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>{pages.length} pages{pages.length !== model.pages.length ? ` (was ${model.pages.length})` : ''} · sources {fmtBytes(size)}</span>
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={apply}>Apply changes</Button>
      </>}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '10px 16px', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
          <Button disabled={!sel.length} onClick={() => rotate(90)}>↻ Rotate</Button>
          <Button disabled={!sel.length} onClick={() => rotate(-90)}>↺</Button>
          <Button disabled={!sel.length} onClick={remove}>Delete</Button>
          <Button disabled={!sel.length} onClick={extract} title="Open the selected pages in a new tab">Extract</Button>
          <Button onClick={insertBlankAfter}>Insert blank</Button>
          <Button onClick={() => void insertFile().then(() => force((x) => x + 1))}>Insert from file…</Button>
          <Button disabled={!selIdx.length} onClick={splitHere} title="Open two new tabs split before the first selected page">Split here</Button>
          <Button onClick={() => void insertFile(true)} title="Append PDFs at the end">Merge…</Button>
          <span style={{ flex: 1 }} />
          <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{sel.length} selected · drag to reorder</span>
        </div>
        <div ref={gridRef} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
          style={{ flex: 1, overflow: 'auto', padding: 16, display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12, alignContent: 'start', background: 'var(--canvas)' }}>
          {pages.map((p, i) => {
            const on = selSet.has(p.id);
            return (
              <div key={p.id} draggable onDragStart={(e) => onDragStart(e, p.id)} onDragOver={(e) => onDragOver(e, i)} onDragEnd={() => setDrop(null)}
                onClick={(e) => click(e, i)} className={'pp-thumb' + (on ? ' on' : '')} style={{ position: 'relative' }}>
                {drop === i && <div style={{ position: 'absolute', left: -7, top: 0, bottom: 18, width: 2, background: 'var(--accent)' }} />}
                {drop === i + 1 && i === pages.length - 1 && <div style={{ position: 'absolute', right: -7, top: 0, bottom: 18, width: 2, background: 'var(--accent)' }} />}
                <Thumb model={model} pageRef={p} width={150} root={gridRef.current} />
                <div onClick={(e) => { e.stopPropagation(); click(e, i, true); }}
                  style={{ position: 'absolute', left: 6, top: 6, width: 14, height: 14, background: on ? 'var(--accent)' : 'var(--paper)', border: `1px solid ${on ? 'var(--accent)' : 'var(--paper-line)'}`, color: 'var(--on-accent)', fontSize: 10, fontWeight: 900, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{on ? '✓' : ''}</div>
                <div className="pp-num" style={{ marginTop: 6 }}>{i + 1}{p.rot ? ` · ${p.rot}°` : ''}{p.src === null ? ' · blank' : p.src !== model.sources[0]?.id ? ' · ' + (model.source(p.src)?.name ?? '') : ''}</div>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}
