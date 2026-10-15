// Deck data model: pure types + factories (no DOM). Slide coordinates are logical units on a 1920×1080 canvas.

export const SLIDE_W = 1920;
export const SLIDE_H = 1080;

export interface Rect { x: number; y: number; w: number; h: number }

export type Transition = 'none' | 'fade' | 'push' | 'morph';
export const TRANSITIONS: { id: Transition; label: string }[] = [
  { id: 'none', label: 'None' }, { id: 'fade', label: 'Fade' }, { id: 'push', label: 'Push' }, { id: 'morph', label: 'Morph' },
];

export type AnimEffect = 'appear' | 'fade' | 'fly-in';
export const ANIM_EFFECTS: { id: AnimEffect; label: string }[] = [
  { id: 'appear', label: 'Appear' }, { id: 'fade', label: 'Fade in' }, { id: 'fly-in', label: 'Fly in' },
];
export interface Animation { effect: AnimEffect; delay: number; duration: number }

export interface Theme { bg: string; ink: string; accent: string; titleFont: string; bodyFont: string }

/** Text roles map to the deck type scale (kicker mono 11, title 54/900, body 15 at 736px preview). */
export type TextRole = 'kicker' | 'title' | 'body' | 'text';
export type PlaceholderRole = 'kicker' | 'title' | 'body' | 'body2' | 'image';

export interface TextStyle {
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  color?: string;
  font?: string;
}

interface ElBase extends Rect {
  id: string;
  /** Set when the element fills a layout placeholder. */
  ph?: PlaceholderRole;
  /** A filled placeholder kept as a free element after a layout change; it becomes the placeholder again when a later layout has that role. */
  phWas?: PlaceholderRole;
  anim?: Animation;
}
export interface TextEl extends ElBase { type: 'text'; role: TextRole; text: string; bullets: boolean; style: TextStyle }
export interface ImageEl extends ElBase { type: 'image'; src: string; fit: 'cover' | 'contain' }
export type ShapeKind = 'rect' | 'ellipse' | 'line';
export interface ShapeEl extends ElBase {
  type: 'shape'; shape: ShapeKind; fill: string; stroke: string; strokeWidth: number;
  /** Lines run top-left → bottom-right of their box; flip makes them bottom-left → top-right. */
  flip?: boolean;
}
export interface TableEl extends ElBase { type: 'table'; rows: string[][]; header: boolean; fontSize: number }
export type El = TextEl | ImageEl | ShapeEl | TableEl;

export interface Slide {
  id: string;
  layoutId: LayoutId;
  /** Background override; falls back to master then theme. */
  bg?: string;
  ink?: string;
  elements: El[];
  transition: Transition;
  notes: string;
}

export type LayoutId = 'title' | 'title-content' | 'two-column' | 'image-full' | 'section' | 'blank';
export interface Placeholder { role: PlaceholderRole; rect: Rect }
export interface Layout { id: LayoutId; name: string; placeholders: Placeholder[] }

export interface Footer { slideNumber: boolean; date: boolean; showText: boolean; text: string }
export interface Master { id: string; name: string; bg?: string; ink?: string; layouts: Layout[]; footer: Footer }

export interface DeckData {
  formatVersion: 1;
  size: { w: number; h: number; ratio: '16:9' };
  theme: Theme;
  masters: Master[];
  slides: Slide[];
}

// ---------- Static options (features, not data) ----------

export const ROLE_FONT_SIZE: Record<TextRole, number> = { kicker: 29, title: 141, body: 39, text: 39 };
export const PH_TO_ROLE: Record<Exclude<PlaceholderRole, 'image'>, TextRole> = { kicker: 'kicker', title: 'title', body: 'body', body2: 'body' };
export const PH_HINT: Record<PlaceholderRole, string> = {
  kicker: 'Click to add kicker', title: 'Click to add title', body: 'Click to add text', body2: 'Click to add text', image: 'Click to add image',
};

export const BG_PRESETS: { bg: string; ink: string; label: string }[] = [
  { bg: '#0c0c0e', ink: '#f2f1ee', label: 'Dark' },
  { bg: '#f2f1ee', ink: '#0c0c0e', label: 'Light' },
  { bg: '#ff5a1f', ink: '#0c0c0e', label: 'Accent' },
  { bg: '#1f3a5f', ink: '#f2f1ee', label: 'Navy' },
  { bg: '#e9e2cf', ink: '#141414', label: 'Cream' },
];

/** Bundled fonts first, then common system fonts. */
export const FONT_CHOICES = ['Archivo', 'JetBrains Mono', 'Georgia', 'Helvetica', 'Arial', 'Times New Roman', 'Courier New'];
export const MONO_FONT = 'JetBrains Mono';

