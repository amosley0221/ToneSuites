// Font helpers for Write (pure: used by the editor schema, the PDF exporter and tests).
import { cssFontFamily } from '@/core/fonts';

export type FontCategory = 'sans' | 'serif' | 'mono';

/** The font the page uses when no font is set (matches the editor's --font-ui). */
export const DEFAULT_FONT = 'Archivo';
export const MONO_FONT = 'JetBrains Mono';

/** Generic category of a family name (used for CSS fallbacks and the PDF standard-font fallback). */
export function fontCategory(name: string): FontCategory {
  if (/mono|courier|consol|menlo|monaco|\bcode\b|typewriter/i.test(name)) return 'mono';
  if (/georgia|times|garamond|cambria|serif|baskerville|bodoni|book antiqua|palatino|didot|caslon|minion|constantia|charter|merriweather|playfair|lora/i.test(name) && !/sans/i.test(name)) return 'serif';
  return 'sans';
}

/** CSS font stack for a family chosen in the font picker; missing fonts fall back to the right generic family. */
export function cssFont(name: string): string {
  const cat = fontCategory(name);
  return cssFontFamily(name, cat === 'mono' ? 'ui-monospace, monospace' : cat === 'serif' ? 'serif' : 'sans-serif');
}

/** Families the PDF standard 14 fonts cover well enough (no need to embed). */
export function standardFontFor(name: string): FontCategory | null {
  const n = name.trim().toLowerCase();
  if (['helvetica', 'arial', 'sans-serif', 'helvetica neue'].includes(n)) return 'sans';
  if (['times', 'times new roman', 'serif'].includes(n)) return 'serif';
  if (['courier', 'courier new', 'monospace'].includes(n)) return 'mono';
  return null;
}

/**
 * Make text drawable by an embedded font: keep characters the font has, replace the rest with
 * `fallback` (the WinAnsi substitution for standard fonts) when the font has those, else "?".
 */
export function fitText(s: string, has: (cp: number) => boolean, fallback: (ch: string) => string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    const c = ch.codePointAt(0)!;
    if (c === 0x0a) { out += ' '; continue; }
    if (c === 0x09) { out += '    '; continue; }
    if (c < 0x20 || c === 0x200b || c === 0xfeff) continue;
    if (has(c)) { out += ch; continue; }
    const sub = fallback(ch);
    out += [...sub].every((x) => has(x.codePointAt(0)!)) ? sub : '?';
  }
  return out;
}
