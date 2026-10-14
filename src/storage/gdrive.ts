// Google Drive provider (REST v3) + OAuth (loopback redirect with PKCE).
// The OAuth client id/secret are entered by the user in Settings › Sync (Desktop-app client from their own Google Cloud project).
import { httpFetch, isTauri, openExternal } from '@/core/platform';
import { useSettings, type ProviderConfig } from '@/core/settings';
import { joinRel, type RemoteEntry, type StorageProvider } from './provider';

const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER = 'application/vnd.google-apps.folder';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';

/** Google-native types are exported to an Office format when downloaded. */
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  'application/vnd.google-apps.document': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' },
  'application/vnd.google-apps.spreadsheet': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' },
  'application/vnd.google-apps.presentation': { mime: 'application/pdf', ext: 'pdf' },
  'application/vnd.google-apps.drawing': { mime: 'image/png', ext: 'png' },
};

function b64url(buf: ArrayBuffer | Uint8Array) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  b.forEach((x) => (s += String.fromCharCode(x)));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function connectGoogleDrive(cfg: ProviderConfig, clientSecret: string): Promise<{ email: string }> {
  if (!isTauri) throw new Error('Google sign-in needs the desktop or Android app');
  if (!cfg.clientId) throw new Error('Enter your Google OAuth client ID first');
  const { invoke } = await import('@tauri-apps/api/core');
  const { listen } = await import('@tauri-apps/api/event');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const state = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const port = await invoke<number>('oauth_listen');
  const redirect = `http://127.0.0.1:${port}`;
  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { un.then((f) => f()); reject(new Error('Google sign-in timed out')); }, 5 * 60 * 1000);
    const un = listen<string>('oauth-redirect', (ev) => {
      clearTimeout(timer);
      un.then((f) => f());
      const u = new URL(ev.payload);
      if (u.searchParams.get('state') !== state) return reject(new Error('Sign-in state mismatch'));
      const err = u.searchParams.get('error');
      if (err) return reject(new Error(`Google sign-in failed: ${err}`));
      resolve(u.searchParams.get('code') ?? '');
    });
    const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    auth.search = new URLSearchParams({
      client_id: cfg.clientId!, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
      code_challenge: challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent', state,
    }).toString();
    openExternal(auth.toString());
  });
  const r = await httpFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: cfg.clientId!, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }).toString(),
  });
  const tok = await r.json();
  if (!r.ok) throw new Error(tok.error_description || tok.error || 'Token exchange failed');
  useSettings.getState().setSecret(cfg.id, { refreshToken: tok.refresh_token, accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000, clientSecret });
  const about = await (await httpFetch(`${API}/about?fields=user`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
  return { email: about.user?.emailAddress ?? '' };
}

interface DriveFile { id: string; name: string; mimeType: string; size?: string; modifiedTime: string; md5Checksum?: string; parents?: string[] }

export class GDriveProvider implements StorageProvider {
  private ids = new Map<string, string>(); // rel -> file id ('' -> root)
  /** @param rootName folder in My Drive used as root; null = whole My Drive (browsing) */
  constructor(public config: ProviderConfig, private rootName: string | null) {}

  label() { return this.rootName ? `drive://${this.rootName}` : 'drive://My Drive'; }

  private async token(): Promise<string> {
    const sec = useSettings.getState().secrets[this.config.id] ?? {};
    if (sec.accessToken && sec.expiresAt && sec.expiresAt > Date.now()) return sec.accessToken;
    if (!sec.refreshToken) throw new Error('Google Drive is not connected — open Settings › Sync');
    const r = await httpFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.config.clientId ?? '', client_secret: sec.clientSecret ?? '', refresh_token: sec.refreshToken, grant_type: 'refresh_token' }).toString(),
    });
    const tok = await r.json();
    if (!r.ok) throw new Error(`Google token refresh failed: ${tok.error_description || tok.error}`);
    useSettings.getState().setSecret(this.config.id, { accessToken: tok.access_token, expiresAt: Date.now() + (tok.expires_in - 60) * 1000 });
    return tok.access_token;
  }

  private async api(path: string, init: RequestInit = {}, base = API): Promise<Response> {
    const t = await this.token();
    const r = await httpFetch(base + path, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${t}` } });
    if (r.status === 401) throw new Error('Google Drive session expired — reconnect in Settings › Sync');
    return r;
  }

  private async query(q: string): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ q, fields: 'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum,parents)', pageSize: '1000', spaces: 'drive' });
      if (pageToken) params.set('pageToken', pageToken);
      const r = await this.api(`/files?${params}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? 'Drive list failed');
      out.push(...j.files);
      pageToken = j.nextPageToken ?? '';
    } while (pageToken);
    return out;
  }

  private esc(s: string) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  private async rootId(): Promise<string> {
    const c = this.ids.get('');
    if (c) return c;
    let id = 'root';
    if (this.rootName) {
      const found = await this.query(`name='${this.esc(this.rootName)}' and mimeType='${FOLDER}' and 'root' in parents and trashed=false`);
      id = found[0]?.id ?? (await this.mkdir(this.rootName, 'root'));
    }
    this.ids.set('', id);
    return id;
  }

  private async mkdir(name: string, parent: string): Promise<string> {
    const r = await this.api('/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message ?? 'Drive mkdir failed');
    return j.id;
  }

  private async idFor(rel: string, create = false): Promise<string | null> {
    rel = joinRel(rel);
    if (this.ids.has(rel)) return this.ids.get(rel)!;
    if (!rel) return this.rootId();
    const parts = rel.split('/');
    let cur = '';
    let id = await this.rootId();
    for (let i = 0; i < parts.length; i++) {
      const next = joinRel(cur, parts[i]);
      let nid = this.ids.get(next);
      if (!nid) {
        const isLast = i === parts.length - 1;
        const found = await this.query(`name='${this.esc(parts[i])}' and '${id}' in parents and trashed=false`);
        nid = found[0]?.id;
        if (!nid) {
          if (!create || isLast) return null;
          nid = await this.mkdir(parts[i], id);
        }
        this.ids.set(next, nid);
      }
      cur = next;
      id = nid;
    }
    return id;
  }

  private toEntry(f: DriveFile, parentRel: string): RemoteEntry {
    const exp = EXPORTS[f.mimeType];
    const name = exp && !f.name.toLowerCase().endsWith('.' + exp.ext) ? `${f.name}.${exp.ext}` : f.name;
    const rel = joinRel(parentRel, name);
    this.ids.set(rel, f.id);
    return { rel, id: f.id, isDir: f.mimeType === FOLDER, size: Number(f.size ?? 0), mtime: Date.parse(f.modifiedTime), rev: f.md5Checksum ?? f.modifiedTime };
  }

  async test() {
    await this.token();
    await this.rootId();
  }

  async list(rel: string): Promise<RemoteEntry[]> {
    const id = await this.idFor(rel);
    if (!id) return [];
    const files = await this.query(`'${id}' in parents and trashed=false`);
    return files.map((f) => this.toEntry(f, joinRel(rel)));
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
    const id = await this.idFor(rel);
    if (!id) throw new Error(`${rel} not found on Drive`);
    const meta = await (await this.api(`/files/${id}?fields=mimeType`)).json();
    const exp = EXPORTS[meta.mimeType];
    const r = exp
      ? await this.api(`/files/${id}/export?mimeType=${encodeURIComponent(exp.mime)}`)
      : await this.api(`/files/${id}?alt=media`);
    if (!r.ok) throw new Error(`Drive download failed (${r.status})`);
    return new Uint8Array(await r.arrayBuffer());
  }

  async put(rel: string, bytes: Uint8Array): Promise<string> {
    rel = joinRel(rel);
    const parentRel = rel.split('/').slice(0, -1).join('/');
    const name = rel.split('/').pop()!;
    const parent = await this.idFor(parentRel, true);
    if (!parent) throw new Error('Drive folder could not be created');
    const existing = await this.idFor(rel);
    const boundary = 'tone' + Math.random().toString(36).slice(2);
    const meta = existing ? {} : { name, parents: [parent] };
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const tail = new TextEncoder().encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
    const r = await this.api(existing ? `/files/${existing}?uploadType=multipart&fields=id,md5Checksum,modifiedTime` : `/files?uploadType=multipart&fields=id,md5Checksum,modifiedTime`,
      { method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body }, UPLOAD);
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message ?? 'Drive upload failed');
    this.ids.set(rel, j.id);
    return j.md5Checksum ?? j.modifiedTime;
  }

  async remove(rel: string) {
    const id = await this.idFor(rel);
    if (!id) return;
    // Move to trash rather than hard delete, so mistakes are recoverable.
    await this.api(`/files/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    this.ids.delete(joinRel(rel));
  }

  async usage() {
    const r = await this.api('/about?fields=storageQuota');
    const j = await r.json();
    const q = j.storageQuota ?? {};
    return { used: Number(q.usage ?? 0), total: Number(q.limit ?? 0) };
  }
}
