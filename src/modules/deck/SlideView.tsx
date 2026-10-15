// Renders one slide at any pixel width: 1920×1080 logical stage scaled with a CSS transform.
// Used by the editor canvas, thumbnails, layout previews and the presenter.
import React, { CSSProperties } from 'react';
import { progressAt } from './timelineMath';
import {
  cssFont, fontSizeOf, masterOf, MONO_FONT, PH_HINT, SLIDE_H, SLIDE_W, slideBg, slideInk,
  type DeckData, type El, type Rect, type Slide, type TextEl,
} from './model';

export interface SlideViewProps {
  deck: DeckData;
  slide: Slide;
  index: number;
  total: number;
  width: number;
  mediaUrl: (path: string) => string;
  /** Editor: show placeholder hints for empty placeholders. */
  hints?: boolean;
  /** Seconds into the slide's build; undefined = everything in its final state. */
  animTime?: number;
  /** Morph transition from the previous slide (p = 0..1). */
  morph?: { from: Slide; p: number };
  editingId?: string | null;
  onElPointerDown?: (e: React.PointerEvent, el: El) => void;
  onElDoubleClick?: (e: React.MouseEvent, el: El) => void;
  onTextInput?: (el: TextEl, text: string) => void;
  onTextBlur?: (el: TextEl) => void;
  onCellInput?: (elId: string, r: number, c: number, text: string) => void;
  onCellBlur?: () => void;
  /** Tab / Shift+Tab in a table cell: move to the next / previous cell. */
  onCellNav?: (elId: string, r: number, c: number, back: boolean) => void;
  editingCell?: { r: number; c: number } | null;
  style?: CSSProperties;
  children?: React.ReactNode;
}

/** Focus a contentEditable and put the caret after its last character. */
function focusAtEnd(n: HTMLElement) {
  n.focus();
  const r = document.createRange();
  r.selectNodeContents(n);
  r.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

const ease = (p: number) => 1 - Math.pow(1 - p, 3);
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

export function textStyle(deck: DeckData, el: TextEl, ink: string): CSSProperties {
  const t = deck.theme;
  const fs = fontSizeOf(el);
  const st = el.style;
  const base: CSSProperties = {
    fontSize: fs, color: st.color ?? ink, textAlign: st.align ?? 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    fontStyle: st.italic ? 'italic' : 'normal', textDecoration: st.underline ? 'underline' : 'none',
  };
  if (el.role === 'title') {
    return { ...base, fontFamily: cssFont(st.font ?? t.titleFont), fontWeight: st.bold === false ? 600 : 900, letterSpacing: '-0.045em', lineHeight: 0.95 };
  }
  if (el.role === 'kicker') {
    return { ...base, fontFamily: cssFont(st.font ?? MONO_FONT), fontWeight: st.bold ? 700 : 400, lineHeight: 1.4, opacity: st.color ? 1 : 0.6, letterSpacing: '0.02em' };
  }
  return { ...base, fontFamily: cssFont(st.font ?? t.bodyFont), fontWeight: st.bold ? 700 : 500, lineHeight: 1.45, opacity: st.color || el.role === 'text' ? 1 : 0.75 };
}

/** Find the element on `from` that `el` morphs out of (same id, placeholder role, text or image). */
export function morphMatch(from: Slide, el: El): El | undefined {
  return from.elements.find((f) => f.id === el.id)
    ?? (el.ph ? from.elements.find((f) => f.ph === el.ph && f.type === el.type) : undefined)
    ?? from.elements.find((f) => f.type === el.type && (
      (f.type === 'text' && el.type === 'text' && f.text && f.text === el.text) ||
      (f.type === 'image' && el.type === 'image' && f.src && f.src === el.src)));
}

function animStyle(el: El, t: number | undefined): CSSProperties {
  if (t === undefined || !el.anim) return {};
  const p = progressAt(el.anim, t);
  if (p <= 0) return { opacity: 0 };
  if (p >= 1) return {};
  const e = ease(p);
  if (el.anim.effect === 'fly-in') return { transform: `translateY(${(1 - e) * (SLIDE_H - el.y + 40)}px)` };
  return { opacity: e };
}

function Bullets({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((l, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.55em' }}>
          {l.trim() ? <span style={{ flexShrink: 0 }}>•</span> : null}<span style={{ minWidth: 0 }}>{l || '​'}</span>
        </div>
      ))}
    </>
  );
}

