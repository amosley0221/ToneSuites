// WebDAV provider — used for the UGREEN NAS (UGOS Pro "WebDAV" file service) or any WebDAV server.
import { httpFetch } from '@/core/platform';
import type { ProviderConfig } from '@/core/settings';
import { joinRel, type RemoteEntry, type StorageProvider } from './provider';

function b64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

export class WebDavProvider implements StorageProvider {
  constructor(public config: ProviderConfig, private password: string) {}

  private base(): string {
    return (this.config.url ?? '').replace(/\/+$/, '');
  }
  private urlFor(rel: string, dir = false): string {
    const enc = rel.split('/').filter(Boolean).map(encodeURIComponent).join('/');
    return this.base() + (enc ? '/' + enc : '') + (dir ? '/' : '');
  }
  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { ...extra };
    if (this.config.username) h.Authorization = 'Basic ' + b64(`${this.config.username}:${this.password}`);
    return h;
  }
  private basePath(): string {
    try { return decodeURIComponent(new URL(this.base()).pathname).replace(/\/+$/, ''); } catch { return ''; }
  }

  label() { return this.base().replace(/^https?:\/\//, 'webdav://'); }

  async test() {
    if (!this.config.url) throw new Error('Enter the WebDAV address of your NAS');
    const r = await httpFetch(this.urlFor('', true), { method: 'PROPFIND', headers: this.headers({ Depth: '0' }) });
    if (r.status === 401) throw new Error('Username or password rejected by the NAS');
    if (r.status === 404) {
      // Root folder does not exist yet: create it.
      const m = await httpFetch(this.urlFor('', true), { method: 'MKCOL', headers: this.headers() });
      if (!m.ok && m.status !== 405) throw new Error(`Could not create folder (${m.status})`);
      return;
    }
    if (!r.ok && r.status !== 207) throw new Error(`NAS answered ${r.status} ${r.statusText}`);
  }

  async list(rel: string): Promise<RemoteEntry[]> {
    const r = await httpFetch(this.urlFor(rel, true), {
      method: 'PROPFIND',
      headers: this.headers({ Depth: '1', 'Content-Type': 'application/xml' }),
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>',
    });
    // A missing root just means nothing synced yet; a missing subfolder mid-walk is an error (never "deleted").
    if (r.status === 404 && !joinRel(rel)) return [];
    if (!r.ok && r.status !== 207) throw new Error(`PROPFIND ${rel || '/'} failed (${r.status})`);
    const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
    const out: RemoteEntry[] = [];
    const responses = Array.from(xml.getElementsByTagNameNS('DAV:', 'response'));
    const base = this.basePath();
    const selfPath = joinRel(rel);
    for (const resp of responses) {
      const href = resp.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? '';
      let path: string;
      try { path = decodeURIComponent(new URL(href, this.base()).pathname); } catch { path = decodeURIComponent(href); }
      if (base && path.startsWith(base)) path = path.slice(base.length);
      const r2 = joinRel(path);
      if (r2 === selfPath) continue;
      const isDir = resp.getElementsByTagNameNS('DAV:', 'collection').length > 0;
      const size = Number(resp.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? 0);
      const lm = resp.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent;
      const etag = resp.getElementsByTagNameNS('DAV:', 'getetag')[0]?.textContent ?? '';
      const mtime = lm ? Date.parse(lm) : 0;
      out.push({ rel: r2, isDir, size, mtime, rev: etag || `${size}-${mtime}` });
    }
    return out;
  }

  async listAll(): Promise<RemoteEntry[]> {
    const out: RemoteEntry[] = [];
    const walk = async (rel: string) => {
      for (const e of await this.list(rel)) {
        if (e.isDir) await walk(e.rel);
        else out.push(e);
      }
    };
    await walk('');
    return out;
  }

  async get(rel: string): Promise<Uint8Array> {
    const r = await httpFetch(this.urlFor(rel), { headers: this.headers() });
    if (!r.ok) throw new Error(`Download ${rel} failed (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }

  private async ensureDirs(rel: string) {
    const parts = rel.split('/').slice(0, -1);
    let cur = '';
    for (const p of parts) {
      cur = joinRel(cur, p);
      const r = await httpFetch(this.urlFor(cur, true), { method: 'MKCOL', headers: this.headers() });
      // 201 created, 405 already exists
      if (!r.ok && r.status !== 405 && r.status !== 301) { /* ignore — PUT will report */ }
    }
  }

  async put(rel: string, bytes: Uint8Array): Promise<string> {
    await this.ensureDirs(rel);
    const r = await httpFetch(this.urlFor(rel), { method: 'PUT', headers: this.headers({ 'Content-Type': 'application/octet-stream' }), body: bytes as BodyInit });
    if (!r.ok) throw new Error(`Upload ${rel} failed (${r.status})`);
    const etag = r.headers.get('etag');
    if (etag) return etag;
    // Some servers don't return an etag on PUT — read it back.
    const parent = rel.split('/').slice(0, -1).join('/');
    const entry = (await this.list(parent)).find((e) => e.rel === joinRel(rel));
    return entry?.rev ?? String(Date.now());
  }

  async remove(rel: string) {
    const r = await httpFetch(this.urlFor(rel), { method: 'DELETE', headers: this.headers() });
    if (!r.ok && r.status !== 404) throw new Error(`Delete ${rel} failed (${r.status})`);
  }

  async usage() {
    try {
      const r = await httpFetch(this.urlFor('', true), {
        method: 'PROPFIND',
        headers: this.headers({ Depth: '0', 'Content-Type': 'application/xml' }),
        body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:quota-used-bytes/><d:quota-available-bytes/></d:prop></d:propfind>',
      });
      const xml = new DOMParser().parseFromString(await r.text(), 'application/xml');
      const used = Number(xml.getElementsByTagNameNS('DAV:', 'quota-used-bytes')[0]?.textContent ?? NaN);
      const avail = Number(xml.getElementsByTagNameNS('DAV:', 'quota-available-bytes')[0]?.textContent ?? NaN);
      if (Number.isFinite(used) && Number.isFinite(avail)) return { used, total: used + avail };
    } catch { /* quota not supported */ }
    return null;
  }
}
