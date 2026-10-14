// Inspector (300px): 10 panel tabs.
import { useMemo, useState } from 'react';
import type { ModuleApi } from '@/core/types';
import { Select } from '@/ui';
import { ADJUST_NAMES, type AdjustType } from '../engine/adjust';
import { BLEND_MODES } from '../engine/blend';
import { composite } from '../engine/composite';
import { ctx2d, getImg, maskToCanvas, newCanvas } from '../engine/canvas';
import type { Layer, PanelId, PixelDoc } from '../engine/doc';
import { selectionFromLayer, UserError } from '../engine/ops';
import { maskPreview } from '../dialogs/LayerDialogs';
import { AdjustPanel, BrushPanel, ColorPanel, PropertiesPanel, TypePanel } from './Panels';
import { CanvasThumb, Chip, DropMenu, NumField, Planned } from './ui';

const TABS: { id: PanelId; label: string }[] = [
  { id: 'layers', label: 'Layers' }, { id: 'channels', label: 'Channels' }, { id: 'paths', label: 'Paths' }, { id: 'props', label: 'Properties' },
  { id: 'adjust', label: 'Adjust' }, { id: 'history', label: 'History' }, { id: 'brush', label: 'Brush' }, { id: 'type', label: 'Type' },
  { id: 'color', label: 'Color' }, { id: 'actions', label: 'Actions' },
];

