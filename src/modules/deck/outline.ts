// .toneoutline interchange ({ title, slides: [{ title, body: string[] }] }) and Markdown outline export.
import { emptyDeck, newSlide, slideTitle, type DeckData, type TextEl } from './model';

export interface ToneOutline { title?: string; slides: { title?: string; body?: string[] }[] }

export function parseOutline(json: string): ToneOutline {
  const raw = JSON.parse(json) as unknown;
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as ToneOutline).slides)) throw new Error('Not a Tone outline (missing "slides")');
  const o = raw as ToneOutline;
  return {
    title: typeof o.title === 'string' ? o.title : undefined,
    slides: o.slides.map((s) => ({
      title: typeof s?.title === 'string' ? s.title : '',
      body: Array.isArray(s?.body) ? s.body.filter((b) => typeof b === 'string') : [],
    })),
  };
}

/** First slide uses the Title layout, the rest Title + content (body lines become bullets). */
export function outlineToDeck(o: ToneOutline): DeckData {
  const d = emptyDeck();
  if (!o.slides.length) return d;
  d.slides = o.slides.map((s, i) => {
    const slide = newSlide(d, i === 0 ? 'title' : 'title-content');
    for (const el of slide.elements) {
      if (el.type !== 'text') continue;
      if (el.ph === 'title') el.text = s.title ?? '';
      if (el.ph === 'body') {
        el.text = (s.body ?? []).join('\n');
        el.bullets = i > 0 && (s.body?.length ?? 0) > 0;
      }
    }
    return slide;
  });
  return d;
}

export function deckToOutline(d: DeckData, title: string): ToneOutline {
  return {
    title,
    slides: d.slides.map((s) => ({
      title: slideTitle(s),
      body: s.elements
        .filter((e): e is TextEl => e.type === 'text' && e.role !== 'title' && e.role !== 'kicker')
        .flatMap((e) => e.text.split('\n'))
        .map((l) => l.trim())
        .filter(Boolean),
    })),
  };
}

export function deckToMarkdown(d: DeckData, title: string): string {
  const out: string[] = [`# ${title}`, ''];
  d.slides.forEach((s, i) => {
    out.push(`## ${slideTitle(s) || `Slide ${i + 1}`}`, '');
    for (const el of s.elements) {
      if (el.type !== 'text' || el.ph === 'title' || !el.text.trim()) continue;
      if (el.role === 'kicker') { out.push(`*${el.text.trim()}*`, ''); continue; }
      const lines = el.text.split('\n').filter((l) => l.trim());
      out.push(...lines.map((l) => (el.bullets ? `- ${l.trim()}` : l.trim())), '');
    }
    if (s.notes.trim()) out.push(...s.notes.trim().split('\n').map((l) => `> ${l}`), '');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}
