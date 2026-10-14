// Properties, Adjust, Brush, Type and Color panels.
import { useEffect, useRef, useState } from 'react';
import type { ModuleApi } from '@/core/types';
import { Button, Select, Slider } from '@/ui';
import { ADJUST_NAMES, applyAdjust, defaultAdjust, type AdjustSpec } from '../engine/adjust';
import { contentBounds } from '../engine/canvas';
import { defaultStyles, type LayerStyles, type PixelDoc, type TextData } from '../engine/doc';
import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../engine/img';
import { addAdjustmentLayer, applyAdjustDestructive, clearPreview, previewPixels, requirePixelLayer, UserError } from '../engine/ops';
import { brushTip } from '../engine/paint';
import { FONT_FAMILIES, FONT_WEIGHTS, rerender } from '../engine/render';
import { CanvasThumb, Check, Chip, ColorSwatch, Label, NumField, Planned } from './ui';

type Toast = (m: string, t?: 'info' | 'error') => void;
const pad = { padding: 14, display: 'flex', flexDirection: 'column' as const, gap: 14, overflow: 'auto' as const, font: 'var(--type-small)', flex: 1 };
const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 8 } as const;

// ---------- Properties ----------

export function PropertiesPanel({ doc, api, toast }: { doc: PixelDoc; api: ModuleApi; toast: Toast }) {
  const l = doc.active;
  if (!l) return <div style={pad}><div className="empty-hint">No layer selected.</div></div>;
  const b = l.canvas && l.kind !== 'fill' && l.kind !== 'adjustment' ? contentBounds(l.canvas) : null;
  const rect = b ? { x: l.x + b.x, y: l.y + b.y, w: b.w, h: b.h } : null;
  const move = (dx: number, dy: number) => {
    if (l.locked) { toast(`“${l.name}” is locked`, 'error'); return; }
    const movers = l.kind === 'group' ? doc.descendants(l.id) : [l];
    for (const m of movers) { m.x += dx; m.y += dy; if (m.mask) m.mask = { ...m.mask, x: m.mask.x + dx, y: m.mask.y + dy }; }
    doc.commit('Move');
  };
  const transform = (fn: (p: { sx: number; sy: number; angle: number }, w: number, h: number) => void) => doc.editor?.applyTransform(fn);
  const styles = l.styles;
  const styleRows: { key: keyof LayerStyles; label: string }[] = [
    { key: 'dropShadow', label: 'Drop shadow' }, { key: 'stroke', label: `Stroke · ${styles?.stroke.size ?? 0} px` }, { key: 'outerGlow', label: 'Outer glow' }, { key: 'colorOverlay', label: 'Color overlay' },
  ];
  return (
    <div style={pad}>
      {rect && (
        <div>
          <Label>Transform · {l.name}</Label>
          <div style={grid2}>
            <NumField label="W" unit="px" value={rect.w} min={1} width={56} onChange={(w) => transform((p, bw) => { p.sx = w / bw; })} />
            <NumField label="H" unit="px" value={rect.h} min={1} width={56} onChange={(h) => transform((p, _bw, bh) => { p.sy = h / bh; })} />
            <NumField label="X" unit="px" value={rect.x} width={56} onChange={(x) => move(x - rect.x, 0)} />
            <NumField label="Y" unit="px" value={rect.y} width={56} onChange={(y) => move(0, y - rect.y)} />
            <NumField label="∠" unit="°" value={0} step={0.1} width={56} onChange={(a) => { if (a) transform((p) => { p.angle = (a * Math.PI) / 180; }); }} />
            <Chip onClick={() => api.runCommand('pixel.edit.freeTransform')} style={{ color: 'var(--accent)', textAlign: 'left' }}>Free transform</Chip>
          </div>
        </div>
      )}
      {l.kind === 'fill' && (
        <div>
          <Label>Color fill · {l.name}</Label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
            <ColorSwatch value={l.fillColor ?? '#000000'} size={28} onChange={(c) => { l.fillColor = c; doc.commit('Fill color'); }} />
            <span style={{ font: 'var(--type-mono)' }}>{l.fillColor}</span>
          </div>
        </div>
      )}
      {l.kind === 'adjustment' && l.adjust && (
        <div>
          <Label>Adjustment · {ADJUST_NAMES[l.adjust.type]}</Label>
          <div style={{ display: 'flex', gap: 4, marginTop: 8 }}>
            <Chip onClick={() => api.runCommand('pixel.layer.contentOptions')}>Edit adjustment…</Chip>
          </div>
        </div>
      )}
      {l.kind === 'text' && l.text && (
        <div>
          <Label>Type · {l.name}</Label>
          <div style={{ color: 'var(--mute)', marginTop: 8 }}>{l.text.font} · {Math.round(l.text.size)} px · edit in the Type panel, or double-click the text with the Move tool.</div>
        </div>
      )}
      <div>
        <Label>Align &amp; distribute</Label>
        <div style={{ display: 'flex', gap: 3, marginTop: 8 }}>
          {(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((a) => (
            <Chip key={a} title={`Align ${a} to ${doc.selection ? 'selection' : 'canvas'}`} onClick={() => api.runCommand(`pixel.layer.align.${a}`)} style={{ padding: '5px 7px' }}>{{ left: '⫷', hcenter: '⫶', right: '⫸', top: '⤒', vcenter: '⫵', bottom: '⤓' }[a]}</Chip>
          ))}
          <Chip disabled title="Distribute needs multi-layer selection (roadmap)" style={{ padding: '5px 7px' }}>⋯</Chip>
        </div>
      </div>
      <div>
        <Label right={<span onClick={() => api.runCommand('pixel.layer.style.dropShadow')} style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 700 }}>+ fx</span>}>Layer styles</Label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {!styles && <div className="empty-hint">No effects. Click + fx to add drop shadow, stroke, glow or color overlay.</div>}
          {styles && styleRows.filter((r) => styles[r.key].enabled || true).map((r) => (
            <div key={r.key} onClick={() => api.runCommand(`pixel.layer.style.${r.key}`)} className="hov-border"
              style={{ padding: '6px 10px', border: '1px solid var(--line)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', color: styles[r.key].enabled ? 'var(--ink)' : 'var(--mute)' }}>
              <span>{r.label}</span>
              <span title={styles[r.key].enabled ? 'Hide effect' : 'Show effect'} onClick={(e) => { e.stopPropagation(); const s: LayerStyles = structuredClone(styles ?? defaultStyles()); s[r.key].enabled = !s[r.key].enabled; l.styles = s; doc.commit('Toggle effect'); }}
                style={{ color: styles[r.key].enabled ? 'var(--ink)' : 'var(--mute)' }}>{styles[r.key].enabled ? '◉' : '○'}</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <Label>Quick actions</Label>
        <div style={grid2}>
          <Chip onClick={() => api.runCommand('pixel.select.subject')}>Select subject</Chip>
          <Chip onClick={() => api.runCommand('pixel.quick.removeBackground')}>Remove background</Chip>
          <Chip onClick={() => api.runCommand('pixel.edit.contentAwareFill')}>Content-aware fill</Chip>
          <Chip onClick={() => api.runCommand('pixel.edit.skyReplacement')}>Sky replacement</Chip>
        </div>
        <div style={{ color: 'var(--mute)', marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>AI-assisted actions <Planned /></div>
      </div>
    </div>
  );
}

// ---------- Adjust ----------

const BASIC: { key: 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'saturation' | 'temperature' | 'clarity'; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: 'Exposure', min: -4, max: 4, step: 0.05 }, { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100, step: 1 }, { key: 'shadows', label: 'Shadows', min: -100, max: 100, step: 1 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100, step: 1 }, { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 },
  { key: 'clarity', label: 'Clarity', min: -100, max: 100, step: 1 },
];

export function AdjustPanel({ doc, api, toast }: { doc: PixelDoc; api: ModuleApi; toast: Toast }) {
  const l = doc.active;
  const editing = l?.kind === 'adjustment' && l.adjust?.type === 'basic' ? l : null;
  const [spec, setSpec] = useState<Extract<AdjustSpec, { type: 'basic' }>>(() => (editing?.adjust as any) ?? (defaultAdjust('basic') as any));
  const dirty = BASIC.some((b) => spec[b.key] !== 0);
  const timer = useRef<number>(0);
  useEffect(() => { setSpec((editing?.adjust as any) ?? (defaultAdjust('basic') as any)); }, [editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (editing) { if (JSON.stringify(editing.adjust) !== JSON.stringify(spec)) { editing.adjust = spec; doc.commit('Basic adjustments'); } return; }
      if (!dirty) { clearPreview(doc); return; }
      try { requirePixelLayer(doc); previewPixels(doc, (img) => applyAdjust(img, spec), 0); } catch { /* shown on apply */ }
    }, editing ? 300 : 120);
    return () => clearTimeout(timer.current);
  }, [spec, doc, editing, dirty]);
  useEffect(() => () => { if (!editing) clearPreview(doc); }, [doc, editing]);
  const act = (fn: () => void) => { try { fn(); setSpec(defaultAdjust('basic') as any); } catch (e) { if (e instanceof UserError) toast(e.message, 'error'); else throw e; } };
  return (
    <div style={{ ...pad, padding: '16px 14px', gap: 16 }}>
      {editing && <Label>Editing adjustment layer · {editing.name}</Label>}
      {BASIC.map((b) => (
        <Slider key={b.key} label={b.label} min={b.min} max={b.max} step={b.step} value={spec[b.key]}
          display={b.key === 'exposure' ? `${spec.exposure > 0 ? '+' : ''}${spec.exposure.toFixed(2)}` : `${spec[b.key] > 0 ? '+' : ''}${spec[b.key]}`}
          onChange={(v) => setSpec({ ...spec, [b.key]: v })} />
      ))}
      <div onClick={() => api.runCommand(l?.kind === 'adjustment' ? 'pixel.adjLayer.curves' : 'pixel.adj.curves')} className="hov-border"
        style={{ padding: '6px 12px', border: '1px solid var(--line)', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}><span>Curves…</span><span style={{ color: 'var(--mute)' }}>RGB</span></div>
      {!editing && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Button onClick={() => { setSpec(defaultAdjust('basic') as any); clearPreview(doc); }} style={{ flex: 1, justifyContent: 'center' }}>Reset</Button>
          <Button disabled={!dirty} onClick={() => act(() => { clearPreview(doc); applyAdjustDestructive(doc, spec); })} style={{ flex: 1, justifyContent: 'center' }}>Apply</Button>
          <Button variant="strong" disabled={!dirty} onClick={() => act(() => { clearPreview(doc); addAdjustmentLayer(doc, { ...spec }); })} style={{ flex: 1, justifyContent: 'center' }}>Apply as layer</Button>
        </div>
      )}
      {editing && <Button onClick={() => setSpec(defaultAdjust('basic') as any)} style={{ justifyContent: 'center' }}>Reset</Button>}
    </div>
  );
}

// ---------- Brush ----------

export function BrushPanel({ doc }: { doc: PixelDoc }) {
  const b = doc.ui.brush;
  const set = (patch: Partial<typeof b>) => { Object.assign(b, patch); doc.emit(); };
  const tip = brushTip({ size: Math.min(56, b.size), hardness: b.hardness, roundness: b.roundness, angle: b.angle, aliased: doc.ui.tool === 'pencil' });
  return (
    <div style={pad}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ width: 64, height: 64, background: 'var(--paper)', border: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CanvasThumb source={tip} width={Math.min(56, Math.max(4, b.size))} height={Math.min(56, Math.max(4, b.size))} checker={false} version={`${b.size}${b.hardness}${b.roundness}${b.angle}`} style={{ border: 0, background: 'transparent' }} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontWeight: 700 }}>{b.hardness >= 90 ? 'Hard' : 'Soft'} round · {b.size} px</div>
          <div style={{ color: 'var(--mute)', display: 'flex', gap: 6, alignItems: 'center' }}>Presets · Import .abr <Planned /></div>
        </div>
      </div>
      <Slider label="Size" min={1} max={500} value={Math.min(500, b.size)} display={`${b.size} px`} onChange={(v) => set({ size: v })} />
      <Slider label="Hardness" min={0} max={100} value={b.hardness} display={`${b.hardness}%`} onChange={(v) => set({ hardness: v })} />
      <Slider label="Spacing" min={1} max={200} value={b.spacing} display={`${b.spacing}%`} onChange={(v) => set({ spacing: v })} />
      <Slider label="Angle" min={-180} max={180} value={b.angle} display={`${b.angle}°`} onChange={(v) => set({ angle: v })} />
      <Slider label="Roundness" min={5} max={100} value={b.roundness} display={`${b.roundness}%`} onChange={(v) => set({ roundness: v })} />
      <Slider label="Opacity" min={1} max={100} value={b.opacity} display={`${b.opacity}%`} onChange={(v) => set({ opacity: v })} />
      <Slider label="Flow" min={1} max={100} value={b.flow} display={`${b.flow}%`} onChange={(v) => set({ flow: v })} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Check on={b.pressureSize} onChange={(v) => set({ pressureSize: v })} label="Pressure → size" />
        <Check on={b.pressureOpacity} onChange={(v) => set({ pressureOpacity: v })} label="Transfer (pressure → opacity)" />
        {['Shape dynamics', 'Scattering', 'Texture', 'Dual brush', 'Color dynamics', 'Brush pose', 'Wet edges', 'Build-up'].map((n) => <Check key={n} on={false} disabled label={n} title={`${n} is on the roadmap`} />)}
      </div>
    </div>
  );
}

