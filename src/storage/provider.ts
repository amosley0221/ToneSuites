// Storage provider interface (Google Drive, WebDAV NAS).
import type { ProviderConfig } from '@/core/settings';

export interface RemoteEntry {
  /** Path relative to the provider root, '/'-separated, no leading slash */
  rel: string;
  isDir: boolean;
  size: number;
  mtime: number;
  /** Opaque revision marker (etag / md5 / modifiedTime) */
  rev: string;
  /** Provider-specific id (Drive file id) */
  id?: string;
}

export interface StorageProvider {
  config: ProviderConfig;
  /** Verify credentials/connectivity. Throws with a readable message on failure. */
  test(): Promise<void>;
  /** List one folder (rel '' = provider root). */
  list(rel: string): Promise<RemoteEntry[]>;
  /** List everything under the root recursively (files only). */
  listAll(): Promise<RemoteEntry[]>;
  get(rel: string): Promise<Uint8Array>;
  /** Upload; returns the new revision marker. */
  put(rel: string, bytes: Uint8Array): Promise<string>;
  remove(rel: string): Promise<void>;
  usage(): Promise<{ used: number; total: number } | null>;
  /** Human-readable location, e.g. 'webdav://nas/Tone' or 'drive://Tone' */
  label(): string;
}

export function joinRel(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}
