import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Segmented, Slider } from '@/ui';
import { ADJUST_NAMES, applyAdjust, CURVE_PRESETS, curveLut, type AdjustSpec, type CurvePoints } from '../engine/adjust';
import { composite } from '../engine/composite';
import { getImg, maskToCanvas } from '../engine/canvas';
import type { Layer, PixelDoc } from '../engine/doc';
import { histogram } from '../engine/img';
import { addAdjustmentLayer, applyAdjustDestructive, clearPreview, previewPixels } from '../engine/ops';
import { Check, ColorSwatch, Label, useEnterKey } from '../editor/ui';

type Mode = 'pixels' | 'newLayer' | 'editLayer';

/**
 * Adjustment dialog. `pixels` applies destructively to the active layer (with "Apply as layer" as an alternative),
 * `newLayer` creates an adjustment layer, `editLayer` edits an existing one (Layer content options).
 */
export function AdjustDialog({ doc, initial, mode, layer, onClose }: { doc: PixelDoc; initial: AdjustSpec; mode: Mode; layer?: Layer; onClose: () => void }) {
  const [spec, setSpec] = useState<AdjustSpec>(initial);
  const [preview, setPreview] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const title = ADJUST_NAMES[spec.type];
  // New adjustment layers are inserted right away (uncommitted) so the preview is the real composite.
  const newLayer = useRef<Layer | null>(null);
  // The dialog host may re-render us with a fresh `initial` object; only the first one counts.
  const init = useRef(initial).current;
  useEffect(() => {
    if (mode !== 'newLayer') return;
    const l = doc.makeLayer('adjustment', ADJUST_NAMES[init.type], { adjust: init });
    if (doc.selection) l.mask = { canvas: maskToCanvas(doc.selection), x: 0, y: 0, enabled: true };
    doc.addLayer(l);
    newLayer.current = l;
    doc.touch();
    return () => {
      // StrictMode re-mounts / closing without OK: drop the uncommitted layer
      if (newLayer.current === l && doc.layer(l.id) && doc.history[doc.histIndex]?.state.layers.every((x) => x.id !== l.id)) {
        doc.removeLayer(l.id);
        doc.touch();
      }
      if (newLayer.current === l) newLayer.current = null;
    };
  }, [doc, mode, init]);

  useEffect(() => {
    if (!preview) { clearPreview(doc); if (newLayer.current) { newLayer.current.visible = false; doc.repaint(); } return; }
    const t = setTimeout(() => {
      try {
        if (mode === 'pixels') previewPixels(doc, (img) => applyAdjust(img, spec), 0);
        else if (mode === 'editLayer' && layer) { doc.adjustOverride = { layerId: layer.id, spec }; doc.repaint(); }
        else if (newLayer.current) { newLayer.current.adjust = spec; newLayer.current.visible = true; doc.repaint(); }
        setError(null);
      } catch (e) { setError((e as Error).message); }
    }, 40);
    return () => clearTimeout(t);
  }, [doc, spec, preview, mode, layer]);

  const cancel = () => {
    clearPreview(doc);
    if (newLayer.current) { doc.removeLayer(newLayer.current.id); newLayer.current = null; doc.touch(); }
    onClose();
  };
  const ok = () => {
    try {
      clearPreview(doc);
      if (mode === 'pixels') applyAdjustDestructive(doc, spec);
      else if (mode === 'editLayer' && layer) { layer.adjust = spec; doc.commit(`Edit ${title}`); }
      else if (newLayer.current) { newLayer.current.adjust = spec; newLayer.current.visible = true; doc.commit(`New ${title} layer`); }
      onClose();
    } catch (e) { setError((e as Error).message); }
  };
  useEnterKey(ok, !error);
  const asLayer = () => { clearPreview(doc); addAdjustmentLayer(doc, spec); onClose(); };
  const target = mode === 'pixels' ? `Layer: ${doc.active?.name ?? '—'}` : 'Adjustment layer';

  return (
    <Dialog title={title} subtitle={target} width={spec.type === 'curves' || spec.type === 'levels' ? 720 : 560} height={spec.type === 'curves' ? 480 : 'auto'} onClose={cancel}>
      {/* wraps to one column on narrow (phone) screens */}
      <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', overflow: 'auto', minWidth: 0 }}>
      <div style={{ flex: '1 1 300px', minWidth: 0, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, font: 'var(--type-small)' }}>
        <Controls doc={doc} spec={spec} set={setSpec} />
      </div>
      <div style={{ flex: '1 0 220px', maxWidth: '100%', borderLeft: '1px solid var(--line)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {spec.type === 'curves' && (
          <div>
            <Label>Presets</Label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
              {Object.entries(CURVE_PRESETS).map(([n, pts]) => (
                <div key={n} className="hov-row" onClick={() => setSpec({ ...spec, rgb: pts.map((p) => [...p] as [number, number]) })}
                  style={{ padding: '5px 8px', cursor: 'pointer', font: 'var(--type-small)' }}>{n}</div>
              ))}
            </div>
          </div>
        )}
        <Check on={preview} onChange={setPreview} label="Preview" />
        {error && <div style={{ color: 'var(--negative)', font: 'var(--type-small)' }}>{error}</div>}
        <div style={{ flex: 1 }} />
        <Button onClick={cancel} style={{ justifyContent: 'center' }}>Cancel</Button>
        {mode === 'pixels' && <Button onClick={asLayer} style={{ justifyContent: 'center' }}>Apply as layer</Button>}
        <Button variant="primary" onClick={ok} disabled={!!error} style={{ justifyContent: 'center' }}>{mode === 'pixels' ? 'Apply' : 'OK'}</Button>
      </div>
      </div>
    </Dialog>
  );
}

