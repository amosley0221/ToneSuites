import { useState } from 'react';
import { Button, Dialog, DialogNav, FormRow, Select } from '@/ui';
import { CANVAS_PRESETS, clampDim, formatBytes, fromPx, rgbaBytes, toPx, type Unit } from '../engine/geometry';
import type { BackgroundFill } from '../engine/ops';
import { Check, ColorSwatch, NumField } from '../editor/ui';

export interface NewCanvasResult { width: number; height: number; ppi: number; background: BackgroundFill; bgColor: string; name: string }

const UNITS: { value: Unit; label: string }[] = [{ value: 'px', label: 'Pixels' }, { value: 'in', label: 'Inches' }, { value: 'cm', label: 'Centimeters' }];

export function NewCanvasDialog({ onDone }: { onDone: (r: NewCanvasResult | null) => void }) {
  const [preset, setPreset] = useState('custom');
  const [unit, setUnit] = useState<Unit>('px');
  const [wPx, setWPx] = useState(1920);
  const [hPx, setHPx] = useState(1080);
  const [ppi, setPpi] = useState(72);
  const [bg, setBg] = useState<BackgroundFill>('white');
  const [bgColor, setBgColor] = useState('#FFFFFF');
  const [name, setName] = useState('Untitled');

  const choose = (id: string) => {
    setPreset(id);
    const p = CANVAS_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setUnit(p.unit);
    setPpi(p.ppi);
    setWPx(toPx(p.w, p.unit, p.ppi));
    setHPx(toPx(p.h, p.unit, p.ppi));
  };
  const w = fromPx(wPx, unit, ppi), h = fromPx(hPx, unit, ppi);
  const step = unit === 'px' ? 1 : 0.01;
  const create = () => onDone({ width: clampDim(wPx), height: clampDim(hPx), ppi, background: bg, bgColor, name: name.trim() || 'Untitled' });

  return (
    <Dialog title="New canvas" subtitle="Pixel" width={760} height={500} onClose={() => onDone(null)}
      footer={<>
        <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{wPx} × {hPx} px · {formatBytes(rgbaBytes(wPx, hPx))} · RGB/8</span>
        <span style={{ flex: 1 }} />
        <Button onClick={() => onDone(null)}>Cancel</Button>
        <Button variant="primary" onClick={create}>Create</Button>
      </>}>
      <DialogNav width={240} value={preset} onChange={choose}
        items={[{ value: 'custom', label: 'Custom' }, ...CANVAS_PRESETS.map((p) => ({ value: p.id, label: p.label, hint: p.hint }))]} />
      <div style={{ flex: 1, padding: '18px 22px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}
        onKeyDown={(e) => { if (e.key === 'Enter') create(); }}>
        <FormRow label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
            style={{ width: 220, padding: '5px 8px', background: 'var(--bg0)', border: '1px solid var(--line)', color: 'var(--ink)', font: 'var(--type-small)', outline: 'none' }} />
        </FormRow>
        <FormRow label="Width">
          <NumField value={w} step={step} min={step} onChange={(v) => { setPreset('custom'); setWPx(clampDim(toPx(v, unit, ppi))); }} width={90} />
          <Select value={unit} options={UNITS} onChange={setUnit} width={120} />
        </FormRow>
        <FormRow label="Height">
          <NumField value={h} step={step} min={step} onChange={(v) => { setPreset('custom'); setHPx(clampDim(toPx(v, unit, ppi))); }} width={90} />
          <span style={{ width: 120, font: 'var(--type-mono)', color: 'var(--mute)' }}>{unit}</span>
        </FormRow>
        <FormRow label="Resolution">
          <NumField value={ppi} min={1} max={2400} onChange={(v) => {
            // physical units keep their size; pixel dimensions follow
            if (unit !== 'px') { setWPx(clampDim(toPx(w, unit, v))); setHPx(clampDim(toPx(h, unit, v))); }
            setPpi(v);
          }} width={90} />
          <span style={{ width: 120, font: 'var(--type-mono)', color: 'var(--mute)' }}>px/in</span>
        </FormRow>
        <FormRow label="Color mode">
          <Select value="rgb8" width={216} onChange={() => {}} options={[{ value: 'rgb8', label: 'RGB color · 8 bit' }]} />
        </FormRow>
        <div style={{ font: 'var(--type-small)', color: 'var(--mute)', textAlign: 'right', marginTop: -2 }}>16/32-bit, Grayscale and CMYK are on the roadmap</div>
        <FormRow label="Background">
          <Select<BackgroundFill> value={bg} width={160} onChange={setBg}
            options={[{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'transparent', label: 'Transparent' }, { value: 'background', label: 'Background color' }]} />
          {bg === 'background' ? <ColorSwatch value={bgColor} onChange={setBgColor} size={26} /> : <span style={{ width: 26 }} />}
        </FormRow>
        <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
          <Check on={wPx >= hPx} onChange={() => { setWPx(hPx); setHPx(wPx); setPreset('custom'); }} label={wPx >= hPx ? 'Landscape' : 'Portrait'} title="Swap width and height" />
        </div>
      </div>
    </Dialog>
  );
}
