// Pure data helpers for menu definitions (no runtime imports — also read by scripts/gen-features.mjs).
import type { FeatureStatus, MenuEntry, MenuItemDef } from './types.ts';

/** Build a menu item. `id` should be globally unique, e.g. 'pixel.image.invert'. */
export function item(id: string, label: string, shortcut?: string, status: FeatureStatus = 'planned', children?: MenuEntry[]): MenuItemDef {
  return { id, label, shortcut, status, children };
}
export const done = (id: string, label: string, shortcut?: string) => item(id, label, shortcut, 'done');
export const partial = (id: string, label: string, shortcut?: string) => item(id, label, shortcut, 'partial');
export const planned = (id: string, label: string, shortcut?: string) => item(id, label, shortcut, 'planned');
export const sub = (id: string, label: string, children: MenuEntry[], status: FeatureStatus = 'done') => item(id, label, undefined, status, children);
export const SEP = '-' as const;

/** File-menu items shared by every module (handled by the core). */
export function fileCommon(): { open: MenuEntry[]; save: MenuEntry[]; close: MenuEntry[] } {
  return {
    open: [
      done('file.new', 'New…', 'Ctrl N'),
      done('file.open', 'Open…', 'Ctrl O'),
      done('file.openRecent', 'Open recent…'),
      done('file.openFolder', 'Browse folder as workspace…'),
      done('file.openFromProvider', 'Open from NAS / Google Drive…'),
    ],
    save: [
      done('file.save', 'Save', 'Ctrl S'),
      done('file.saveAs', 'Save as…', 'Ctrl Shift S'),
      done('file.saveCopy', 'Save a copy…', 'Ctrl Alt S'),
      done('file.revert', 'Revert', 'F12'),
      done('file.export', 'Convert & export…', 'Ctrl Shift E'),
    ],
    close: [
      done('file.info', 'File info…', 'Ctrl Alt Shift I'),
      done('file.close', 'Close', 'Ctrl W'),
    ],
  };
}

/** Help menu shared by every module. */
export function helpCommon(moduleName: string): MenuEntry[] {
  return [
    done('app.palette', 'Command palette', 'Ctrl K'),
    done('app.shortcuts', 'Keyboard shortcuts'),
    done('app.whatsNew', "What's new"),
    done('app.checkUpdates', 'Check for updates…'),
    planned(`help.${moduleName.toLowerCase()}`, `Tone ${moduleName} help`),
    done('app.about', 'About Tone'),
  ];
}
