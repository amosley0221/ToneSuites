import { describe, expect, it } from 'vitest';
import { conflictCopyName, planFile } from './syncPlan';

const K = { hash: 'h1', rev: 'r1' };

describe('planFile', () => {
  it('does nothing when neither side changed', () => expect(planFile({ hash: 'h1' }, { rev: 'r1' }, K)).toBe('none'));
  it('uploads local-only changes', () => expect(planFile({ hash: 'h2' }, { rev: 'r1' }, K)).toBe('upload'));
  it('downloads remote-only changes', () => expect(planFile({ hash: 'h1' }, { rev: 'r2' }, K)).toBe('download'));
  it('flags edits on both sides as a conflict', () => expect(planFile({ hash: 'h2' }, { rev: 'r2' }, K)).toBe('conflict'));
  it('compares files that exist on both sides but were never synced', () => expect(planFile({ hash: 'x' }, { rev: 'y' }, undefined)).toBe('compare'));
  it('uploads new local files', () => expect(planFile({ hash: 'x' }, undefined, undefined)).toBe('upload'));
  it('downloads new remote files', () => expect(planFile(undefined, { rev: 'y' }, undefined)).toBe('download'));
  it('propagates a remote delete when local is unchanged', () => expect(planFile({ hash: 'h1' }, undefined, K)).toBe('deleteLocal'));
  it('keeps (re-uploads) a file deleted remotely but edited locally', () => expect(planFile({ hash: 'h2' }, undefined, K)).toBe('upload'));
  it('propagates a local delete when remote is unchanged', () => expect(planFile(undefined, { rev: 'r1' }, K)).toBe('deleteRemote'));
  it('keeps (downloads) a file deleted locally but edited remotely', () => expect(planFile(undefined, { rev: 'r2' }, K)).toBe('download'));
  it('forgets files gone everywhere', () => expect(planFile(undefined, undefined, K)).toBe('forget'));
});

describe('conflictCopyName', () => {
  const d = new Date('2026-10-14T12:00:00Z');
  it('inserts before the extension', () => expect(conflictCopyName('a/b/report.tone', 'Home NAS', d)).toBe('a/b/report (conflict Home NAS 2026-10-14).tone'));
  it('handles names without extension', () => expect(conflictCopyName('notes', 'Drive', d)).toBe('notes (conflict Drive 2026-10-14)'));
  it('ignores dots in folder names', () => expect(conflictCopyName('v1.2/notes', 'Drive', d)).toBe('v1.2/notes (conflict Drive 2026-10-14)'));
});
