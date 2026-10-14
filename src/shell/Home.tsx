import { useEffect, useState } from 'react';
import { displayShortcut, runCommand } from '@/core/commands';
import { newDocument, openDialog, openRecent, openWorkspaceRel } from '@/core/documents';
import { isTauri, listFilesRecursive } from '@/core/platform';
import { useSettings } from '@/core/settings';
import { useApp, type RemoteDevice } from '@/core/store';
import type { Mode } from '@/core/types';
import { MODULE_META } from '@/modules/meta';
import { Badge, Button, Eyebrow, Mark, UsageBar } from '@/ui';
import { fmtBytes, greeting, relShort, relTime } from './format';

const HANDOFF_WINDOW = 12 * 3600 * 1000;

export function Home({ compact }: { compact: boolean }) {
  const s = useSettings((x) => x.s);
  const osLabel = useSettings((x) => x.osLabel);
  const sync = useApp((x) => x.sync);
  const docs = useApp((x) => x.docs);
  const dismissedAt = useApp((x) => x.handoffDismissedAt);
  const modes = (Object.keys(MODULE_META) as Mode[]).filter((m) => s.modulesEnabled[m] !== false);

  const openHere = new Set(docs.map((d) => d.title));
  const handoff = sync.devices.find((d) => Date.now() - d.lastActive < HANDOFF_WINDOW && d.lastActive > dismissedAt && d.openDocs.some((o) => !openHere.has(o.title)));
  const deviceCount = 1 + sync.devices.length;
  const hasProviders = s.providers.some((p) => p.enabled);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: compact ? 'column' : 'row', minHeight: 0, overflow: compact ? 'auto' : 'hidden' }}>
      <div style={{ flex: 1, overflowY: compact ? 'visible' : 'auto', padding: compact ? '20px 16px' : '28px 36px', minWidth: 0 }}>
        {handoff && <HandoffBanner device={handoff} />}
        <div style={{ font: 'var(--type-display)', letterSpacing: 'var(--ls-display)', fontSize: compact ? 40 : 52, marginTop: handoff ? 24 : 8 }}>{greeting()}</div>
        <div style={{ color: 'var(--mute)', marginTop: 10, font: 'var(--type-body)' }}>
          {hasProviders
            ? deviceCount > 1 ? `Everything you were working on is synced across your ${deviceCount} devices.` : 'Your workspace syncs to your storage. Other devices appear here once they connect.'
            : 'Start something new, or open a file. Connect your NAS or Google Drive in Settings to sync between devices.'}
        </div>

        <Eyebrow style={{ marginTop: 36, marginBottom: 12 }}>New</Eyebrow>
        <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(5, 1fr)', gap: 10 }}>
          {modes.map((m) => {
            const meta = MODULE_META[m];
            return (
              <div key={m} onClick={() => void newDocument(m)} className="hov-border"
                style={{ border: '1px solid var(--line)', background: 'var(--bg1)', padding: 16, cursor: 'pointer', minHeight: 98, transition: 'border-color var(--dur-fast)' }}>
                <span style={{ width: 34, height: 34, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--ink)', color: 'var(--bg0)', font: '500 11px var(--font-mono)' }}>{meta.mark}</span>
                <div style={{ font: 'var(--type-title)', letterSpacing: 'var(--ls-title)', marginTop: 14 }}>{meta.name}</div>
                <div style={{ color: 'var(--mute)', font: 'var(--type-small)', marginTop: 2 }}>{meta.description}</div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginTop: 36, marginBottom: 8 }}>
          <Eyebrow>Recent</Eyebrow>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={() => void openDialog()}>Open file…</Button>
          {hasProviders && <Button size="sm" variant="ghost" onClick={() => void runCommand('file.openFromProvider')}>Browse storage…</Button>}
        </div>
        {s.recents.length === 0 ? (
          <div className="empty-hint" style={{ borderTop: '1px solid var(--line)', paddingTop: 14 }}>Files you create or open will show up here.</div>
        ) : (
          <div style={{ borderTop: '1px solid var(--line)' }}>
            {s.recents.slice(0, 12).map((r) => {
              const prov = r.location.providerId ? s.providers.find((p) => p.id === r.location.providerId)?.name : null;
              return (
                <div key={r.location.kind + r.location.path} onClick={() => void openRecent(r)} className="hov-row"
                  style={{ display: 'grid', gridTemplateColumns: compact ? '28px 1fr 70px' : '28px 1.6fr 1fr 1.2fr 90px', alignItems: 'center', gap: 10, padding: '9px 6px', borderBottom: '1px solid var(--line)', cursor: 'pointer' }}>
                  <Mark>{MODULE_META[r.mode].mark}</Mark>
                  <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                  {!compact && <span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>{MODULE_META[r.mode].name}</span>}
                  {!compact && <span style={{ color: 'var(--mute)', font: 'var(--type-small)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{prov ?? (r.location.path.startsWith(s.workspaceDir) ? 'Synced' : 'This device')}</span>}
                  <span style={{ color: 'var(--mute)', font: 'var(--type-mono)', textAlign: 'right' }}>{relShort(r.openedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ width: compact ? 'auto' : 320, background: 'var(--bg1)', borderLeft: compact ? 0 : '1px solid var(--line)', borderTop: compact ? '1px solid var(--line)' : 0, overflowY: compact ? 'visible' : 'auto', padding: 16, flexShrink: 0 }}>
        <Eyebrow style={{ marginBottom: 10 }}>Devices</Eyebrow>
        <DeviceCard name={s.deviceName || 'This device'} detail={`${osLabel || 'This device'} · active now`} status="ONLINE" tone="positive" />
        {sync.devices.map((d) => (
          <DeviceCard key={d.id} name={d.name} detail={`${d.os} · ${relTime(d.lastActive)}`} status={Date.now() - d.lastActive < 5 * 60_000 ? 'ONLINE' : 'SYNCED'} tone={Date.now() - d.lastActive < 5 * 60_000 ? 'positive' : 'mute'} />
        ))}
        {!sync.devices.length && <div className="empty-hint">Other devices appear here after they sync to the same NAS or Google Drive folder.</div>}

        <Eyebrow style={{ marginTop: 22, marginBottom: 10 }}>Storage</Eyebrow>
        <LocalCard />
        {s.providers.map((p) => {
          const st = sync.providers[p.id];
          const status = !p.enabled ? 'OFF' : st?.status === 'online' ? (p.kind === 'gdrive' ? 'SYNCED' : 'MOUNTED') : st?.status === 'syncing' ? 'SYNCING' : st?.status === 'offline' ? 'OFFLINE' : st?.status === 'error' ? 'ERROR' : '—';
          const tone = st?.status === 'online' ? 'positive' : st?.status === 'error' ? 'negative' : st?.status === 'offline' ? 'accent' : 'mute';
          return (
            <div key={p.id} style={{ border: '1px solid var(--line)', padding: 12, marginBottom: 8, background: 'var(--bg0)' }} title={st?.message}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 800 }}>{p.name}</span><Badge tone={tone as any}>{status}</Badge>
              </div>
              <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.kind === 'gdrive' ? `/${p.url || 'Tone'}${p.account ? ' · ' + p.account : ''}` : (p.url ?? '').replace(/^https?:\/\//, '')}
              </div>
              {st?.usage && st.usage.total > 0 && <>
                <UsageBar used={st.usage.used} total={st.usage.total} />
                <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', marginTop: 6 }}>{fmtBytes(st.usage.used)} of {fmtBytes(st.usage.total)}</div>
              </>}
            </div>
          );
        })}
        <Button style={{ width: '100%', justifyContent: 'center' }} onClick={() => void runCommand('app.settings.sync')}>+ Add storage</Button>

        {!compact && <>
          <Eyebrow style={{ marginTop: 22, marginBottom: 10 }}>Shortcuts</Eyebrow>
          {[['Command palette', 'Ctrl K'], ['New document', 'Ctrl N'], ['Switch tab', 'Ctrl Tab'], ['Export', 'Ctrl Shift E']].map(([a, b]) => (
            <div key={a} style={{ display: 'flex', justifyContent: 'space-between', font: 'var(--type-small)', padding: '3px 0' }}>
              <span>{a}</span><span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{displayShortcut(b)}</span>
            </div>
          ))}
        </>}
      </div>
    </div>
  );
}

function DeviceCard({ name, detail, status, tone }: { name: string; detail: string; status: string; tone: 'positive' | 'mute' }) {
  return (
    <div style={{ border: '1px solid var(--line)', padding: 12, marginBottom: 8, background: 'var(--bg0)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 800 }}>{name}</span><Badge tone={tone}>{status}</Badge>
      </div>
      <div style={{ font: 'var(--type-small)', color: 'var(--mute)', marginTop: 2 }}>{detail}</div>
    </div>
  );
}

function LocalCard() {
  const ws = useSettings((x) => x.s.workspaceDir);
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    if (!isTauri || !ws) return;
    void listFilesRecursive(ws).then((f) => setSize(f.reduce((a, b) => a + b.size, 0))).catch(() => setSize(0));
  }, [ws]);
  return (
    <div style={{ border: '1px solid var(--line)', padding: 12, marginBottom: 8, background: 'var(--bg0)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontWeight: 800 }}>Local</span><Badge tone="positive">{isTauri ? 'ONLINE' : 'BROWSER'}</Badge>
      </div>
      <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws || 'Files download to your browser'}</div>
      {size != null && <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', marginTop: 6 }}>{fmtBytes(size)} in workspace</div>}
    </div>
  );
}

function HandoffBanner({ device }: { device: RemoteDevice }) {
  const [choose, setChoose] = useState(false);
  const titles = device.openDocs.map((d) => d.title);
  const openAll = async (docs = device.openDocs) => { for (const d of docs) await openWorkspaceRel(d.rel); };
  return (
    <div style={{ border: '1px solid var(--accent)', background: 'var(--sel)', padding: '14px 18px', display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <span style={{ width: 8, height: 8, background: 'var(--accent)', marginTop: 6 }} />
      <div style={{ flex: 1, minWidth: 240 }}>
        <div style={{ fontWeight: 800 }}>{device.name} has {device.openDocs.length} document{device.openDocs.length === 1 ? '' : 's'} open — continue here?</div>
        <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', marginTop: 4 }}>{titles.join(' · ')} · last active {relTime(device.lastActive)} · tabs restore in the same order</div>
        {choose && (
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {device.openDocs.map((d) => <Button key={d.rel} size="sm" onClick={() => void openWorkspaceRel(d.rel)}>{d.title}</Button>)}
          </div>
        )}
      </div>
      <Button variant="primary" onClick={() => void openAll()}>Open all</Button>
      <Button onClick={() => setChoose(!choose)}>Choose…</Button>
      <Button variant="ghost" onClick={() => useApp.setState({ handoffDismissedAt: Date.now() })}>Dismiss</Button>
    </div>
  );
}