function Controls({ doc, spec, set }: { doc: PixelDoc; spec: AdjustSpec; set: (s: AdjustSpec) => void }) {
  const S = (label: string, key: string, min: number, max: number, step = 1, unit = '') => (
    <Slider key={key} label={label} min={min} max={max} step={step} value={(spec as any)[key]} display={`${(spec as any)[key]}${unit}`}
      onChange={(v) => set({ ...spec, [key]: v } as AdjustSpec)} />
  );
  switch (spec.type) {
    case 'brightnessContrast': return <>{S('Brightness', 'brightness', -150, 150)}{S('Contrast', 'contrast', -50, 100)}</>;
    case 'exposure': return <>{S('Exposure', 'exposure', -5, 5, 0.01)}{S('Offset', 'offset', -0.5, 0.5, 0.001)}{S('Gamma correction', 'gamma', 0.1, 3, 0.01)}</>;
    case 'vibrance': return <>{S('Vibrance', 'vibrance', -100, 100)}{S('Saturation', 'saturation', -100, 100)}</>;
    case 'hueSaturation': return <>{S('Hue', 'hue', -180, 180, 1, '°')}{S('Saturation', 'saturation', -100, 100)}{S('Lightness', 'lightness', -100, 100)}
      <Check on={!!spec.colorize} onChange={(v) => set({ ...spec, colorize: v ? 1 : 0 })} label="Colorize" /></>;
    case 'blackWhite': return <>{S('Reds', 'reds', -200, 300, 1, '%')}{S('Yellows', 'yellows', -200, 300, 1, '%')}{S('Greens', 'greens', -200, 300, 1, '%')}{S('Cyans', 'cyans', -200, 300, 1, '%')}{S('Blues', 'blues', -200, 300, 1, '%')}{S('Magentas', 'magentas', -200, 300, 1, '%')}</>;
    case 'photoFilter': return <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: 'var(--mute)' }}>Filter color</span><ColorSwatch value={spec.color} onChange={(c) => set({ ...spec, color: c })} size={26} /></div>
      {S('Density', 'density', 0, 100, 1, '%')}
      <Check on={!!spec.preserveLum} onChange={(v) => set({ ...spec, preserveLum: v ? 1 : 0 })} label="Preserve luminosity" /></>;
    case 'posterize': return S('Levels', 'levels', 2, 255);
    case 'threshold': return S('Threshold level', 'level', 1, 255);
    case 'gradientMap': return <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <ColorSwatch value={spec.from} onChange={(c) => set({ ...spec, from: c })} size={26} />
        <div style={{ flex: 1, height: 26, border: '1px solid var(--line)', background: `linear-gradient(to right, ${spec.reverse ? spec.to : spec.from}, ${spec.reverse ? spec.from : spec.to})` }} />
        <ColorSwatch value={spec.to} onChange={(c) => set({ ...spec, to: c })} size={26} />
      </div>
      <Check on={!!spec.reverse} onChange={(v) => set({ ...spec, reverse: v ? 1 : 0 })} label="Reverse" /></>;
    case 'invert': case 'desaturate': return <div style={{ color: 'var(--mute)' }}>No settings.</div>;
    case 'basic': return <>{S('Exposure', 'exposure', -4, 4, 0.05)}{S('Contrast', 'contrast', -100, 100)}{S('Highlights', 'highlights', -100, 100)}{S('Shadows', 'shadows', -100, 100)}{S('Saturation', 'saturation', -100, 100)}{S('Temperature', 'temperature', -100, 100)}{S('Clarity', 'clarity', -100, 100)}</>;
    case 'colorBalance': return <ColorBalance spec={spec} set={set} />;
    case 'channelMixer': return <ChannelMixer spec={spec} set={set} />;
    case 'levels': return <Levels doc={doc} spec={spec} set={set} />;
    case 'curves': return <Curves doc={doc} spec={spec} set={set} />;
  }
}

