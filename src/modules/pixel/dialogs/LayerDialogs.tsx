import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Select, Slider } from '@/ui';
import { BLEND_MODES, type BlendMode } from '../engine/blend';
import { canvasAlphaToMask, maskToCanvas, newCanvas, ctx2d } from '../engine/canvas';
import { defaultStyles, type Layer, type LayerStyles, type PixelDoc } from '../engine/doc';
import { featherMask, invertMask } from '../engine/mask';
import { applyMask } from '../engine/ops';
import { CanvasThumb, Check, ColorSwatch, Label, Planned } from '../editor/ui';

export function LayerPropsDialog({ doc, layer, onClose }: { doc: PixelDoc; layer: Layer; onClose: () => void }) {
  const orig = useRef({ blend: layer.blend, opacity: layer.opacity, name: layer.name, mask: layer.mask }).current;
  const [blend, setBlend] = useState<BlendMode>(layer.blend);
  const [opacity, setOpacity] = useState(Math.round(layer.opacity * 100));
  const [name, setName] = useState(layer.name);
  const [feather, setFeather] = useState(0);
  const [, force] = useState(0);
  useEffect(() => { layer.blend = blend; layer.opacity = opacity / 100; doc.repaint(); }, [blend, opacity, layer, doc]);
  const cancel = () => { Object.assign(layer, orig); doc.touch(); onClose(); };
  const ok = () => {
    layer.name = name.trim() || layer.name;
    if (feather > 0 && layer.mask) {
      const m = layer.mask;
      const fm = featherMask(canvasAlphaToMask(m.canvas), feather);
      layer.mask = { ...m, canvas: maskToCanvas(fm) };
    }
    doc.commit('Layer properties');
    onClose();
  };
  const invert = () => {
    if (!layer.mask) return;
    layer.mask = { ...layer.mask, canvas: maskToCanvas(invertMask(canvasAlphaToMask(layer.mask.canvas))) };
    doc.repaint(); force((n) => n + 1);
  };
  const toggle = () => { if (!layer.mask) return; layer.mask = { ...layer.mask, enabled: !layer.mask.enabled }; doc.repaint(); force((n) => n + 1); };
  const applyToPixels = () => {
    try { layer.name = name; applyMask(doc); onClose(); } catch (e) { doc.repaint(); alert((e as Error).message); }
  };
  return (
    <Dialog title="Layer properties" subtitle={layer.name} width={760} height={460} onClose={cancel}>
      <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto', font: 'var(--type-small)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: 'var(--mute)', width: 60 }}>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') ok(); }}
            style={{ flex: 1, padding: '5px 8px', background: 'var(--bg0)', border: '1px solid var(--line)', color: 'var(--ink)', outline: 'none', font: 'var(--type-small)' }} />
        </div>
        <div>
          <Label>Blend mode</Label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, marginTop: 8 }}>
            {BLEND_MODES.map((b) => (
              <div key={b.id} onClick={() => setBlend(b.id)} className={b.id === blend ? '' : 'hov-border'}
                style={{ padding: '6px 8px', border: '1px solid var(--line)', cursor: 'pointer', background: b.id === blend ? 'var(--ink)' : 'transparent', color: b.id === blend ? 'var(--bg0)' : 'var(--ink)', fontWeight: b.id === blend ? 700 : 500 }}>{b.label}</div>
            ))}
          </div>
        </div>
        <Slider label="Opacity" value={opacity} min={0} max={100} display={`${opacity}%`} onChange={setOpacity} />
      </div>
      <div style={{ width: 280, borderLeft: '1px solid var(--line)', padding: 18, display: 'flex', flexDirection: 'column', gap: 12, font: 'var(--type-small)' }}>
        <Label>Mask · {layer.name}</Label>
        {layer.mask ? <>
          <div style={{ display: 'flex', gap: 10 }}>
            <CanvasThumb source={() => maskPreview(layer)} width={90} height={64} checker={false} version={layer.mask} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Button size="sm" onClick={invert}>Invert</Button>
              <Button size="sm" onClick={toggle}>{layer.mask.enabled ? 'Disable' : 'Enable'}</Button>
              <Button size="sm" onClick={applyToPixels}>Apply to pixels</Button>
            </div>
          </div>
          <Slider label="Feather" value={feather} min={0} max={100} step={0.5} display={`${feather} px`} onChange={setFeather} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: 'var(--mute)' }}>Density · Refine edge <Planned /></div>
        </> : <div style={{ color: 'var(--mute)' }}>No mask. Add one from Layer › Layer mask or the Mask button in the Layers panel.</div>}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={cancel} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Button>
          <Button variant="primary" onClick={ok} style={{ flex: 1, justifyContent: 'center' }}>OK</Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Mask as visible grayscale for thumbnails. */
