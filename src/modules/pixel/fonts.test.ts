import { describe, expect, it } from 'vitest';
import { afterFontReady, fontFamilyCss, fontString } from './engine/render';
import type { TextData } from './engine/doc';

const t = (font: string): TextData => ({ text: 'x', font, size: 20, weight: 700, italic: true, color: '#000', align: 'left', leading: 1.2, tracking: 0, underline: false });

describe('Pixel type fonts', () => {
  it('quotes family names but keeps generic families working', () => {
    expect(fontString(t('My Font'))).toBe('italic 700 20px "My Font", sans-serif');
    expect(fontFamilyCss('serif')).toBe('serif');
    expect(fontFamilyCss('Courier New')).toBe('"Courier New", monospace');
  });
  it('runs right away when there is nothing to load', () => {
    let ran = 0;
    expect(afterFontReady(t('Archivo'), () => ran++)).toBe(true);
    expect(ran).toBe(1);
  });
});
