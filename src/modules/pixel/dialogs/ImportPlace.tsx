import { useState } from 'react';
import type { ModuleApi } from '@/core/types';
import { Button, Dialog, DialogNav } from '@/ui';
import { bytesToCanvas, canvasToBytes, type Cnv } from '../engine/canvas';
import type { PixelDoc } from '../engine/doc';
import { getInternalClip, nextLayerName, placeCanvas, UserError } from '../engine/ops';
import { CanvasThumb, Check, Planned, useEnterKey } from '../editor/ui';

export const PLACE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'psd'];

interface Item { id: string; name: string; canvas: Cnv; detail: string; bytes?: Uint8Array }

/** Files placed during this app session (Recent source). */
const recent: Item[] = [];

type Source = 'device' | 'drive' | 'nas' | 'camera' | 'scanner' | 'clipboard' | 'recent';

/** Decode image or PSD bytes to a canvas (PSD → flattened composite). Content decides, not the extension. */
export async function decodeToCanvas(bytes: Uint8Array): Promise<Cnv> {
  const isPsd = bytes[0] === 0x38 && bytes[1] === 0x42 && bytes[2] === 0x50 && bytes[3] === 0x53;
  if (isPsd) {
    const { readPsd } = await import('ag-psd');
    const psd = readPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { skipLayerImageData: true, skipThumbnail: true });
    if (!psd.canvas) throw new Error('This PSD has no composite image');
    return psd.canvas as Cnv;
  }
  return bytesToCanvas(bytes, '');
}

/** Set once the system clipboard read has hung (a permission prompt nobody answers); later reads give up sooner. */
let clipboardSlow = false;

/** Read images from the system clipboard (falls back to Tone's internal clipboard). Never hangs. */
export async function readClipboardImages(): Promise<Cnv[]> {
  const out: Cnv[] = [];
  try {
    const read = navigator.clipboard?.read?.();
    if (read) {
      read.catch(() => { /* handled below via timeout / empty */ });
      const items = await Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), clipboardSlow ? 400 : 2500))]);
      if (items === null) clipboardSlow = true;
      for (const it of items ?? []) {
        const type = it.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await it.getType(type);
        out.push(await bytesToCanvas(new Uint8Array(await blob.arrayBuffer()), type));
      }
    }
  } catch { /* permission denied or unsupported */ }
  if (!out.length) { const c = getInternalClip(); if (c) out.push(c.canvas); }
  return out;
}

/** Images carried by a paste (or drop) event — needs no clipboard permission. */
export async function imagesFromDataTransfer(dt: DataTransfer | null): Promise<Cnv[]> {
  const out: Cnv[] = [];
  for (const it of Array.from(dt?.items ?? [])) {
    if (it.kind !== 'file' || !it.type.startsWith('image/')) continue;
    const f = it.getAsFile();
    if (!f) continue;
    try { out.push(await decodeToCanvas(new Uint8Array(await f.arrayBuffer()))); } catch { /* not decodable */ }
  }
  return out;
}

/** Edit › Paste / Paste in place / Paste into: system image first, else Tone's own clipboard (keeps its position). */
export function pasteCanvases(doc: PixelDoc, sys: Cnv[], mode: 'center' | 'inPlace' | 'into') {
  const internal = getInternalClip();
  const c = sys[0] ?? internal?.canvas;
  if (!c) throw new UserError('Nothing to paste — copy an image first');
  const fromUs = !!internal && (sys.length === 0 || (sys[0].width === internal.canvas.width && sys[0].height === internal.canvas.height));
  const pos = mode !== 'center' && fromUs ? { x: internal!.x, y: internal!.y } : {};
  if (mode === 'into' && !doc.selection) throw new UserError('Make a selection to paste into');
  placeCanvas(doc, c, nextLayerName(doc), { ...pos, into: mode === 'into' });
  doc.commit(mode === 'into' ? 'Paste into' : 'Paste');
}

/** Place canvases as new layers; the last one enters free transform. */
export function placeAll(doc: PixelDoc, items: { canvas: Cnv; name: string }[]) {
  if (!items.length) return;
  for (const it of items) placeCanvas(doc, it.canvas, it.name.replace(/\.[^.]+$/, '') || 'Placed', { fit: true });
  doc.commit(items.length > 1 ? `Place ${items.length} files` : 'Place');
  doc.editor?.startTransform({ placed: true });
}

