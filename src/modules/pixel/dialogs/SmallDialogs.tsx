import { useEffect, useMemo, useState } from 'react';
import { Button, Dialog, FormRow, Segmented, Select, Slider } from '@/ui';
import { composite } from '../engine/composite';
import { getImg, maskToCanvas } from '../engine/canvas';
import type { PixelDoc } from '../engine/doc';
import { colorRange, combine, isEmpty, toneRange, type CombineOp } from '../engine/mask';
import { hexToRgb } from '../engine/img';
import { fillWith, loadSelectionChannel, strokeSelection } from '../engine/ops';
import { CanvasThumb, Check, ColorSwatch, NumField, useEnterKey } from '../editor/ui';

function Footer({ onCancel, onOk, okLabel = 'OK', disabled }: { onCancel: () => void; onOk: () => void; okLabel?: string; disabled?: boolean }) {
  return <><span style={{ flex: 1 }} /><Button onClick={onCancel}>Cancel</Button><Button variant="primary" onClick={onOk} disabled={disabled}>{okLabel}</Button></>;
}

const body = { flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column' as const, gap: 6, font: 'var(--type-small)', overflow: 'auto' as const };

export function PromptDialog({ title, subtitle, label, initial, onOk, onClose, kind = 'text', min, max, step, unit }: {
  title: string; subtitle?: string; label: string; initial: string | number; onOk: (v: string) => void; onClose: () => void;
  kind?: 'text' | 'number'; min?: number; max?: number; step?: number; unit?: string;
}) {
  const [v, setV] = useState(String(initial));
  const ok = () => { onOk(v); onClose(); };
  useEnterKey(ok);
  return (
    <Dialog title={title} subtitle={subtitle} width={440} height="auto" onClose={onClose} footer={<Footer onCancel={onClose} onOk={ok} />}>
      <div style={body}>
        <FormRow label={label}>
          {kind === 'number'
            ? <NumField value={Number(v) || 0} min={min} max={max} step={step} unit={unit} onChange={(n) => setV(String(n))} width={100} />
            : <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
              style={{ width: 240, padding: '5px 8px', background: 'var(--bg0)', border: '1px solid var(--line)', color: 'var(--ink)', outline: 'none', font: 'var(--type-small)' }} />}
        </FormRow>
      </div>
    </Dialog>
  );
}

type FillContent = 'foreground' | 'background' | 'color' | 'black' | 'white' | 'gray';
export function FillDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [content, setContent] = useState<FillContent>('foreground');
  const [color, setColor] = useState(doc.ui.fg);
  const [opacity, setOpacity] = useState(100);
  const [mode, setMode] = useState<GlobalCompositeOperation>('source-over');
  const [err, setErr] = useState<string | null>(null);
  const resolve = () => ({ foreground: doc.ui.fg, background: doc.ui.bg, color, black: '#000000', white: '#FFFFFF', gray: '#808080' }[content]);
  const ok = () => { try { fillWith(doc, resolve(), opacity / 100, mode); onClose(); } catch (e) { setErr((e as Error).message); } };
  useEnterKey(ok);
  return (
    <Dialog title="Fill" subtitle={doc.selection ? 'Selection' : 'Whole layer'} width={480} height="auto" onClose={onClose} footer={<Footer onCancel={onClose} onOk={ok} />}>
      <div style={body}>
        <FormRow label="Contents">
          <Select<FillContent> value={content} width={180} onChange={setContent} options={[
            { value: 'foreground', label: 'Foreground color' }, { value: 'background', label: 'Background color' }, { value: 'color', label: 'Color…' },
            { value: 'black', label: 'Black' }, { value: 'white', label: 'White' }, { value: 'gray', label: '50% gray' }]} />
          {content === 'color' ? <ColorSwatch value={color} onChange={setColor} size={26} /> : <span style={{ width: 26, height: 26, background: resolve(), border: '1px solid var(--line)' }} />}
        </FormRow>
        <FormRow label="Mode">
          <Select<GlobalCompositeOperation> value={mode} width={180} onChange={setMode} options={[
            { value: 'source-over', label: 'Normal' }, { value: 'multiply', label: 'Multiply' }, { value: 'screen', label: 'Screen' }, { value: 'overlay', label: 'Overlay' },
            { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosity' }, { value: 'source-atop', label: 'Preserve transparency' }]} />
        </FormRow>
        <Slider label="Opacity" value={opacity} min={1} max={100} display={`${opacity}%`} onChange={setOpacity} />
        <div style={{ color: 'var(--mute)', display: 'flex', gap: 6 }}>Content-aware fill is on the roadmap.</div>
        {err && <div style={{ color: 'var(--negative)' }}>{err}</div>}
      </div>
    </Dialog>
  );
}

export function StrokeDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [width, setWidth] = useState(4);
  const [color, setColor] = useState(doc.ui.fg);
  const [loc, setLoc] = useState<'Inside' | 'Center' | 'Outside'>('Center');
  const [opacity, setOpacity] = useState(100);
  const [err, setErr] = useState<string | null>(null);
  const ok = () => { try { strokeSelection(doc, width, color, loc.toLowerCase() as 'inside', opacity / 100); onClose(); } catch (e) { setErr((e as Error).message); } };
  useEnterKey(ok);
  return (
    <Dialog title="Stroke" subtitle="Selection" width={460} height="auto" onClose={onClose} footer={<Footer onCancel={onClose} onOk={ok} />}>
      <div style={body}>
        <FormRow label="Width"><NumField value={width} min={1} max={250} unit="px" onChange={setWidth} width={80} /></FormRow>
        <FormRow label="Color"><ColorSwatch value={color} onChange={setColor} size={26} /></FormRow>
        <FormRow label="Location"><Segmented value={loc} options={['Inside', 'Center', 'Outside'] as const} onChange={setLoc} /></FormRow>
        <Slider label="Opacity" value={opacity} min={1} max={100} display={`${opacity}%`} onChange={setOpacity} />
        {err && <div style={{ color: 'var(--negative)' }}>{err}</div>}
      </div>
    </Dialog>
  );
}

type RangeSel = 'sampled' | 'highlights' | 'midtones' | 'shadows';
export function ColorRangeDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [what, setWhat] = useState<RangeSel>('sampled');
  const [color, setColor] = useState(doc.ui.fg);
  const [fuzz, setFuzz] = useState(40);
  const [op, setOp] = useState<CombineOp>('replace');
  const img = useMemo(() => getImg(composite(doc)), [doc]);
  const mask = useMemo(() => what === 'sampled' ? colorRange(img, hexToRgb(color), fuzz * 2.55) : toneRange(img, what), [img, what, color, fuzz]);
  const [v, setV] = useState(0);
  useEffect(() => setV((n) => n + 1), [mask]);
  const ok = () => {
    const m = combine(doc.selection, mask, op);
    doc.setSelection(isEmpty(m) ? null : m);
    doc.commit('Color range');
    onClose();
  };
  useEnterKey(ok);
  return (
    <Dialog title="Color range" subtitle="Composite image" width={680} height="auto" onClose={onClose} footer={<Footer onCancel={onClose} onOk={ok} />}>
      <div style={body}>
        <FormRow label="Select">
          <Select<RangeSel> value={what} width={180} onChange={setWhat} options={[{ value: 'sampled', label: 'Sampled color' }, { value: 'highlights', label: 'Highlights' }, { value: 'midtones', label: 'Midtones' }, { value: 'shadows', label: 'Shadows' }]} />
        </FormRow>
        {what === 'sampled' && <FormRow label="Color"><ColorSwatch value={color} onChange={setColor} size={26} /><span style={{ color: 'var(--mute)' }}>Tip: pick it first with the eyedropper (I)</span></FormRow>}
        {what === 'sampled' && <Slider label="Fuzziness" value={fuzz} min={0} max={100} onChange={setFuzz} />}
        <FormRow label="Combine with selection">
          <Select<CombineOp> value={op} width={160} onChange={setOp} options={[{ value: 'replace', label: 'Replace' }, { value: 'add', label: 'Add' }, { value: 'subtract', label: 'Subtract' }, { value: 'intersect', label: 'Intersect' }]} />
        </FormRow>
        <div style={{ color: 'var(--mute)' }}>Localized clusters, skin tones and out-of-gamut ranges are on the roadmap.</div>
      </div>
      <div style={{ width: 260, borderLeft: '1px solid var(--line)', padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CanvasThumb source={() => maskPreviewCanvas(mask)} width={228} height={200} checker={false} version={v} />
      </div>
    </Dialog>
  );
}

function maskPreviewCanvas(m: { w: number; h: number; data: Uint8Array }) {
  const c = maskToCanvas(m);
  const x = c.getContext('2d')!;
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = '#fff';
  x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-over';
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, c.height);
  return c;
}

export function TrimDialog({ onOk, onClose }: { onOk: (b: 'transparent' | 'topLeft' | 'bottomRight') => void; onClose: () => void }) {
  const [b, setB] = useState<'transparent' | 'topLeft' | 'bottomRight'>('transparent');
  const ok = () => { onOk(b); onClose(); };
  useEnterKey(ok);
  return (
    <Dialog title="Trim" subtitle="Based on" width={420} height="auto" onClose={onClose} footer={<Footer onCancel={onClose} onOk={ok} />}>
      <div style={{ ...body, gap: 10 }}>
        <Check on={b === 'transparent'} onChange={() => setB('transparent')} label="Transparent pixels" />
        <Check on={b === 'topLeft'} onChange={() => setB('topLeft')} label="Top left pixel color" />
        <Check on={b === 'bottomRight'} onChange={() => setB('bottomRight')} label="Bottom right pixel color" />
      </div>
    </Dialog>
  );
}

export function LoadSelectionDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [id, setId] = useState(doc.channels[0]?.id ?? '');
  const [op, setOp] = useState<CombineOp>('replace');
  const ok = () => { if (id) loadSelectionChannel(doc, id, op); onClose(); };
  useEnterKey(ok);
  return (
    <Dialog title="Load selection" subtitle="Alpha channels" width={460} height="auto" onClose={onClose} footer={<Footer onCancel={onClose} onOk={ok} disabled={!id} />}>
      <div style={body}>
        {doc.channels.length === 0 ? <div style={{ color: 'var(--mute)' }}>No saved selections yet. Use Select › Save selection… first.</div> : <>
          <FormRow label="Channel"><Select value={id} width={200} onChange={setId} options={doc.channels.map((c) => ({ value: c.id, label: c.name }))} /></FormRow>
          <FormRow label="Operation"><Select<CombineOp> value={op} width={200} onChange={setOp} options={[{ value: 'replace', label: 'New selection' }, { value: 'add', label: 'Add to selection' }, { value: 'subtract', label: 'Subtract from selection' }, { value: 'intersect', label: 'Intersect with selection' }]} /></FormRow>
        </>}
      </div>
    </Dialog>
  );
}

export function NewGuideDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [axis, setAxis] = useState<'Horizontal' | 'Vertical'>('Vertical');
  const [pos, setPos] = useState(Math.round(doc.width / 2));
  const ok = () => {
    doc.guides = [...doc.guides, { axis: axis === 'Vertical' ? 'v' : 'h', pos }];
    doc.ui.showGuides = true;
    doc.commit('New guide');
    onClose();
  };
  useEnterKey(ok);
  return (
    <Dialog title="New guide" width={420} height="auto" onClose={onClose} footer={<Footer onCancel={onClose} onOk={ok} />}>
      <div style={body}>
        <FormRow label="Orientation"><Segmented value={axis} options={['Horizontal', 'Vertical'] as const} onChange={setAxis} /></FormRow>
        <FormRow label="Position"><NumField value={pos} unit="px" onChange={setPos} width={90} /></FormRow>
      </div>
    </Dialog>
  );
}
