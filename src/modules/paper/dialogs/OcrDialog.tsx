// OCR dialog. The recognition engine (Tesseract sidecar) is not installed yet, so this shows the
// page and the text already embedded in it — never invented "recognized" text.
import { useEffect, useState } from 'react';
import { Badge, Button, Dialog, Eyebrow, Select } from '@/ui';
import type { PaperActions } from '../actions';
import type { PaperModel } from '../model';
import { geom, geomSync, pageText, shownRotation, type Geom } from '../render';
import { itemsToParagraphs } from '../text';
import { Thumb } from '../Thumb';
import { makeViewport } from '../viewport';

// Languages the planned Tesseract bundle will ship with (feature list, not data).
const LANGS = ['English', 'Deutsch', 'Français', 'Español', 'Italiano', 'Nederlands', 'Português', 'Polski'] as const;

export function OcrDialog({ model, actions, onClose }: { model: PaperModel; actions: PaperActions; onClose: () => void }) {
  const [lang, setLang] = useState<string>(LANGS[0]);
  const [pageIdx, setPageIdx] = useState(model.ui.page);
  const ref = model.pages[pageIdx];
  const [text, setText] = useState<string | null>(null);
  const [g, setG] = useState<Geom | null>(() => (ref ? geomSync(model, ref) : null));

  useEffect(() => {
    if (!ref) return;
    setText(null);
    void geom(model, ref).then(setG).catch(() => {});
    void pageText(model, ref).then((t) => setText(t ? itemsToParagraphs(t.items).map((p) => p.text).join('\n\n') : '')).catch(() => setText(''));
  }, [model, ref]);

  const geo = g ?? { view: [0, 0, 612, 792] as [number, number, number, number], rotate: 0 };
  const unit = ref ? makeViewport(geo.view, shownRotation(geo, ref), 1) : null;
  const W = unit ? Math.round(Math.min(420, 540 * (unit.width / unit.height))) : 420;

  const copy = async () => {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); actions.api.toast('Copied page text'); } catch { actions.api.toast('Clipboard is not available', 'error'); }
  };

  return (
    <Dialog title="Recognize text (OCR)" subtitle={model.fileName} width={960} height={660} onClose={onClose}>
      <div style={{ flex: 1, background: 'var(--canvas)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 16, gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-mono)', color: 'var(--mute)' }}>
          <Button size="sm" variant="ghost" disabled={pageIdx <= 0} onClick={() => setPageIdx(pageIdx - 1)}>‹</Button>
          <span>Page {pageIdx + 1} of {model.pages.length}</span>
          <Button size="sm" variant="ghost" disabled={pageIdx >= model.pages.length - 1} onClick={() => setPageIdx(pageIdx + 1)}>›</Button>
        </div>
        {ref && (
          <div style={{ position: 'relative', width: W, boxShadow: 'var(--shadow-page)', flexShrink: 0 }}>
            <Thumb model={model} pageRef={ref} width={W} root={null} style={{ border: 0 }} />
            <div style={{ position: 'absolute', left: 24, bottom: 20, font: '500 9px var(--font-mono)', color: 'var(--accent)' }}>OCR engine not installed yet</div>
          </div>
        )}
      </div>
      <div style={{ width: 360, borderLeft: '1px solid var(--line)', display: 'flex', flexDirection: 'column', font: 'var(--type-small)', overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <Eyebrow>Language</Eyebrow>
          <Select value={lang} options={LANGS} onChange={setLang} width={120} />
          <span style={{ flex: 1 }} />
          <Badge tone="accent">Planned</Badge>
        </div>
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--line)', background: 'var(--sel)', boxShadow: 'inset 2px 0 0 var(--accent)', lineHeight: 1.5 }}>
          OCR engine not installed yet. Tone Paper will recognize scanned pages with a bundled Tesseract engine in a later release.
        </div>
        <div style={{ padding: '12px 14px 4px' }}><Eyebrow>Text already in this page</Eyebrow></div>
        <div style={{ flex: 1, overflow: 'auto', padding: '4px 14px 14px', lineHeight: 1.7, whiteSpace: 'pre-wrap', userSelect: 'text' }}>
          {text === null ? <span style={{ color: 'var(--mute)' }}>Reading…</span>
            : text ? text
            : <span style={{ color: 'var(--mute)' }}>{ref?.src ? 'No embedded text on this page — it is probably a scan and will need OCR.' : 'This is a blank page.'}</span>}
        </div>
        <div style={{ padding: 14, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <Button disabled={!text} onClick={() => void copy()} style={{ justifyContent: 'center' }}>Copy text</Button>
          <Button onClick={() => { onClose(); void actions.toWrite(); }} style={{ justifyContent: 'center' }}>Send to Write</Button>
          <Button variant="primary" disabled title="Planned: needs the OCR engine" style={{ justifyContent: 'center', gridColumn: 'span 2' }}>Make PDF searchable (all pages)</Button>
        </div>
      </div>
    </Dialog>
  );
}
