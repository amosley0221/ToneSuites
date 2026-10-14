import { useSettings } from '@/core/settings';
import { useApp } from '@/core/store';
import { requestSync, resolveConflict } from '@/storage/sync';
import { Badge, Button, Dialog, Eyebrow } from '@/ui';
import { relTime } from './format';

export function SyncDialog({ close }: { close: () => void }) {
  const sync = useApp((s) => s.sync);
  const s = useSettings((x) => x.s);
  const osLabel = useSettings((x) => x.osLabel);
  const providers = s.providers;
  return (
    <Dialog title="Sync" subtitle={`${1 + sync.devices.length} device${sync.devices.length ? 's' : ''} · ${providers.length} provider${providers.length === 1 ? '' : 's'}`} width={760} height={600} onClose={close}
      footer={<>
        <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{sync.lastSync ? `Last sync ${relTime(sync.lastSync)}` : 'Not synced yet'}</span>
        <span style={{ flex: 1 }} />
        <Button onClick={() => { close(); void import('@/core/commands').then((c) => c.runCommand('app.settings.sync')); }}>Storage settings…</Button>
        <Button variant="primary" disabled={sync.running} onClick={() => requestSync(0)}>{sync.running ? 'Syncing…' : 'Sync now'}</Button>
      </>}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
        {sync.conflicts.length > 0 && <Eyebrow style={{ marginBottom: 10 }}>Conflicts · {sync.conflicts.length}</Eyebrow>}
        {sync.conflicts.map((c) => (
          <div key={c.id} style={{ border: '1px solid var(--accent)', background: 'var(--sel)', padding: 14, marginBottom: 10 }}>
            <div style={{ fontWeight: 800 }}>{c.rel}</div>
            <div style={{ font: 'var(--type-mono)', color: 'var(--mute)', margin: '4px 0 10px' }}>
              A · this device, edited {relTime(c.localMtime)} — B · {c.providerName}, edited {relTime(c.remoteMtime)}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => resolveConflict(c, 'both')} title="Keeps both versions: B is saved next to A as a '(conflict …)' copy">Merge both</Button>
              <Button onClick={() => resolveConflict(c, 'local')}>Keep A</Button>
              <Button onClick={() => resolveConflict(c, 'remote')}>Keep B</Button>
              <Button variant="ghost" onClick={() => resolveConflict(c, 'both')}>Compare (save both)</Button>
            </div>
          </div>
        ))}
        <Eyebrow style={{ marginTop: sync.conflicts.length ? 18 : 0, marginBottom: 10 }}>Devices & providers</Eyebrow>
        <Row name={s.deviceName || 'This device'} detail={`${osLabel} · local store`} status="ONLINE" tone="positive" />
        {sync.devices.map((d) => <Row key={d.id} name={d.name} detail={`${d.os} · last seen ${relTime(d.lastActive)}${d.appVersion ? ' · v' + d.appVersion : ''}`} status="SYNCED" tone="mute" />)}
        {providers.map((p) => {
          const st = sync.providers[p.id];
          const label = !p.enabled ? 'OFF' : st?.status === 'online' ? 'UP TO DATE' : st?.status === 'syncing' ? 'SYNCING' : st?.status === 'offline' ? 'OFFLINE' : st?.status === 'error' ? 'ERROR' : 'WAITING';
          const tone = st?.status === 'online' ? 'positive' : st?.status === 'error' ? 'negative' : st?.status === 'offline' ? 'accent' : 'mute';
          return <Row key={p.id} name={p.name} detail={`${p.kind === 'gdrive' ? '/' + (p.url || 'Tone') : (p.url ?? '').replace(/^https?:\/\//, '')}${st?.files != null ? ` · ${st.files.toLocaleString()} files` : ''}${st?.message ? ' · ' + st.message : ''}`} status={label} tone={tone as any} />;
        })}
        {sync.pending > 0 && <Row name="Offline queue" detail={`${sync.pending} change${sync.pending === 1 ? '' : 's'} waiting to sync`} status="PENDING" tone="accent" />}
        {!providers.length && <div className="empty-hint">No storage connected yet. Add your NAS or Google Drive in Storage settings to sync between devices.</div>}
      </div>
    </Dialog>
  );
}

function Row({ name, detail, status, tone }: { name: string; detail: string; status: string; tone: 'positive' | 'mute' | 'accent' | 'negative' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{name}</div>
        <div style={{ font: 'var(--type-small)', color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</div>
      </div>
      <Badge tone={tone}>{status}</Badge>
    </div>
  );
}
