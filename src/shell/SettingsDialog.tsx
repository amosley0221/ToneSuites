import { useState } from 'react';
import { displayShortcut, flattenMenus, GLOBAL_SHORTCUTS } from '@/core/commands';
import { isTauri, pickOpenPaths, uid } from '@/core/platform';
import { ACCENTS, useSettings, type ProviderConfig } from '@/core/settings';
import { useApp } from '@/core/store';
import type { Mode, ModuleDef } from '@/core/types';
import { runCommand } from '@/core/commands';
import { runUpdateCheck, useUpdates } from '@/core/updater';
import { connectGoogleDrive } from '@/storage/gdrive';
import { relTime } from './format';
import { webdavBrowseUrl } from '@/storage/webdav';
import { makeProvider, requestSync } from '@/storage/sync';
import { loadModule, MODULE_META } from '@/modules/meta';
import { Badge, Button, Dialog, DialogNav, Eyebrow, FormRow, Input, Segmented, Select, Switch } from '@/ui';

const TABS = ['General', 'Appearance', 'Shortcuts', 'Sync', 'Updates', 'Modules', 'Formats'] as const;
type Tab = (typeof TABS)[number];

export function SettingsDialog({ close, initial }: { close: () => void; initial?: string }) {
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(initial ?? '') ? (initial as Tab) : 'General');
  const hasUpdate = useUpdates((u) => !!u.available);
  return (
    <Dialog title="Settings" subtitle={`Tone Suites ${__APP_VERSION__}`} width={860} height={580} onClose={close} stackOnPhone>
      <DialogNav items={TABS.map((t) => ({ value: t, label: t, hint: t === 'Updates' && hasUpdate ? <span style={{ color: 'var(--accent)' }}>NEW</span> : undefined }))} value={tab} onChange={setTab} />
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px' }}>
        {tab === 'General' && <General />}
        {tab === 'Appearance' && <Appearance />}
        {tab === 'Shortcuts' && <Shortcuts />}
        {tab === 'Sync' && <Sync />}
        {tab === 'Updates' && <Updates />}
        {tab === 'Modules' && <Modules />}
        {tab === 'Formats' && <Formats />}
      </div>
    </Dialog>
  );
}

function General() {
  const { s, update } = useSettings();
  const pickWorkspace = async () => {
    const [p] = await pickOpenPaths([], false, true);
    if (p) { update({ workspaceDir: p }); requestSync(500); }
  };
  return (
    <div>
      <Eyebrow>This device</Eyebrow>
      <FormRow label="Device name (shown on your other devices)"><Input value={s.deviceName} onChange={(v) => update({ deviceName: v })} style={{ width: 240 }} /></FormRow>
      <FormRow label="Workspace folder (synced)">
        <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.workspaceDir || '—'}</span>
        {isTauri && <Button size="sm" onClick={() => void pickWorkspace()}>Change…</Button>}
      </FormRow>
      <Eyebrow style={{ marginTop: 22 }}>Documents</Eyebrow>
      <FormRow label="Autosave every"><Select value={String(s.autosaveSeconds)} options={[{ value: '0', label: 'Off' }, { value: '5', label: '5 seconds' }, { value: '30', label: '30 seconds' }, { value: '60', label: '1 minute' }]} onChange={(v) => update({ autosaveSeconds: Number(v) })} /></FormRow>
      <FormRow label="Reopen my tabs on launch"><Switch on={s.restoreSession} onChange={(v) => update({ restoreSession: v })} /></FormRow>
    </div>
  );
}

