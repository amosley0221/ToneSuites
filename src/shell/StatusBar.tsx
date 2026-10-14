import { useEffect, useState } from 'react';
import { runCommand } from '@/core/commands';
import { useSettings } from '@/core/settings';
import { models, useApp } from '@/core/store';
import type { ModuleDef } from '@/core/types';
import { loadModule, MODULE_META } from '@/modules/meta';

export function StatusBar() {
  const docs = useApp((s) => s.docs);
  const activeId = useApp((s) => s.activeId);
  const sync = useApp((s) => s.sync);
  useApp((s) => s.tick); // modules call api.refreshChrome() to update the hint
  const recents = useSettings((s) => s.s.recents.length);
  const allProviders = useSettings((s) => s.s.providers);
  const providers = allProviders.filter((p) => p.enabled && p.sync);
  const osLabel = useSettings((s) => s.osLabel);
  const doc = docs.find((d) => d.id === activeId) ?? null;
  const [mod, setMod] = useState<ModuleDef | null>(null);
  useEffect(() => { if (doc) void loadModule(doc.mode).then(setMod); else setMod(null); }, [doc?.mode]);

  const mode = doc ? MODULE_META[doc.mode].name.toUpperCase() : 'HOME';
  let hint = '';
  if (!doc) hint = `${recents} recent · ${1 + sync.devices.length} device${sync.devices.length ? 's' : ''}`;
  else if (mod?.statusHint) { try { hint = mod.statusHint(models.get(doc.id)); } catch { hint = doc.title; } }
  else hint = doc.title;

  const states = providers.map((p) => sync.providers[p.id]?.status ?? 'unknown');
  let syncLabel = 'Local only';
  let dot = 'var(--mute)';
  if (providers.length) {
    if (sync.conflicts.length) { syncLabel = `${sync.conflicts.length} conflict${sync.conflicts.length > 1 ? 's' : ''}`; dot = 'var(--accent)'; }
    else if (sync.running || states.includes('syncing')) { syncLabel = 'Syncing…'; dot = 'var(--info)'; }
    else if (states.includes('error')) { syncLabel = 'Sync error'; dot = 'var(--negative)'; }
    else if (states.includes('offline')) { syncLabel = `Offline · ${sync.pending} queued`; dot = 'var(--accent)'; }
    else if (sync.pending) { syncLabel = `${sync.pending} pending`; dot = 'var(--accent)'; }
    else { syncLabel = 'Synced'; dot = 'var(--positive)'; }
  }

  return (
    <div style={{ height: 'var(--h-statusbar)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 12px', background: 'var(--bg1)', borderTop: '1px solid var(--line)', font: 'var(--type-mono)', color: 'var(--mute)', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'hidden' }}>
      <span style={{ color: 'var(--ink)' }}>{mode}</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{hint}</span>
      <span style={{ flex: 1 }} />
      <span onClick={() => void runCommand('app.sync')} className="hov-ink" style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
        <span style={{ width: 6, height: 6, background: dot, borderRadius: '50%' }} />{syncLabel}
      </span>
      <span>{osLabel}</span>
    </div>
  );
}
