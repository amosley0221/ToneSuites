// Masters & layouts dialog (~1240×700): master + 6 layouts, editable placeholder boxes, background, footer.
import React, { useState } from 'react';
import { Button, Checkbox, Dialog, Eyebrow, Input } from '@/ui';
import { resizeRect } from './Canvas';
import type { DeckDoc } from './doc';
import { LayoutThumb } from './LayoutThumb';
import {
  addPlaceholder, BG_PRESETS, cssFont, layoutOf, masterOf, MONO_FONT, PLACEHOLDER_ROLES, removePlaceholder, resetLayout, setPlaceholderRect,
  SLIDE_H, SLIDE_W, type LayoutId, type PlaceholderRole, type Rect,
} from './model';
import { PopMenu } from './parts';

const PREVIEW_W = 640;
const ROLE_INFO: Record<PlaceholderRole, { name: string; spec: (d: DeckDoc) => string }> = {
  kicker: { name: 'Kicker', spec: () => 'Mono 11' },
  title: { name: 'Title', spec: (d) => `${d.data.theme.titleFont} 54/900` },
  body: { name: 'Body', spec: (d) => `${d.data.theme.bodyFont} 15` },
  body2: { name: 'Body 2', spec: (d) => `${d.data.theme.bodyFont} 15` },
  image: { name: 'Image', spec: () => 'Fill' },
};
type Sel = 'master' | LayoutId;
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

