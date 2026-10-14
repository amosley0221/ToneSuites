import { useEffect, useState } from 'react';
import { alsoSaveToDrive, openConverted, saveBytesAs } from '@/core/documents';
import { stripExt } from '@/core/platform';
import { useSettings } from '@/core/settings';
import { models, useApp } from '@/core/store';
import type { Doc, ExportFormat, ModuleDef } from '@/core/types';
import { loadModule, MODULE_META } from '@/modules/meta';
import { Button, Checkbox, Dialog, Eyebrow, Select } from '@/ui';

export function ConvertDialog({ doc, close }: { doc: Doc; close: () => void }) {
  const [mod, setMod] = useState<ModuleDef | null>(null);
  const [sel, setSel] = useState(0);
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [openTab, setOpenTab] = useState(true);
  const [drive, setDrive] = useState(false);
  const [busy, setBusy] = useState(false);
  const hasDrive = useSettings((s) => s.s.providers.some((p) => p.kind === 'gdrive' && p.enabled));
  useEffect(() => { void loadModule(doc.mode).then(setMod); }, [doc.mode]);
  const fmt: ExportFormat | undefined = mod?.exports[sel];
  useEffect(() => { if (fmt) setOpts(Object.fromEntries((fmt.options ?? []).map((o) => [o.id, o.default]))); }, [fmt?.id]);

  const base = stripExt(doc.title);
  const outName = fmt ? `${base}.${fmt.ext}` : '';
  const target = fmt?.opensIn ? MODULE_META[fmt.opensIn].name : null;

  const run = async () => {
    if (!fmt) return;
    setBusy(true);
    try {
      const res = await fmt.run(models.get(doc.id), opts, base);
      const { bytes, filename } = res;
      if (drive) await alsoSaveToDrive(bytes, filename);
      const openIn = res.kind === 'doc' ? res.mode : fmt.opensIn;
      if (openIn && openTab) await openConverted(bytes, filename, doc.id, openIn);
      else await saveBytesAs(bytes, filename, [fmt.ext]);
      close();
    } catch (e: any) {
      useApp.getState().toast(`Convert failed: ${e?.message ?? e}`, 'error');
    }
    setBusy(false);
  };

  return (
    <Dialog title="Convert & export" subtitle={doc.title} width={880} height={560} onClose={close}
      footer={<>
        <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{fmt ? `→ ${outName}${target && openTab ? ` · opens in Tone ${target}` : ''}` : ''}</span>
        <span style={{ flex: 1 }} />
        <Button onClick={close}>Cancel</Button>
        <Button variant="primary" disabled={!fmt || busy} onClick={() => void run()}>
          {busy ? 'Working…' : target && openTab ? `Convert & open in ${target}` : `Export ${fmt?.name ?? ''}`}
        </Button>
      </>}>
      <div style={{ width: 340, borderRight: '1px solid var(--line)', padding: 14, overflowY: 'auto', flexShrink: 0 }}>
        <Eyebrow style={{ marginBottom: 10 }}>Convert {doc.title} to</Eyebrow>
        {!mod && <div className="empty-hint">Loading…</div>}
        {mod?.exports.map((f, i) => (
          <div key={f.id} onClick={() => setSel(i)} className={i === sel ? '' : 'hov-border'}
            style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px', marginBottom: 6, cursor: 'pointer', border: `1px solid ${i === sel ? 'var(--accent)' : 'var(--line)'}`, background: i === sel ? 'var(--sel)' : 'transparent' }}>
            <span style={{ font: 'var(--type-mono)', border: '1px solid var(--line)', padding: '6px 0', width: 52, textAlign: 'center', flexShrink: 0 }}>.{f.ext}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800 }}>{f.name}</div>
              <div style={{ font: 'var(--type-small)', color: 'var(--mute)' }}>{f.description}</div>
            </div>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 22, padding: 18, overflowY: 'auto' }}>
        <div style={{ width: 180, height: 232, background: 'var(--paper)', boxShadow: 'var(--shadow-page)', padding: 16, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ height: 10, width: '70%', background: 'var(--paper-ink)' }} />
          {[90, 80, 86, 60].map((w, i) => <div key={i} style={{ height: 4, width: w + '%', background: 'var(--paper-line)' }} />)}
          <div style={{ flex: 1 }} />
          <div style={{ font: '400 9px var(--font-mono)', color: 'var(--paper-mute)' }}>preview · {outName}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Eyebrow style={{ marginBottom: 10 }}>Options</Eyebrow>
          {(fmt?.options ?? []).map((o) => (
            <div key={o.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', border: '1px solid var(--line)', marginBottom: 6 }}>
              <span style={{ fontWeight: 700 }}>{o.label}</span>
              <Select value={opts[o.id] ?? o.default} options={o.choices} onChange={(v) => setOpts({ ...opts, [o.id]: v })} width={180} mono />
            </div>
          ))}
          {fmt && !(fmt.options ?? []).length && <div className="empty-hint">No options for this format.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
            <Checkbox checked onChange={() => {}} label={<>Keep original <span className="mono" style={{ color: 'var(--mute)' }}>{doc.title}</span></>} />
            {fmt?.opensIn && <Checkbox checked={openTab} onChange={setOpenTab} label="Open result in a new tab" />}
            <Checkbox checked={drive} onChange={(v) => setDrive(v && hasDrive)} label={hasDrive ? 'Also save a copy to Google Drive' : 'Also save a copy to Google Drive (connect Drive in Settings first)'} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}
