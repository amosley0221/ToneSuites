// Native .tone payload: deck.json + media/* (images referenced by path). formatVersion 1.
import { DeckDoc, extMime, toDataUrl } from './doc';
import { defaultMaster, defaultTheme, type DeckData } from './model';

export async function serializeDeck(doc: DeckDoc): Promise<Record<string, Uint8Array | string>> {
  const files: Record<string, Uint8Array | string> = { 'deck.json': JSON.stringify(doc.data) };
  const used = new Set<string>();
  for (const s of doc.data.slides) for (const e of s.elements) if (e.type === 'image' && e.src) used.add(e.src);
  for (const path of used) {
    const m = doc.media.get(path);
    if (m) files[path] = m.bytes;
  }
  return files;
}

export async function deserializeDeck(files: Record<string, Uint8Array>, formatVersion: number): Promise<DeckDoc> {
  const raw = files['deck.json'];
  if (!raw) throw new Error('Deck payload missing (deck.json)');
  if (formatVersion > 1) throw new Error(`Deck format ${formatVersion} is newer than this app supports`);
  const data = migrate(JSON.parse(new TextDecoder().decode(raw)));
  const doc = new DeckDoc(data);
  for (const [path, bytes] of Object.entries(files)) {
    if (!path.startsWith('media/')) continue;
    const ext = path.split('.').pop() ?? '';
    const mime = extMime(ext);
    doc.media.set(path, { mime, bytes, url: toDataUrl(bytes, mime) });
  }
  return doc;
}

/** Fill defaults for fields that may be absent in older / hand-written files. */
export function migrate(d: Partial<DeckData>): DeckData {
  const out: DeckData = {
    formatVersion: 1,
    size: { w: 1920, h: 1080, ratio: '16:9' },
    theme: { ...defaultTheme(), ...(d.theme ?? {}) },
    masters: d.masters?.length ? d.masters : [defaultMaster()],
    slides: d.slides ?? [],
  };
  for (const s of out.slides) {
    s.elements ??= [];
    s.transition ??= 'none';
    s.notes ??= '';
  }
  return out;
}