function ElementView(props: { el: El; deck: DeckData; ink: string; p: SlideViewProps; extra?: CSSProperties }) {
  const { el, deck, ink, p, extra } = props;
  const box: CSSProperties = { position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, ...animStyle(el, p.animTime), ...extra };
  const events = {
    onPointerDown: p.onElPointerDown ? (e: React.PointerEvent) => p.onElPointerDown!(e, el) : undefined,
    onDoubleClick: p.onElDoubleClick ? (e: React.MouseEvent) => p.onElDoubleClick!(e, el) : undefined,
  };
  if (el.type === 'text') {
    const editing = p.editingId === el.id;
    const ts = textStyle(deck, el, ink);
    if (editing) {
      return (
        <div {...events} style={{ ...box, cursor: 'text' }} data-el={el.id}>
          <div
            contentEditable={'plaintext-only' as unknown as boolean}
            suppressContentEditableWarning
            ref={(n) => {
              if (n && n.dataset.init !== el.id) {
                n.dataset.init = el.id;
                n.innerText = el.text;
                focusAtEnd(n);
              }
            }}
            onInput={(e) => p.onTextInput?.(el, (e.currentTarget as HTMLElement).innerText.replace(/\n$/, ''))}
            onBlur={() => p.onTextBlur?.(el)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); }
            }}
            style={{ ...ts, outline: 'none', minHeight: '100%', caretColor: deck.theme.accent, userSelect: 'text' }}
          />
        </div>
      );
    }
    const empty = !el.text.trim();
    if (empty && !p.hints) return null;
    return (
      <div {...events} style={box} data-el={el.id}>
        {empty
          ? <div style={{ ...ts, opacity: 0.35 }}>{el.ph ? PH_HINT[el.ph] : 'Text'}</div>
          : <div style={ts}>{el.bullets ? <Bullets text={el.text} /> : el.text}</div>}
      </div>
    );
  }
  if (el.type === 'image') {
    if (!el.src) {
      if (!p.hints) return null;
      return (
        <div {...events} data-el={el.id} style={{ ...box, background: 'repeating-linear-gradient(135deg,rgba(128,128,128,.25) 0 20px,transparent 20px 40px)', border: '3px dashed rgba(128,128,128,.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: cssFont(MONO_FONT), fontSize: 26, color: '#888' }}>
          [ {PH_HINT.image} ]
        </div>
      );
    }
    return (
      <div {...events} data-el={el.id} style={{ ...box, overflow: 'hidden' }}>
        <img src={p.mediaUrl(el.src)} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: el.fit, display: 'block', pointerEvents: 'none' }} />
      </div>
    );
  }
  if (el.type === 'shape') {
    const sw = el.strokeWidth;
    return (
      <div {...events} data-el={el.id} style={{ ...box, overflow: 'visible' }}>
        <svg width={Math.max(el.w, 1)} height={Math.max(el.h, 1)} style={{ overflow: 'visible', display: 'block' }}>
          {el.shape === 'rect' && <rect x={sw / 2} y={sw / 2} width={Math.max(0, el.w - sw)} height={Math.max(0, el.h - sw)} fill={el.fill || 'none'} stroke={el.stroke || 'none'} strokeWidth={sw} />}
          {el.shape === 'ellipse' && <ellipse cx={el.w / 2} cy={el.h / 2} rx={Math.max(0, el.w / 2 - sw / 2)} ry={Math.max(0, el.h / 2 - sw / 2)} fill={el.fill || 'none'} stroke={el.stroke || 'none'} strokeWidth={sw} />}
          {el.shape === 'line' && (
            <>
              <line x1={0} y1={el.flip ? el.h : 0} x2={el.w} y2={el.flip ? 0 : el.h} stroke="transparent" strokeWidth={Math.max(sw, 24)} />
              <line x1={0} y1={el.flip ? el.h : 0} x2={el.w} y2={el.flip ? 0 : el.h} stroke={el.stroke || ink} strokeWidth={sw} />
            </>
          )}
        </svg>
      </div>
    );
  }
  // table
  const cols = el.rows[0]?.length ?? 0;
  return (
    <div {...events} data-el={el.id} style={{ ...box, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: cssFont(deck.theme.bodyFont), fontSize: el.fontSize, color: ink }}>
        <tbody>
          {el.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, c) => {
                const isEditing = p.editingId === el.id && p.editingCell?.r === r && p.editingCell?.c === c;
                return (
                  <td key={c} style={{ border: `2px solid ${ink}33`, padding: '10px 16px', fontWeight: el.header && r === 0 ? 800 : 500, width: `${100 / cols}%`, verticalAlign: 'top', background: el.header && r === 0 ? `${ink}14` : 'transparent' }}>
                    {isEditing
                      ? <div contentEditable={'plaintext-only' as unknown as boolean} suppressContentEditableWarning
                          ref={(n) => { if (n && n.dataset.init !== `${r}:${c}`) { n.dataset.init = `${r}:${c}`; n.innerText = cell; focusAtEnd(n); } }}
                          onInput={(e) => p.onCellInput?.(el.id, r, c, (e.currentTarget as HTMLElement).innerText.replace(/\n$/, ''))}
                          onBlur={() => p.onCellBlur?.()}
                          onKeyDown={(e) => {
                            if (e.key === 'Tab' && p.onCellNav) { e.preventDefault(); p.onCellNav(el.id, r, c, e.shiftKey); }
                            else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); }
                          }}
                          style={{ outline: 'none', minHeight: '1em', userSelect: 'text' }} />
                      : (cell || '​')}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Footer({ deck, index, total, ink }: { deck: DeckData; index: number; total: number; ink: string }) {
  const f = masterOf(deck).footer;
  if (!f.slideNumber && !f.date && !(f.showText && f.text)) return null;
  const st: CSSProperties = { position: 'absolute', bottom: 46, fontFamily: cssFont(MONO_FONT), fontSize: 26, color: ink, opacity: 0.5, whiteSpace: 'nowrap' };
  const right = [f.date ? new Date().toLocaleDateString() : '', f.showText ? f.text : ''].filter(Boolean).join(' · ');
  return (
    <>
      {f.slideNumber && <div style={{ ...st, left: 128 }}>{String(index + 1).padStart(2, '0')} / {total}</div>}
      {right && <div style={{ ...st, right: 128 }}>{right}</div>}
    </>
  );
}

export function SlideView(p: SlideViewProps) {
  const { deck, slide, width } = p;
  const scale = width / SLIDE_W;
  const bg = slideBg(deck, slide);
  const ink = slideInk(deck, slide);
  const morph = p.morph;
  const mp = morph ? ease(morph.p) : 1;
  const matched = new Map<El, El>();
  const usedFrom = new Set<El>();
  if (morph) {
    for (const el of slide.elements) {
      const m = morphMatch(morph.from, el);
      if (m && !usedFrom.has(m)) { matched.set(el, m); usedFrom.add(m); }
    }
  }
  return (
    <div style={{ width, height: (width * SLIDE_H) / SLIDE_W, position: 'relative', overflow: 'hidden', flexShrink: 0, background: morph ? slideBg(deck, morph.from) : bg, ...p.style }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
        {morph && <div style={{ position: 'absolute', inset: 0, background: bg, opacity: mp }} />}
        {morph && morph.from.elements.filter((f) => !usedFrom.has(f)).map((f) => (
          <ElementView key={'from-' + f.id} el={f} deck={deck} ink={slideInk(deck, morph.from)} p={{ ...p, hints: false, animTime: undefined, onElPointerDown: undefined, onElDoubleClick: undefined }} extra={{ opacity: 1 - mp }} />
        ))}
        {slide.elements.map((el) => {
          let extra: CSSProperties | undefined;
          if (morph) {
            const m = matched.get(el);
            if (m) {
              const r: Rect = { x: lerp(m.x, el.x, mp), y: lerp(m.y, el.y, mp), w: lerp(m.w, el.w, mp), h: lerp(m.h, el.h, mp) };
              extra = { left: r.x, top: r.y, width: r.w, height: r.h };
            } else extra = { opacity: mp };
          }
          return <ElementView key={el.id} el={el} deck={deck} ink={ink} p={p} extra={extra} />;
        })}
        <Footer deck={deck} index={p.index} total={p.total} ink={ink} />
        {p.children}
      </div>
    </div>
  );
}
