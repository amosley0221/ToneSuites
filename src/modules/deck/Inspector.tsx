// Deck inspector (280px): layout grid, theme, transition, selection properties, animation, export.
import React from 'react';
import type { ModuleApi } from '@/core/types';
import { Button, Checkbox, Eyebrow, Segmented } from '@/ui';
import { FontPicker } from '@/ui/FontPicker';
import { IMAGE_EXTS } from './commands';
import { extMime, type DeckDoc } from './doc';
import { LayoutThumb } from './LayoutThumb';
import {
  ANIM_EFFECTS, BG_PRESETS, fontSizeOf, masterOf, slideBg, TRANSITIONS,
  type AnimEffect, type El, type TextEl, type Transition,
} from './model';
import * as ops from './ops';
import { ColorField, NumField } from './parts';

const Row = ({ label, children }: { label: React.ReactNode; children: React.ReactNode }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, font: 'var(--type-small)' }}>
    <span style={{ color: 'var(--mute)' }}>{label}</span>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{children}</div>
  </div>
);

function ExportRow({ label, hint, onClick, planned }: { label: string; hint: string; onClick: () => void; planned?: boolean }) {
  return (
    <div onClick={onClick} className="hov-border" style={{ padding: '8px 10px', border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', cursor: 'pointer', font: 'var(--type-small)', fontWeight: 600, transition: 'border-color var(--dur-fast)' }}>
      <span style={{ color: planned ? 'var(--mute)' : 'var(--ink)' }}>{label}</span><span style={{ color: 'var(--mute)', fontWeight: 500 }}>{hint}</span>
    </div>
  );
}

export function Inspector({ doc, api, compact }: { doc: DeckDoc; api: ModuleApi; compact: boolean }) {
  const d = doc.data;
  const s = doc.slide();
  const sel = doc.selected();
  const one: El | undefined = sel.length === 1 ? sel[0] : undefined;
  const bg = s ? slideBg(d, s) : d.theme.bg;
  const set = (fn: () => void, key?: string) => { fn(); doc.commit(key); };
  const run = (id: string) => api.runCommand(id);

  return (
    <div className={`inspector${compact && doc.ui.panelsOpen ? ' open' : ''}`}>
      <div className="insp-section">
        <Eyebrow>Layout</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {masterOf(d).layouts.map((l) => <LayoutThumb key={l.id} layout={l} active={s?.layoutId === l.id} onClick={() => ops.setLayout(doc, l.id)} />)}
        </div>
      </div>

      <div className="insp-section">
        <Eyebrow>Theme</Eyebrow>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {BG_PRESETS.map((p) => (
            <div key={p.bg} title={`${p.label} — click: whole deck · Shift-click: this slide`}
              onClick={(e) => ops.setBackground(doc, p.bg, p.ink, e.shiftKey ? 'slide' : 'theme')}
              style={{ width: 32, height: 32, background: p.bg, cursor: 'pointer', border: bg.toLowerCase() === p.bg ? '2px solid var(--accent)' : '1px solid var(--line)' }} />
          ))}
          <span style={{ flex: 1 }} />
          <ColorField value={bg} title="Custom background (this slide)" onChange={(v) => set(() => { if (s) s.bg = v; }, 'slide-bg')} />
        </div>
        <Row label="Title font">
          <FontPicker value={d.theme.titleFont} width={140} onChange={(v) => set(() => { d.theme.titleFont = v; })} />
        </Row>
        <Row label="Body font">
          <FontPicker value={d.theme.bodyFont} width={140} onChange={(v) => set(() => { d.theme.bodyFont = v; })} />
        </Row>
        <Row label="Accent">
          <ColorField value={d.theme.accent} onChange={(v) => set(() => { d.theme.accent = v; }, 'accent')} />
        </Row>
      </div>

      <div className="insp-section">
        <Eyebrow>Transition</Eyebrow>
        <Segmented value={TRANSITIONS.find((t) => t.id === (s?.transition ?? 'none'))!.label} options={TRANSITIONS.map((t) => t.label)}
          onChange={(v) => ops.setTransition(doc, TRANSITIONS.find((t) => t.label === v)!.id as Transition)} />
        <div style={{ marginTop: 8 }}>
          <Button size="sm" variant="ghost" onClick={() => run('deck.slide.transition.applyAll')}>Apply to all slides</Button>
        </div>
      </div>

      {one && <ElementSection doc={doc} el={one} api={api} />}
      {sel.length > 0 && (
        <div className="insp-section">
          <Eyebrow>Arrange</Eyebrow>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            <Button size="sm" onClick={() => ops.arrange(doc, 'front')}>Front</Button>
            <Button size="sm" onClick={() => ops.arrange(doc, 'forward')}>Forward</Button>
            <Button size="sm" onClick={() => ops.arrange(doc, 'backward')}>Backward</Button>
            <Button size="sm" onClick={() => ops.arrange(doc, 'back')}>Back</Button>
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {([['left', '⇤'], ['hcenter', '↔'], ['right', '⇥'], ['top', '⤒'], ['vmiddle', '↕'], ['bottom', '⤓']] as [ops.AlignMode, string][]).map(([m, g]) => (
              <Button key={m} size="sm" title={`Align ${m === 'hcenter' ? 'center' : m === 'vmiddle' ? 'middle' : m}${sel.length === 1 ? ' to slide' : ''}`} onClick={() => ops.align(doc, m)}>{g}</Button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            <Button size="sm" onClick={() => ops.duplicateSelection(doc)}>Duplicate</Button>
            <Button size="sm" onClick={() => ops.deleteSelection(doc)}>Delete</Button>
          </div>
        </div>
      )}
      {one && <AnimationSection doc={doc} el={one} />}

      <div className="insp-section">
        <Eyebrow>Export</Eyebrow>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ExportRow label="PDF" hint="Ctrl Shift E" onClick={() => run('file.export')} />
          <ExportRow label="PowerPoint (.pptx)" hint="compatible" onClick={() => run('deck.file.exportPptx')} />
          <ExportRow label="Video (.mp4)" hint="planned" planned onClick={() => run('deck.file.exportVideo')} />
        </div>
      </div>
    </div>
  );
}

function ElementSection({ doc, el, api }: { doc: DeckDoc; el: El; api: ModuleApi }) {
  const set = (fn: () => void, key?: string) => { fn(); doc.commit(key); };
  return (
    <div className="insp-section">
      <Eyebrow>{el.type === 'text' ? (el.ph ? `${el.ph.replace('2', ' 2')} placeholder` : 'Text box') : el.type === 'shape' ? el.shape : el.type}</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <NumField label="X" width="100%" value={el.x} onChange={(v) => set(() => { el.x = v; })} />
        <NumField label="Y" width="100%" value={el.y} onChange={(v) => set(() => { el.y = v; })} />
        <NumField label="W" width="100%" min={0} value={el.w} onChange={(v) => set(() => { el.w = v; })} />
        <NumField label="H" width="100%" min={0} value={el.h} onChange={(v) => set(() => { el.h = v; })} />
      </div>
      {el.type === 'text' && <TextProps doc={doc} el={el} />}
      {el.type === 'shape' && (
        <>
          {el.shape !== 'line' && <Row label="Fill"><ColorField value={el.fill} allowNone onChange={(v) => set(() => { el.fill = v; }, 'fill')} /></Row>}
          <Row label="Stroke"><ColorField value={el.stroke} allowNone={el.shape !== 'line'} onChange={(v) => set(() => { el.stroke = v; }, 'stroke')} /></Row>
          <Row label="Stroke width"><NumField label="" min={0} value={el.strokeWidth} onChange={(v) => set(() => { el.strokeWidth = v; })} /></Row>
          {el.shape === 'line' && <Row label="Direction"><Checkbox checked={!!el.flip} onChange={(v) => set(() => { el.flip = v; })} label="Flip" /></Row>}
        </>
      )}
      {el.type === 'image' && (
        <>
          <Row label="Fit"><Segmented value={el.fit === 'cover' ? 'Fill' : 'Fit'} options={['Fill', 'Fit']} onChange={(v) => set(() => { el.fit = v === 'Fill' ? 'cover' : 'contain'; })} /></Row>
          <div style={{ marginTop: 8 }}>
            <Button size="sm" onClick={async () => {
              const [f] = await api.pickFile(IMAGE_EXTS);
              if (!f) return;
              set(() => { el.src = doc.addMedia(f.bytes, extMime(f.name.split('.').pop() ?? '')); });
            }}>{el.src ? 'Replace image…' : 'Choose image…'}</Button>
          </div>
        </>
      )}
      {el.type === 'table' && (
        <>
          <Row label="Rows">
            <Button size="sm" disabled={el.rows.length <= 1} onClick={() => set(() => { el.rows.pop(); el.h = Math.max(40, el.h - el.h / (el.rows.length + 1)); })}>−</Button>
            <span style={{ font: 'var(--type-mono)', width: 20, textAlign: 'center' }}>{el.rows.length}</span>
            <Button size="sm" onClick={() => set(() => { el.rows.push(el.rows[0].map(() => '')); el.h += el.h / (el.rows.length - 1); })}>+</Button>
          </Row>
          <Row label="Columns">
            <Button size="sm" disabled={(el.rows[0]?.length ?? 0) <= 1} onClick={() => set(() => { for (const r of el.rows) r.pop(); })}>−</Button>
            <span style={{ font: 'var(--type-mono)', width: 20, textAlign: 'center' }}>{el.rows[0]?.length ?? 0}</span>
            <Button size="sm" onClick={() => set(() => { for (const r of el.rows) r.push(''); })}>+</Button>
          </Row>
          <Row label="Font size"><NumField label="" min={8} value={el.fontSize} onChange={(v) => set(() => { el.fontSize = v; })} /></Row>
          <Row label="Header row"><Checkbox checked={el.header} onChange={(v) => set(() => { el.header = v; })} /></Row>
          <div className="empty-hint" style={{ fontSize: 11 }}>Double-click a cell to edit it.</div>
        </>
      )}
    </div>
  );
}

function TextProps({ doc, el }: { doc: DeckDoc; el: TextEl }) {
  const set = (fn: () => void, key?: string) => { fn(); doc.commit(key); };
  const st = el.style;
  const bold = el.role === 'title' ? st.bold !== false : !!st.bold;
  return (
    <>
      <Row label="Font">
        <FontPicker value={st.font ?? ''} width={140} allowEmpty emptyLabel="Theme"
          onChange={(v) => set(() => { if (v) st.font = v; else delete st.font; })} />
      </Row>
      <Row label="Size">
        <NumField label="" min={6} value={fontSizeOf(el)} onChange={(v) => set(() => { st.fontSize = v; })} />
      </Row>
      <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
        <Button size="sm" active={bold} onClick={() => set(() => { st.bold = !bold; })}><b>B</b></Button>
        <Button size="sm" active={!!st.italic} onClick={() => set(() => { st.italic = !st.italic; })}><i>I</i></Button>
        <Button size="sm" active={!!st.underline} onClick={() => set(() => { st.underline = !st.underline; })}><u>U</u></Button>
        <span style={{ width: 6 }} />
        {(['left', 'center', 'right'] as const).map((a) => (
          <Button key={a} size="sm" active={(st.align ?? 'left') === a} title={`Align ${a}`} onClick={() => set(() => { st.align = a; })}>{a === 'left' ? '≡⇤' : a === 'center' ? '≡' : '⇥≡'}</Button>
        ))}
        <Button size="sm" active={el.bullets} title="Bullets" onClick={() => set(() => { el.bullets = !el.bullets; })}>• List</Button>
      </div>
      <Row label="Color">
        <ColorField value={st.color ?? ''} allowNone onChange={(v) => set(() => { if (v) st.color = v; else delete st.color; }, 'color')} />
      </Row>
    </>
  );
}

function AnimationSection({ doc, el }: { doc: DeckDoc; el: El }) {
  const a = el.anim;
  const set = (fn: () => void) => { fn(); doc.commit(); };
  return (
    <div className="insp-section">
      <Eyebrow>Animation</Eyebrow>
      {!a
        ? <Button size="sm" onClick={() => { doc.ui.timeline = true; ops.toggleAnimation(doc); }}>+ Add animation</Button>
        : (
          <>
            <Segmented value={ANIM_EFFECTS.find((x) => x.id === a.effect)!.label} options={ANIM_EFFECTS.map((x) => x.label)}
              onChange={(v) => set(() => { a.effect = ANIM_EFFECTS.find((x) => x.label === v)!.id as AnimEffect; })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginTop: 8 }}>
              <NumField label="Delay" width="100%" step={0.05} min={0} value={a.delay} onChange={(v) => set(() => { a.delay = v; })} />
              <NumField label="Dur" width="100%" step={0.05} min={0.1} value={a.duration} onChange={(v) => set(() => { a.duration = v; })} />
            </div>
            <div style={{ marginTop: 8 }}><Button size="sm" variant="ghost" onClick={() => set(() => { delete el.anim; })}>Remove animation</Button></div>
          </>
        )}
    </div>
  );
}