function ColorBalance({ spec, set }: { spec: Extract<AdjustSpec, { type: 'colorBalance' }>; set: (s: AdjustSpec) => void }) {
  const [tone, setTone] = useState<'Shadows' | 'Midtones' | 'Highlights'>('Midtones');
  const key = tone.toLowerCase() as 'shadows' | 'midtones' | 'highlights';
  const v = spec[key];
  const upd = (i: number, x: number) => { const n = [...v] as [number, number, number]; n[i] = x; set({ ...spec, [key]: n }); };
  return <>
    <Segmented value={tone} options={['Shadows', 'Midtones', 'Highlights'] as const} onChange={setTone} />
    <Slider label="Cyan ↔ Red" min={-100} max={100} value={v[0]} onChange={(x) => upd(0, x)} />
    <Slider label="Magenta ↔ Green" min={-100} max={100} value={v[1]} onChange={(x) => upd(1, x)} />
    <Slider label="Yellow ↔ Blue" min={-100} max={100} value={v[2]} onChange={(x) => upd(2, x)} />
    <Check on={!!spec.preserveLum} onChange={(b) => set({ ...spec, preserveLum: b ? 1 : 0 })} label="Preserve luminosity" />
  </>;
}

function ChannelMixer({ spec, set }: { spec: Extract<AdjustSpec, { type: 'channelMixer' }>; set: (s: AdjustSpec) => void }) {
  const [ch, setCh] = useState<'Red' | 'Green' | 'Blue'>('Red');
  const key = ch === 'Red' ? 'r' : ch === 'Green' ? 'g' : 'b';
  const v = spec[key];
  const upd = (i: number, x: number) => { const n = [...v] as [number, number, number, number]; n[i] = x; set({ ...spec, [key]: n }); };
  return <>
    <Segmented value={ch} options={['Red', 'Green', 'Blue'] as const} onChange={setCh} />
    {['Red', 'Green', 'Blue', 'Constant'].map((n, i) => <Slider key={n} label={n} min={-200} max={200} value={v[i]} display={`${v[i]}%`} onChange={(x) => upd(i, x)} />)}
    <Check on={!!spec.mono} onChange={(b) => set({ ...spec, mono: b ? 1 : 0 })} label="Monochrome" />
  </>;
}

function useHistogram(doc: PixelDoc) {
  return useMemo(() => {
    const l = doc.active;
    const src = l?.canvas && l.kind === 'pixel' ? doc.layerDocCanvas(l) : composite(doc);
    return histogram(getImg(src));
  }, [doc]);
}

