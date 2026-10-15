import { describe, expect, it } from 'vitest';
import { updateAction } from './updater';

const u = { version: '0.2.0', kind: 'desktop' as const };
const prompt = { updateMode: 'prompt' as const, updatePromptedVersion: '' };
const ctx = { manual: false, atLaunch: false, hasUnsaved: false };

describe('updateAction', () => {
  it('pops up once per new version', () => {
    expect(updateAction(u, prompt, ctx)).toBe('popup');
    expect(updateAction(u, { ...prompt, updatePromptedVersion: '0.2.0' }, ctx)).toBe('badge');
    expect(updateAction({ ...u, version: '0.3.0' }, { ...prompt, updatePromptedVersion: '0.2.0' }, ctx)).toBe('popup');
  });
  it('always shows the popup when asked', () => expect(updateAction(u, { ...prompt, updatePromptedVersion: '0.2.0' }, { ...ctx, manual: true })).toBe('popup'));
  it('installs silently only at launch with nothing unsaved', () => {
    const silent = { updateMode: 'silent' as const, updatePromptedVersion: '' };
    expect(updateAction(u, silent, { ...ctx, atLaunch: true })).toBe('install');
    expect(updateAction(u, silent, ctx)).toBe('badge'); // mid-session check never restarts the app
    expect(updateAction(u, silent, { ...ctx, atLaunch: true, hasUnsaved: true })).toBe('badge');
    expect(updateAction({ ...u, kind: 'android' }, silent, { ...ctx, atLaunch: true })).toBe('popup');
  });
});
