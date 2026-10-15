import { useEffect, useState, type ReactNode } from 'react';
import changelog from '../../CHANGELOG.md?raw';
import { newDocument, openFromProvider, openRecent } from '@/core/documents';
import { extOf } from '@/core/platform';
import { useSettings } from '@/core/settings';
import { models } from '@/core/store';
import type { Doc, Mode } from '@/core/types';
import { changelogFor, type AvailableUpdate } from '@/core/updater';
import { ALL_OPENABLE, MODULE_META } from '@/modules/meta';
import type { RemoteEntry } from '@/storage/provider';
import { makeProvider } from '@/storage/sync';
import { Button, Dialog, DialogNav, Eyebrow, Mark } from '@/ui';
import { fmtBytes, relShort } from './format';

export function NewPicker({ close }: { close: () => void }) {
  return (
    <Dialog title="New document" width={640} height="auto" onClose={close}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, padding: 18, flex: 1 }}>
        {(Object.keys(MODULE_META) as Mode[]).map((m) => (
          <div key={m} className="hov-border" onClick={() => { close(); void newDocument(m); }}
            style={{ border: '1px solid var(--line)', padding: 14, cursor: 'pointer', background: 'var(--bg0)' }}>
            <Mark size={28} inverted>{MODULE_META[m].mark}</Mark>
            <div style={{ font: 'var(--type-title)', marginTop: 10 }}>{MODULE_META[m].name}</div>
            <div style={{ font: 'var(--type-small)', color: 'var(--mute)' }}>{MODULE_META[m].description}</div>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function RecentDialog({ close }: { close: () => void }) {
  const recents = useSettings((s) => s.s.recents);
  return (
    <Dialog title="Open recent" subtitle={`${recents.length} files`} width={640} height={480} onClose={close}>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!recents.length && <div className="empty-hint" style={{ padding: 18 }}>Nothing yet — files you open or save appear here.</div>}
        {recents.map((r) => (
          <div key={r.location.kind + r.location.path} className="hov-row" onClick={() => { close(); void openRecent(r); }}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
            <Mark>{MODULE_META[r.mode].mark}</Mark>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{r.title}</div>
              <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.location.path}</div>
            </div>
            <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{relShort(r.openedAt)}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

/** Browse NAS (WebDAV) or the whole Google Drive and open a file. */
export function ProviderBrowser({ close }: { close: () => void }) {
  const allProviders = useSettings((s) => s.s.providers);
  const providers = allProviders.filter((p) => p.enabled);
  const [pid, setPid] = useState(providers[0]?.id ?? '');
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<RemoteEntry[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const cfg = providers.find((p) => p.id === pid);
  useEffect(() => {
    if (!cfg) return;
    setEntries(null); setErr(null);
    makeProvider(cfg, true).list(path) // whole NAS / My Drive, not just the synced folder
      .then((e) => setEntries(e.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.rel.localeCompare(b.rel))))
      .catch((e) => setErr(String(e?.message ?? e)));
  }, [pid, path]);
  const crumbs = path ? path.split('/') : [];
  return (
    <Dialog title="Open from storage" subtitle={cfg ? makeProvider(cfg, true).label() : ''} width={900} height={600} onClose={close} stackOnPhone>
      {providers.length === 0 ? (
        <div className="empty-hint" style={{ padding: 18 }}>No storage connected. Add your NAS or Google Drive in Settings › Sync.</div>
      ) : <>
        <DialogNav items={providers.map((p) => ({ value: p.id, label: p.name, hint: p.kind === 'gdrive' ? 'Drive' : 'NAS' }))} value={pid} onChange={(v) => { setPid(v); setPath(''); }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--line)', font: 'var(--type-mono)', flexWrap: 'wrap' }}>
            <span className="hov-ink" style={{ cursor: 'pointer', color: 'var(--mute)' }} onClick={() => setPath('')}>{cfg?.kind === 'gdrive' ? 'My Drive' : cfg?.name ?? 'NAS'}</span>
            {crumbs.map((c, i) => <span key={i}> / <span className="hov-ink" style={{ cursor: 'pointer', color: i === crumbs.length - 1 ? 'var(--ink)' : 'var(--mute)' }} onClick={() => setPath(crumbs.slice(0, i + 1).join('/'))}>{c}</span></span>)}
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {err && <div style={{ padding: 16, color: 'var(--negative)', font: 'var(--type-small)' }}>{err}</div>}
            {!err && !entries && <div className="empty-hint" style={{ padding: 16 }}>Loading…</div>}
            {entries?.length === 0 && <div className="empty-hint" style={{ padding: 16 }}>This folder is empty.</div>}
            {entries?.map((e) => {
              const name = e.rel.split('/').pop()!;
              const ok = e.isDir || ALL_OPENABLE.includes(extOf(name));
              return (
                <div key={e.rel} className={ok ? 'hov-row' : ''} onClick={() => { if (e.isDir) setPath(e.rel); else if (ok) { close(); void openFromProvider(pid, e.rel, true); } }}
                  style={{ display: 'grid', gridTemplateColumns: '24px 1fr 90px 90px', gap: 10, alignItems: 'center', padding: '8px 16px', borderBottom: '1px solid var(--line)', cursor: ok ? 'pointer' : 'default', opacity: ok ? 1 : 0.45 }}>
                  <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{e.isDir ? '▸' : '·'}</span>
                  <span style={{ fontWeight: e.isDir ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
                  <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', textAlign: 'right' }}>{e.isDir ? '' : fmtBytes(e.size)}</span>
                  <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', textAlign: 'right' }}>{e.mtime ? relShort(e.mtime) : ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      </>}
    </Dialog>
  );
}

export function FileInfo({ doc, close }: { doc: Doc; close: () => void }) {
  const rows: [string, ReactNode][] = [
    ['Name', doc.title],
    ['Module', MODULE_META[doc.mode].name],
    ['Format', doc.format === 'tone' ? '.tone (Tone container)' : '.' + doc.format],
    ['Location', doc.location ? doc.location.path : 'Not saved yet'],
    ['Saved', doc.savedAt ? new Date(doc.savedAt).toLocaleString() : doc.dirty ? 'Unsaved changes' : '—'],
    ['Converted from', doc.convertedFrom?.title ?? '—'],
    ['Has content', models.has(doc.id) ? 'Yes' : 'No'],
  ];
  return (
    <Dialog title="File info" subtitle={doc.title} width={560} height="auto" onClose={close}>
      <div style={{ padding: 18, flex: 1 }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 12, padding: '6px 0', borderBottom: '1px solid var(--line)', font: 'var(--type-small)' }}>
            <span style={{ width: 130, color: 'var(--mute)', flexShrink: 0 }}>{k}</span><span style={{ wordBreak: 'break-all' }}>{v}</span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function About({ close }: { close: () => void }) {
  const osLabel = useSettings((s) => s.osLabel);
  return (
    <Dialog title="About Tone" width={480} height="auto" onClose={close}>
      <div style={{ padding: 22, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 22, height: 22, background: 'var(--accent)' }} />
          <div style={{ font: '900 28px var(--font-ui)', letterSpacing: '-0.04em' }}>TONE</div>
        </div>
        <div style={{ marginTop: 14, font: 'var(--type-body)' }}>Tone Suites {__APP_VERSION__}</div>
        <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', marginTop: 4 }}>{osLabel}</div>
        <div style={{ font: 'var(--type-small)', color: 'var(--mute)', marginTop: 14 }}>Pixel · Cells · Deck · Write · Paper — one window, one sync engine.</div>
      </div>
    </Dialog>
  );
}

/** Minimal markdown renderer for release notes (headings, bullets, bold, code). */
export function Notes({ md }: { md: string }) {
  const inline = (t: string) => t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((p, i) =>
    p.startsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith('`') ? <code key={i} className="mono" style={{ fontSize: 11 }}>{p.slice(1, -1)}</code> : p);
  return (
    <div style={{ font: 'var(--type-body)' }}>
      {md.split('\n').map((l, i) => {
        if (/^###\s/.test(l)) return <div key={i} className="eyebrow" style={{ marginTop: 14, marginBottom: 6 }}>{l.replace(/^###\s*/, '')}</div>;
        if (/^##\s/.test(l)) return <div key={i} style={{ font: 'var(--type-subtitle)', marginTop: 16 }}>{l.replace(/^##\s*/, '')}</div>;
        if (/^\s*[-*]\s/.test(l)) return <div key={i} style={{ display: 'flex', gap: 8, padding: '2px 0' }}><span style={{ color: 'var(--accent)' }}>■</span><span>{inline(l.replace(/^\s*[-*]\s*/, ''))}</span></div>;
        if (!l.trim()) return <div key={i} style={{ height: 6 }} />;
        return <div key={i}>{inline(l)}</div>;
      })}
    </div>
  );
}

export function WhatsNew({ close, version }: { close: () => void; version: string }) {
  const notes = changelogFor(changelog, version);
  return (
    <Dialog title="What's new" subtitle={`Tone Suites ${version}`} width={620} height={520} onClose={close}
      footer={<><span style={{ flex: 1 }} /><Button variant="primary" onClick={close}>Got it</Button></>}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
        {notes ? <Notes md={notes} /> : <div className="empty-hint">No notes for this version.</div>}
      </div>
    </Dialog>
  );
}

export function UpdateDialog({ update, close }: { update: AvailableUpdate; close: () => void }) {
  const [pct, setPct] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setPct(0);
    try { await update.install(setPct); if (update.kind === 'android') close(); } catch (e: any) { setErr(String(e?.message ?? e)); setPct(null); }
  };
  return (
    <Dialog title="Update available" subtitle={`Tone Suites ${update.version}`} width={620} height={520} onClose={close}
      footer={<>
        {err && <span style={{ color: 'var(--negative)', font: 'var(--type-small)' }}>{err}</span>}
        <span style={{ flex: 1 }} />
        <Button onClick={close}>Later</Button>
        <Button variant="primary" disabled={pct != null} onClick={() => void go()}>
          {update.kind === 'android' ? 'Download update' : pct != null ? `Installing… ${pct}%` : 'Restart to update'}
        </Button>
      </>}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 22px' }}>
        <div style={{ font: 'var(--type-small)', color: 'var(--mute)', marginBottom: 10 }}>
          You have {__APP_VERSION__}. {update.kind === 'android'
            ? 'Install the new APK over this one (Vault or the download button) — your files and settings stay.'
            : 'The update installs in place — no uninstall, your files and settings stay.'}
        </div>
        <Eyebrow style={{ marginBottom: 6 }}>Update notes</Eyebrow>
        {update.notes ? <Notes md={update.notes} /> : <div className="empty-hint">No notes provided.</div>}
      </div>
    </Dialog>
  );
}