export function Inspector({ doc, api, open, toast }: { doc: PixelDoc; api: ModuleApi; open: boolean; toast: (m: string, t?: 'info' | 'error') => void }) {
  const p = doc.ui.panel;
  return (
    <div className={`inspector wide${open ? ' open' : ''}`} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', borderBottom: '1px solid var(--line)', padding: '6px 6px 0', gap: 2, flexShrink: 0 }}>
        {TABS.map((t) => (
          <div key={t.id} onClick={() => { doc.ui.panel = t.id; doc.emit(); }} className="hov-ink"
            style={{ padding: '6px 9px', font: 'var(--type-label)', fontWeight: 700, fontSize: 11, cursor: 'pointer', color: p === t.id ? 'var(--ink)' : 'var(--mute)', boxShadow: p === t.id ? 'inset 0 -2px 0 var(--accent)' : 'none' }}>{t.label}</div>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {p === 'layers' && <LayersPanel doc={doc} api={api} toast={toast} />}
        {p === 'channels' && <ChannelsPanel doc={doc} api={api} toast={toast} />}
        {p === 'paths' && <PathsPanel />}
        {p === 'props' && <PropertiesPanel doc={doc} api={api} toast={toast} />}
        {p === 'adjust' && <AdjustPanel doc={doc} api={api} toast={toast} />}
        {p === 'history' && <HistoryPanel doc={doc} />}
        {p === 'brush' && <BrushPanel doc={doc} />}
        {p === 'type' && <TypePanel doc={doc} />}
        {p === 'color' && <ColorPanel doc={doc} />}
        {p === 'actions' && <ActionsPanel />}
      </div>
    </div>
  );
}

const footer = { display: 'flex', flexWrap: 'wrap' as const, gap: 4, padding: 8, borderTop: '1px solid var(--line)', flexShrink: 0 };

function kindLabel(l: Layer) {
  switch (l.kind) {
    case 'pixel': return 'Pixel';
    case 'text': return 'Type';
    case 'shape': return `Shape · ${l.shape?.type ?? ''}`;
    case 'group': return 'Group';
    case 'adjustment': return `Adjustment · ${l.adjust ? ADJUST_NAMES[l.adjust.type] : ''}`;
    case 'fill': return 'Color fill';
  }
}

const ADJ_MENU: AdjustType[] = ['brightnessContrast', 'levels', 'curves', 'exposure', 'vibrance', 'hueSaturation', 'colorBalance', 'blackWhite', 'photoFilter', 'channelMixer', 'invert', 'posterize', 'threshold', 'gradientMap'];

export function LayersPanel({ doc, api, toast }: { doc: PixelDoc; api: ModuleApi; toast: (m: string, t?: 'info' | 'error') => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropOn, setDropOn] = useState<{ id: string; into: boolean } | null>(null);
  const a = doc.active;
  const rows = doc.panelOrder();
  const v = doc.pixelRev;
  const run = (fn: () => void) => { try { fn(); } catch (e) { if (e instanceof UserError) toast(e.message, 'error'); else throw e; } };
  return (
    <>
      <div style={{ padding: 10, display: 'flex', gap: 6, borderBottom: '1px solid var(--line)', alignItems: 'center', flexShrink: 0 }}>
        <Select value={a?.blend ?? 'normal'} width="100%" style={{ flex: 1 }} options={BLEND_MODES.map((b) => ({ value: b.id, label: b.label }))}
          onChange={(b) => { if (!a) return; a.blend = b; doc.commit('Blend mode'); }} />
        <NumField value={Math.round((a?.opacity ?? 1) * 100)} unit="%" min={0} max={100} width={64} title="Opacity"
          onChange={(o) => { if (!a) return; a.opacity = o / 100; doc.commit('Opacity'); }} />
        <Chip active={!!a?.locked} title="Lock layer" onClick={() => { if (!a) return; a.locked = !a.locked; doc.commit(a.locked ? 'Lock layer' : 'Unlock layer'); }} mono>⊘</Chip>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {rows.map(({ layer: l, depth }) => {
          const on = l.id === doc.activeId;
          const target = dropOn?.id === l.id;
          return (
            <div key={l.id} draggable={renaming !== l.id}
              onDragStart={(e) => { setDragId(l.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', l.id); }}
              onDragOver={(e) => { if (!dragId || dragId === l.id) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDropOn({ id: l.id, into: l.kind === 'group' && e.clientY > r.top + r.height * 0.3 && e.clientY < r.bottom - r.height * 0.3 }); }}
              onDragLeave={() => setDropOn(null)}
              onDrop={(e) => { e.preventDefault(); if (dragId && dropOn) { doc.moveTo(dragId, l.id, dropOn.into); doc.commit('Reorder layers'); } setDragId(null); setDropOn(null); }}
              onDragEnd={() => { setDragId(null); setDropOn(null); }}
              onClick={() => { doc.activeId = l.id; doc.ui.editMask = false; doc.emit(); api.refreshChrome(); }}
              className={on ? '' : 'hov-row'}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', paddingLeft: 12 + depth * 14, cursor: 'pointer', background: on ? 'var(--sel)' : 'transparent', borderBottom: '1px solid var(--line)', boxShadow: target ? (dropOn!.into ? 'inset 0 0 0 1px var(--accent)' : 'inset 0 2px 0 var(--accent)') : 'none', opacity: dragId === l.id ? 0.5 : 1 }}>
              <div onClick={(e) => { e.stopPropagation(); l.visible = !l.visible; doc.commit(l.visible ? 'Show layer' : 'Hide layer'); }} title={l.visible ? 'Hide' : 'Show'}
                style={{ width: 16, color: l.visible ? 'var(--ink)' : 'var(--mute)', font: 'var(--type-small)', fontSize: 11, textAlign: 'center' }}>{l.visible ? '◉' : '○'}</div>
              {l.kind === 'group'
                ? <div onClick={(e) => { e.stopPropagation(); l.collapsed = !l.collapsed; doc.emit(); }} style={{ width: 40, height: 28, border: '1px solid var(--line)', background: 'var(--bg0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--mute)', font: 'var(--type-mono)', flexShrink: 0 }}>{l.collapsed ? '▸' : '▾'}</div>
                : l.kind === 'adjustment' ? <div style={{ width: 40, height: 28, border: '1px solid var(--line)', background: 'linear-gradient(135deg, var(--ink) 50%, var(--bg0) 50%)', flexShrink: 0 }} />
                  : l.kind === 'fill' ? <div style={{ width: 40, height: 28, border: '1px solid var(--line)', background: l.fillColor, flexShrink: 0 }} />
                    : <div onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.stopPropagation(); run(() => selectionFromLayer(doc, l)); } else if (doc.ui.editMask && on) { e.stopPropagation(); doc.ui.editMask = false; doc.emit(); } }} title="Ctrl-click: load as selection">
                      <CanvasThumb source={l.canvas} width={40} height={28} version={v} style={{ outline: on && !doc.ui.editMask && l.mask ? '1px solid var(--accent)' : undefined }} />
                    </div>}
              {l.mask && (
                <div onClick={(e) => { e.stopPropagation(); doc.activeId = l.id; doc.ui.editMask = true; doc.emit(); }} title="Layer mask — click to paint on the mask">
                  <CanvasThumb source={() => maskPreview(l)} width={28} height={28} checker={false} version={`${v}-${l.mask.enabled}`}
                    style={{ outline: on && doc.ui.editMask ? '1px solid var(--accent)' : undefined, opacity: l.mask.enabled ? 1 : 0.4 }} />
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                {renaming === l.id
                  ? <input autoFocus defaultValue={l.name} onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                    onBlur={(e) => { const n = e.target.value.trim(); setRenaming(null); if (n && n !== l.name) { l.name = n; doc.commit('Rename layer'); } }}
                    style={{ width: '100%', background: 'var(--bg0)', border: '1px solid var(--accent)', color: 'var(--ink)', font: 'var(--type-small)', fontWeight: 600, padding: '1px 4px', outline: 'none' }} />
                  : <div onDoubleClick={(e) => { e.stopPropagation(); setRenaming(l.id); }} style={{ font: 'var(--type-small)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>}
                <div style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {kindLabel(l)}{l.blend !== 'normal' ? ` · ${BLEND_MODES.find((b) => b.id === l.blend)?.label}` : ''}{l.opacity < 1 ? ` · ${Math.round(l.opacity * 100)}%` : ''}{l.styles ? ' · fx' : ''}
                </div>
              </div>
              {l.locked && <div style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>locked</div>}
            </div>
          );
        })}
      </div>
      <div style={footer}>
        <Chip onClick={() => api.runCommand('pixel.layer.newLayer')}>+ Layer</Chip>
        <Chip onClick={() => api.runCommand('pixel.layer.newGroup')}>Group</Chip>
        <Chip onClick={() => api.runCommand(a?.mask ? 'pixel.layer.mask.delete' : doc.selection ? 'pixel.layer.mask.revealSelection' : 'pixel.layer.mask.revealAll')}>{a?.mask ? '− Mask' : 'Mask'}</Chip>
        <DropMenu label="Adjust ▾" align="right" items={[
          { label: 'Solid color fill', onClick: () => api.runCommand('pixel.layer.fill.solid') },
          ...ADJ_MENU.map((t) => ({ label: ADJUST_NAMES[t], onClick: () => api.runCommand(`pixel.adjLayer.${t}`) })),
        ]} style={{ padding: '5px 8px' }} />
        <Chip title="Layer style" onClick={() => api.runCommand('pixel.layer.style.dropShadow')}>fx</Chip>
        <Chip title="Delete layer" onClick={() => api.runCommand('pixel.layer.deleteLayer')}>Delete</Chip>
      </div>
    </>
  );
}

function ChannelsPanel({ doc, api, toast }: { doc: PixelDoc; api: ModuleApi; toast: (m: string, t?: 'info' | 'error') => void }) {
  const v = doc.pixelRev;
  const thumbs = useMemo(() => {
    const comp = composite(doc);
    const k = Math.min(1, 80 / Math.max(comp.width, comp.height));
    const small = newCanvas(Math.max(1, Math.round(comp.width * k)), Math.max(1, Math.round(comp.height * k)));
    ctx2d(small).drawImage(comp, 0, 0, small.width, small.height);
    const img = getImg(small);
    const ch = (i: number) => {
      const c = newCanvas(small.width, small.height);
      const out = ctx2d(c).createImageData(small.width, small.height);
      for (let p = 0; p < img.data.length; p += 4) { const val = img.data[p + i]; out.data[p] = out.data[p + 1] = out.data[p + 2] = val; out.data[p + 3] = img.data[p + 3]; }
      ctx2d(c).putImageData(out, 0, 0);
      return c;
    };
    return { rgb: small, r: ch(0), g: ch(1), b: ch(2) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, v]);
  const [selCh, setSelCh] = useState<string | null>(null);
  const row = (name: string, key: string, src: HTMLCanvasElement, onClick?: () => void, active?: boolean, extra?: React.ReactNode) => (
    <div key={name + key} onClick={onClick} className={active ? '' : 'hov-row'} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--line)', background: active ? 'var(--sel)' : 'transparent', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ width: 16, color: 'var(--mute)', fontSize: 11 }}>◉</div>
      <CanvasThumb source={src} width={40} height={28} version={v} checker={false} />
      <div style={{ flex: 1, font: 'var(--type-small)', fontWeight: 600 }}>{name}</div>
      {extra}
      <div style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{key}</div>
    </div>
  );
  return (
    <>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {row('RGB', '', thumbs.rgb, undefined, true)}
        {row('Red', '', thumbs.r)}
        {row('Green', '', thumbs.g)}
        {row('Blue', '', thumbs.b)}
        {doc.channels.map((c) => row(c.name, 'alpha', maskToCanvas(c.mask), () => setSelCh(c.id), selCh === c.id,
          <span className="hov-ink" title="Delete channel" onClick={(e) => { e.stopPropagation(); doc.channels = doc.channels.filter((x) => x.id !== c.id); doc.commit('Delete channel'); }} style={{ color: 'var(--mute)', cursor: 'pointer', padding: '0 4px' }}>✕</span>))}
        {doc.channels.length === 0 && <div className="empty-hint" style={{ padding: '10px 12px' }}>Saved selections appear here as alpha channels.</div>}
      </div>
      <div style={footer}>
        <Chip disabled={!doc.channels.length} onClick={() => {
          const id = selCh ?? doc.channels[doc.channels.length - 1]?.id;
          const c = doc.channels.find((x) => x.id === id);
          if (!c) return;
          doc.setSelection(c.mask); doc.commit('Load selection');
        }}>Load as selection</Chip>
        <Chip onClick={() => { if (!doc.selection) { toast('Make a selection first', 'error'); return; } api.runCommand('pixel.select.save'); }}>Save selection</Chip>
        <Chip onClick={() => { if (!doc.selection) { toast('Make a selection first', 'error'); return; } doc.channels = [...doc.channels, { id: Math.random().toString(36).slice(2), name: `Alpha ${doc.channels.length + 1}`, mask: doc.selection }]; doc.commit('New channel'); }}>+ Alpha</Chip>
      </div>
    </>
  );
}

function PathsPanel() {
  return (
    <>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        <div className="empty-hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>No paths. Pen tools and vector paths are on the roadmap <Planned /></div>
      </div>
      <div style={footer}>
        {['Fill path', 'Stroke path', '→ Selection', '→ Vector mask', '→ Shape'].map((n) => <Chip key={n} disabled>{n}</Chip>)}
      </div>
    </>
  );
}

function HistoryPanel({ doc }: { doc: PixelDoc }) {
  const fmt = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {doc.history.map((h, i) => {
          const cur = i === doc.histIndex;
          return (
            <div key={i} onClick={() => doc.jump(i)} className={cur ? '' : 'hov-row'}
              style={{ padding: '9px 14px 9px 8px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-small)', cursor: 'pointer', background: cur ? 'var(--sel)' : 'transparent', color: cur ? 'var(--ink)' : i > doc.histIndex ? 'var(--mute)' : 'var(--ink)', opacity: i > doc.histIndex ? 0.6 : 1 }}>
              <span title="Set as History brush source" onClick={(e) => { e.stopPropagation(); doc.ui.historySource = i; doc.emit(); }}
                style={{ width: 14, height: 14, border: '1px solid var(--line)', background: doc.ui.historySource === i ? 'var(--accent)' : 'transparent', flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{h.label}</span>
              <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{fmt(h.time)}</span>
            </div>
          );
        })}
      </div>
      <div style={footer}>
        <Chip disabled={!doc.canUndo} onClick={() => doc.undo()}>Undo</Chip>
        <Chip disabled={!doc.canRedo} onClick={() => doc.redo()}>Redo</Chip>
        <Chip onClick={() => doc.clearHistory()}>Clear history</Chip>
        <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)', alignSelf: 'center', marginLeft: 'auto' }}>{doc.history.length} states</span>
      </div>
    </>
  );
}

function ActionsPanel() {
  return (
    <>
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        <div className="empty-hint" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>No actions yet. Recording and playback are on the roadmap <Planned /></div>
      </div>
      <div style={footer}>
        {['● Record', '▶ Play', '■ Stop', 'Batch…', 'Droplet…', 'Scripts ▾'].map((n) => <Chip key={n} disabled>{n}</Chip>)}
      </div>
    </>
  );
}
