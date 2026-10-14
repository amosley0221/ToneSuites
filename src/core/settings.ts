// User settings + device identity, persisted to the app data dir.
// Nothing in here ships with values: everything starts empty and is filled by the user.
import { create } from 'zustand';
import { appDataDir, defaultWorkspaceDir, hostname, isTauri, joinPath, osLabel, readText, uid, writeText } from './platform';
import type { Mode } from './types';

export type ProviderKind = 'webdav' | 'gdrive';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  /** User-chosen display name ("Home NAS", "Google Drive") */
  name: string;
  enabled: boolean;
  /** webdav: base URL incl. folder (e.g. http://100.x.y.z:5005/Tone); gdrive: name of the root folder in My Drive */
  url?: string;
  username?: string;
  /** gdrive: OAuth client id / secret (Desktop app type) entered by the user */
  clientId?: string;
  /** gdrive: connected account email (display only) */
  account?: string;
  /** Sync the local workspace with this provider */
  sync: boolean;
}

export interface RecentEntry {
  title: string;
  mode: Mode;
  format: string;
  location: { kind: 'local' | 'provider'; path: string; providerId?: string };
  openedAt: number;
}

export type ConflictPolicy = 'ask' | 'newest' | 'both';

export interface Settings {
  theme: 'dark' | 'light';
  accent: string;
  deviceId: string;
  deviceName: string;
  workspaceDir: string;
  autosaveSeconds: number;
  updateMode: 'prompt' | 'silent';
  conflictPolicy: ConflictPolicy;
  syncIntervalSeconds: number;
  providers: ProviderConfig[];
  recents: RecentEntry[];
  lastSeenVersion: string;
  modulesEnabled: Record<Mode, boolean>;
  /** Default export options per format id */
  defaultUnits: 'px' | 'in' | 'cm';
  restoreSession: boolean;
  /** Tabs open when the app was last closed (restored on launch). */
  lastSession: { mode: Mode; title: string; format: string; location: RecentEntry['location'] }[];
}

/** Secrets never leave this device (not synced). */
export interface Secrets {
  [providerId: string]: { password?: string; refreshToken?: string; accessToken?: string; expiresAt?: number; clientSecret?: string };
}

export const ACCENTS = [
  { name: 'Orange', value: '#ff5a1f' },
  { name: 'Lime', value: '#e8ff47' },
  { name: 'Blue', value: '#4f8ff7' },
  { name: 'Green', value: '#2fb98a' },
];

function defaults(): Settings {
  return {
    theme: 'dark',
    accent: '#ff5a1f',
    deviceId: '',
    deviceName: '',
    workspaceDir: '',
    autosaveSeconds: 5,
    updateMode: 'prompt',
    conflictPolicy: 'ask',
    syncIntervalSeconds: 60,
    providers: [],
    recents: [],
    lastSeenVersion: '',
    modulesEnabled: { pixel: true, cells: true, deck: true, write: true, paper: true },
    defaultUnits: 'px',
    restoreSession: true,
    lastSession: [],
  };
}

interface SettingsStore {
  s: Settings;
  secrets: Secrets;
  loaded: boolean;
  osLabel: string;
  load: () => Promise<void>;
  update: (patch: Partial<Settings>) => void;
  setSecret: (providerId: string, patch: Secrets[string]) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
async function settingsPath(name: string) { return joinPath(await appDataDir(), name); }

async function persist(s: Settings, secrets: Secrets) {
  if (!isTauri) {
    try {
      localStorage.setItem('tone.settings', JSON.stringify(s));
      localStorage.setItem('tone.secrets', JSON.stringify(secrets));
    } catch { /* storage unavailable */ }
    return;
  }
  await writeText(await settingsPath('settings.json'), JSON.stringify(s, null, 2));
  await writeText(await settingsPath('secrets.json'), JSON.stringify(secrets));
}

export const useSettings = create<SettingsStore>((set, get) => ({
  s: defaults(),
  secrets: {},
  loaded: false,
  osLabel: '',
  load: async () => {
    let s = defaults();
    let secrets: Secrets = {};
    try {
      if (isTauri) {
        const raw = await readText(await settingsPath('settings.json'));
        if (raw) s = { ...s, ...JSON.parse(raw) };
        const sec = await readText(await settingsPath('secrets.json'));
        if (sec) secrets = JSON.parse(sec);
      } else {
        const raw = localStorage.getItem('tone.settings');
        if (raw) s = { ...s, ...JSON.parse(raw) };
        const sec = localStorage.getItem('tone.secrets');
        if (sec) secrets = JSON.parse(sec);
      }
    } catch (e) {
      console.warn('settings load failed', e);
    }
    let dirty = false;
    if (!s.deviceId) { s.deviceId = uid(); dirty = true; }
    if (!s.deviceName) { s.deviceName = await hostname().catch(() => 'This device'); dirty = true; }
    if (!s.workspaceDir && isTauri) { s.workspaceDir = await defaultWorkspaceDir(); dirty = true; }
    const label = await osLabel().catch(() => '');
    set({ s, secrets, loaded: true, osLabel: label });
    if (dirty) await persist(s, secrets);
  },
  update: (patch) => {
    const s = { ...get().s, ...patch };
    set({ s });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(get().s, get().secrets), 300);
  },
  setSecret: (providerId, patch) => {
    const secrets = { ...get().secrets, [providerId]: { ...get().secrets[providerId], ...patch } };
    set({ secrets });
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(get().s, get().secrets), 300);
  },
}));

export function addRecent(entry: Omit<RecentEntry, 'openedAt'>) {
  const { s, update } = useSettings.getState();
  const key = (e: RecentEntry['location']) => `${e.kind}:${e.providerId ?? ''}:${e.path}`;
  const recents = [{ ...entry, openedAt: Date.now() }, ...s.recents.filter((r) => key(r.location) !== key(entry.location))].slice(0, 30);
  update({ recents });
}

export function applyTheme(theme: Settings['theme'], accent: string) {
  const root = document.documentElement;
  if (theme === 'light') root.setAttribute('data-theme', 'light');
  else root.removeAttribute('data-theme');
  root.style.setProperty('--accent', accent);
  const r = parseInt(accent.slice(1, 3), 16), g = parseInt(accent.slice(3, 5), 16), b = parseInt(accent.slice(5, 7), 16);
  root.style.setProperty('--sel', `rgba(${r},${g},${b},${theme === 'light' ? 0.12 : 0.14})`);
  document.body.style.background = 'var(--bg0)';
}
