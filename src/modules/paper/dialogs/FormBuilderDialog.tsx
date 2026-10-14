// Form builder: place Text / Date / Number / Checkbox / Signature fields; saved as real AcroForm fields on save.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Dialog, Eyebrow, Input, Select, Switch } from '@/ui';
import type { PaperActions } from '../actions';
import { newId, type FieldType, type NewField, type PaperModel, type Rect } from '../model';
import { formFields, geom, geomSync, shownRotation, type FieldInfo, type Geom } from '../render';
import { Thumb } from '../Thumb';
import { makeViewport } from '../viewport';

const TYPES: { value: FieldType; label: string; size: [number, number] }[] = [
  { value: 'text', label: 'Text', size: [180, 22] },
  { value: 'date', label: 'Date', size: [110, 22] },
  { value: 'number', label: 'Number', size: [100, 22] },
  { value: 'checkbox', label: 'Checkbox', size: [14, 14] },
  { value: 'signature', label: 'Signature', size: [200, 50] },
];
const typeLabel = (t: string) => TYPES.find((x) => x.value === t)?.label ?? (t === 'radiobutton' ? 'Radio' : t === 'combobox' ? 'Dropdown' : t === 'listbox' ? 'List' : t.charAt(0).toUpperCase() + t.slice(1));
const LETTER_GEOM: Geom = { view: [0, 0, 612, 792], rotate: 0 };

