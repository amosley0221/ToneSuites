// Options bar (40px) and tool rail (52px).
import { useEffect, useRef, useState } from 'react';
import type { ModuleApi } from '@/core/types';
import { Button, Select } from '@/ui';
import type { PixelDoc } from '../engine/doc';
import { FONT_FAMILIES, FONT_WEIGHTS } from '../engine/render';
import { TOOL_GROUPS, defaultVariant, groupOf, variantOf, type ToolGroup, type ToolId } from '../engine/tooldefs';
import type { ToolController } from './controller';
import { Check, Chip, ColorSwatch, DropMenu, NumField, Planned } from './ui';

const fieldGap = { display: 'flex', alignItems: 'center', gap: 18, flexShrink: 0 } as const;

export function selectTool(doc: PixelDoc, id: ToolId) {
  const g = groupOf(id);
  doc.ui.tool = id;
  doc.ui.groupVariant = { ...doc.ui.groupVariant, [g.id]: id };
  doc.emit();
}

export function OptionsBar({ doc, ctl, api, onPanels, compact }: { doc: PixelDoc; ctl: ToolController; api: ModuleApi; onPanels?: () => void; compact: boolean }) {
  const ui = doc.ui;
  const set = (fn: () => void) => { fn(); doc.emit(); };
  const t = ui.tool;
  const v = variantOf(t);
  const right = (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <Button onClick={() => api.runCommand('pixel.edit.undo')} disabled={!doc.canUndo}>Undo</Button>
      <Button onClick={() => api.runCommand('pixel.edit.redo')} disabled={!doc.canRedo}>Redo</Button>
      {!compact && <DropMenu label="Import ▾" align="right" items={[
        { label: 'Place from this device…', onClick: () => api.runCommand('pixel.file.importPlace') },
        { label: 'Paste from clipboard', hint: 'Ctrl V', onClick: () => api.runCommand('pixel.file.pasteClipboard') },
        { label: 'Open from NAS / Google Drive…', onClick: () => api.runCommand('file.openFromProvider') },
      ]} style={{ padding: '6px 12px' }} />}
      {!compact && <Button onClick={() => api.runCommand('pixel.filter.gallery')}>Filter gallery</Button>}
      <Button variant="primary" onClick={() => api.runCommand('file.export')}>Export</Button>
    </div>
  );
  const Name = ({ children, accent }: { children: React.ReactNode; accent?: boolean }) => (
    <div style={{ font: 'var(--type-label)', fontWeight: 800, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: accent ? 'var(--accent)' : 'var(--ink)', whiteSpace: 'nowrap', flexShrink: 0 }}>{children}</div>
  );

  // free transform variant
  if (ctl.transform) {
    const p = ctl.transform.p, tr = ctl.transform;
    const upd = (fn: () => void) => { fn(); doc.repaint(); doc.emit(); };
    return (
      <div className="toolbar" style={{ gap: 14, padding: '0 12px' }}>
        <Name accent>Free transform</Name>
        <NumField label="X" value={Math.round(p.cx - (tr.w * p.sx) / 2)} onChange={(x) => upd(() => { p.cx = x + (tr.w * p.sx) / 2; })} />
        <NumField label="Y" value={Math.round(p.cy - (tr.h * p.sy) / 2)} onChange={(y) => upd(() => { p.cy = y + (tr.h * p.sy) / 2; })} />
        <NumField label="W" unit="%" value={Math.round(p.sx * 1000) / 10} step={0.1} onChange={(w) => upd(() => { p.sx = w / 100 || 0.01; })} />
        <NumField label="H" unit="%" value={Math.round(p.sy * 1000) / 10} step={0.1} onChange={(h) => upd(() => { p.sy = h / 100 || 0.01; })} />
        <NumField label="∠" unit="°" value={Math.round((p.angle * 180) / Math.PI * 10) / 10} step={0.1} onChange={(a) => upd(() => { p.angle = (a * Math.PI) / 180; })} />
        <Select value={tr.smooth ? 'bicubic' : 'nearest'} width={170} onChange={(val) => upd(() => { tr.smooth = val === 'bicubic'; })}
          options={[{ value: 'bicubic', label: 'Interpolation: Bicubic' }, { value: 'nearest', label: 'Interpolation: Nearest' }]} />
        <Chip disabled title="Warp, perspective and distort are on the roadmap">Warp · Perspective · Distort</Chip>
        <div style={{ flex: 1 }} />
        <Button onClick={() => ctl.cancelTransform()}>Cancel</Button>
        <Button variant="primary" onClick={() => ctl.commitTransform()}>Commit ⏎</Button>
      </div>
    );
  }
  if (t === 'crop' && ctl.crop) {
    const c = ctl.crop;
    return (
      <div className="toolbar" style={{ gap: 14, padding: '0 12px' }}>
        <Name>Crop</Name>
        <NumField label="W" unit="px" value={Math.round(c.w)} min={1} onChange={(w) => { ctl.crop = { ...c, w }; doc.emit(); }} />
        <NumField label="H" unit="px" value={Math.round(c.h)} min={1} onChange={(h) => { ctl.crop = { ...c, h }; doc.emit(); }} />
        <Check on={ui.crop.deletePixels} onChange={(b) => set(() => { ui.crop.deletePixels = b; })} label="Delete cropped pixels" />
        <div style={{ flex: 1 }} />
        <Button onClick={() => { ctl.crop = null; doc.emit(); }}>Cancel</Button>
        <Button variant="primary" onClick={() => ctl.commitCrop(true)}>Commit ⏎</Button>
      </div>
    );
  }

  const b = ui.brush;
  const size = <NumField label="Size" unit="px" value={b.size} min={1} max={2500} onChange={(n) => set(() => { b.size = n; })} />;
  const hard = <NumField label="Hardness" unit="%" value={b.hardness} min={0} max={100} onChange={(n) => set(() => { b.hardness = n; })} />;
  const opac = <NumField label="Opacity" unit="%" value={b.opacity} min={1} max={100} onChange={(n) => set(() => { b.opacity = n; })} />;
  const flow = <NumField label="Flow" unit="%" value={b.flow} min={1} max={100} onChange={(n) => set(() => { b.flow = n; })} />;
  const selMode = (
    <div style={{ display: 'flex', gap: 2 }}>
      {(['replace', 'add', 'subtract', 'intersect'] as const).map((m) => (
        <Chip key={m} active={ui.select.mode === m} onClick={() => set(() => { ui.select.mode = m; })} title={m}>{{ replace: 'New', add: 'Add', subtract: 'Sub', intersect: 'Int' }[m]}</Chip>
      ))}
    </div>
  );
  let fields: React.ReactNode = null;
  if (!v.working) fields = <span style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--mute)', font: 'var(--type-small)' }}>{v.name} is on the roadmap <Planned /></span>;
  else switch (t) {
    case 'move': fields = <><Check on={ui.move.autoSelect} onChange={(x) => set(() => { ui.move.autoSelect = x; })} label="Auto-select layer" />
      <Chip onClick={() => api.runCommand('pixel.edit.freeTransform')}>Free transform</Chip>
      <div style={{ display: 'flex', gap: 2 }}>{(['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const).map((a) => <Chip key={a} title={`Align ${a}`} onClick={() => api.runCommand(`pixel.layer.align.${a}`)}>{{ left: '⫷', hcenter: '⫶', right: '⫸', top: '⤒', vcenter: '⫵', bottom: '⤓' }[a]}</Chip>)}</div></>; break;
    case 'marqueeRect': case 'marqueeEllipse': case 'lasso': case 'polyLasso': case 'marqueeRow': case 'marqueeCol':
      fields = <>{selMode}<NumField label="Feather" unit="px" value={ui.select.feather} min={0} max={250} step={0.5} onChange={(n) => set(() => { ui.select.feather = n; })} />
        {t === 'polyLasso' && <span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>Click points · double-click or Enter to close · Esc cancels</span>}</>; break;
    case 'wand': fields = <>{selMode}<NumField label="Tolerance" value={ui.wand.tolerance} min={0} max={255} onChange={(n) => set(() => { ui.wand.tolerance = n; })} />
      <Check on={ui.wand.contiguous} onChange={(x) => set(() => { ui.wand.contiguous = x; })} label="Contiguous" />
      <Check on={ui.wand.sampleAll} onChange={(x) => set(() => { ui.wand.sampleAll = x; })} label="Sample all layers" /></>; break;
    case 'crop': fields = <><Check on={ui.crop.deletePixels} onChange={(x) => set(() => { ui.crop.deletePixels = x; })} label="Delete cropped pixels" />
      <span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>Drag a crop box · Enter commits</span></>; break;
    case 'eyedropper': fields = <>
      <Select value={String(ui.eyedropper.sample)} width={150} onChange={(s) => set(() => { ui.eyedropper.sample = Number(s) as 1 | 3 | 5; })} options={[{ value: '1', label: 'Point sample' }, { value: '3', label: '3 × 3 average' }, { value: '5', label: '5 × 5 average' }]} />
      <Select value={ui.eyedropper.source} width={150} onChange={(s) => set(() => { ui.eyedropper.source = s; })} options={[{ value: 'all', label: 'All layers' }, { value: 'layer', label: 'Current layer' }]} />
      <span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>Alt-click sets background</span></>; break;
    case 'brush': case 'eraser': fields = <>{size}{hard}{opac}{flow}<Check on={b.pressureSize} onChange={(x) => set(() => { b.pressureSize = x; })} label="Pressure → size" /></>; break;
    case 'pencil': fields = <>{size}{opac}</>; break;
    case 'clone': fields = <>{size}{hard}{opac}{flow}<Check on={ui.retouch.sampleAll} onChange={(x) => set(() => { ui.retouch.sampleAll = x; })} label="Sample all layers" /><span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>{ui.cloneSource ? 'Source set' : 'Alt-click to set source'}</span></>; break;
    case 'historyBrush': fields = <>{size}{hard}{opac}<span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>Source: {doc.history[ui.historySource]?.label ?? '—'} (set in History panel)</span></>; break;
    case 'magicEraser': fields = <><NumField label="Tolerance" value={ui.wand.tolerance} min={0} max={255} onChange={(n) => set(() => { ui.wand.tolerance = n; })} /><Check on={ui.wand.contiguous} onChange={(x) => set(() => { ui.wand.contiguous = x; })} label="Contiguous" /></>; break;
    case 'gradient': fields = <>
      <div style={{ display: 'flex', gap: 2 }}><Chip active={ui.gradient.type === 'linear'} onClick={() => set(() => { ui.gradient.type = 'linear'; })}>Linear</Chip><Chip active={ui.gradient.type === 'radial'} onClick={() => set(() => { ui.gradient.type = 'radial'; })}>Radial</Chip></div>
      <Select value={ui.gradient.fade} width={180} onChange={(s) => set(() => { ui.gradient.fade = s; })} options={[{ value: 'fgbg', label: 'Foreground → background' }, { value: 'fgclear', label: 'Foreground → transparent' }]} />
      <Check on={ui.gradient.reverse} onChange={(x) => set(() => { ui.gradient.reverse = x; })} label="Reverse" />
      <NumField label="Opacity" unit="%" value={ui.gradient.opacity} min={1} max={100} onChange={(n) => set(() => { ui.gradient.opacity = n; })} /></>; break;
    case 'bucket': fields = <><NumField label="Tolerance" value={ui.bucket.tolerance} min={0} max={255} onChange={(n) => set(() => { ui.bucket.tolerance = n; })} />
      <NumField label="Opacity" unit="%" value={ui.bucket.opacity} min={1} max={100} onChange={(n) => set(() => { ui.bucket.opacity = n; })} />
      <Check on={ui.bucket.contiguous} onChange={(x) => set(() => { ui.bucket.contiguous = x; })} label="Contiguous" />
      <Check on={ui.bucket.sampleAll} onChange={(x) => set(() => { ui.bucket.sampleAll = x; })} label="All layers" /></>; break;
    case 'blur': case 'sharpen': case 'smudge': fields = <>{size}<NumField label="Strength" unit="%" value={ui.retouch.strength} min={1} max={100} onChange={(n) => set(() => { ui.retouch.strength = n; })} /></>; break;
    case 'dodge': case 'burn': fields = <>{size}
      <Select value={ui.tone.range} width={130} onChange={(s) => set(() => { ui.tone.range = s; })} options={[{ value: 'shadows', label: 'Shadows' }, { value: 'midtones', label: 'Midtones' }, { value: 'highlights', label: 'Highlights' }]} />
      <NumField label="Exposure" unit="%" value={ui.tone.exposure} min={1} max={100} onChange={(n) => set(() => { ui.tone.exposure = n; })} /></>; break;
    case 'sponge': fields = <>{size}
      <Select value={ui.tone.spongeMode} width={130} onChange={(s) => set(() => { ui.tone.spongeMode = s; })} options={[{ value: 'desaturate', label: 'Desaturate' }, { value: 'saturate', label: 'Saturate' }]} />
      <NumField label="Flow" unit="%" value={ui.retouch.strength} min={1} max={100} onChange={(n) => set(() => { ui.retouch.strength = n; })} /></>; break;
    case 'typeH': {
      const tt = ui.type;
      const al = doc.active?.kind === 'text' ? doc.active : null;
      const apply = (patch: Partial<typeof tt>) => set(() => {
        Object.assign(tt, patch);
        if (al?.text) { al.text = { ...al.text, ...patch }; import('../engine/render').then((r) => { r.rerender(al); doc.commit('Type settings'); }); }
      });
      fields = <>
        <Select value={tt.font} width={150} onChange={(f) => apply({ font: f })} options={FONT_FAMILIES} />
        <Select value={String(tt.weight)} width={110} onChange={(w) => apply({ weight: Number(w) })} options={FONT_WEIGHTS} />
        <NumField label="Size" unit="px" value={tt.size} min={1} max={2000} onChange={(n) => apply({ size: n })} />
        <ColorSwatch value={al?.text?.color ?? ui.fg} onChange={(c) => { ui.fg = c; apply({ color: c }); }} title="Text color" />
        <div style={{ display: 'flex', gap: 2 }}>{(['left', 'center', 'right'] as const).map((a) => <Chip key={a} active={tt.align === a} onClick={() => apply({ align: a })}>{{ left: '⇤', center: '↔', right: '⇥' }[a]}</Chip>)}</div></>;
      break;
    }
    case 'rect': case 'ellipse': case 'triangle': case 'polygon': case 'line': {
      const s = ui.shape;
      fields = <>
        <Select value={s.mode} width={110} onChange={(m) => set(() => { s.mode = m; })} options={[{ value: 'shape', label: 'Shape layer' }, { value: 'pixels', label: 'Pixels' }]} />
        {t !== 'line' && <Check on={s.fillOn} onChange={(x) => set(() => { s.fillOn = x; })} label="Fill (fg)" />}
        {t !== 'line' && <Check on={s.strokeOn} onChange={(x) => set(() => { s.strokeOn = x; if (x && !s.strokeWidth) s.strokeWidth = 2; })} label="Stroke (bg)" />}
        <NumField label={t === 'line' ? 'Weight' : 'Stroke'} unit="px" value={s.strokeWidth} min={0} max={500} onChange={(n) => set(() => { s.strokeWidth = n; })} />
        {t === 'rect' && <NumField label="Radius" unit="px" value={s.radius} min={0} max={2000} onChange={(n) => set(() => { s.radius = n; })} />}
        {t === 'polygon' && <NumField label="Sides" value={s.sides} min={3} max={64} onChange={(n) => set(() => { s.sides = n; })} />}</>;
      break;
    }
    case 'hand': case 'zoom': fields = <><Chip onClick={() => doc.view?.fit()}>Fit on screen</Chip><Chip onClick={() => doc.view?.zoomTo(1)}>100%</Chip>
      {t === 'zoom' && <span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>Click to zoom in · Alt-click to zoom out</span>}</>; break;
  }
  return (
    <div className="toolbar" style={{ gap: 18, padding: '0 12px' }}>
      {onPanels && <Button onClick={onPanels}>Panels</Button>}
      <Name>{v.name}</Name>
      <div style={fieldGap}>{fields}</div>
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

export function ToolRail({ doc, compact }: { doc: PixelDoc; compact: boolean }) {
  const [flyout, setFlyout] = useState<{ g: ToolGroup; top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const ui = doc.ui;
  useEffect(() => {
    if (!flyout) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setFlyout(null); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [flyout]);
  const current = groupOf(ui.tool);
  const press = useRef<number | null>(null);
  const openFly = (g: ToolGroup, el: HTMLElement) => {
    const r = el.getBoundingClientRect(), rr = ref.current!.getBoundingClientRect();
    setFlyout({ g, top: compact ? -8 : r.top - rr.top, left: compact ? r.left - rr.left : 52 });
  };
  return (
    <div ref={ref} className="toolrail" style={{ width: 52, borderRight: '1px solid var(--line)', background: 'var(--bg1)', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: compact ? '0 6px' : '6px 0', position: compact ? undefined : 'relative', zIndex: compact ? undefined : 4, flexShrink: 0, overflowY: compact ? undefined : 'auto' }}>
      {TOOL_GROUPS.map((g) => {
        const on = g === current;
        const tool = on ? ui.tool : ui.groupVariant[g.id] ?? defaultVariant(g);
        const names = g.variants.map((x) => x.name).join(' · ');
        return (
          <div key={g.id} title={`${names} (${g.key})`} className={on ? '' : 'tool-cell'}
            onPointerDown={(e) => { const el = e.currentTarget; press.current = window.setTimeout(() => { if (g.variants.length > 1) openFly(g, el); }, 450); }}
            onPointerUp={() => { if (press.current) clearTimeout(press.current); }}
            onContextMenu={(e) => { e.preventDefault(); if (g.variants.length > 1) openFly(g, e.currentTarget); }}
            onClick={(e) => {
              if (on && g.variants.length > 1) { if (flyout?.g === g) setFlyout(null); else openFly(g, e.currentTarget); return; }
              setFlyout(null);
              selectTool(doc, tool);
            }}
            style={{
              width: 36, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative', flexShrink: 0,
              background: on ? 'var(--accent)' : 'transparent', color: on ? 'var(--on-accent)' : 'var(--mute)', font: '500 11px var(--font-mono)',
              borderTop: g.sep && !compact ? '1px solid var(--line)' : 0,
            }}>
            {g.key}
            {g.variants.length > 1 && <span style={{ position: 'absolute', right: 3, bottom: 3, width: 0, height: 0, borderLeft: '4px solid transparent', borderBottom: `4px solid ${on ? 'var(--on-accent)' : 'var(--mute)'}` }} />}
          </div>
        );
      })}
      {flyout && (
        <div style={{ position: 'absolute', left: flyout.left, top: compact ? undefined : flyout.top, bottom: compact ? 50 : undefined, width: 230, background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', padding: '4px 0', zIndex: 60 }}>
          {flyout.g.variants.map((x, i) => (
            <div key={x.id} className="hov-row" onClick={() => { selectTool(doc, x.id); setFlyout(null); }}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '7px 12px', font: 'var(--type-small)', cursor: 'pointer', background: x.id === ui.tool ? 'var(--sel)' : 'transparent', color: x.working ? 'var(--ink)' : 'var(--mute)' }}>
              <span>{x.name}{!x.working && <span style={{ marginLeft: 8 }}><Planned /></span>}</span>
              <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{flyout.g.key}{i ? ' (shift)' : ''}</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 8 }} />
      <div style={{ position: 'relative', width: 40, height: 46, flexShrink: 0 }}>
        <span style={{ position: 'absolute', left: 12, top: 18 }} title="Background color"><ColorSwatch value={ui.bg} size={26} onChange={(c) => { ui.bg = c; doc.emit(); }} /></span>
        <span style={{ position: 'absolute', left: 0, top: 0, outline: '2px solid var(--bg0)' }} title="Foreground color"><ColorSwatch value={ui.fg} size={26} onChange={(c) => { ui.fg = c; doc.emit(); }} /></span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 4, flexShrink: 0 }}>
        <span title="Swap colors (X)" className="hov-ink" style={{ cursor: 'pointer', color: 'var(--mute)', font: 'var(--type-mono)' }} onClick={() => { [ui.fg, ui.bg] = [ui.bg, ui.fg]; doc.emit(); }}>⇄</span>
        <span title="Default colors (D)" className="hov-ink" style={{ cursor: 'pointer', color: 'var(--mute)', font: 'var(--type-mono)' }} onClick={() => { ui.fg = '#000000'; ui.bg = '#FFFFFF'; doc.emit(); }}>◪</span>
      </div>
    </div>
  );
}
