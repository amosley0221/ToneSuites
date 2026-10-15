// WebDAV provider — used for the UGREEN NAS (UGOS Pro "WebDAV" file service) or any WebDAV server.
import { httpFetch } from '@/core/platform';
import type { ProviderConfig } from '@/core/settings';
import { joinRel, type RemoteEntry, type StorageProvider } from './provider';

/** ETags arrive as `"abc"`, `W/"abc"` or `abc` depending on server and request; compare them bare. */
export function normEtag(e: string | null | undefined): string {
  return (e ?? '').trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

function b64(s: string) {
  return btoa(unescape(encodeURIComponent(s)));
}

/** Where "Open from NAS" starts: the user's browse address, or the server root of the sync address. */
export function webdavBrowseUrl(cfg: ProviderConfig): string {
  if (cfg.browseUrl?.trim()) return cfg.browseUrl.trim();
  try { return new URL(cfg.url ?? '').origin; } catch { return cfg.url ?? ''; }
}

export class WebDavProvider implements StorageProvider {
  /** @param browseRoot list from the browse address (whole NAS) instead of the sync folder */
  constructor(public config: ProviderConfig, private password: string, private browseRoot = false) {}

  private base(): string {
    return (this.browseRoot ? webdavBrowseUrl(this.config) : this.config.url ?? '').replace(/\/+$/, '');
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

  /** PROPFIND one resource (Depth 0) or a folder's children (Depth 1). */
  private async propfind(rel: string, depth: '0' | '1', dir: boolean): Promise<Response> {
    return httpFetch(this.urlFor(rel, dir), {
      method: 'PROPFIND',
      headers: this.headers({ Depth: depth, 'Content-Type': 'application/xml' }),
      body: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getlastmodified/><d:getcontentlength/><d:getetag/><d:resourcetype/></d:prop></d:propfind>',
    });
  }

  private parse(xmlText: string): RemoteEntry[] {
    const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
    const out: RemoteEntry[] = [];
    const base = this.basePath();
    for (const resp of Array.from(xml.getElementsByTagNameNS('DAV:', 'response'))) {
      const href = resp.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? '';
      let path: string;
      try { path = decodeURIComponent(new URL(href, this.base() + '/').pathname); } catch { path = decodeURIComponent(href); }
      if (base && path.startsWith(base)) path = path.slice(base.length);
      const isDir = resp.getElementsByTagNameNS('DAV:', 'collection').length > 0;
      const size = Number(resp.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent ?? 0) || 0;
      const lm = resp.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent;
      const etag = normEtag(resp.getElementsByTagNameNS('DAV:', 'getetag')[0]?.textContent);
      const mtime = lm ? Date.parse(lm) || 0 : 0;
      out.push({ rel: joinRel(path), isDir, size, mtime, rev: etag || `${size}-${mtime}` });
    }
    return out;
  }

  async list(rel: string): Promise<RemoteEntry[]> {
    const r = await this.propfind(rel, '1', true);
    if (r.status === 401) throw new Error('Username or password rejected by the NAS');
    // A missing root just means nothing synced yet; a missing subfolder mid-walk is an error (never "deleted").
    if (r.status === 404 && !joinRel(rel)) return [];
    if (!r.ok && r.status !== 207) throw new Error(`PROPFIND ${rel || '/'} failed (${r.status})`);
    const selfPath = joinRel(rel);
    return this.parse(await r.text()).filter((e) => e.rel !== selfPath);
  }

  /** Revision marker of one file, computed exactly like list() does (so sync sees no phantom change). */
  private async revOf(rel: string): Promise<string | null> {
    const r = await this.propfind(rel, '0', false);
    if (!r.ok && r.status !== 207) return null;
    return this.parse(await r.text()).find((e) => e.rel === joinRel(rel))?.rev ?? null;
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

  /** Folders known to exist (MKCOL'd or seen) during this provider's lifetime. */
  private made = new Set<string>();

  private async mkcol(url: string) {
    if (this.made.has(url)) return;
    const r = await httpFetch(url, { method: 'MKCOL', headers: this.headers() });
    // 201 created, 405 already exists; anything else surfaces when the PUT fails.
    if (r.ok || r.status === 405 || r.status === 301) this.made.add(url);
  }

  private async ensureDirs(rel: string) {
    // The sync folder itself may not exist yet (Test connection was never pressed, or the
    // address was just changed): create it and any missing parents, or every PUT fails with 409.
    if (!this.made.has(this.urlFor('', true))) {
      try {
        const u = new URL(this.base());
        let acc = u.origin;
        for (const seg of u.pathname.split('/').filter(Boolean)) { acc += '/' + seg; await this.mkcol(acc + '/'); }
      } catch { /* invalid URL: PUT reports it */ }
    }
    const parts = rel.split('/').slice(0, -1);
    let cur = '';
    for (const p of parts) {
      cur = joinRel(cur, p);
      await this.mkcol(this.urlFor(cur, true));
    }
  }

  async put(rel: string, bytes: Uint8Array): Promise<string> {
    await this.ensureDirs(rel);
    const r = await httpFetch(this.urlFor(rel), { method: 'PUT', headers: this.headers({ 'Content-Type': 'application/octet-stream' }), body: bytes as BodyInit });
    if (!r.ok) throw new Error(`Upload ${rel} failed (${r.status})`);
    // Use the revision exactly as a listing reports it: servers often format the PUT ETag differently
    // (quoted / weak) or leave it out, which would make the next sync see a remote change and re-download.
    const listed = await this.revOf(rel).catch(() => null);
    return listed ?? (normEtag(r.headers.get('etag')) || String(Date.now()));
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