export function ImportPlaceDialog({ doc, api, onClose, initial = 'device' }: { doc: PixelDoc; api: ModuleApi; onClose: () => void; initial?: Source }) {
  const [src, setSrc] = useState<Source>(initial);
  const [items, setItems] = useState<Item[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [asLayers, setAsLayers] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const add = (list: Item[]) => {
    setItems((cur) => [...cur, ...list]);
    setSel((cur) => new Set([...cur, ...list.map((i) => i.id)]));
  };
  const pickDevice = async () => {
    setBusy(true); setMsg(null);
    try {
      const files = await api.pickFile(PLACE_EXTS, true);
      const list: Item[] = [];
      for (const f of files) {
        try {
          const c = await decodeToCanvas(f.bytes);
          list.push({ id: Math.random().toString(36).slice(2), name: f.name, canvas: c, bytes: f.bytes, detail: `${f.name.split('.').pop()?.toUpperCase()} · ${c.width}×${c.height}` });
        } catch { setMsg(`Could not decode ${f.name}`); }
      }
      add(list);
    } finally { setBusy(false); }
  };
  const pickClipboard = async () => {
    setBusy(true); setMsg(null);
    const cs = await readClipboardImages();
    setBusy(false);
    if (!cs.length) { setMsg('No image on the clipboard'); return; }
    add(cs.map((c, i) => ({ id: Math.random().toString(36).slice(2), name: `Pasted ${i + 1}`, canvas: c, detail: `Clipboard · ${c.width}×${c.height}` })));
  };
  const chosen = items.filter((i) => sel.has(i.id));
  const place = async () => {
    if (!chosen.length) return;
    recent.unshift(...chosen.filter((c) => !recent.includes(c)));
    recent.splice(24);
    if (asLayers) { placeAll(doc, chosen); onClose(); return; }
    // open each in its own tab instead
    for (const c of chosen) await api.openBytesAsDoc(c.bytes ?? await canvasToBytes(c.canvas), c.bytes ? c.name : `${c.name}.png`);
    onClose();
  };
  useEnterKey(() => { void place(); }, chosen.length > 0);
  const shown = src === 'recent' ? recent : items;

  return (
    <Dialog title="Import & place" subtitle="Pixel" width={1000} height={680} onClose={onClose}>
      <div style={{ width: 220, borderRight: '1px solid var(--line)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '14px 16px 0' }} className="eyebrow">Source</div>
        <DialogNav<Source> width={219} value={src} onChange={(v) => { setSrc(v); setMsg(null); }} items={[
          { value: 'device', label: 'This device', hint: 'Ctrl O' },
          { value: 'drive', label: 'Google Drive' },
          { value: 'nas', label: 'NAS (SMB / WebDAV)' },
          { value: 'camera', label: 'Camera / phone', hint: 'USB' },
          { value: 'scanner', label: 'Scanner' },
          { value: 'clipboard', label: 'Clipboard', hint: 'Ctrl V' },
          { value: 'recent', label: 'Recent' },
        ]} />
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--line)', minHeight: 48 }}>
          {src === 'device' && <Button onClick={pickDevice} disabled={busy}>Choose files…</Button>}
          {src === 'clipboard' && <Button onClick={pickClipboard} disabled={busy}>Read clipboard</Button>}
          <span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>{busy ? 'Loading…' : msg ?? (shown.length ? `${shown.length} item${shown.length > 1 ? 's' : ''}` : '')}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 14 }}>
          {(src === 'drive' || src === 'nas') && (
            <div style={{ font: 'var(--type-small)', color: 'var(--mute)', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>Files on Google Drive and your NAS are opened through Tone's storage browser. Use <b style={{ color: 'var(--ink)' }}>File › Open from NAS / Google Drive</b>, then copy and paste into this canvas, or place them from a synced local folder via “This device”.</div>
              <div><Button onClick={() => { onClose(); api.runCommand('file.openFromProvider'); }}>Open from NAS / Google Drive…</Button></div>
            </div>
          )}
          {(src === 'camera' || src === 'scanner') && (
            <div style={{ font: 'var(--type-small)', color: 'var(--mute)', display: 'flex', gap: 8, alignItems: 'center' }}>
              {src === 'camera' ? 'Importing from a camera or phone (MTP)' : 'Scanning (TWAIN/WIA)'} is on the roadmap <Planned />
            </div>
          )}
          {(src === 'device' || src === 'clipboard' || src === 'recent') && (
            shown.length === 0
              ? <div style={{ font: 'var(--type-small)', color: 'var(--mute)' }}>{src === 'recent' ? 'Nothing placed yet in this session.' : src === 'device' ? 'Choose one or more images to place.' : 'Copy an image in any app, then read the clipboard.'}</div>
              : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
                {shown.map((it) => {
                  const on = sel.has(it.id);
                  return (
                    <div key={it.id} onClick={() => { if (src === 'recent' && !items.includes(it)) setItems((c) => [...c, it]); const n = new Set(sel); if (on) n.delete(it.id); else n.add(it.id); setSel(n); }}
                      className={on ? '' : 'hov-border'} style={{ border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`, cursor: 'pointer', background: 'var(--bg0)' }}>
                      <CanvasThumb source={it.canvas} width={138} height={84} style={{ border: 0, width: '100%' }} />
                      <div style={{ padding: '6px 8px' }}>
                        <div style={{ font: 'var(--type-small)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
                        <div style={{ font: 'var(--type-mono)', fontSize: 10, color: 'var(--mute)' }}>{it.detail}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
          )}
        </div>
        <div style={{ borderTop: '1px solid var(--line)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <Check on={false} disabled label={<span>Place as embedded smart object <Planned /></span>} />
            <Check on={false} disabled label={<span>Place as linked <Planned /></span>} />
            <Check on={asLayers} onChange={setAsLayers} label="Open each file as a layer" />
            <Check on={false} disabled label={<span>Open RAW in Camera editor first <Planned /></span>} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ font: 'var(--type-mono)', color: 'var(--mute)', flex: 1 }}>Opens: PNG · JPEG · WebP · GIF · BMP · PSD (flattened)</span>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={!chosen.length} onClick={place}>{asLayers ? `Place ${chosen.length || ''} file${chosen.length === 1 ? '' : 's'}` : `Open ${chosen.length || ''} in new tabs`}</Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
