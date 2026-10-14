// .tone container: a zip with manifest.json + module payload files + assets.
import JSZip from 'jszip';
import type { Mode } from './types';

export const FORMAT_VERSION = 1;

export interface ToneManifest {
  format: 'tone';
  formatVersion: number;
  mode: Mode;
  title: string;
  created: string;
  modified: string;
  appVersion: string;
  deviceId: string;
  convertedFrom?: string;
}

export async function packTone(manifest: Omit<ToneManifest, 'format' | 'formatVersion'>, files: Record<string, Uint8Array | string>): Promise<Uint8Array> {
  const zip = new JSZip();
  const full: ToneManifest = { format: 'tone', formatVersion: FORMAT_VERSION, ...manifest };
  zip.file('manifest.json', JSON.stringify(full, null, 2));
  for (const [name, data] of Object.entries(files)) {
    if (name === 'manifest.json') continue;
    zip.file(name, data);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

export async function unpackTone(bytes: Uint8Array): Promise<{ manifest: ToneManifest; files: Record<string, Uint8Array> }> {
  const zip = await JSZip.loadAsync(bytes);
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('Not a Tone file (manifest.json missing)');
  const manifest = JSON.parse(await mf.async('string')) as ToneManifest;
  if (manifest.format !== 'tone') throw new Error('Not a Tone file');
  if (manifest.formatVersion > FORMAT_VERSION) {
    throw new Error(`This file was saved by a newer version of Tone (format ${manifest.formatVersion}). Update the app to open it.`);
  }
  const files: Record<string, Uint8Array> = {};
  await Promise.all(
    Object.values(zip.files)
      .filter((f) => !f.dir && f.name !== 'manifest.json')
      .map(async (f) => { files[f.name] = await f.async('uint8array'); }),
  );
  return { manifest, files };
}

/** Peek the mode of a .tone file without fully unpacking. */
export async function peekToneMode(bytes: Uint8Array): Promise<Mode | null> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const mf = zip.file('manifest.json');
    if (!mf) return null;
    return (JSON.parse(await mf.async('string')) as ToneManifest).mode;
  } catch { return null; }
}

export const text = (u: Uint8Array) => new TextDecoder().decode(u);
export const bytes = (s: string) => new TextEncoder().encode(s);
