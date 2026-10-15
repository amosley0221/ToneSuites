// Sync engine against an in-memory provider and a temp folder per simulated device.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';

const cur = { data: '' };
const remote = new Map<string, { bytes: Uint8Array; rev: number }>();
let revSeq = 1;

vi.mock('@/core/platform', () => ({
  isTauri: true,
  appDataDir: async () => cur.data,
  joinPath: async (...p: string[]) => path.join(...p),
  listFilesRecursive: async (root: string) => {
    const out: { path: string; rel: string; size: number; mtime: number }[] = [];
    const walk = (dir: string, rel: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith('.')) continue;
        const full = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r);
        else { const st = fs.statSync(full); out.push({ path: full, rel: r, size: st.size, mtime: Math.floor(st.mtimeMs) }); }
      }
    };
    walk(root, '');
    return out;
  },
  statFile: async (p: string) => { const st = fs.statSync(p); return { size: st.size, mtime: Math.floor(st.mtimeMs) }; },
  readFile: async (p: string) => new Uint8Array(fs.readFileSync(p)),
  writeFile: async (p: string, d: Uint8Array) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, d); },
  readText: async (p: string) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null),
  writeText: async (p: string, t: string) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); },
  removePath: async (p: string) => fs.rmSync(p, { recursive: true, force: true }),
  sha256Hex: async (d: Uint8Array) => createHash('sha256').update(d).digest('hex'),
  appVersion: async () => 'test',
  uid: () => Math.random().toString(36).slice(2),
  hostname: async () => 'test', osLabel: async () => 'Test', defaultWorkspaceDir: async () => '',
  httpFetch: async () => { throw new Error('no network in tests'); },
}));

// A WebDAV server whose PUT answers a quoted ETag while listings report it bare (as wsgidav and others do).
vi.mock('./webdav', async (orig) => {
  const real = await orig<typeof import('./webdav')>();
  class WebDavProvider {
    constructor(public config: { id: string; name: string }) {}
    label() { return 'mem://'; }
    async test() {}
    async list(rel: string) {
      const pre = rel ? rel + '/' : '';
      return [...remote.entries()].filter(([k]) => k.startsWith(pre) && !k.slice(pre.length).includes('/'))
        .map(([k, v]) => ({ rel: k, isDir: false, size: v.bytes.length, mtime: v.rev, rev: `${v.rev}` }));
    }
    async listAll() { return [...remote.entries()].map(([k, v]) => ({ rel: k, isDir: false, size: v.bytes.length, mtime: v.rev, rev: `${v.rev}` })); }
    async get(rel: string) { const f = remote.get(rel); if (!f) throw new Error('404'); return f.bytes; }
    async put(rel: string, bytes: Uint8Array) { const rev = revSeq++; remote.set(rel, { bytes, rev }); return `"${rev}"`; }
    async remove(rel: string) { remote.delete(rel); }
    async usage() { return null; }
  }
  return { ...real, WebDavProvider };
});

const { useSettings } = await import('@/core/settings');
const { useApp } = await import('@/core/store');
const sync = await import('./sync');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'tone-sync-'));
const dev = (n: string) => ({ ws: path.join(T, n, 'ws'), data: path.join(T, n, 'data'), id: 'dev-' + n });
const A = dev('A'), B = dev('B');
const provider = { id: 'mem', kind: 'webdav' as const, name: 'NAS', enabled: true, sync: true, url: 'mem://x' };
async function syncAs(d: typeof A) {
  cur.data = d.data;
  useSettings.setState({ loaded: true, s: { ...useSettings.getState().s, deviceId: d.id, deviceName: d.id, workspaceDir: d.ws, providers: [provider], conflictPolicy: 'ask' } });
  await sync.syncAll();
  return useApp.getState().sync;
}
const write = (d: typeof A, rel: string, t: string) => { const p = path.join(d.ws, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); };
const read = (d: typeof A, rel: string) => { const p = path.join(d.ws, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };

describe('sync engine', () => {
  const replaced: string[] = [];
  beforeAll(() => { sync.syncHooks.onLocalReplaced = (p) => replaced.push(p); });
  afterAll(() => fs.rmSync(T, { recursive: true, force: true }));

  it('uploads, mirrors to the other device and then stays quiet', async () => {
    write(A, 'notes/a.tone', 'one');
    await syncAs(A);
    expect(new TextDecoder().decode(remote.get('notes/a.tone')!.bytes)).toBe('one');
    await syncAs(B);
    expect(read(B, 'notes/a.tone')).toBe('one');
    replaced.length = 0;
    await syncAs(A); await syncAs(B); await syncAs(A);
    // A quoted ETag from PUT must not look like a remote change (which reloads open tabs).
    expect(replaced).toEqual([]);
    expect(useApp.getState().sync.pending).toBe(0);
    expect(useApp.getState().sync.devices.map((d) => d.id)).toEqual([B.id]);
  });

  it('reports edits on both sides as a conflict and applies the choice', async () => {
    write(A, 'notes/a.tone', 'from A');
    write(B, 'notes/a.tone', 'from B!');
    await syncAs(A);
    const st = await syncAs(B);
    expect(st.conflicts.map((c) => c.rel)).toEqual(['notes/a.tone']);
    sync.resolveConflict(st.conflicts[0], 'both');
    expect(useApp.getState().sync.conflicts).toEqual([]);
    await syncAs(B);
    expect(read(B, 'notes/a.tone')).toBe('from B!');
    const copies = fs.readdirSync(path.join(B.ws, 'notes')).filter((f) => f.includes('(conflict NAS'));
    expect(copies.length).toBe(1);
    expect(read(B, 'notes/' + copies[0])).toBe('from A');
    await syncAs(B); await syncAs(A);
    expect(read(A, 'notes/a.tone')).toBe('from B!');
    expect(read(A, 'notes/' + copies[0])).toBe('from A');
  });

  it('propagates deletes', async () => {
    fs.rmSync(path.join(A.ws, 'notes', 'a.tone'));
    await syncAs(A);
    expect(remote.has('notes/a.tone')).toBe(false);
    await syncAs(B);
    expect(read(B, 'notes/a.tone')).toBe(null);
  });
});
