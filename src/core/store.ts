// Session state: open documents (tabs), overlays, sync status.
import { create } from 'zustand';
import type { ReactNode } from 'react';
import type { Doc, Mode } from './types';

export interface DialogEntry { id: number; render: (close: () => void) => ReactNode }
export interface Toast { id: number; msg: string; tone: 'info' | 'error' }

export interface RemoteDevice {
  id: string;
  name: string;
  os: string;
  lastActive: number;
  openDocs: { title: string; mode: Mode; rel: string }[];
  appVersion?: string;
}

export interface SyncConflict {
  id: string;
  providerId: string;
  providerName: string;
  rel: string;
  localMtime: number;
  remoteMtime: number;
  remoteDevice?: string;
}

export interface ProviderState {
  status: 'unknown' | 'online' | 'offline' | 'error' | 'syncing';
  message?: string;
  usage?: { used: number; total: number };
  files?: number;
  lastSync?: number;
}

export interface SyncState {
  running: boolean;
  pending: number;
  lastSync?: number;
  providers: Record<string, ProviderState>;
  conflicts: SyncConflict[];
  devices: RemoteDevice[];
}

interface AppState {
  docs: Doc[];
  activeId: string; // 'home' or doc id
  palette: boolean;
  dialogs: DialogEntry[];
  toasts: Toast[];
  inspectorOpen: boolean;
  handoffDismissedAt: number;
  sync: SyncState;
  /** Session id incremented when chrome needs re-render after model mutation */
  tick: number;
  setActive: (id: string) => void;
  addDoc: (doc: Doc) => void;
  updateDoc: (id: string, patch: Partial<Doc>) => void;
  removeDoc: (id: string) => void;
  moveDoc: (from: number, to: number) => void;
  setPalette: (v: boolean) => void;
  pushDialog: (render: DialogEntry['render']) => void;
  popDialog: (id?: number) => void;
  toast: (msg: string, tone?: Toast['tone']) => void;
  setSync: (patch: Partial<SyncState>) => void;
  setProviderState: (id: string, patch: Partial<ProviderState>) => void;
  bump: () => void;
}

let dialogSeq = 1;
let toastSeq = 1;

export const useApp = create<AppState>((set, get) => ({
  docs: [],
  activeId: 'home',
  palette: false,
  dialogs: [],
  toasts: [],
  inspectorOpen: false,
  handoffDismissedAt: 0,
  sync: { running: false, pending: 0, providers: {}, conflicts: [], devices: [] },
  tick: 0,
  setActive: (id) => set({ activeId: id, palette: false }),
  addDoc: (doc) => set({ docs: [...get().docs, doc], activeId: doc.id }),
  updateDoc: (id, patch) => set({ docs: get().docs.map((d) => (d.id === id ? { ...d, ...patch } : d)) }),
  removeDoc: (id) => {
    const docs = get().docs;
    const idx = docs.findIndex((d) => d.id === id);
    const next = docs.filter((d) => d.id !== id);
    let activeId = get().activeId;
    if (activeId === id) activeId = next[Math.min(idx, next.length - 1)]?.id ?? 'home';
    set({ docs: next, activeId });
  },
  moveDoc: (from, to) => {
    const docs = [...get().docs];
    const [d] = docs.splice(from, 1);
    docs.splice(to, 0, d);
    set({ docs });
  },
  setPalette: (v) => set({ palette: v }),
  pushDialog: (render) => set({ dialogs: [...get().dialogs, { id: dialogSeq++, render }] }),
  popDialog: (id) => {
    const ds = get().dialogs;
    set({ dialogs: id == null ? ds.slice(0, -1) : ds.filter((d) => d.id !== id) });
  },
  toast: (msg, tone = 'info') => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, msg, tone }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), tone === 'error' ? 6000 : 3200);
  },
  setSync: (patch) => set({ sync: { ...get().sync, ...patch } }),
  setProviderState: (id, patch) => {
    const sync = get().sync;
    set({ sync: { ...sync, providers: { ...sync.providers, [id]: { ...(sync.providers[id] ?? { status: 'unknown' }), ...patch } } } });
  },
  bump: () => set({ tick: get().tick + 1 }),
}));

/** Live module models, keyed by doc id. Kept outside React state; modules mutate them in place. */
export const models = new Map<string, unknown>();

export const activeDoc = (): Doc | null => {
  const { docs, activeId } = useApp.getState();
  return docs.find((d) => d.id === activeId) ?? null;
};
