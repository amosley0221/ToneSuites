// Native .tone payload: original.pdf + edits.json (+ sources/<id>.pdf for merged documents).
import { PaperModel, type PaperData } from './model';

export const PAPER_FORMAT_VERSION = 1;

interface EditsJson extends Omit<PaperData, 'sources'> {
  formatVersion: number;
  fileName: string;
  sources: { id: string; name: string; file: string }[];
}

export function serializeModel(m: PaperModel): Record<string, Uint8Array | string> {
  // Only keep sources that pages still reference (merged-then-deleted documents are dropped).
  const used = new Set(m.pages.map((p) => p.src));
  const sources = m.sources.filter((s, i) => i === 0 || used.has(s.id));
  const files: Record<string, Uint8Array | string> = {};
  const list = sources.map((s, i) => {
    const file = i === 0 ? 'original.pdf' : `sources/${s.id}.pdf`;
    files[file] = s.bytes;
    return { id: s.id, name: s.name, file };
  });
  const json: EditsJson = {
    formatVersion: PAPER_FORMAT_VERSION, fileName: m.fileName, sources: list,
    pages: m.pages, edits: m.edits, formValues: m.formValues, newFields: m.newFields, flattenForm: m.flattenForm,
  };
  files['edits.json'] = JSON.stringify(json);
  return files;
}

export function deserializeModel(files: Record<string, Uint8Array>, formatVersion: number): PaperModel {
  if (formatVersion > PAPER_FORMAT_VERSION) throw new Error('This Paper file was made by a newer version of Tone');
  const raw = files['edits.json'];
  if (!raw) throw new Error('Paper file is missing edits.json');
  const j = JSON.parse(new TextDecoder().decode(raw)) as EditsJson;
  const sources = j.sources.map((s) => {
    const bytes = files[s.file];
    if (!bytes) throw new Error(`Paper file is missing ${s.file}`);
    return { id: s.id, name: s.name, bytes };
  });
  return new PaperModel(j.fileName, {
    sources, pages: j.pages ?? [], edits: j.edits ?? [], formValues: j.formValues ?? {}, newFields: j.newFields ?? [], flattenForm: !!j.flattenForm,
  });
}
