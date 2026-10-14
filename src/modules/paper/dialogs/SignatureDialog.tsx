// Signature pad: draw, type or upload → trimmed PNG data URL.
import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, DialogNav, Eyebrow, FormRow, Input, Segmented, Select } from '@/ui';
import type { ModuleApi } from '@/core/types';

type Mode = 'Draw' | 'Type' | 'Image';
const INKS = { Black: '#111111', Blue: '#1f3f9f' } as const;
// Handwriting-like faces that commonly exist on Windows / macOS / Android; the browser falls back to cursive.
const FONTS = ['Segoe Script', 'Brush Script MT', 'Snell Roundhand', 'Lucida Handwriting', 'cursive'] as const;
const W = 480, H = 180;

export function SignatureDialog({ onUse, onClose, pickFile }: { onUse: (sig: { url: string; aspect: number }) => void; onClose: () => void; pickFile: ModuleApi['pickFile'] }) {
  const [mode, setMode] = useState<Mode>('Draw');
  const [ink, setInk] = useState<keyof typeof INKS>('Black');
  const [name, setName] = useState('');
  const [font, setFont] = useState<string>(FONTS[0]);
  const [empty, setEmpty] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const clear = () => {
    const c = canvas.current;
    if (!c) return;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
  };
  useEffect(() => { clear(); }, [mode]);

  // Type mode: draw the name into the canvas.
  useEffect(() => {
    if (mode !== 'Type') return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!name.trim()) { setEmpty(true); return; }
    let size = 64 * dpr;
    ctx.font = `${size}px "${font}", cursive`;
    while (ctx.measureText(name).width > c.width - 40 * dpr && size > 12) { size -= 4; ctx.font = `${size}px "${font}", cursive`; }
    ctx.fillStyle = INKS[ink];
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 20 * dpr, c.height / 2);
    setEmpty(false);
  }, [mode, name, font, ink, dpr]);

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'Draw') return;
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const r = c.getBoundingClientRect();
    const pt = (ev: { clientX: number; clientY: number }) => [(ev.clientX - r.left) * (c.width / r.width), (ev.clientY - r.top) * (c.height / r.height)] as const;
    ctx.strokeStyle = INKS[ink]; ctx.lineWidth = 2.6 * dpr; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    let [lx, ly] = pt(e);
    ctx.beginPath(); ctx.arc(lx, ly, 1.3 * dpr, 0, Math.PI * 2); ctx.fillStyle = INKS[ink]; ctx.fill();
    setEmpty(false);
    c.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      const [x, y] = pt(ev);
      ctx.beginPath(); ctx.moveTo(lx, ly); ctx.quadraticCurveTo(lx, ly, (lx + x) / 2, (ly + y) / 2); ctx.lineTo(x, y); ctx.stroke();
      lx = x; ly = y;
    };
    const up = () => { c.removeEventListener('pointermove', mv); c.removeEventListener('pointerup', up); };
    c.addEventListener('pointermove', mv);
    c.addEventListener('pointerup', up);
  };

  const upload = async () => {
    const [f] = await pickFile(['png', 'jpg', 'jpeg'], false);
    if (!f) return;
    const mime = /\.png$/i.test(f.name) ? 'image/png' : 'image/jpeg';
    const url = URL.createObjectURL(new Blob([f.bytes as BlobPart], { type: mime }));
    const img = new Image();
    img.onload = () => {
      const c = canvas.current!;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / img.width, c.height / img.height);
      ctx.drawImage(img, (c.width - img.width * s) / 2, (c.height - img.height * s) / 2, img.width * s, img.height * s);
      URL.revokeObjectURL(url);
      setEmpty(false);
    };
    img.src = url;
  };

  const use = () => {
    const out = trim(canvas.current!);
    if (out) onUse(out);
  };

  return (
    <Dialog title="Signature" subtitle="Draw, type or upload" width={780} height={420} onClose={onClose}
      footer={<><span style={{ color: 'var(--mute)', font: 'var(--type-small)' }}>Visual signature (image). Certificate-based digital signatures are planned.</span><span style={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={empty} onClick={use}>Use signature</Button></>}>
      <DialogNav<Mode> value={mode} onChange={setMode} items={['Draw', 'Type', 'Image']} />
      <div style={{ flex: 1, padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Eyebrow>Ink</Eyebrow><Segmented value={ink} options={Object.keys(INKS) as (keyof typeof INKS)[]} onChange={setInk} />
          <span style={{ flex: 1 }} />
          {mode === 'Draw' && <Button size="sm" onClick={clear}>Clear</Button>}
          {mode === 'Image' && <Button size="sm" onClick={() => void upload()}>Choose image…</Button>}
        </div>
        {mode === 'Type' && (
          <>
            <FormRow label="Name"><Input value={name} onChange={setName} autoFocus placeholder="Your name" style={{ width: 260 }} /></FormRow>
            <FormRow label="Style"><Select value={font} options={FONTS} onChange={setFont} width={200} /></FormRow>
          </>
        )}
        <div style={{ background: 'var(--paper)', border: '1px solid var(--line)', position: 'relative', width: '100%', maxWidth: W, aspectRatio: `${W} / ${H}` }}>
          <canvas ref={canvas} width={W * dpr} height={H * dpr} onPointerDown={down}
            style={{ width: '100%', height: '100%', display: 'block', cursor: mode === 'Draw' ? 'crosshair' : 'default', touchAction: 'none' }} />
          <div style={{ position: 'absolute', left: 20, right: 20, bottom: 34, borderTop: '1px solid var(--paper-line)', pointerEvents: 'none' }} />
          {empty && <div style={{ position: 'absolute', left: 20, bottom: 14, font: 'var(--type-mono)', fontSize: 10, color: 'var(--paper-mute)', pointerEvents: 'none' }}>{mode === 'Draw' ? 'Sign above the line' : mode === 'Type' ? 'Type your name' : 'Choose a PNG or JPEG'}</div>}
        </div>
      </div>
    </Dialog>
  );
}

/** Crop transparent margins; returns PNG data URL + aspect. */
function trim(c: HTMLCanvasElement): { url: string; aspect: number } | null {
  const ctx = c.getContext('2d')!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return { url: out.toDataURL('image/png'), aspect: out.width / out.height };
}
