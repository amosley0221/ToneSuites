// Conditional formatting: rules list + rule editor. Rules are applied by the grid renderer.
import { useState } from 'react';
import { Dialog } from '@/ui';
import { MAX_COLS, MAX_ROWS, parseRange, rangeToA1 } from './address';
import { COND_KINDS, describeRule, evalRule } from './condfmt';
import { uid, type CondKind, type CondRule, type Workbook } from './model';
import { ColorWell, Label, monoInput, stopEditKeys, TB } from './widgets';

export function CondFormatDialog({ wb, onClose }: { wb: Workbook; onClose: () => void }) {
  const s = wb.sheet;
  // Whole rows/columns are limited to the used area; a normal selection (even of empty cells to fill later) is kept.
  const sg = s.sel.range;
  const whole = sg.r1 >= MAX_ROWS - 1 || sg.c1 >= MAX_COLS - 1;
  const selRange = rangeToA1(whole ? wb.clampToUsed(s, sg) : sg);
  const [rules, setRules] = useState<CondRule[]>(() => s.condFormats.map((r) => ({ ...r, style: { ...r.style } })));
  const newRule = (): CondRule => ({ id: uid(), range: selRange, kind: 'gt', a: '0', style: { color: '#e5484d' } });
  const [cur, setCur] = useState<string | null>(() => rules[0]?.id ?? null);
  const addRule = () => { const r = newRule(); setRules((rs) => [...rs, r]); setCur(r.id); };
  const rule = rules.find((r) => r.id === cur) ?? null;
  const update = (patch: Partial<CondRule>) => setRules((rs) => rs.map((r) => (r.id === cur ? { ...r, ...patch } : r)));
  const updateStyle = (patch: Partial<CondRule['style']>) => setRules((rs) => rs.map((r) => (r.id === cur ? { ...r, style: { ...r.style, ...patch } } : r)));

  const done = () => {
    const valid = rules.filter((r) => parseRange(r.range));
    wb.structural(() => { s.condFormats = valid; });
    onClose();
  };

  const kind = COND_KINDS.find((k) => k.id === rule?.kind);
  // Preview: evaluate the rule against the active cell's value.
  const active = wb.display(s, s.sel.r, s.sel.c);
  const sampleValue = active.kind === 'num' ? active.num : active.text;
  const sampleText = active.text || '123.00';
  const sampleStyle = rule ? (rule.kind === 'scale' ? { fill: rule.scale?.max ?? '#2fb98a' } : rule.style) : null;
  const applies = rule && active.text ? !!evalRule({ rule, range: { r0: 0, c0: 0, r1: 0, c1: 0 }, threshold: -Infinity, min: 0, max: 1 }, sampleValue, active.text) : null;

  return (
    <Dialog title="Conditional formatting" subtitle={s.name} width={820} height={500} onClose={onClose}>
      <div onKeyDown={stopEditKeys} style={{ display: 'flex', flex: 1, minWidth: 0, font: 'var(--type-small)' }}>
        <div style={{ width: 320, borderRight: '1px solid var(--line)', padding: 14, display: 'flex', flexDirection: 'column', gap: 6, overflowY: 'auto', flexShrink: 0 }}>
          <Label style={{ paddingBottom: 6 }}>Rules on this sheet · {rules.length}</Label>
          {rules.map((r) => {
            const on = r.id === cur;
            return (
              <div key={r.id} onClick={() => setCur(r.id)} className={on ? '' : 'hov-row'}
                style={{ padding: '10px 12px', border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'), background: on ? 'var(--sel)' : 'transparent', cursor: 'pointer' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>{r.range || '—'}</span>
                  <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{COND_KINDS.find((k) => k.id === r.kind)?.label}</span>
                </div>
                <div style={{ color: 'var(--mute)', marginTop: 4 }}>{describeRule(r)}</div>
              </div>
            );
          })}
          <div onClick={addRule} className="hov-border"
            style={{ padding: '6px 12px', border: '1px solid var(--line)', cursor: 'pointer', textAlign: 'center', color: 'var(--mute)', marginTop: 6 }}>+ New rule</div>
        </div>
        <div style={{ flex: 1, padding: 20, display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {!rule && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
              <div className="empty-hint">{rules.length ? 'Select a rule to edit it.' : `No rules on this sheet yet. Create one for ${selRange}.`}</div>
              <TB onClick={addRule}>+ New rule</TB>
            </div>
          )}
          {rule && (
            <>
              <div>
                <Label>Apply to range</Label>
                <input value={rule.range} onChange={(e) => update({ range: e.target.value.toUpperCase() })} spellCheck={false}
                  style={{ ...monoInput, marginTop: 8, borderColor: parseRange(rule.range) ? 'var(--line)' : 'var(--negative)' }} />
              </div>
              <div>
                <Label>Format cells if</Label>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <select value={rule.kind} onChange={(e) => update({ kind: e.target.value as CondKind, ...(e.target.value === 'scale' && !rule.scale ? { scale: { min: '#ffffff', max: '#2fb98a' } } : {}), ...(e.target.value === 'topN' ? { a: rule.a && /^\d+$/.test(rule.a) ? rule.a : '10' } : {}) })}
                    style={{ flex: 1, padding: '6px 12px', border: '1px solid var(--line)', background: 'var(--bg1)', color: 'var(--ink)', font: 'var(--type-label)', fontSize: 12, cursor: 'pointer' }}>
                    {COND_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                  {kind && kind.args >= 1 && <input value={rule.a ?? ''} onChange={(e) => update({ a: e.target.value })} placeholder={rule.kind === 'topN' ? 'N' : 'Value'} style={{ ...monoInput, flex: 1, width: 'auto' }} />}
                  {kind && kind.args >= 2 && <input value={rule.b ?? ''} onChange={(e) => update({ b: e.target.value })} placeholder="and" style={{ ...monoInput, flex: 1, width: 'auto' }} />}
                </div>
              </div>
              <div>
                <Label>Style</Label>
                {rule.kind === 'scale' ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <ColorWell value={rule.scale?.min} onChange={(c) => update({ scale: { min: c ?? '#ffffff', max: rule.scale?.max ?? '#2fb98a' } })} title="Lowest value" />
                    <div style={{ width: 120, height: 14, background: `linear-gradient(90deg, ${rule.scale?.min ?? '#ffffff'}, ${rule.scale?.max ?? '#2fb98a'})`, border: '1px solid var(--line)' }} />
                    <ColorWell value={rule.scale?.max} onChange={(c) => update({ scale: { min: rule.scale?.min ?? '#ffffff', max: c ?? '#2fb98a' } })} title="Highest value" />
                    <span style={{ color: 'var(--mute)' }}>Lowest → highest</span>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 6, marginTop: 8, alignItems: 'center' }}>
                    <TB active={!!rule.style.b} onClick={() => updateStyle({ b: !rule.style.b })} style={{ fontWeight: 800 }}>B</TB>
                    <TB active={!!rule.style.i} onClick={() => updateStyle({ i: !rule.style.i })} style={{ fontStyle: 'italic' }}>I</TB>
                    <ColorWell value={rule.style.color} onChange={(c) => updateStyle({ color: c })} title="Text colour" />
                    <ColorWell value={rule.style.fill} onChange={(c) => updateStyle({ fill: c })} title="Fill colour" />
                    <span style={{ color: 'var(--mute)' }}>Text · Fill</span>
                  </div>
                )}
              </div>
              <div>
                <Label>Preview{active.text ? ` · active cell ${applies ? 'matches' : 'does not match'}` : ''}</Label>
                <div style={{
                  marginTop: 8, display: 'inline-flex', padding: '6px 10px', border: '1px solid var(--line)', font: 'var(--type-mono)',
                  background: sampleStyle?.fill ?? 'var(--bg0)', color: sampleStyle?.color ?? 'var(--ink)', fontWeight: sampleStyle?.b ? 700 : 500, fontStyle: sampleStyle?.i ? 'italic' : 'normal',
                }}>{sampleText}</div>
              </div>
            </>
          )}
          <div style={{ marginTop: 'auto', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {rule && <TB onClick={() => { setRules((rs) => rs.filter((r) => r.id !== cur)); setCur(rules.find((r) => r.id !== cur)?.id ?? null); }}>Delete rule</TB>}
            <button type="button" onClick={done}
              style={{ font: 'var(--type-label)', fontWeight: 800, padding: '8px 16px', background: 'var(--accent)', color: 'var(--on-accent)', border: 0, cursor: 'pointer' }}>Done</button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