function Updates() {
  const { s, update } = useSettings();
  const { available, checking, lastChecked, error } = useUpdates();
  const check = () => void runUpdateCheck(true).catch(() => { /* shown below via error */ });
  return (
    <div>
      {available ? (
        <div style={{ border: '1px solid var(--accent)', background: 'var(--sel)', padding: 14, marginBottom: 14 }}>
          <div style={{ fontWeight: 800 }}>Tone Suites {available.version} is available</div>
          <div style={{ font: 'var(--type-small)', color: 'var(--mute)', margin: '4px 0 10px' }}>
            You have {__APP_VERSION__}. {available.kind === 'android' ? 'Install it through Vault (or download it here) — it installs over this version.' : 'It installs in place; your files and settings stay.'}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" onClick={() => void runCommand('app.showUpdate')}>{available.kind === 'android' ? 'See notes & download' : 'See notes & install'}</Button>
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--line)', padding: 14, marginBottom: 14, background: 'var(--bg0)' }}>
          <div style={{ fontWeight: 800 }}>{checking ? 'Checking for updates…' : error ? 'Couldn\'t check for updates' : !isTauri ? 'Updates are delivered to the installed app' : lastChecked ? 'You\'re up to date' : 'Not checked yet'}</div>
          <div style={{ font: 'var(--type-small)', color: error ? 'var(--negative)' : 'var(--mute)', marginTop: 4 }}>
            {error ?? `Tone Suites ${__APP_VERSION__}`}
          </div>
        </div>
      )}
      <FormRow label="Current version"><span style={{ font: 'var(--type-mono)' }}>{__APP_VERSION__}</span></FormRow>
      <FormRow label="Last checked">
        <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{lastChecked ? relTime(lastChecked) : '—'}</span>
        <Button size="sm" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check now'}</Button>
      </FormRow>
      <FormRow label="When an update is available (Windows / macOS)">
        <Segmented value={s.updateMode === 'prompt' ? 'Ask to restart' : 'Install on next launch'} options={['Ask to restart', 'Install on next launch']} onChange={(v) => update({ updateMode: v === 'Ask to restart' ? 'prompt' : 'silent' })} />
      </FormRow>
      <FormRow label="Release notes for this version"><Button size="sm" onClick={() => void runCommand('app.whatsNew')}>What's new</Button></FormRow>
      <div className="empty-hint" style={{ marginTop: 8 }}>Tone checks when it starts and every few hours. A new version shows a one-time popup and stays in the title bar until installed.</div>
    </div>
  );
}

function Appearance() {
  const { s, update } = useSettings();
  return (
    <div>
      <Eyebrow>Theme</Eyebrow>
      <FormRow label="Mode"><Segmented value={s.theme === 'dark' ? 'Dark' : 'Light'} options={['Dark', 'Light']} onChange={(v) => update({ theme: v === 'Dark' ? 'dark' : 'light' })} /></FormRow>
      <FormRow label="Accent">
        {ACCENTS.map((a) => (
          <div key={a.value} title={a.name} onClick={() => update({ accent: a.value })}
            style={{ width: 26, height: 26, background: a.value, cursor: 'pointer', outline: s.accent === a.value ? '2px solid var(--ink)' : 'none', outlineOffset: 2 }} />
        ))}
      </FormRow>
      <FormRow label="Measurement units"><Segmented value={s.defaultUnits} options={['px', 'in', 'cm'] as const} onChange={(v) => update({ defaultUnits: v })} /></FormRow>
    </div>
  );
}

