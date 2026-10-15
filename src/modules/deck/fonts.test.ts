import { describe, expect, it } from 'vitest';
import { cssFont, fontCategory } from './model';

describe('Deck fonts', () => {
  it('builds CSS stacks with the right fallback', () => {
    expect(cssFont('JetBrains Mono')).toBe('"JetBrains Mono", ui-monospace, monospace');
    expect(cssFont('Georgia')).toBe('"Georgia", serif');
    expect(cssFont('My "Font"')).toBe('"My Font", Helvetica, Arial, sans-serif');
    expect(fontCategory('Source Code Pro')).toBe('mono');
    expect(fontCategory('Merriweather Sans')).toBe('sans');
  });
});