export function FormBuilderDialog({ model, actions, onClose }: { model: PaperModel; actions: PaperActions; onClose: () => void }) {
  const [draft, setDraft] = useState<NewField[]>(model.newFields);
  const [detected, setDetected] = useState<FieldInfo[]>([]);
  const [pageIdx, setPageIdx] = useState(model.ui.page);
  const [sel, setSel] = useState<string | null>(null);
  const [adding, setAdding] = useState<FieldType | null>(null);
  const [menu, setMenu] = useState(false);
  const [rubber, setRubber] = useState<{ a: [number, number]; b: [number, number] } | null>(null);
  const [move, setMove] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const ref = model.pages[pageIdx];
  const [g, setG] = useState<Geom | null>(() => (ref ? geomSync(model, ref) : null));
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => { void formFields(model).then(setDetected); }, [model]);
  useEffect(() => { if (ref) { setG(geomSync(model, ref)); void geom(model, ref).then(setG).catch(() => {}); } }, [model, ref]);

  const geo = g ?? LETTER_GEOM;
  const rot = ref ? shownRotation(geo, ref) : 0;
  const unit = makeViewport(geo.view, rot, 1);
  const W = Math.round(Math.min(460, 540 * (unit.width / unit.height)));
  const vp = makeViewport(geo.view, rot, W / unit.width);

  const pageDetected = useMemo(() => (ref && ref.src === model.sources[0]?.id ? detected.filter((d) => d.page === ref.index) : []), [detected, ref, model]);
  const pageDraft = draft.filter((f) => f.page === ref?.id);
  const selField = draft.find((f) => f.id === sel);
  const selDetected = sel?.startsWith('d:') ? detected[parseInt(sel.slice(2), 10)] : undefined;

  const local = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = box.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const place = (e: React.PointerEvent) => {
    if (!adding || !ref) return;
    e.preventDefault();
    const a = local(e);
    let b = a;
    setRubber({ a, b });
    const mv = (ev: PointerEvent) => { b = local(ev); setRubber({ a, b }); };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      setRubber(null);
      const t = TYPES.find((x) => x.value === adding)!;
      let rect: Rect;
      if (Math.abs(b[0] - a[0]) > 6 && Math.abs(b[1] - a[1]) > 6) rect = vp.rectFromView(a[0], a[1], b[0], b[1]);
      else rect = vp.rectFromView(a[0], a[1], a[0] + t.size[0] * vp.scale, a[1] + t.size[1] * vp.scale);
      const n = draft.filter((f) => f.type === adding).length + 1;
      const f: NewField = { id: newId('f'), page: ref.id, rect, type: adding!, name: `${t.label} ${n}`, required: false };
      setDraft([...draft, f]);
      setSel(f.id);
      setAdding(null);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const startMove = (e: React.PointerEvent, f: NewField) => {
    if (adding) return;
    e.stopPropagation(); e.preventDefault();
    setSel(f.id);
    const a = local(e);
    let d: [number, number] = [0, 0];
    const mv = (ev: PointerEvent) => { const p = local(ev); d = [p[0] - a[0], p[1] - a[1]]; setMove({ id: f.id, dx: d[0], dy: d[1] }); };
    const up = () => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      setMove(null);
      if (Math.hypot(d[0], d[1]) < 2) return;
      const v = vp.rectToView(f.rect);
      const rect = vp.rectFromView(v.left + d[0], v.top + d[1], v.left + d[0] + v.width, v.top + d[1] + v.height);
      setDraft((ds) => ds.map((x) => (x.id === f.id ? { ...x, rect } : x)));
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const patch = (p: Partial<NewField>) => setDraft(draft.map((f) => (f.id === sel ? { ...f, ...p } : f)));
  const save = () => {
    actions.commit((m) => { m.newFields = draft; });
    onClose();
  };

  const row = (key: string, name: string, type: string, on: boolean, onClick: () => void, sub?: string) => (
    <div key={key} onClick={onClick} className={on ? '' : 'hov-row'}
      style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '9px 14px', borderBottom: '1px solid var(--line)', cursor: 'pointer', background: on ? 'var(--sel)' : 'transparent', boxShadow: on ? 'inset 2px 0 0 var(--accent)' : 'none' }}>
      <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ color: 'var(--mute)', font: 'var(--type-mono)', fontSize: 10, whiteSpace: 'nowrap' }}>{sub ? `${sub} · ` : ''}{typeLabel(type)}</span>
    </div>
  );

  return (
    <Dialog title="Form builder" subtitle={model.fileName} width={1000} height={680} onClose={onClose}>
      <div style={{ flex: 1, background: 'var(--canvas)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10, minWidth: 0, position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-mono)', color: 'var(--mute)' }}>
          <Button size="sm" variant="ghost" disabled={pageIdx <= 0} onClick={() => setPageIdx(pageIdx - 1)}>‹</Button>
          <span>Page {pageIdx + 1} of {model.pages.length}</span>
          <Button size="sm" variant="ghost" disabled={pageIdx >= model.pages.length - 1} onClick={() => setPageIdx(pageIdx + 1)}>›</Button>
          {adding && <span style={{ color: 'var(--accent)' }}>· click or drag on the page to place a {typeLabel(adding)} field</span>}
        </div>
        {ref && (
          <div ref={box} onPointerDown={place} style={{ position: 'relative', width: vp.width, height: vp.height, boxShadow: 'var(--shadow-page)', cursor: adding ? 'crosshair' : 'default', flexShrink: 0, touchAction: 'none' }}>
            <Thumb model={model} pageRef={ref} width={W} root={null} style={{ border: 0 }} />
            {pageDetected.map((d) => {
              const i = detected.indexOf(d);
              const v = vp.rectToView(d.rect);
              const on = sel === `d:${i}`;
              return <div key={`d${i}`} onPointerDown={(e) => { if (!adding) { e.stopPropagation(); setSel(`d:${i}`); } }}
                style={{ position: 'absolute', ...v, border: `1px solid ${on ? 'var(--accent)' : 'var(--info)'}`, background: on ? 'rgba(255,90,31,.12)' : 'rgba(79,143,247,.08)', font: '500 9px var(--font-mono)', color: on ? 'var(--accent)' : 'var(--info)', padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}>{d.name}</div>;
            })}
            {pageDraft.map((f) => {
              let v = vp.rectToView(f.rect);
              if (move?.id === f.id) v = { ...v, left: v.left + move.dx, top: v.top + move.dy };
              const on = sel === f.id;
              return <div key={f.id} onPointerDown={(e) => startMove(e, f)}
                style={{ position: 'absolute', ...v, border: `1px ${on ? 'solid' : 'dashed'} ${on ? 'var(--accent)' : 'var(--info)'}`, background: on ? 'rgba(255,90,31,.12)' : 'rgba(79,143,247,.06)', font: '500 9px var(--font-mono)', color: on ? 'var(--accent)' : 'var(--info)', padding: '0 4px', overflow: 'hidden', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', cursor: 'move' }}>{f.type === 'checkbox' ? '' : f.name}</div>;
            })}
            {rubber && <div style={{ position: 'absolute', left: Math.min(rubber.a[0], rubber.b[0]), top: Math.min(rubber.a[1], rubber.b[1]), width: Math.abs(rubber.a[0] - rubber.b[0]), height: Math.abs(rubber.a[1] - rubber.b[1]), outline: '1px dashed var(--accent)' }} />}
          </div>
        )}
      </div>
      <div style={{ width: 300, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', font: 'var(--type-small)', overflow: 'hidden', flexShrink: 0 }}
>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative' }}>
          <Eyebrow>Fields · {detected.length} detected{draft.length ? ` · ${draft.length} new` : ''}</Eyebrow>
          <Button size="sm" active={!!adding} onClick={() => { if (adding) setAdding(null); else setMenu(!menu); }}>{adding ? 'Cancel add' : '+ Add ▾'}</Button>
          {menu && (
            <div style={{ position: 'absolute', right: 14, top: 40, width: 160, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 5 }}>
              {TYPES.map((t) => <div key={t.value} className="hov-row" onClick={() => { setAdding(t.value); setMenu(false); }} style={{ padding: '6px 14px', cursor: 'pointer' }}>{t.label}</div>)}
            </div>
          )}
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {!detected.length && !draft.length && <div className="empty-hint" style={{ padding: '12px 14px' }}>No fields yet. Use + Add, then click on the page.</div>}
          {detected.map((d, i) => row(`d${i}`, d.name, d.type, sel === `d:${i}`, () => { setSel(`d:${i}`); const pi = model.pages.findIndex((p) => p.src === model.sources[0]?.id && p.index === d.page); if (pi >= 0) setPageIdx(pi); }, 'detected'))}
          {draft.map((f) => row(f.id, f.name, f.type, sel === f.id, () => { setSel(f.id); const pi = model.pageIndex(f.page); if (pi >= 0) setPageIdx(pi); }))}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Eyebrow>Properties{selField ? ` · ${selField.name}` : selDetected ? ` · ${selDetected.name}` : ''}</Eyebrow>
          {selField ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><span>Name</span><Input value={selField.name} onChange={(v) => patch({ name: v })} style={{ width: 170 }} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>Type</span><Select value={selField.type} options={TYPES.map((t) => ({ value: t.value, label: t.label }))} onChange={(v) => patch({ type: v })} width={120} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>Required</span><Switch on={selField.required} onChange={(v) => patch({ required: v })} /></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--mute)' }}><span>Auto-fill from profile</span><Badge>planned</Badge></div>
              <Button size="sm" onClick={() => { setDraft(draft.filter((f) => f.id !== sel)); setSel(null); }}>Delete field</Button>
            </>
          ) : selDetected ? (
            <div className="empty-hint">Detected in the PDF ({typeLabel(selDetected.type)}). Fill it with the Fill form tool; editing existing field definitions is planned.</div>
          ) : <div className="empty-hint">Select a field to edit its properties.</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <Button style={{ flex: 1, justifyContent: 'center' }} onClick={() => { save(); actions.setTool('Fill form'); }}>Preview form</Button>
            <Button variant="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={save}>Save fields</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