function Shortcuts() {
  const [mode, setMode] = useState<Mode | 'global'>('global');
  const [mod, setMod] = useState<ModuleDef | null>(null);
  const pick = (m: Mode | 'global') => { setMode(m); if (m !== 'global') void loadModule(m).then(setMod); else setMod(null); };
  const rows = mode === 'global' ? GLOBAL_SHORTCUTS.map((g) => ({ label: g.label, shortcut: g.shortcut, path: '' })) : (mod ? flattenMenus(mod.menus).filter((i) => i.shortcut) : []);
  return (
    <div>
      <Segmented value={mode === 'global' ? 'Global' : MODULE_META[mode].name} options={['Global', ...Object.values(MODULE_META).map((m) => m.name)]}
        onChange={(v) => pick(v === 'Global' ? 'global' : (Object.values(MODULE_META).find((m) => m.name === v)!.id))} />
      <div style={{ marginTop: 14 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--line)', font: 'var(--type-small)' }}>
            <span>{r.label} {r.path && <span style={{ color: 'var(--mute)', font: 'var(--type-mono)', fontSize: 10 }}> {r.path}</span>}</span>
            <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{displayShortcut(r.shortcut)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Modules() {
  const { s, update } = useSettings();
  return (
    <div>
      <Eyebrow>Modules shown on Home</Eyebrow>
      {Object.values(MODULE_META).map((m) => (
        <FormRow key={m.id} label={<span><b style={{ color: 'var(--ink)' }}>{m.name}</b> — {m.description}</span>}>
          <Switch on={s.modulesEnabled[m.id] !== false} onChange={(v) => update({ modulesEnabled: { ...s.modulesEnabled, [m.id]: v } })} />
        </FormRow>
      ))}
    </div>
  );
}

function Formats() {
  return (
    <div>
      <Eyebrow>File types Tone opens</Eyebrow>
      {Object.values(MODULE_META).map((m) => (
        <FormRow key={m.id} label={<b style={{ color: 'var(--ink)' }}>{m.name}</b>}>
          <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>.tone {m.opens.map((e) => '.' + e).join(' ')}</span>
        </FormRow>
      ))}
      <div className="empty-hint" style={{ marginTop: 10 }}>.tone is Tone's native container (a zip with a manifest). Older .tone files are migrated when opened and only rewritten when you save.</div>
    </div>
  );
}

// ---------- Sync ----------

function Sync() {
  const { s, update } = useSettings();
  const states = useApp((a) => a.sync.providers);
  const [adding, setAdding] = useState<'webdav' | 'gdrive' | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const remove = (id: string) => {
    update({ providers: useSettings.getState().s.providers.filter((p) => p.id !== id) });
    useSettings.getState().dropSecret(id);
    useApp.getState().setSync({ providers: Object.fromEntries(Object.entries(useApp.getState().sync.providers).filter(([k]) => k !== id)) });
  };
  return (
    <div>
      <Eyebrow>Storage providers</Eyebrow>
      <ProviderRow name="Local" detail={`This device · ${s.workspaceDir || 'browser downloads'}`} meta="Always on" status={<Badge tone="positive">Default</Badge>} />
      {s.providers.map((p) => {
        const st = states[p.id];
        return (
          <div key={p.id}>
            <ProviderRow name={p.name}
              detail={p.kind === 'gdrive' ? `Google account · ${p.account || 'not connected'}` : `WebDAV · ${p.username || 'no user'}`}
              meta={p.kind === 'gdrive' ? `/${p.url || 'Tone'}` : (p.url ?? '').replace(/^https?:\/\//, '')}
              status={<>
                <Badge tone={st?.status === 'online' ? 'positive' : st?.status === 'error' ? 'negative' : st?.status === 'offline' ? 'accent' : 'mute'}>
                  {!p.enabled ? 'Off' : st?.status === 'online' ? (p.kind === 'gdrive' ? 'Connected' : 'Mounted') : st?.status ?? 'Not synced yet'}
                </Badge>
                <Button size="sm" onClick={() => setEditing(editing === p.id ? null : p.id)}>{editing === p.id ? 'Close' : 'Edit'}</Button>
              </>} />
            {st?.message && <div style={{ font: 'var(--type-mono)', color: 'var(--negative)', margin: '-4px 0 8px' }}>{st.message}</div>}
            {editing === p.id && (p.kind === 'webdav'
              ? <WebDavForm existing={p} onDone={() => setEditing(null)} onRemove={() => { remove(p.id); setEditing(null); }} />
              : <GDriveForm existing={p} onDone={() => setEditing(null)} onRemove={() => { remove(p.id); setEditing(null); }} />)}
          </div>
        );
      })}
      {!adding && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button onClick={() => setAdding('webdav')}>+ NAS / WebDAV</Button>
          <Button onClick={() => setAdding('gdrive')}>+ Google Drive</Button>
        </div>
      )}
      {adding === 'webdav' && <WebDavForm onDone={() => setAdding(null)} />}
      {adding === 'gdrive' && <GDriveForm onDone={() => setAdding(null)} />}
      <div style={{ font: 'var(--type-small)', color: 'var(--mute)', marginTop: 14 }}>
        Edits always save to the local workspace first, then sync to every connected provider. Offline edits queue and sync when the provider is reachable again.
        Your NAS is reached over WebDAV (works on Windows, macOS and Android); Google Drive uses your Google account.
      </div>
      <Eyebrow style={{ marginTop: 22 }}>Conflicts</Eyebrow>
      <Segmented value={s.conflictPolicy === 'ask' ? 'Ask me' : s.conflictPolicy === 'newest' ? 'Keep newest' : 'Keep both'} options={['Ask me', 'Keep newest', 'Keep both']}
        onChange={(v) => update({ conflictPolicy: v === 'Ask me' ? 'ask' : v === 'Keep newest' ? 'newest' : 'both' })} />
      <FormRow label="Sync every">
        <Select value={String(s.syncIntervalSeconds)} options={[{ value: '30', label: '30 seconds' }, { value: '60', label: '1 minute' }, { value: '300', label: '5 minutes' }, { value: '900', label: '15 minutes' }]} onChange={(v) => update({ syncIntervalSeconds: Number(v) })} />
        <Button size="sm" onClick={() => requestSync(0)}>Sync now</Button>
      </FormRow>
    </div>
  );
}

function ProviderRow({ name, detail, meta, status }: { name: string; detail: string; meta: string; status: React.ReactNode }) {
  return (
    <div className="provider-row" style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr auto', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--line)', marginBottom: 8, background: 'var(--bg0)' }}>
      <div><div style={{ fontWeight: 800 }}>{name}</div><div style={{ font: 'var(--type-small)', color: 'var(--mute)' }}>{detail}</div></div>
      <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{meta}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{status}</div>
    </div>
  );
}

function useSaveProvider() {
  return (cfg: ProviderConfig) => {
    // Read the latest list: Google sign-in can take minutes, during which other providers may change.
    const { s, update } = useSettings.getState();
    const exists = s.providers.some((p) => p.id === cfg.id);
    update({ providers: exists ? s.providers.map((p) => (p.id === cfg.id ? cfg : p)) : [...s.providers, cfg] });
    requestSync(500);
  };
}

function WebDavForm({ existing, onDone, onRemove }: { existing?: ProviderConfig; onDone: () => void; onRemove?: () => void }) {
  const save = useSaveProvider();
  const { secrets, setSecret } = useSettings();
  const [cfg, setCfg] = useState<ProviderConfig>(existing ?? { id: uid(), kind: 'webdav', name: '', enabled: true, sync: true, url: '', username: '' });
  const [pw, setPw] = useState(existing ? secrets[existing.id]?.password ?? '' : '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true); setMsg(null);
    try {
      setSecret(cfg.id, { password: pw });
      await makeProvider(cfg).test();
      setMsg({ ok: true, text: 'Connected.' });
    } catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); }
    setBusy(false);
  };
  return (
    <div style={{ border: '1px solid var(--line)', padding: 14, marginBottom: 10, background: 'var(--bg0)' }}>
      <FormRow label="Name"><Input value={cfg.name} placeholder="e.g. Home NAS" onChange={(v) => setCfg({ ...cfg, name: v })} style={{ width: 300 }} /></FormRow>
      <FormRow label="Sync folder (WebDAV address)"><Input mono value={cfg.url ?? ''} placeholder="http://<nas-ip>:<port>/<share>/Tone" onChange={(v) => setCfg({ ...cfg, url: v.trim() })} style={{ width: 300 }} /></FormRow>
      <FormRow label="Browse from (Open from NAS)"><Input mono value={cfg.browseUrl ?? ''} placeholder={webdavBrowseUrl({ ...cfg, browseUrl: '' }) || 'http://<nas-ip>:<port>'} onChange={(v) => setCfg({ ...cfg, browseUrl: v.trim() })} style={{ width: 300 }} /></FormRow>
      <FormRow label="Username"><Input value={cfg.username ?? ''} onChange={(v) => setCfg({ ...cfg, username: v })} style={{ width: 300 }} /></FormRow>
      <FormRow label="Password (stays on this device)"><Input type="password" value={pw} onChange={setPw} style={{ width: 300 }} /></FormRow>
      <FormRow label="Sync my workspace with this NAS"><Switch on={cfg.sync} onChange={(v) => setCfg({ ...cfg, sync: v })} /></FormRow>
      <FormRow label="Enabled"><Switch on={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} /></FormRow>
      <div style={{ font: 'var(--type-small)', color: 'var(--mute)', margin: '6px 0 10px' }}>
        UGREEN NAS: turn on WebDAV in UGOS Pro (Control Panel › File Services › WebDAV). The sync folder is where Tone keeps your
        documents in step across devices, e.g. <span className="mono">http://&lt;NAS IP&gt;:&lt;port&gt;/&lt;shared folder&gt;/Tone</span>.
        File › Open from NAS browses every shared folder your account can reach, starting at "Browse from" (the NAS root unless you change it).
        Away from home, use the NAS's Tailscale address. See docs/SETUP.md.
      </div>
      {msg && <div style={{ font: 'var(--type-mono)', color: msg.ok ? 'var(--positive)' : 'var(--negative)', marginBottom: 8 }}>{msg.text}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button disabled={busy || !cfg.url} onClick={() => void test()}>{busy ? 'Testing…' : 'Test connection'}</Button>
        <span style={{ flex: 1 }} />
        {onRemove && <Button variant="ghost" onClick={onRemove}>Remove</Button>}
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={!cfg.url || !cfg.name} onClick={() => { setSecret(cfg.id, { password: pw }); save(cfg); onDone(); }}>Save</Button>
      </div>
    </div>
  );
}

function GDriveForm({ existing, onDone, onRemove }: { existing?: ProviderConfig; onDone: () => void; onRemove?: () => void }) {
  const save = useSaveProvider();
  const { secrets } = useSettings();
  const [cfg, setCfg] = useState<ProviderConfig>(existing ?? { id: uid(), kind: 'gdrive', name: 'Google Drive', enabled: true, sync: true, url: 'Tone', clientId: '' });
  const [secret, setSecretVal] = useState(existing ? secrets[existing.id]?.clientSecret ?? '' : '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true); setMsg({ ok: true, text: 'Finish signing in in your browser…' });
    try {
      const { email } = await connectGoogleDrive(cfg, secret);
      const next = { ...cfg, account: email };
      setCfg(next);
      save(next);
      setMsg({ ok: true, text: `Connected as ${email}.` });
    } catch (e: any) { setMsg({ ok: false, text: String(e?.message ?? e) }); }
    setBusy(false);
  };
  return (
    <div style={{ border: '1px solid var(--line)', padding: 14, marginBottom: 10, background: 'var(--bg0)' }}>
      <FormRow label="Name"><Input value={cfg.name} onChange={(v) => setCfg({ ...cfg, name: v })} style={{ width: 300 }} /></FormRow>
      <FormRow label="Sync folder in My Drive"><Input mono value={cfg.url ?? ''} onChange={(v) => setCfg({ ...cfg, url: v.trim() })} style={{ width: 300 }} /></FormRow>
      <FormRow label="OAuth client ID"><Input mono value={cfg.clientId ?? ''} placeholder="….apps.googleusercontent.com" onChange={(v) => setCfg({ ...cfg, clientId: v.trim() })} style={{ width: 300 }} /></FormRow>
      <FormRow label="OAuth client secret (stays on this device)"><Input type="password" value={secret} onChange={setSecretVal} style={{ width: 300 }} /></FormRow>
      <FormRow label="Sync my workspace with Drive"><Switch on={cfg.sync} onChange={(v) => setCfg({ ...cfg, sync: v })} /></FormRow>
      <FormRow label="Enabled"><Switch on={cfg.enabled} onChange={(v) => setCfg({ ...cfg, enabled: v })} /></FormRow>
      <div style={{ font: 'var(--type-small)', color: 'var(--mute)', margin: '6px 0 10px' }}>
        Create a free "Desktop app" OAuth client in your own Google Cloud project (Drive API enabled) and paste its ID and secret here — step-by-step in docs/SETUP.md.
        {cfg.account && <> Connected as <b style={{ color: 'var(--ink)' }}>{cfg.account}</b>.</>}
      </div>
      {msg && <div style={{ font: 'var(--type-mono)', color: msg.ok ? 'var(--positive)' : 'var(--negative)', marginBottom: 8 }}>{msg.text}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="strong" disabled={busy || !cfg.clientId || !secret} onClick={() => void connect()}>{busy ? 'Waiting for Google…' : cfg.account ? 'Reconnect' : 'Sign in with Google'}</Button>
        <span style={{ flex: 1 }} />
        {onRemove && <Button variant="ghost" onClick={onRemove}>Remove</Button>}
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" disabled={!cfg.clientId} onClick={() => { useSettings.getState().setSecret(cfg.id, { clientSecret: secret }); save(cfg); onDone(); }}>Save</Button>
      </div>
    </div>
  );
}