// ---------- Type ----------

export function TypePanel({ doc }: { doc: PixelDoc }) {
  const l = doc.active?.kind === 'text' ? doc.active : null;
  const t: TextData = l?.text ?? doc.ui.type;
  const apply = (patch: Partial<TextData>) => {
    Object.assign(doc.ui.type, patch);
    if (l?.text) { l.text = { ...l.text, ...patch }; rerender(l); doc.commit('Type settings'); } else doc.emit();
  };
  return (
    <div style={{ ...pad, gap: 12 }}>
      <Label>Character{l ? ` · ${l.name}` : ' · defaults for new type'}</Label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
        <div style={{ gridColumn: 'span 2' }}><Select value={t.font} width="100%" options={FONT_FAMILIES} onChange={(f) => apply({ font: f })} /></div>
        <Select value={String(t.weight)} width="100%" options={FONT_WEIGHTS} onChange={(w) => apply({ weight: Number(w) })} />
        <NumField value={Math.round(t.size * 10) / 10} unit="px" min={1} max={2000} step={0.5} width={110} onChange={(s) => apply({ size: s })} title="Size" />
        <NumField label="Leading" value={t.leading} min={0.5} max={4} step={0.05} width={60} onChange={(v) => apply({ leading: v })} />
        <NumField label="Tracking" value={t.tracking} min={-500} max={2000} width={60} onChange={(v) => apply({ tracking: v })} />
      </div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
        <Chip active={t.weight >= 700} onClick={() => apply({ weight: t.weight >= 700 ? 400 : 700 })} style={{ fontWeight: 800 }}>B</Chip>
        <Chip active={t.italic} onClick={() => apply({ italic: !t.italic })} style={{ fontStyle: 'italic' }}>I</Chip>
        <Chip active={t.underline} onClick={() => apply({ underline: !t.underline })} style={{ textDecoration: 'underline' }}>U</Chip>
        <Chip disabled title="All caps (roadmap)">TT</Chip>
        <Chip disabled title="Strikethrough (roadmap)" style={{ textDecoration: 'line-through' }}>S</Chip>
        <Chip disabled title="Superscript (roadmap)">x²</Chip>
        <span style={{ flex: 1 }} />
        <ColorSwatch value={t.color} size={26} onChange={(c) => apply({ color: c })} title="Text color" />
      </div>
      <Label>Paragraph</Label>
      <div style={{ display: 'flex', gap: 3 }}>
        {(['left', 'center', 'right'] as const).map((a) => <Chip key={a} active={t.align === a} onClick={() => apply({ align: a })}>{{ left: 'Left', center: 'Center', right: 'Right' }[a]}</Chip>)}
        <Chip disabled title="Justify (roadmap)">Justify</Chip>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        <Chip disabled style={{ flex: 1 }}>Warp text…</Chip><Chip disabled style={{ flex: 1 }}>Type on path</Chip><Chip disabled style={{ flex: 1 }}>Glyphs</Chip>
      </div>
      <div style={{ color: 'var(--mute)' }}>Click the canvas with the Type tool (T) to add text; click existing type to edit. Esc or Ctrl Enter finishes.</div>
    </div>
  );
}