export function cssFont(name: string): string {
  if (name === 'JetBrains Mono') return '"JetBrains Mono", ui-monospace, monospace';
  if (name === 'Georgia' || name === 'Times New Roman') return `"${name}", serif`;
  if (name === 'Courier New') return '"Courier New", monospace';
  return `"${name}", Helvetica, Arial, sans-serif`;
}

const M = 128; // outer margin in slide units (48px at the 736px preview)
const CW = SLIDE_W - 2 * M;

export function defaultLayouts(): Layout[] {
  return [
    { id: 'title', name: 'Title', placeholders: [
      { role: 'kicker', rect: { x: M, y: 600, w: 1100, h: 44 } },
      { role: 'title', rect: { x: M, y: 652, w: 1400, h: 170 } },
      { role: 'body', rect: { x: M, y: 846, w: 1100, h: 110 } },
    ] },
    { id: 'title-content', name: 'Title + content', placeholders: [
      { role: 'title', rect: { x: M, y: 110, w: CW, h: 170 } },
      { role: 'body', rect: { x: M, y: 320, w: CW, h: 640 } },
    ] },
    { id: 'two-column', name: 'Two column', placeholders: [
      { role: 'title', rect: { x: M, y: 110, w: CW, h: 170 } },
      { role: 'body', rect: { x: M, y: 320, w: 800, h: 640 } },
      { role: 'body2', rect: { x: M + 864, y: 320, w: 800, h: 640 } },
    ] },
    { id: 'image-full', name: 'Image full bleed', placeholders: [
      { role: 'image', rect: { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H } },
      { role: 'title', rect: { x: M, y: 800, w: 1400, h: 170 } },
    ] },
    { id: 'section', name: 'Section header', placeholders: [
      { role: 'kicker', rect: { x: M, y: 420, w: 1100, h: 44 } },
      { role: 'title', rect: { x: M, y: 472, w: CW, h: 170 } },
    ] },
    { id: 'blank', name: 'Blank', placeholders: [] },
  ];
}

