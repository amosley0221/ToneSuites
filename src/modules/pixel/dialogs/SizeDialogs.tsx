import { useState } from 'react';
import { Button, Dialog, FormRow, Select } from '@/ui';
import type { PixelDoc } from '../engine/doc';
import { clampDim, constrainSize, formatBytes, fromPx, rgbaBytes, toPx, type Unit } from '../engine/geometry';
import { canvasSize, imageSize } from '../engine/ops';
import { Check, ColorSwatch, Label, NumField, useEnterKey } from '../editor/ui';

const UNITS: { value: Unit; label: string }[] = [{ value: 'px', label: 'px' }, { value: 'in', label: 'in' }, { value: 'cm', label: 'cm' }, { value: 'mm', label: 'mm' }];

export function ImageSizeDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [ppi, setPpi] = useState(doc.ppi);
  const [unit, setUnit] = useState<Unit>('px');
  const [link, setLink] = useState(true);
  const [resample, setResample] = useState(true);
  const [method, setMethod] = useState<'smooth' | 'nearest'>('smooth');
  const step = unit === 'px' ? 1 : 0.01;
  const setDim = (which: 'w' | 'h', v: number) => {
    const px = clampDim(toPx(v, unit, ppi));
    if (link) { const r = constrainSize(doc.width, doc.height, which, px); setW(r.w); setH(r.h); }
    else if (which === 'w') setW(px); else setH(px);
  };
  const setRes = (v: number) => {
    if (!resample) {
      // keep pixels, change print size
      setPpi(v);
      return;
    }
    if (unit !== 'px') { setW(clampDim(toPx(fromPx(w, unit, ppi), unit, v))); setH(clampDim(toPx(fromPx(h, unit, ppi), unit, v))); }
    setPpi(v);
  };
  const ok = () => { imageSize(doc, resample ? w : doc.width, resample ? h : doc.height, ppi, method); onClose(); };
  useEnterKey(ok);
  return (
    <Dialog title="Image size" subtitle={`${doc.width} × ${doc.height} px`} width={720} height={400} onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={ok}>OK</Button></>}>
      <div style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--type-small)' }}>
        <FormRow label="Image size"><span style={{ font: 'var(--type-mono)' }}>{formatBytes(rgbaBytes(doc.width, doc.height))} → {formatBytes(rgbaBytes(w, h))}</span></FormRow>
        <FormRow label="Width">
          <NumField value={fromPx(w, unit, ppi)} step={step} min={step} onChange={(v) => setDim('w', v)} width={90} />
          <Select value={unit} options={UNITS} onChange={setUnit} width={70} />
        </FormRow>
        <FormRow label="Height">
          <NumField value={fromPx(h, unit, ppi)} step={step} min={step} onChange={(v) => setDim('h', v)} width={90} />
          <span style={{ width: 70, font: 'var(--type-mono)', color: 'var(--mute)' }}>{unit}</span>
        </FormRow>
        <FormRow label="Resolution"><NumField value={ppi} min={1} max={2400} onChange={setRes} width={90} /><span style={{ width: 70, font: 'var(--type-mono)', color: 'var(--mute)' }}>px/in</span></FormRow>
        <div style={{ display: 'flex', gap: 18, padding: '10px 0' }}>
          <Check on={link} onChange={setLink} label="Constrain proportions (linked)" />
          <Check on={resample} onChange={setResample} label="Resample" />
        </div>
        <FormRow label="Method">
          <Select value={method} width={220} onChange={setMethod} options={[{ value: 'smooth', label: 'Bicubic (smooth)' }, { value: 'nearest', label: 'Nearest neighbour (hard edges)' }]} />
        </FormRow>
      </div>
    </Dialog>
  );
}

export function CanvasSizeDialog({ doc, onClose }: { doc: PixelDoc; onClose: () => void }) {
  const [unit, setUnit] = useState<Unit>('px');
  const [relative, setRelative] = useState(false);
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [anchor, setAnchor] = useState(4);
  const [ext, setExt] = useState<'transparent' | 'white' | 'black' | 'background' | 'foreground' | 'other'>('transparent');
  const [other, setOther] = useState('#808080');
  const step = unit === 'px' ? 1 : 0.01;
  const shown = (px: number, base: number) => fromPx(relative ? px - base : px, unit, doc.ppi);
  const set = (which: 'w' | 'h', v: number) => {
    const px = toPx(v, unit, doc.ppi) + (relative ? (which === 'w' ? doc.width : doc.height) : 0);
    if (which === 'w') setW(clampDim(px)); else setH(clampDim(px));
  };
  const color = ext === 'transparent' ? null : ext === 'white' ? '#FFFFFF' : ext === 'black' ? '#000000' : ext === 'background' ? doc.ui.bg : ext === 'foreground' ? doc.ui.fg : other;
  const ok = () => { canvasSize(doc, w, h, anchor, color); onClose(); };
  useEnterKey(ok);
  return (
    <Dialog title="Canvas size" subtitle={`${doc.width} × ${doc.height} px`} width={720} height={440} onClose={onClose}
      footer={<><span style={{ flex: 1 }} /><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={ok}>OK</Button></>}>
      <div style={{ flex: 1, padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 4, font: 'var(--type-small)' }}>
        <div style={{ color: 'var(--mute)', font: 'var(--type-mono)', paddingBottom: 8 }}>Current: {doc.width} × {doc.height} px · {formatBytes(rgbaBytes(doc.width, doc.height))}</div>
        <FormRow label="Width"><NumField value={shown(w, doc.width)} step={step} onChange={(v) => set('w', v)} width={90} /><Select value={unit} options={UNITS} onChange={setUnit} width={70} /></FormRow>
        <FormRow label="Height"><NumField value={shown(h, doc.height)} step={step} onChange={(v) => set('h', v)} width={90} /><span style={{ width: 70, font: 'var(--type-mono)', color: 'var(--mute)' }}>{unit}</span></FormRow>
        <div style={{ padding: '6px 0' }}><Check on={relative} onChange={setRelative} label="Relative" /></div>
        <FormRow label="Canvas extension color">
          <Select value={ext} width={150} onChange={setExt} options={[
            { value: 'transparent', label: 'Transparent' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' },
            { value: 'foreground', label: 'Foreground' }, { value: 'background', label: 'Background' }, { value: 'other', label: 'Other…' }]} />
          {ext === 'other' && <ColorSwatch value={other} onChange={setOther} size={26} />}
        </FormRow>
        <div style={{ color: 'var(--mute)' }}>The extension color fills new area on the bottom pixel layer.</div>
      </div>
      <div style={{ width: 220, borderLeft: '1px solid var(--line)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Label>Anchor</Label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 32px)', gap: 4 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} onClick={() => setAnchor(i)} className={i === anchor ? '' : 'hov-border'}
              style={{ width: 32, height: 32, border: '1px solid var(--line)', background: i === anchor ? 'var(--accent)' : 'var(--bg0)', cursor: 'pointer' }} />
          ))}
        </div>
        <div style={{ marginTop: 10, color: 'var(--mute)', font: 'var(--type-mono)' }}>New: {w} × {h} px</div>
      </div>
    </Dialog>
  );
}