// ---------- Color ----------

export function ColorPanel({ doc }: { doc: PixelDoc }) {
  const fg = doc.ui.fg;
  const [r, g, b] = hexToRgb(fg);
  const [h0, s0, v0] = rgbToHsv(r, g, b);
  const [hue, setHue] = useState(h0);
  useEffect(() => { if (s0 > 0.01 && v0 > 0.01) setHue(h0); }, [fg]); // eslint-disable-line react-hooks/exhaustive-deps
  const setHsv = (h: number, s: number, v: number) => { const [nr, ng, nb] = hsvToRgb(h, s, v); doc.ui.fg = rgbToHex(nr, ng, nb); doc.emit(); };
  const drag = (e: React.PointerEvent, fn: (fx: number, fy: number) => void) => {
    const el = e.currentTarget as HTMLElement;
    const go = (ev: { clientX: number; clientY: number }) => { const rr = el.getBoundingClientRect(); fn(Math.max(0, Math.min(1, (ev.clientX - rr.left) / rr.width)), Math.max(0, Math.min(1, (ev.clientY - rr.top) / rr.height))); };
    go(e);
    const mv = (ev: PointerEvent) => go(ev);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };
  const [hexText, setHexText] = useState(fg);
  useEffect(() => setHexText(fg), [fg]);
  const pure = rgbToHex(...hsvToRgb(hue, 1, 1));
  return (
    <div style={{ ...pad, gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div onPointerDown={(e) => drag(e, (x, y) => setHsv(hue, x, 1 - y))}
          style={{ flex: 1, height: 120, background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${pure})`, cursor: 'crosshair', position: 'relative', touchAction: 'none' }}>
          <div style={{ position: 'absolute', left: `${s0 * 100}%`, top: `${(1 - v0) * 100}%`, width: 10, height: 10, border: '2px solid #fff', borderRadius: 6, margin: '-6px 0 0 -6px', pointerEvents: 'none' }} />
        </div>
        <div onPointerDown={(e) => drag(e, (_x, y) => { const nh = y * 360; setHue(nh); setHsv(nh, s0 || 1, v0 || 1); })}
          style={{ width: 14, height: 120, background: 'linear-gradient(to bottom,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)', position: 'relative', cursor: 'ns-resize', touchAction: 'none' }}>
          <div style={{ position: 'absolute', left: -2, right: -2, top: `${(hue / 360) * 100}%`, height: 2, background: '#fff', pointerEvents: 'none' }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        <NumField label="H" value={Math.round(hue)} min={0} max={360} width={44} onChange={(v) => { setHue(v); setHsv(v, s0, v0); }} />
        <NumField label="S" value={Math.round(s0 * 100)} min={0} max={100} width={44} onChange={(v) => setHsv(hue, v / 100, v0)} />
        <NumField label="B" value={Math.round(v0 * 100)} min={0} max={100} width={44} onChange={(v) => setHsv(hue, s0, v / 100)} />
        <NumField label="R" value={r} min={0} max={255} width={44} onChange={(v) => { doc.ui.fg = rgbToHex(v, g, b); doc.emit(); }} />
        <NumField label="G" value={g} min={0} max={255} width={44} onChange={(v) => { doc.ui.fg = rgbToHex(r, v, b); doc.emit(); }} />
        <NumField label="B" value={b} min={0} max={255} width={44} onChange={(v) => { doc.ui.fg = rgbToHex(r, g, v); doc.emit(); }} />
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ width: 26, height: 26, background: fg, border: '1px solid var(--line)' }} />
        <input value={hexText} onChange={(e) => setHexText(e.target.value)} onKeyDown={(e) => e.stopPropagation()}
          onBlur={() => { if (/^#?[0-9a-f]{6}$/i.test(hexText.trim())) { doc.ui.fg = ('#' + hexText.trim().replace('#', '')).toUpperCase(); doc.emit(); } else setHexText(fg); }}
          style={{ width: 90, padding: '4px 8px', background: 'var(--bg0)', border: '1px solid var(--line)', color: 'var(--ink)', font: 'var(--type-mono)', outline: 'none' }} />
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--mute)' }}>Background</span>
        <ColorSwatch value={doc.ui.bg} onChange={(c) => { doc.ui.bg = c; doc.emit(); }} />
      </div>
      <div style={{ display: 'flex', gap: 6, color: 'var(--mute)' }}><span style={{ color: 'var(--ink)' }}>RGB</span>·<span style={{ color: 'var(--ink)' }}>HSB</span>·<span>Lab</span>·<span>CMYK</span><Planned /></div>
      <Label>Swatches</Label>
      {doc.swatches.length === 0 ? <div className="empty-hint">No swatches yet. “+ Swatch” saves the foreground color with this document.</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: 3 }}>
          {doc.swatches.map((c, i) => (
            <div key={i} title={`${c} — click to use, Alt-click to remove`} onClick={(e) => {
              if (e.altKey) { doc.swatches = doc.swatches.filter((_, j) => j !== i); doc.commit('Delete swatch'); return; }
              doc.ui.fg = c; doc.emit();
            }} style={{ aspectRatio: '1', background: c, border: '1px solid var(--line)', cursor: 'pointer' }} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 4 }}>
        <Chip style={{ flex: 1 }} onClick={() => { if (!doc.swatches.includes(fg)) { doc.swatches = [...doc.swatches, fg]; doc.commit('Add swatch'); } }}>+ Swatch</Chip>
        <Chip style={{ flex: 1 }} disabled>Gradients</Chip>
        <Chip style={{ flex: 1 }} disabled>Patterns</Chip>
      </div>
      <div style={{ color: 'var(--mute)', lineHeight: 1.5 }}>Document: RGB · 8-bit · sRGB. Other modes and proofing are on the roadmap.</div>
    </div>
  );
}
