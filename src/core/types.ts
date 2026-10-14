import type { ComponentType } from 'react';

export type Mode = 'pixel' | 'cells' | 'deck' | 'write' | 'paper';
export const MODES: Mode[] = ['pixel', 'cells', 'deck', 'write', 'paper'];

/** Where a document lives. `null` path = never saved. */
export interface DocLocation {
  /** 'local' = file system path; 'provider' = a file inside a sync provider opened directly. */
  kind: 'local' | 'provider';
  path: string;
  providerId?: string;
}

export interface FolderWorkspace {
  /** Absolute folder path (local) */
  folder: string;
  files: string[];
  index: number;
}

export interface Doc {
  id: string;
  mode: Mode;
  title: string;
  location: DocLocation | null;
  /** Format of the file on disk ('tone' for native containers, otherwise the foreign ext, e.g. 'pdf', 'xlsx'). */
  format: string;
  dirty: boolean;
  convertedFrom?: { docId: string; title: string };
  folderWorkspace?: FolderWorkspace;
  /** Bumped whenever the module reports a change; used to trigger autosave & re-render of chrome. */
  rev: number;
  /** Last time the doc was saved (ms) */
  savedAt?: number;
}

// ---------- Menus & commands ----------

export type FeatureStatus = 'done' | 'partial' | 'planned';

export interface MenuItemDef {
  /** Stable command id, e.g. 'pixel.image.adjustments.invert' */
  id: string;
  label: string;
  shortcut?: string;
  status?: FeatureStatus;
  children?: MenuEntry[];
}
export type MenuEntry = MenuItemDef | '-';
export interface MenuDef { name: string; items: MenuEntry[] }

/** Context passed to every command handler. */
export interface CommandContext {
  doc: Doc | null;
  model: unknown;
}
export type CommandHandler = (ctx: CommandContext) => void | Promise<void>;

// ---------- Module contract ----------

export interface ExportResultFile { kind: 'file'; bytes: Uint8Array; filename: string }
/**
 * A conversion whose result opens in a new tab inside Tone. The bytes are handed to the target
 * module's openFile(bytes, filename) — so modules never depend on each other's models.
 * Interchange formats: pdf → Paper, html/md → Write, xlsx/csv → Cells, png → Pixel,
 * and `*.toneoutline` (JSON: { title, slides: [{ title, body: string[] }] }) → Deck.
 */
export interface ExportResultDoc { kind: 'doc'; mode: Mode; bytes: Uint8Array; filename: string }
export type ExportResult = ExportResultFile | ExportResultDoc;

export interface ExportOption {
  id: string;
  label: string;
  choices: string[];
  default: string;
}

export interface ExportFormat {
  id: string;
  /** e.g. 'PDF' */
  name: string;
  /** file extension without dot, e.g. 'pdf' */
  ext: string;
  description: string;
  /** If the result opens inside Tone, which module. */
  opensIn?: Mode;
  options?: ExportOption[];
  run: (model: unknown, opts: Record<string, string>, title: string) => Promise<ExportResult>;
}

export interface EditorProps<M = unknown> {
  doc: Doc;
  model: M;
  /** Call after every user edit (marks dirty, schedules autosave). */
  onChange: () => void;
  /** True when narrow (Android / small window) layout should be used. */
  compact: boolean;
  /** Core services (dialogs, toasts, file pickers, opening docs, running commands). */
  api: ModuleApi;
}

export interface ModuleDef<M = any> {
  id: Mode;
  mark: string;
  name: string;
  description: string;
  /** Foreign file extensions this module can open (lowercase, no dot). */
  opens: string[];
  /** Create a blank document. May show a dialog first; return null if the user cancelled. */
  createBlank: () => Promise<{ model: M; title: string } | null>;
  /** Open a foreign file (pdf, xlsx, docx, png...). */
  openFile: (bytes: Uint8Array, filename: string) => Promise<M>;
  /** Native format: files written into the .tone zip container (manifest is added by core). */
  serialize: (model: M) => Promise<Record<string, Uint8Array | string>>;
  deserialize: (files: Record<string, Uint8Array>, formatVersion: number) => Promise<M>;
  /** When a foreign-format doc is saved in place (e.g. a PDF in Paper), produce bytes in that format. Return null if unsupported (core falls back to Save as .tone). */
  saveForeign?: (model: M, format: string) => Promise<Uint8Array | null>;
  exports: ExportFormat[];
  menus: MenuDef[];
  /** Command handlers keyed by MenuItemDef.id. */
  commands: (getModel: () => M | undefined, api: ModuleApi) => Record<string, CommandHandler>;
  Editor: ComponentType<EditorProps<M>>;
  /** Short hint for the status bar */
  statusHint?: (model: M) => string;
}

/** Services the core exposes to modules. */
export interface ModuleApi {
  toast: (msg: string, tone?: 'info' | 'error') => void;
  openDialog: (render: (close: () => void) => import('react').ReactNode) => void;
  markDirty: () => void;
  pickFile: (exts: string[], multiple?: boolean) => Promise<{ name: string; bytes: Uint8Array }[]>;
  saveBytes: (bytes: Uint8Array, filename: string, exts: string[]) => Promise<boolean>;
  /** Open a model of THIS module in a new tab (e.g. Paper › Split). */
  openNewDoc: (mode: Mode, model: unknown, title: string, convertedFrom?: string) => void;
  /** Open bytes in the module that handles `filename`'s extension, in a new tab, linked back to the current doc. */
  openBytesAsDoc: (bytes: Uint8Array, filename: string) => Promise<void>;
  runCommand: (id: string) => void;
  /** Ask the chrome (status bar, menus) to re-read the model, e.g. after selection changes that aren't edits. */
  refreshChrome: () => void;
}