function HistogramSvg({ data, height = 120 }: { data: Uint32Array; height?: number }) {
  let max = 1;
  for (let i = 0; i < 256; i++) max = Math.max(max, data[i]);
  const path = Array.from(data).map((v, i) => `L${i} ${height - (Math.sqrt(v) / Math.sqrt(max)) * height}`).join(' ');
  return (
    <svg viewBox={`0 0 255 ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block', background: 'var(--bg0)', border: '1px solid var(--line)' }}>
      <path d={`M0 ${height} ${path} L255 ${height} Z`} fill="var(--mute)" opacity={0.6} />
    </svg>
  );
}

function Levels({ doc, spec, set }: { doc: PixelDoc; spec: Extract<AdjustSpec, { type: 'levels' }>; set: (s: AdjustSpec) => void }) {
  const h = useHistogram(doc);
  return <>
    <HistogramSvg data={h.l} />
    <Slider label="Input shadows" min={0} max={253} value={spec.inBlack} onChange={(v) => set({ ...spec, inBlack: Math.min(v, spec.inWhite - 2) })} />
    <Slider label="Midtones (gamma)" min={0.1} max={9.99} step={0.01} value={spec.gamma} onChange={(v) => set({ ...spec, gamma: v })} />
    <Slider label="Input highlights" min={2} max={255} value={spec.inWhite} onChange={(v) => set({ ...spec, inWhite: Math.max(v, spec.inBlack + 2) })} />
    <Slider label="Output shadows" min={0} max={255} value={spec.outBlack} onChange={(v) => set({ ...spec, outBlack: v })} />
    <Slider label="Output highlights" min={0} max={255} value={spec.outWhite} onChange={(v) => set({ ...spec, outWhite: v })} />
  </>;
}

function Curves({ doc, spec, set }: { doc: PixelDoc; spec: Extract<AdjustSpec, { type: 'curves' }>; set: (s: AdjustSpec) => void }) {
  const [ch, setCh] = useState<'rgb' | 'r' | 'g' | 'b'>('rgb');
  const [sel, setSel] = useState(1);
  const [showHist, setShowHist] = useState(true);
  const svg = useRef<SVGSVGElement>(null);
  const h = useHistogram(doc);
  const pts = spec[ch];
  const lut = curveLut(pts);
  const color = ch === 'rgb' ? 'var(--accent)' : ch === 'r' ? '#e5484d' : ch === 'g' ? '#2fb98a' : '#4f8ff7';
  const toPt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect();
    return [Math.round(((e.clientX - r.left) / r.width) * 255), Math.round((1 - (e.clientY - r.top) / r.height) * 255)];
  };
  const setPts = (p: CurvePoints) => set({ ...spec, [ch]: p });
  const down = (e: React.PointerEvent) => {
    const [x, y] = toPt(e);
    let i = pts.findIndex((p) => Math.abs(p[0] - x) < 8 && Math.abs(p[1] - y) < 12);
    let cur = pts.map((p) => [...p] as [number, number]);
    if (i < 0) { cur.push([x, lut[Math.max(0, Math.min(255, x))]]); cur.sort((a, b) => a[0] - b[0]); i = cur.findIndex((p) => p[0] === x); setPts(cur); }
    setSel(i);
    const idx = i;
    const mv = (ev: PointerEvent) => {
      const [nx, ny] = toPt(ev);
      const out = cur.map((p) => [...p] as [number, number]);
      const lo = idx > 0 ? out[idx - 1][0] + 1 : 0, hi = idx < out.length - 1 ? out[idx + 1][0] - 1 : 255;
      // dragging an inner point far outside removes it
      if (out.length > 2 && idx > 0 && idx < out.length - 1 && (ny < -40 || ny > 295)) { out.splice(idx, 1); setPts(out); cur = out; up(); return; }
      out[idx] = [Math.max(lo, Math.min(hi, nx)), Math.max(0, Math.min(255, ny))];
      cur = out;
      setPts(out);
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const curve = Array.from(lut).map((v, i) => `${i === 0 ? 'M' : 'L'}${(i / 255) * 300} ${300 - (v / 255) * 300}`).join(' ');
  const hist = ch === 'rgb' ? h.l : h[ch];
  let hmax = 1;
  for (let i = 0; i < 256; i++) hmax = Math.max(hmax, hist[i]);
  const sp = pts[Math.min(sel, pts.length - 1)];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Segmented value={ch === 'rgb' ? 'RGB' : ch === 'r' ? 'Red' : ch === 'g' ? 'Green' : 'Blue'} options={['RGB', 'Red', 'Green', 'Blue'] as const}
        onChange={(v) => { setCh(v === 'RGB' ? 'rgb' : v === 'Red' ? 'r' : v === 'Green' ? 'g' : 'b'); setSel(0); }} />
      <svg ref={svg} viewBox="0 0 300 300" onPointerDown={down} style={{ width: '100%', maxWidth: 300, aspectRatio: '1', height: 'auto', background: 'var(--bg0)', border: '1px solid var(--line)', touchAction: 'none', cursor: 'crosshair' }}>
        {[75, 150, 225].map((v) => <g key={v}><line x1={v} y1={0} x2={v} y2={300} stroke="var(--line)" /><line x1={0} y1={v} x2={300} y2={v} stroke="var(--line)" /></g>)}
        {showHist && <path d={`M0 300 ${Array.from(hist).map((v, i) => `L${(i / 255) * 300} ${300 - (Math.sqrt(v) / Math.sqrt(hmax)) * 280}`).join(' ')} L300 300 Z`} fill="var(--mute)" opacity={0.25} />}
        <path d="M0 300 L300 0" stroke="var(--mute)" strokeDasharray="4 4" fill="none" />
        <path d={curve} stroke={color} strokeWidth={2} fill="none" />
        {pts.map((p, i) => <rect key={i} x={(p[0] / 255) * 300 - 4} y={300 - (p[1] / 255) * 300 - 4} width={8} height={8} fill={i === sel ? color : 'var(--bg0)'} stroke={color} />)}
      </svg>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ color: 'var(--mute)', font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)' }}>INPUT</span><span style={{ font: 'var(--type-mono)' }}>{sp?.[0] ?? 0}</span>
        <span style={{ color: 'var(--mute)', font: 'var(--type-eyebrow)', letterSpacing: 'var(--ls-eyebrow)' }}>OUTPUT</span><span style={{ font: 'var(--type-mono)' }}>{sp?.[1] ?? 0}</span>
        <span style={{ flex: 1 }} />
        <Check on={showHist} onChange={setShowHist} label="Show histogram" />
      </div>
      <div style={{ color: 'var(--mute)' }}>Click to add a point · drag a point off the grid to remove it</div>
    </div>
  );
}
