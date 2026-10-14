import { useCallback, useEffect, useState } from 'react';
import { markDirty, switchFolderFile } from '@/core/documents';
import { models, useApp } from '@/core/store';
import type { Doc, ModuleDef } from '@/core/types';
import { loadModule } from '@/modules/meta';
import { Banner, Button } from '@/ui';
import { MenuRow } from './MenuRow';
import { relTime } from './format';

export function DocView({ doc, active, compact }: { doc: Doc; active: boolean; compact: boolean }) {
  const [mod, setMod] = useState<ModuleDef | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    loadModule(doc.mode).then((m) => live && setMod(m)).catch((e) => live && setErr(String(e?.message ?? e)));
    return () => { live = false; };
  }, [doc.mode]);
  const onChange = useCallback(() => markDirty(doc.id), [doc.id]);
  const model = models.get(doc.id);

  return (
    <div style={{ flex: 1, minHeight: 0, display: active ? 'flex' : 'none', flexDirection: 'column' }}>
      {mod && <MenuRow menus={mod.menus} right={<DocMeta doc={doc} />} />}
      {doc.convertedFrom && (
        <Banner actions={<Button size="sm" onClick={() => useApp.getState().setActive(doc.convertedFrom!.docId)}>Open original</Button>}>
          Converted from <b>{doc.convertedFrom.title}</b> — the original is untouched.
        </Banner>
      )}
      {err && <div style={{ padding: 24, color: 'var(--negative)' }}>Failed to load module: {err}</div>}
      {mod && model !== undefined && (
        // Keyed on the model object: replacing it (revert, folder switch, sync update) remounts the editor.
        <mod.Editor key={doc.id + ':' + modelKey(model)} doc={doc} model={model} onChange={onChange} compact={compact} />
      )}
    </div>
  );
}

const ids = new WeakMap<object, number>();
let seq = 1;
function modelKey(m: unknown): number {
  if (!m || typeof m !== 'object') return 0;
  let k = ids.get(m);
  if (!k) { k = seq++; ids.set(m, k); }
  return k;
}

function DocMeta({ doc }: { doc: Doc }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const ws = doc.folderWorkspace;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, font: 'var(--type-mono)', color: 'var(--mute)', paddingRight: 4 }}>
      {ws && <FolderSwitcher doc={doc} />}
      {!ws && <span>{doc.dirty ? (doc.location ? 'Unsaved changes' : 'Not saved yet') : doc.savedAt ? `Saved · ${relTime(doc.savedAt)}` : doc.title}</span>}
    </div>
  );
}

function FolderSwitcher({ doc }: { doc: Doc }) {
  const ws = doc.folderWorkspace!;
  const [open, setOpen] = useState(false);
  const folderName = ws.folder.split(/[\\/]/).pop();
  return (
    <div style={{ position: 'relative' }}>
      <div onClick={() => setOpen(!open)} className="hov-border"
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px', border: '1px solid var(--line)', cursor: 'pointer' }}>
        <span className="eyebrow">Folder</span>
        <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontWeight: 700 }}>{folderName}</span>
        <span>/</span>
        <span style={{ color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontWeight: 600 }}>{ws.files[ws.index]}</span>
        <span>{ws.index + 1} of {ws.files.length}</span>
        <span>▾</span>
      </div>
      {open && (
        <div onMouseLeave={() => setOpen(false)}
          style={{ position: 'absolute', right: 0, top: '100%', width: 340, maxHeight: 420, overflowY: 'auto', background: 'var(--bg1)', border: '1px solid var(--line)', boxShadow: 'var(--shadow-float)', zIndex: 60 }}>
          {ws.files.map((f, i) => (
            <div key={f} className="hov-row" onClick={() => { setOpen(false); void switchFolderFile(doc.id, i); }}
              style={{ padding: '6px 14px', cursor: 'pointer', font: 'var(--type-small)', fontWeight: i === ws.index ? 700 : 500, background: i === ws.index ? 'var(--sel)' : 'transparent', color: 'var(--ink)' }}>
              {f}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 6, padding: 10, borderTop: '1px solid var(--line)' }}>
            <Button size="sm" onClick={() => { setOpen(false); void openAllAsTabs(doc); }}>Open all as tabs</Button>
            <span style={{ flex: 1 }} />
            <span style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)', alignSelf: 'center' }}>Ctrl ↑/↓ switches</span>
          </div>
        </div>
      )}
    </div>
  );
}

async function openAllAsTabs(doc: Doc) {
  const { openPath } = await import('@/core/documents');
  const { joinPath } = await import('@/core/platform');
  const ws = doc.folderWorkspace!;
  for (let i = 0; i < ws.files.length; i++) if (i !== ws.index) await openPath(await joinPath(ws.folder, ws.files[i]));
}
