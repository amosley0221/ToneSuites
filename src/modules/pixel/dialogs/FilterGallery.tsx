import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, Slider } from '@/ui';
import { ctx2d, getImg, imgToCanvas, newCanvas } from '../engine/canvas';
import type { PixelDoc } from '../engine/doc';
import { defaultParams, FILTERS, filterById, type FilterDef } from '../engine/filters';
import { hexToRgb } from '../engine/img';
import { applyPixels, clearPreview, previewPixels, requirePixelLayer } from '../engine/ops';
import { Check, Planned } from '../editor/ui';

export function runFilter(doc: PixelDoc, f: FilterDef, params: Record<string, number>, seed: number) {
  const ctx = { seed, fg: hexToRgb(doc.ui.fg), bg: hexToRgb(doc.ui.bg) };
  applyPixels(doc, f.name, (img) => f.run(img, params, ctx), margin(f, params));
  doc.lastFilter = { id: f.id, params };
}

/** How far outside the selection a filter reads pixels. */
function margin(_f: FilterDef, p: Record<string, number>) {
  return Math.ceil(Math.max(8, (p.radius ?? 0) * 3, p.distance ?? 0, p.cell ?? 0, p.shift ?? 0, (p.height ?? 0) * 2));
}

const TILE_W = 200, TILE_H = 84;