export function MastersDialog({ doc, onClose }: { doc: DeckDoc; onClose: () => void }) {
  const d = doc.data;
  const master = masterOf(d);
  const [sel, setSel] = useState<Sel>(doc.slide()?.layoutId ?? 'title');
  const [role, setRole] = useState<PlaceholderRole | null>('title');
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
  const layout = sel === 'master' ? null : layoutOf(d, sel);
  const bg = master.bg ?? d.theme.bg;
  const ink = master.ink ?? d.theme.ink;
  const k = PREVIEW_W / SLIDE_W;

  const startDrag = (e: React.PointerEvent, r: PlaceholderRole, h: Handle | 'move') => {
    if (!layout) return;
    e.stopPropagation();
    e.preventDefault();
    setRole(r);
    const p = layout.placeholders.find((x) => x.role === r)!;
    const o: Rect = { ...p.rect };
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      moved = true;
      const next = h === 'move' ? { ...o, x: Math.round(o.x + dx), y: Math.round(o.y + dy) } : resizeRect(o, h, dx, dy, ev.shiftKey, 20);
      setPlaceholderRect(d, layout.id, r, next);
      doc.emit();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) doc.commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const sample = (r: PlaceholderRole): React.ReactNode => {
    const t = d.theme;
    if (r === 'title') return <div style={{ fontFamily: cssFont(t.titleFont), fontWeight: 900, fontSize: 141, letterSpacing: '-0.045em', lineHeight: 0.95 }}>Click to edit title</div>;
    if (r === 'kicker') return <div style={{ fontFamily: cssFont(MONO_FONT), fontSize: 29, opacity: 0.6 }}>Kicker placeholder · mono 11</div>;
    if (r === 'image') return <div style={{ fontFamily: cssFont(MONO_FONT), fontSize: 29, opacity: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'repeating-linear-gradient(135deg,rgba(128,128,128,.18) 0 20px,transparent 20px 40px)' }}>[ Image placeholder ]</div>;
    return <div style={{ fontFamily: cssFont(t.bodyFont), fontSize: 39, opacity: 0.75, lineHeight: 1.45 }}>{r === 'body2' ? 'Second column' : 'Body placeholder'} · {t.bodyFont} 15</div>;
  };

  const missing = layout ? PLACEHOLDER_ROLES.filter((r) => !layout.placeholders.some((p) => p.role === r)) : [];
  const footer = master.footer;
  const setFooter = (fn: () => void) => { fn(); doc.commit(); };

  return (
    <Dialog title="Masters & layouts" subtitle={doc.title} width={1240} height={700} onClose={onClose}>
      <div style={{ width: 220, borderRight: '1px solid var(--line)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', flexShrink: 0 }}>
        <Eyebrow style={{ padding: '0 4px 4px' }}>Master</Eyebrow>
        <div onClick={() => { setSel('master'); setRole(null); }}
          style={{ aspectRatio: '16 / 9', background: bg, color: ink, border: `2px solid ${sel === 'master' ? 'var(--accent)' : 'var(--line)'}`, padding: 8, fontSize: 9, fontWeight: 900, cursor: 'pointer', flexShrink: 0 }}>
          {master.name}
        </div>
        <Eyebrow style={{ padding: '8px 4px 4px' }}>Layouts</Eyebrow>
        {master.layouts.map((l) => (
          <div key={l.id} style={{ flexShrink: 0 }}>
            <LayoutThumb layout={l} active={sel === l.id} onClick={() => { setSel(l.id); setRole(l.placeholders[0]?.role ?? null); }} />
            <div style={{ font: 'var(--type-small)', fontSize: 11, color: sel === l.id ? 'var(--ink)' : 'var(--mute)', padding: '4px 4px 6px' }}>{l.name}</div>
          </div>
        ))}
      </div>

      <div onPointerDown={() => setRole(null)} style={{ flex: 1, minWidth: 0, background: 'var(--canvas)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, overflow: 'hidden' }}>
        <div style={{ width: PREVIEW_W, height: PREVIEW_W * SLIDE_H / SLIDE_W, background: bg, color: ink, position: 'relative', boxShadow: 'var(--shadow-page)', flexShrink: 0 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, width: SLIDE_W, height: SLIDE_H, transform: `scale(${k})`, transformOrigin: '0 0', overflow: 'hidden', pointerEvents: 'none' }}>
            {layout?.placeholders.map((p) => (
              <div key={p.role} style={{ position: 'absolute', left: p.rect.x, top: p.rect.y, width: p.rect.w, height: p.rect.h, overflow: 'hidden', padding: 8 }}>{sample(p.role)}</div>
            ))}
            {(footer.slideNumber || footer.date || footer.showText) && (
              <div style={{ position: 'absolute', right: 128, bottom: 46, fontFamily: cssFont(MONO_FONT), fontSize: 24, opacity: 0.5 }}>
                {[footer.slideNumber ? '‹#›' : '', footer.date ? 'Date' : '', footer.showText ? (footer.text || 'Footer') : ''].filter(Boolean).join(' · ')}
              </div>
            )}
            {sel === 'master' && <div style={{ position: 'absolute', left: 128, top: 128, fontFamily: cssFont(MONO_FONT), fontSize: 29, opacity: 0.5 }}>Master · background and footer apply to every layout</div>}
          </div>
          {layout?.placeholders.map((p) => {
            const on = role === p.role;
            return (
              <div key={p.role} onPointerDown={(e) => startDrag(e, p.role, 'move')}
                style={{ position: 'absolute', left: p.rect.x * k, top: p.rect.y * k, width: p.rect.w * k, height: p.rect.h * k, cursor: 'move', touchAction: 'none',
                  border: `1px dashed ${on ? 'var(--accent)' : 'rgba(128,128,128,.6)'}` }}>
                {on && HANDLES.map((h) => (
                  <div key={h} onPointerDown={(e) => startDrag(e, p.role, h)}
                    style={{ position: 'absolute', width: 8, height: 8, marginLeft: -4, marginTop: -4, background: '#fff', border: '1px solid var(--accent)', touchAction: 'none',
                      left: h.includes('w') ? 0 : h.includes('e') ? '100%' : '50%', top: h.includes('n') ? 0 : h.includes('s') ? '100%' : '50%',
                      cursor: h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize' }} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ width: 260, borderLeft: '1px solid var(--line)', padding: '16px 14px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto', flexShrink: 0 }}>
        <div>
          <Eyebrow>Editing</Eyebrow>
          <div style={{ marginTop: 6, font: 'var(--type-subtitle)', letterSpacing: '-0.02em' }}>{layout ? layout.name : `${master.name} master`}</div>
        </div>
        {layout && (
          <div>
            <Eyebrow>Placeholders</Eyebrow>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
              {layout.placeholders.map((p) => (
                <div key={p.role} onClick={() => setRole(p.role)} className="hov-border"
                  style={{ padding: '6px 10px', border: `1px solid ${role === p.role ? 'var(--accent)' : 'var(--line)'}`, display: 'flex', justifyContent: 'space-between', gap: 8, cursor: 'pointer', font: 'var(--type-small)', fontWeight: 600 }}>
                  <span>{ROLE_INFO[p.role].name}</span>
                  <span style={{ display: 'flex', gap: 8, color: 'var(--mute)', fontWeight: 500 }}>
                    {ROLE_INFO[p.role].spec(doc)}
                    <span className="hov-ink" title="Remove placeholder" onClick={(e) => { e.stopPropagation(); removePlaceholder(d, layout.id, p.role); doc.commit(); }}>✕</span>
                  </span>
                </div>
              ))}
              {!layout.placeholders.length && <div className="empty-hint">This layout has no placeholders.</div>}
              <div onClick={(e) => { if (missing.length) { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setAddAt({ x: r.left, y: r.bottom + 2 }); } }}
                className="hov-border" style={{ padding: '6px 12px', border: '1px solid var(--line)', cursor: missing.length ? 'pointer' : 'default', color: 'var(--mute)', textAlign: 'center', font: 'var(--type-small)', opacity: missing.length ? 1 : 0.5 }}>
                + Add placeholder
              </div>
            </div>
          </div>
        )}
        <div>
          <Eyebrow>Background</Eyebrow>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            {BG_PRESETS.map((p) => (
              <div key={p.bg} title={p.label} onClick={() => { master.bg = p.bg; master.ink = p.ink; doc.commit(); }}
                style={{ width: 28, height: 28, background: p.bg, cursor: 'pointer', border: master.bg === p.bg ? '2px solid var(--accent)' : '1px solid var(--line)' }} />
            ))}
            <div title="Use the theme background" onClick={() => { delete master.bg; delete master.ink; doc.commit(); }}
              style={{ width: 28, height: 28, cursor: 'pointer', border: master.bg ? '1px dashed var(--line)' : '2px dashed var(--accent)' }} />
          </div>
        </div>
        <div>
          <Eyebrow>Footer</Eyebrow>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <Checkbox checked={footer.slideNumber} onChange={(v) => setFooter(() => { footer.slideNumber = v; })} label="Slide number" />
            <Checkbox checked={footer.showText} onChange={(v) => setFooter(() => { footer.showText = v; })} label="Footer text" />
            {footer.showText && <Input value={footer.text} placeholder="Footer text" onChange={(v) => { footer.text = v; doc.commit('footer-text'); }} />}
            <Checkbox checked={footer.date} onChange={(v) => setFooter(() => { footer.date = v; })} label="Date" />
          </div>
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', gap: 6 }}>
          {layout && <Button style={{ flex: 1, justifyContent: 'center' }} onClick={() => { resetLayout(d, layout.id); doc.commit(); }}>Reset layout</Button>}
          <Button variant="primary" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Back to deck</Button>
        </div>
      </div>
      {addAt && layout && (
        <PopMenu x={addAt.x} y={addAt.y} width={200} onClose={() => setAddAt(null)}
          items={missing.map((r) => ({ label: ROLE_INFO[r].name, onClick: () => { addPlaceholder(d, layout.id, r); setRole(r); doc.commit(); } }))} />
      )}
    </Dialog>
  );
}