export function maskPreview(l: Layer) {
  if (!l.mask) return null;
  const c = newCanvas(l.mask.canvas.width, l.mask.canvas.height);
  const x = ctx2d(c);
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, c.height);
  const t = newCanvas(c.width, c.height);
  const tx = ctx2d(t);
  tx.drawImage(l.mask.canvas, 0, 0);
  tx.globalCompositeOperation = 'source-in';
  tx.fillStyle = '#fff';
  tx.fillRect(0, 0, c.width, c.height);
  x.drawImage(t, 0, 0);
  return c;
}

export const STYLE_EFFECTS: { id: string; name: string; key?: keyof LayerStyles }[] = [
  { id: 'blending', name: 'Blending options' },
  { id: 'bevel', name: 'Bevel & emboss' },
  { id: 'stroke', name: 'Stroke', key: 'stroke' },
  { id: 'innerShadow', name: 'Inner shadow' },
  { id: 'innerGlow', name: 'Inner glow' },
  { id: 'satin', name: 'Satin' },
  { id: 'colorOverlay', name: 'Color overlay', key: 'colorOverlay' },
  { id: 'gradientOverlay', name: 'Gradient overlay' },
  { id: 'patternOverlay', name: 'Pattern overlay' },
  { id: 'outerGlow', name: 'Outer glow', key: 'outerGlow' },
  { id: 'dropShadow', name: 'Drop shadow', key: 'dropShadow' },
];