export function defaultTheme(): Theme {
  return { bg: '#0c0c0e', ink: '#f2f1ee', accent: '#ff5a1f', titleFont: 'Archivo', bodyFont: 'Archivo' };
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function defaultMaster(): Master {
  return { id: 'master-1', name: 'Default', layouts: defaultLayouts(), footer: { slideNumber: true, date: false, showText: false, text: '' } };
}

export function emptyDeck(): DeckData {
  const d: DeckData = { formatVersion: 1, size: { w: SLIDE_W, h: SLIDE_H, ratio: '16:9' }, theme: defaultTheme(), masters: [defaultMaster()], slides: [] };
  d.slides.push(newSlide(d, 'title'));
  return d;
}

// ---------- Lookups ----------

export function masterOf(d: DeckData): Master { return d.masters[0]; }
export function layoutOf(d: DeckData, id: LayoutId): Layout {
  const ls = masterOf(d).layouts;
  return ls.find((l) => l.id === id) ?? ls[0];
}
export function slideBg(d: DeckData, s: Slide): string { return s.bg ?? masterOf(d).bg ?? d.theme.bg; }
export function slideInk(d: DeckData, s: Slide): string { return s.ink ?? masterOf(d).ink ?? d.theme.ink; }

// ---------- Element factories ----------

export function textEl(role: TextRole, rect: Rect, text = '', ph?: PlaceholderRole): TextEl {
  return { id: newId(), type: 'text', role, text, bullets: false, style: {}, ...rect, ph };
}
function placeholderEl(p: Placeholder): El {
  if (p.role === 'image') return { id: newId(), type: 'image', src: '', fit: 'cover', ...p.rect, ph: 'image' };
  const el = textEl(PH_TO_ROLE[p.role], p.rect, '', p.role);
  if (p.role === 'body' || p.role === 'body2') el.bullets = false;
  return el;
}

export function newSlide(d: DeckData, layoutId: LayoutId): Slide {
  const layout = layoutOf(d, layoutId);
  return { id: newId(), layoutId: layout.id, elements: layout.placeholders.map(placeholderEl), transition: 'none', notes: '' };
}

export function isEmptyEl(el: El): boolean {
  if (el.type === 'text') return el.text.trim() === '';
  if (el.type === 'image') return !el.src;
  return false;
}

/**
 * Re-flow a slide onto another layout. Placeholder elements move to the new layout's matching box;
 * empty placeholders that have no counterpart are dropped; filled ones are kept where they are
 * (as free elements) so no user content is ever lost. Missing placeholders are created empty.
 */
export function applyLayout(d: DeckData, s: Slide, layoutId: LayoutId): void {
  const layout = layoutOf(d, layoutId);
  const used = new Set<El>();
  const next: El[] = [];
  for (const p of layout.placeholders) {
    const match = s.elements.find((e) => e.ph === p.role && !used.has(e))
      ?? s.elements.find((e) => !e.ph && e.phWas === p.role && !used.has(e));
    if (match) {
      used.add(match);
      Object.assign(match, p.rect, { ph: p.role });
      delete match.phWas;
      next.push(match);
    } else next.push(placeholderEl(p));
  }
  for (const e of s.elements) {
    if (used.has(e)) continue;
    if (e.ph && isEmptyEl(e)) continue;
    if (e.ph) { e.phWas = e.ph; delete e.ph; }
    next.push(e);
  }
  // Keep the original z-order for elements that already existed.
  const order = new Map(s.elements.map((e, i) => [e, i]));
  next.sort((a, b) => (order.get(a) ?? -1) - (order.get(b) ?? -1));
  s.elements = next;
  s.layoutId = layout.id;
}

export function cloneSlide(s: Slide): Slide {
  const c: Slide = JSON.parse(JSON.stringify(s));
  c.id = newId();
  for (const e of c.elements) e.id = newId();
  return c;
}

export function fontSizeOf(el: TextEl): number { return el.style.fontSize ?? ROLE_FONT_SIZE[el.role]; }

/** Title text of a slide (for thumbnails, outlines, presenter "next"). */
export function slideTitle(s: Slide): string {
  const t = s.elements.find((e): e is TextEl => e.type === 'text' && e.ph === 'title')
    ?? s.elements.find((e): e is TextEl => e.type === 'text' && e.role === 'title');
  return t?.text.split('\n')[0] ?? '';
}

export function elLabel(el: El): string {
  if (el.type === 'text') {
    const t = el.text.trim().split('\n')[0];
    if (t) return t.length > 22 ? t.slice(0, 21) + '…' : t;
    return el.ph ? el.ph[0].toUpperCase() + el.ph.slice(1).replace('2', ' 2') : 'Text';
  }
  if (el.type === 'image') return 'Image';
  if (el.type === 'table') return `Table ${el.rows.length}×${el.rows[0]?.length ?? 0}`;
  return el.shape === 'rect' ? 'Rectangle' : el.shape === 'ellipse' ? 'Ellipse' : 'Line';
}

// ---------- Master / layout editing (propagates to slides that use the layout) ----------

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Move/resize a layout placeholder; slide placeholders that were not moved by hand follow it. */
export function setPlaceholderRect(d: DeckData, layoutId: LayoutId, role: PlaceholderRole, rect: Rect): void {
  const p = layoutOf(d, layoutId).placeholders.find((x) => x.role === role);
  if (!p) return;
  const old = { ...p.rect };
  p.rect = { ...rect };
  for (const s of d.slides) {
    if (s.layoutId !== layoutId) continue;
    for (const e of s.elements) if (e.ph === role && sameRect(e, old)) Object.assign(e, rect);
  }
}

export const PLACEHOLDER_ROLES: PlaceholderRole[] = ['kicker', 'title', 'body', 'body2', 'image'];

export function addPlaceholder(d: DeckData, layoutId: LayoutId, role: PlaceholderRole): void {
  const layout = layoutOf(d, layoutId);
  if (layout.placeholders.some((p) => p.role === role)) return;
  const def = defaultLayouts().flatMap((l) => l.placeholders).find((p) => p.role === role);
  const ph: Placeholder = { role, rect: def ? { ...def.rect } : { x: M, y: 320, w: CW, h: 400 } };
  if (role === 'image') layout.placeholders.unshift(ph); else layout.placeholders.push(ph);
  for (const s of d.slides) {
    if (s.layoutId !== layoutId || s.elements.some((e) => e.ph === role)) continue;
    if (role === 'image') s.elements.unshift(placeholderEl(ph)); else s.elements.push(placeholderEl(ph));
  }
}

export function removePlaceholder(d: DeckData, layoutId: LayoutId, role: PlaceholderRole): void {
  const layout = layoutOf(d, layoutId);
  layout.placeholders = layout.placeholders.filter((p) => p.role !== role);
  for (const s of d.slides) {
    if (s.layoutId !== layoutId) continue;
    s.elements = s.elements.filter((e) => !(e.ph === role && isEmptyEl(e)));
    for (const e of s.elements) if (e.ph === role) delete e.ph;
  }
}

/** Restore a layout's default placeholders and re-flow its slides. */
export function resetLayout(d: DeckData, layoutId: LayoutId): void {
  const def = defaultLayouts().find((l) => l.id === layoutId);
  const layout = layoutOf(d, layoutId);
  if (!def) return;
  layout.placeholders = def.placeholders;
  for (const s of d.slides) if (s.layoutId === layoutId) applyLayout(d, s, layoutId);
}
