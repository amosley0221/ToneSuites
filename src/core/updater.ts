// In-place updates.
// Desktop (Windows/macOS): Tauri updater plugin with signed manifests published on GitHub Releases.
// Android: compare with the latest GitHub Release; the APK is installed over the existing app
// (same package id + same signing key), e.g. through Vault or the direct download link.
import { RELEASE_REPO } from '@/config';
import { appVersion, httpFetch, isTauri, openExternal, osType, relaunch } from './platform';

export interface AvailableUpdate {
  version: string;
  notes: string;
  date?: string;
  /** Desktop: download, install and restart. Android: open the APK download. */
  install: (onProgress?: (pct: number) => void) => Promise<void>;
  kind: 'desktop' | 'android';
  apkUrl?: string;
}

export function cmpVersion(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri) return null;
  const os = await osType();
  if (os === 'android' || os === 'ios') return checkAndroid();
  const { check } = await import('@tauri-apps/plugin-updater');
  const u = await check();
  if (!u) return null;
  return {
    kind: 'desktop',
    version: u.version,
    notes: u.body ?? '',
    date: u.date,
    install: async (onProgress) => {
      let total = 0, got = 0;
      await u.downloadAndInstall((ev) => {
        if (ev.event === 'Started') total = ev.data.contentLength ?? 0;
        else if (ev.event === 'Progress') { got += ev.data.chunkLength; if (total) onProgress?.(Math.round((got / total) * 100)); }
      });
      await relaunch();
    },
  };
}

async function checkAndroid(): Promise<AvailableUpdate | null> {
  const r = await httpFetch(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`Update check failed (${r.status})`);
  const rel = await r.json();
  const latest = String(rel.tag_name ?? '').replace(/^v/, '');
  if (!latest || cmpVersion(latest, await appVersion()) <= 0) return null;
  const apk = (rel.assets ?? []).find((a: any) => String(a.name).endsWith('.apk'));
  return {
    kind: 'android',
    version: latest,
    notes: rel.body ?? '',
    date: rel.published_at,
    apkUrl: apk?.browser_download_url,
    install: async () => { await openExternal(apk?.browser_download_url ?? rel.html_url); },
  };
}

/** Section of CHANGELOG.md for a given version (bundled at build time). */
export function changelogFor(changelog: string, version: string): string {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s*\\[?v?${version.replace(/\./g, '\\.')}\\]?`).test(l));
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}