export function LayerStyleDialog({ doc, layer, initial = 'dropShadow', onClose }: { doc: PixelDoc; layer: Layer; initial?: string; onClose: () => void }) {
  const orig = useRef({ styles: layer.styles ? structuredClone(layer.styles) : null, blend: layer.blend, opacity: layer.opacity }).current;
  const [st, setSt] = useState<LayerStyles>(() => {
    const s = layer.styles ? structuredClone(layer.styles) : defaultStyles();
    const eff = STYLE_EFFECTS.find((e) => e.id === initial);
    if (eff?.key && !layer.styles) s[eff.key].enabled = true;
    else if (eff?.key && layer.styles && !layer.styles[eff.key].enabled) s[eff.key].enabled = true;
    return s;
  });
  const [sel, setSel] = useState(initial);
  const [opacity, setOpacity] = useState(Math.round(layer.opacity * 100));
  const [blend, setBlend] = useState<BlendMode>(layer.blend);
  useEffect(() => { layer.styles = st; layer.opacity = opacity / 100; layer.blend = blend; doc.repaint(); }, [st, opacity, blend, layer, doc]);
  const cancel = () => { layer.styles = orig.styles; layer.blend = orig.blend; layer.opacity = orig.opacity; doc.touch(); onClose(); };
  const ok = () => {
    const any = st.dropShadow.enabled || st.stroke.enabled || st.outerGlow.enabled || st.colorOverlay.enabled;
    layer.styles = any ? st : null;
    doc.commit('Layer style');
    onClose();
  };
  const upd = <K extends keyof LayerStyles>(k: K, patch: Partial<LayerStyles[K]>) => setSt({ ...st, [k]: { ...st[k], ...patch } });
  const eff = STYLE_EFFECTS.find((e) => e.id === sel)!;
  const blendOpts = BLEND_MODES.map((b) => ({ value: b.id, label: b.label }));
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <Dialog title="Layer style" subtitle={layer.name} width={900} height={560} onClose={cancel}>
      <div style={{ width: 240, borderRight: '1px solid var(--line)', padding: '10px 0', overflowY: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '4px 16px 8px' }}><Label>Styles · {layer.name}</Label></div>
        {STYLE_EFFECTS.map((e) => {
          const on = e.key ? st[e.key].enabled : e.id === 'blending';
          const active = e.id === sel;
          const plannedEff = !e.key && e.id !== 'blending';
          return (
            <div key={e.id} onClick={() => !plannedEff && setSel(e.id)} className={active || plannedEff ? '' : 'hov-row'}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', cursor: plannedEff ? 'default' : 'pointer', background: active ? 'var(--bg0)' : 'transparent', boxShadow: active ? 'inset 2px 0 0 var(--accent)' : 'none', color: active ? 'var(--ink)' : 'var(--mute)', font: 'var(--type-small)' }}>
              <span onClick={(ev) => { if (!e.key) return; ev.stopPropagation(); upd(e.key, { enabled: !st[e.key].enabled } as any); setSel(e.id); }}
                style={{ width: 14, height: 14, flexShrink: 0, border: on && e.key ? '1px solid var(--accent)' : '1px solid var(--line)', background: on && e.key ? 'var(--accent)' : 'transparent' }} />
              <span style={{ flex: 1 }}>{e.name}</span>
              {plannedEff && <Planned />}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, padding: 18, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto', font: 'var(--type-small)' }}>
        <div style={{ font: 'var(--type-subtitle)' }}>{eff.name}</div>
        {sel === 'blending' && <>
          <Row label="Blend mode"><Select value={blend} options={blendOpts} onChange={setBlend} width={180} /></Row>
          <Slider label="Opacity" min={0} max={100} value={opacity} display={`${opacity}%`} onChange={setOpacity} />
        </>}
        {sel === 'dropShadow' && <>
          <Row label="Blend mode"><Select value={st.dropShadow.blend} options={blendOpts} onChange={(v) => upd('dropShadow', { blend: v })} width={160} /><span style={{ color: 'var(--mute)' }}>Color</span><ColorSwatch value={st.dropShadow.color} onChange={(c) => upd('dropShadow', { color: c })} /></Row>
          <Slider label="Opacity" min={0} max={1} step={0.01} value={st.dropShadow.opacity} display={pct(st.dropShadow.opacity)} onChange={(v) => upd('dropShadow', { opacity: v })} />
          <Slider label="Angle" min={-180} max={180} value={st.dropShadow.angle} display={`${st.dropShadow.angle}°`} onChange={(v) => upd('dropShadow', { angle: v })} />
          <Slider label="Distance" min={0} max={300} value={st.dropShadow.distance} display={`${st.dropShadow.distance} px`} onChange={(v) => upd('dropShadow', { distance: v })} />
          <Slider label="Size" min={0} max={250} value={st.dropShadow.size} display={`${st.dropShadow.size} px`} onChange={(v) => upd('dropShadow', { size: v })} />
          <div style={{ color: 'var(--mute)', display: 'flex', gap: 6, alignItems: 'center' }}>Spread · contour · noise <Planned /></div>
        </>}
        {sel === 'stroke' && <>
          <Row label="Color"><ColorSwatch value={st.stroke.color} onChange={(c) => upd('stroke', { color: c })} /><span style={{ color: 'var(--mute)' }}>Position: outside</span></Row>
          <Slider label="Size" min={1} max={100} value={st.stroke.size} display={`${st.stroke.size} px`} onChange={(v) => upd('stroke', { size: v })} />
          <Slider label="Opacity" min={0} max={1} step={0.01} value={st.stroke.opacity} display={pct(st.stroke.opacity)} onChange={(v) => upd('stroke', { opacity: v })} />
        </>}
        {sel === 'outerGlow' && <>
          <Row label="Blend mode"><Select value={st.outerGlow.blend} options={blendOpts} onChange={(v) => upd('outerGlow', { blend: v })} width={160} /><span style={{ color: 'var(--mute)' }}>Color</span><ColorSwatch value={st.outerGlow.color} onChange={(c) => upd('outerGlow', { color: c })} /></Row>
          <Slider label="Opacity" min={0} max={1} step={0.01} value={st.outerGlow.opacity} display={pct(st.outerGlow.opacity)} onChange={(v) => upd('outerGlow', { opacity: v })} />
          <Slider label="Size" min={1} max={250} value={st.outerGlow.size} display={`${st.outerGlow.size} px`} onChange={(v) => upd('outerGlow', { size: v })} />
        </>}
        {sel === 'colorOverlay' && <>
          <Row label="Color"><ColorSwatch value={st.colorOverlay.color} onChange={(c) => upd('colorOverlay', { color: c })} /></Row>
          <Slider label="Opacity" min={0} max={1} step={0.01} value={st.colorOverlay.opacity} display={pct(st.colorOverlay.opacity)} onChange={(v) => upd('colorOverlay', { opacity: v })} />
        </>}
        {eff.key && <Check on={st[eff.key].enabled} onChange={(v) => upd(eff.key!, { enabled: v } as any)} label="Enabled" />}
      </div>
      <div style={{ width: 200, borderLeft: '1px solid var(--line)', padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Label>Preview</Label>
        <div style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>Changes show live on the canvas.</div>
        <div style={{ flex: 1 }} />
        <Button onClick={cancel} style={{ justifyContent: 'center' }}>Cancel</Button>
        <Button variant="primary" onClick={ok} style={{ justifyContent: 'center' }}>OK</Button>
      </div>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span style={{ color: 'var(--mute)', width: 80 }}>{label}</span>{children}</div>;
}
