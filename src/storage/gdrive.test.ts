// Google Drive provider against a tiny fake of the Drive v3 REST API.
import { describe, expect, it, vi } from 'vitest';

interface F { id: string; name: string; mimeType: string; parents: string[]; data?: Uint8Array; modifiedTime: string; trashed?: boolean }
const files: F[] = [];
let seq = 1;
const calls: { method: string; url: string; body?: string }[] = [];
let expireNext = false;
const add = (name: string, mimeType: string, parent: string, data?: string) => {
  const f: F = { id: 'f' + seq++, name, mimeType, parents: [parent], data: data ? new TextEncoder().encode(data) : undefined, modifiedTime: new Date(1700000000000 + seq * 1000).toISOString() };
  files.push(f);
  return f;
};

function matchQ(q: string, f: F): boolean {
  if (f.trashed) return false;
  const name = /name='((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\(.)/g, '$1');
  const parent = /'([^']+)' in parents/.exec(q)?.[1];
  const mime = /mimeType='([^']+)'/.exec(q)?.[1];
  return (!name || f.name === name) && (!parent || f.parents.includes(parent)) && (!mime || f.mimeType === mime);
}
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });

vi.mock('@/core/platform', () => ({
  isTauri: true,
  openExternal: async () => {},
  appDataDir: async () => '/tmp', joinPath: async (...p: string[]) => p.join('/'), readText: async () => null, writeText: async () => {},
  uid: () => 'u', hostname: async () => 'h', osLabel: async () => 'o', defaultWorkspaceDir: async () => '',
  httpFetch: async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: typeof init.body === 'string' ? init.body : init.body ? new TextDecoder().decode(init.body as Uint8Array) : undefined });
    if (u.hostname === 'oauth2.googleapis.com') return json({ access_token: 'fresh', expires_in: 3600 });
    if ((init.headers as Record<string, string>)?.Authorization === 'Bearer stale' && expireNext) { expireNext = false; return json({ error: { message: 'expired' } }, 401); }
    const path = u.pathname.replace(/^\/(upload\/)?drive\/v3/, '');
    if (path === '/files' && method === 'GET') return json({ files: files.filter((f) => matchQ(u.searchParams.get('q') ?? '', f)) });
    if (path === '/files' && method === 'POST' && !u.searchParams.get('uploadType')) {
      const m = JSON.parse(String(init.body));
      return json({ id: add(m.name, m.mimeType, m.parents[0]).id });
    }
    const id = path.split('/')[2];
    const f = files.find((x) => x.id === id);
    if (path.endsWith('/export')) return new Response(new TextEncoder().encode(`exported ${f!.name} as ${u.searchParams.get('mimeType')}`));
    if (method === 'GET' && u.searchParams.get('alt') === 'media') return new Response(f!.data as BodyInit);
    if (method === 'GET') return json({ mimeType: f?.mimeType });
    if (u.searchParams.get('uploadType') === 'multipart') {
      const target = method === 'POST' ? add('?', 'application/octet-stream', '') : f!;
      if (method === 'POST') { const meta = JSON.parse(String(calls.at(-1)!.body).split('\r\n\r\n')[1].split('\r\n')[0]); target.name = meta.name; target.parents = meta.parents; }
      return json({ id: target.id, md5Checksum: 'md5-' + target.id + '-' + calls.length });
    }
    if (method === 'PATCH') { f!.trashed = true; return json({}); }
    return json({ error: { message: 'unhandled ' + method + ' ' + path } }, 500);
  },
}));

const { useSettings } = await import('@/core/settings');
const { GDriveProvider } = await import('./gdrive');
const cfg = { id: 'g', kind: 'gdrive' as const, name: 'Drive', enabled: true, sync: true, url: 'Tone', clientId: 'cid' };
useSettings.setState({ secrets: { g: { accessToken: 'tok', expiresAt: Date.now() + 1e6, refreshToken: 'r', clientSecret: 's' } } });

describe('GDriveProvider', () => {
  it('creates the root folder and nested folders on upload, then updates in place', async () => {
    const p = new GDriveProvider(cfg, 'Tone');
    await p.put('a/b/x.tone', new Uint8Array([1, 2, 3]));
    const tone = files.find((f) => f.name === 'Tone')!;
    const a = files.find((f) => f.name === 'a')!;
    expect(a.parents).toEqual([tone.id]);
    const x = files.find((f) => f.name === 'x.tone')!;
    expect(x.parents).toEqual([files.find((f) => f.name === 'b')!.id]);
    // A fresh provider (as every sync / open creates) finds the existing file and PATCHes it.
    const before = files.length;
    await new GDriveProvider(cfg, 'Tone').put('a/b/x.tone', new Uint8Array([4]));
    expect(files.length).toBe(before);
    expect(calls.at(-1)!.method).toBe('PATCH');
  });

  it('opens a Google Doc listed as .docx from a fresh provider (Open from Drive / recents)', async () => {
    const tone = files.find((f) => f.name === 'Tone')!;
    add('Plan', 'application/vnd.google-apps.document', tone.id);
    const listed = await new GDriveProvider(cfg, 'Tone').list('');
    expect(listed.map((e) => e.rel)).toContain('Plan.docx');
    const bytes = await new GDriveProvider(cfg, 'Tone').get('Plan.docx');
    expect(new TextDecoder().decode(bytes)).toMatch(/exported Plan as application\/vnd.openxmlformats-officedocument.wordprocessingml.document/);
    // Saving back sends the docx type so Drive converts instead of storing junk in the Doc.
    await new GDriveProvider(cfg, 'Tone').put('Plan.docx', new Uint8Array([9]));
    expect(calls.at(-1)!.method).toBe('PATCH');
    expect(calls.at(-1)!.body).toContain('Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  });

  it('refreshes and retries once when the access token is rejected', async () => {
    useSettings.setState({ secrets: { g: { accessToken: 'stale', expiresAt: Date.now() + 1e6, refreshToken: 'r', clientSecret: 's' } } });
    expireNext = true;
    const listed = await new GDriveProvider(cfg, 'Tone').list('');
    expect(listed.length).toBeGreaterThan(0);
    expect(useSettings.getState().secrets.g.accessToken).toBe('fresh');
  });

  it('trashes on remove', async () => {
    await new GDriveProvider(cfg, 'Tone').remove('a/b/x.tone');
    expect(files.find((f) => f.name === 'x.tone')!.trashed).toBe(true);
  });
});
