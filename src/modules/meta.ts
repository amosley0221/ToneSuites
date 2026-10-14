// Static module metadata (no heavy imports). Engines are lazy-loaded via loadModule().
import type { Mode, ModuleDef } from '@/core/types';

export interface ModuleMeta { id: Mode; mark: string; name: string; description: string; opens: string[] }

export const MODULE_META: Record<Mode, ModuleMeta> = {
  pixel: { id: 'pixel', mark: 'Px', name: 'Pixel', description: 'Layers, masks, retouch, RAW', opens: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'psd'] },
  cells: { id: 'cells', mark: 'Cl', name: 'Cells', description: 'Formulas, pivots, charts', opens: ['xlsx', 'csv', 'tsv'] },
  deck: { id: 'deck', mark: 'Dk', name: 'Deck', description: 'Slides, present, record', opens: [] },
  write: { id: 'write', mark: 'Wr', name: 'Write', description: 'Long-form, styles, track changes', opens: ['docx', 'md', 'markdown', 'txt', 'html', 'htm'] },
  paper: { id: 'paper', mark: 'Pp', name: 'Paper', description: 'PDF annotate, sign, OCR, merge', opens: ['pdf'] },
};

export const ALL_OPENABLE = ['tone', ...Object.values(MODULE_META).flatMap((m) => m.opens)];

export function modeForExt(ext: string): Mode | null {
  for (const m of Object.values(MODULE_META)) if (m.opens.includes(ext)) return m.id;
  return null;
}

// Each module folder's index.ts(x) default-exports its ModuleDef; loaded on first use (code-split).
const loaders = import.meta.glob<{ default: ModuleDef }>(['./*/index.ts', './*/index.tsx']);
const cache = new Map<Mode, Promise<ModuleDef>>();
export function loadModule(mode: Mode): Promise<ModuleDef> {
  let p = cache.get(mode);
  if (!p) {
    const load = loaders[`./${mode}/index.ts`] ?? loaders[`./${mode}/index.tsx`];
    p = load ? load().then((m) => m.default) : Promise.reject(new Error(`The ${MODULE_META[mode].name} module is not available in this build`));
    cache.set(mode, p);
  }
  return p;
}
