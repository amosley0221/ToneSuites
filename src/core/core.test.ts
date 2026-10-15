import { describe, expect, it } from 'vitest';
import { keyEvent, normShortcut } from './commands';
import { packTone, unpackTone } from './toneFile';
import { changelogFor, cmpVersion } from './updater';

describe('.tone container', () => {
  it('round-trips manifest and payload', async () => {
    const bytes = await packTone({ mode: 'write', title: 't.tone', created: 'c', modified: 'm', appVersion: '0.1.0', deviceId: 'd' }, { 'document.json': '{"a":1}', 'media/x.bin': new Uint8Array([1, 2, 3]) });
    const { manifest, files } = await unpackTone(bytes);
    expect(manifest.mode).toBe('write');
    expect(manifest.formatVersion).toBe(1);
    expect(new TextDecoder().decode(files['document.json'])).toBe('{"a":1}');
    expect([...files['media/x.bin']]).toEqual([1, 2, 3]);
  });
  it('refuses files from a newer format', async () => {
    const JSZip = (await import('jszip')).default;
    const z = new JSZip();
    z.file('manifest.json', JSON.stringify({ format: 'tone', formatVersion: 99, mode: 'write' }));
    await expect(unpackTone(await z.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/newer version/);
  });
});

describe('updates', () => {
  it('compares versions', () => {
    expect(cmpVersion('0.2.0', '0.1.9')).toBe(1);
    expect(cmpVersion('v1.0.0', '1.0.0')).toBe(0);
    expect(cmpVersion('1.0.10', '1.0.9')).toBe(1);
    expect(cmpVersion('1.0.0', '1.1.0')).toBe(-1);
  });
  it('extracts the changelog section for a version', () => {
    const md = '# C\n\n## [Unreleased]\n\n## [0.2.0] - 2026-11-01\n### Fixed\n- thing\n\n## [0.1.0] - x\n- old\n';
    expect(changelogFor(md, '0.2.0')).toBe('### Fixed\n- thing');
    expect(changelogFor(md, '0.1.0')).toBe('- old');
    expect(changelogFor(md, '9.9.9')).toBe('');
  });
});

describe('shortcuts', () => {
  it('normalises shortcut strings', () => {
    expect(normShortcut('Ctrl Shift S')).toBe('ctrl+shift+s');
    expect(normShortcut('Ctrl Alt Shift I')).toBe('ctrl+alt+shift+i');
    expect(normShortcut('F12')).toBe('f12');
    expect(normShortcut('Ctrl +')).toBe('ctrl+=');
  });
  it('matches shifted punctuation by physical key', () => {
    const ev = { key: '}', code: 'BracketRight', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent;
    expect(keyEvent(ev)).toBe(normShortcut('Ctrl Shift ]'));
  });
  it('matches Ctrl Space against the key event', () => {
    const ev = { key: ' ', code: 'Space', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false } as KeyboardEvent;
    expect(keyEvent(ev)).toBe(normShortcut('Ctrl Space'));
  });
});

describe('save error messages', async () => {
  const { saveErrorMessage } = await import('./documents');
  it('explains a file locked by another app', () => {
    expect(saveErrorMessage('a.csv', new Error('The process cannot access the file because it is being used by another process. (os error 32)'))).toMatch(/open in another app/);
  });
  it('keeps other errors', () => expect(saveErrorMessage('a.csv', 'disk full')).toBe('Save failed: disk full'));
});
