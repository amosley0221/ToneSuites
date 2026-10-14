// Lazy page thumbnail (rendered once per page/rotation/size, cached as an object URL).
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { geom, geomSync, renderPage, shownRotation, type Geom } from './render';
import type { PageRef, PaperModel } from './model';
import { makeViewport } from './viewport';

const cache = new WeakMap<Uint8Array, Map<string, string>>();
const LETTER_GEOM: Geom = { view: [0, 0, 612, 792], rotate: 0 };

export function Thumb({ model, pageRef, width, root, style }: { model: PaperModel; pageRef: PageRef; width: number; root: Element | null; style?: CSSProperties }) {
  const [g, setG] = useState<Geom | null>(() => geomSync(model, pageRef));
  const src = model.source(pageRef.src);
  const key = `${pageRef.index}:${pageRef.rot}:${width}`;
  const [url, setUrl] = useState<string | null>(() => (src ? cache.get(src.bytes)?.get(key) ?? null : null));
  const ref = useRef<HTMLDivElement>(null);
  const geo = g ?? LETTER_GEOM;
  const vp = makeViewport(geo.view, shownRotation(geo, pageRef), 1);
  const height = Math.round(width * (vp.height / vp.width));

  useEffect(() => { setUrl(src ? cache.get(src.bytes)?.get(key) ?? null : null); }, [src, key]);

  useEffect(() => {
    if (!src || url) return;
    const el = ref.current;
    if (!el) return;
    let job: ReturnType<typeof renderPage> | null = null;
    let live = true;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || job) return;
      const gg = g ?? await geom(model, pageRef).catch(() => null);
      if (!gg || !live) return;
      if (!g) setG(gg);
      const scale = width / makeViewport(gg.view, shownRotation(gg, pageRef), 1).width;
      const c = document.createElement('canvas');
      job = renderPage(c, model, pageRef, scale);
      job.promise.then(() => new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))).then((b) => {
        if (!b || !live) return;
        const u = URL.createObjectURL(b);
        let m = cache.get(src.bytes);
        if (!m) { m = new Map(); cache.set(src.bytes, m); }
        m.set(key, u);
        setUrl(u);
      }).catch(() => {});
    }, { root, rootMargin: '400px 0px' });
    io.observe(el);
    return () => { live = false; io.disconnect(); job?.cancel(); };
  }, [src, url, key, g, model, pageRef, width, root]);

  return (
    <div ref={ref} className="pp-thumb-img" style={{ width: '100%', aspectRatio: `${width} / ${height}`, position: 'relative', overflow: 'hidden', ...style }}>
      {url && <img src={url} alt="" draggable={false} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />}
    </div>
  );
}