export function FilterGalleryDialog({ doc, initial, onClose, galleryOnly = true }: { doc: PixelDoc; initial?: string; onClose: () => void; galleryOnly?: boolean }) {
  const list = useMemo(() => {
    const g = FILTERS.filter((f) => f.gallery);
    const init = initial ? filterById(initial) : undefined;
    return init && !init.gallery ? [init, ...g] : g;
  }, [initial]);
  const [id, setId] = useState(initial && filterById(initial) ? initial : list.find((f) => !f.planned)!.id);
  const f = filterById(id)!;
  const [params, setParams] = useState<Record<string, number>>(() => (doc.lastFilter?.id === id ? { ...doc.lastFilter.params } : defaultParams(f)));
  const [preview, setPreview] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seed = useRef(Math.floor(Math.random() * 1e9)).current;
  const layer = doc.active;

  // sample used for tile thumbnails: center crop of the active layer
  const sample = useMemo(() => {
    const l = doc.active;
    const c = newCanvas(TILE_W, TILE_H);
    if (!l?.canvas) return getImg(c);
    const src = doc.layerDocCanvas(l);
    const k = Math.max(TILE_W / src.width, TILE_H / src.height);
    const x = ctx2d(c);
    x.imageSmoothingQuality = 'high';
    const sw = TILE_W / k, sh = TILE_H / k;
    x.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, TILE_W, TILE_H);
    return getImg(c);
  }, [doc]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let cancelled = false;
    const todo = list.filter((x) => !x.planned);
    const ctx = { seed, fg: hexToRgb(doc.ui.fg), bg: hexToRgb(doc.ui.bg) };
    const step = (i: number) => {
      if (cancelled || i >= todo.length) return;
      const fx = todo[i];
      try {
        const out = fx.run(sample, defaultParams(fx), ctx);
        const url = imgToCanvas(out).toDataURL();
        setThumbs((t) => ({ ...t, [fx.id]: url }));
      } catch { /* thumbnail is best-effort */ }
      setTimeout(() => step(i + 1), 0);
    };
    step(0);
    return () => { cancelled = true; };
  }, [list, sample, seed, doc]);

  useEffect(() => {
    try { requirePixelLayer(doc); setError(null); } catch (e) { setError((e as Error).message); return; }
    if (!preview || f.planned) { clearPreview(doc); return; }
    setBusy(true);
    const t = setTimeout(() => {
      try {
        const ctx = { seed, fg: hexToRgb(doc.ui.fg), bg: hexToRgb(doc.ui.bg) };
        previewPixels(doc, (img) => f.run(img, params, ctx), margin(f, params));
      } catch (e) { setError((e as Error).message); }
      setBusy(false);
    }, 180);
    return () => clearTimeout(t);
  }, [doc, f, params, preview, seed]);

  const close = () => { clearPreview(doc); onClose(); };
  const apply = () => {
    try { runFilter(doc, f, params, seed); onClose(); } catch (e) { setError((e as Error).message); }
  };
  const pick = (x: FilterDef) => {
    if (x.planned) return;
    setId(x.id);
    setParams(doc.lastFilter?.id === x.id ? { ...doc.lastFilter.params } : defaultParams(x));
  };

  return (
    <Dialog title={galleryOnly ? 'Filter gallery' : f.name} subtitle={`Layer: ${layer?.name ?? '—'}`} width={1000} height={640} onClose={close}>
      <div style={{ flex: 1, padding: 16, overflow: 'auto', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, alignContent: 'start' }}>
        {list.map((x) => (
          <div key={x.id} onClick={() => pick(x)} className={x.id === id || x.planned ? '' : 'hov-border'} title={x.planned ? `${x.name} is on the roadmap` : x.name}
            style={{ border: `1px solid ${x.id === id ? 'var(--accent)' : 'var(--line)'}`, cursor: x.planned ? 'default' : 'pointer', background: 'var(--bg0)', opacity: x.planned ? 0.5 : 1 }}>
            <div style={{
              height: TILE_H, backgroundColor: 'var(--check2)', backgroundSize: thumbs[x.id] ? 'cover' : '16px 16px', backgroundPosition: 'center',
              backgroundImage: thumbs[x.id] ? `url(${thumbs[x.id]})` : 'linear-gradient(45deg,var(--check) 25%,transparent 25%,transparent 75%,var(--check) 75%),linear-gradient(45deg,var(--check) 25%,transparent 25%,transparent 75%,var(--check) 75%)',
            }} />
            <div style={{ padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 6, font: 'var(--type-small)' }}>
              <span style={{ fontWeight: 600 }}>{x.name}</span>
              {x.planned ? <Planned /> : <span style={{ color: 'var(--mute)', font: 'var(--type-mono)', fontSize: 10 }}>{x.cat}</span>}
            </div>
          </div>
        ))}
      </div>
      <div style={{ width: 280, borderLeft: '1px solid var(--line)', padding: 16, display: 'flex', flexDirection: 'column', gap: 16, font: 'var(--type-small)', flexShrink: 0 }}>
        <div style={{ font: 'var(--type-subtitle)', letterSpacing: '-0.02em' }}>{f.name}</div>
        {f.params.length === 0 && <div style={{ color: 'var(--mute)' }}>This filter has no settings.</div>}
        {f.params.map((p) => p.toggle
          ? <Check key={p.id} on={!!params[p.id]} onChange={(v) => setParams({ ...params, [p.id]: v ? 1 : 0 })} label={p.label} />
          : <Slider key={p.id} label={p.label} min={p.min} max={p.max} step={p.step} value={params[p.id] ?? p.default}
            display={`${params[p.id] ?? p.default}${p.unit ? (p.unit === '%' || p.unit === '°' ? p.unit : ' ' + p.unit) : ''}`}
            onChange={(v) => setParams({ ...params, [p.id]: v })} />)}
        <Check on={preview} onChange={setPreview} label="Preview on canvas" />
        <Check on={false} disabled label={<span>Apply as smart filter (editable) <Planned /></span>} />
        {error && <div style={{ color: 'var(--negative)' }}>{error}</div>}
        <div style={{ flex: 1 }} />
        <div style={{ color: 'var(--mute)', font: 'var(--type-mono)', minHeight: 16 }}>{busy ? 'Rendering preview…' : ''}</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={close} style={{ flex: 1, justifyContent: 'center' }}>Cancel</Button>
          <Button variant="primary" onClick={apply} disabled={!!error || f.planned} style={{ flex: 1, justifyContent: 'center' }}>Apply</Button>
        </div>
      </div>
    </Dialog>
  );
}
