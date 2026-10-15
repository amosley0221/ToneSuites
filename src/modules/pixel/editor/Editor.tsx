// Pixel editor root: options bar, tool rail, canvas viewport, inspector.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { EditorProps } from '@/core/types';
import { useApp } from '@/core/store';
import type { PixelDoc } from '../engine/doc';
import { formatBytes, rgbaBytes } from '../engine/geometry';
import { TOOL_GROUPS, defaultVariant, groupOf } from '../engine/tooldefs';
import { OptionsBar, ToolRail, selectTool } from './Chrome';
import { ToolController } from './controller';
import { Inspector } from './Inspector';
import { Viewport, type ViewApi } from './Viewport';
import { DropMenu } from './ui';
import { imagesFromDataTransfer, pasteCanvases } from '../dialogs/ImportPlace';
import { UserError } from '../engine/ops';

export function Editor({ model: doc, onChange, compact, api }: EditorProps<PixelDoc>) {
  useSyncExternalStore(doc.subscribe, doc.getVersion);
  const [panelsOpen, setPanelsOpen] = useState(false);
  const [textEdit, setTextEdit] = useState<{ id: string; isNew: boolean } | null>(null);
  const textRef = useRef<{ id: string; isNew: boolean } | null>(null);
  const viewApi = useRef<ViewApi | null>(null);
  const cursorRef = useRef<(c: string) => void>(() => {});
  const spaceHeld = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const ctl = useMemo(() => new ToolController(doc, {
    toast: (m, t) => api.toast(m, t),
    redrawOverlay: () => viewApi.current?.redrawOverlay(),
    zoomAt: (f, sx, sy) => viewApi.current?.zoomAt(f, sx, sy),
    panBy: (dx, dy) => viewApi.current?.panBy(dx, dy),
    editText: (id, isNew) => { textRef.current = { id, isNew }; setTextEdit({ id, isNew }); },
    zoom: () => doc.ui.zoom,
    setCursor: (c) => cursorRef.current(c),
  }), [doc, api]);

  const finishText = () => {
    const te = textRef.current;
    if (!te) return;
    textRef.current = null;
    setTextEdit(null);
    const l = doc.layer(te.id);
    if (!l) return;
    if (!l.text?.text.trim()) {
      doc.removeLayer(l.id);
      if (te.isNew) doc.touch(); else doc.commit('Delete type');
      return;
    }
    doc.commit(te.isNew ? 'Type' : 'Edit type');
  };

  useEffect(() => {
    doc.onCommit = onChange;
    doc.editor = {
      startTransform: () => ctl.startTransform(),
      commitTransient: () => { finishText(); ctl.commitAll(); },
      applyTransform: (fn) => {
        if (!ctl.startTransform()) return;
        const t = ctl.transform!;
        fn(t.p, t.w, t.h);
        ctl.commitTransform();
      },
    };
    return () => { if (doc.onCommit === onChange) doc.onCommit = null; doc.editor = null; doc.view = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, ctl, onChange]);

  // Tool switches commit pending sessions; status bar follows tool / layer / zoom changes.
  const last = useRef({ tool: doc.ui.tool, active: doc.activeId, zoom: doc.ui.zoom });
  useEffect(() => doc.subscribe(() => {
    const l = last.current;
    if (l.tool !== doc.ui.tool) {
      if (ctl.transform) ctl.commitTransform();
      if (ctl.crop && doc.ui.tool !== 'crop') { ctl.crop = null; }
      ctl.overlay = {};
      finishText();
      cursorRef.current('default');
    }
    if (l.tool !== doc.ui.tool || l.active !== doc.activeId || l.zoom !== doc.ui.zoom) api.refreshChrome();
    last.current = { tool: doc.ui.tool, active: doc.activeId, zoom: doc.ui.zoom };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [doc, ctl, api]);

  // ---------- keyboard ----------
  useEffect(() => {
    const isTyping = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
    };
    const active = () => !!rootRef.current && rootRef.current.offsetParent !== null && useApp.getState().dialogs.length === 0;
    const down = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTyping(e.target) || !active()) return;
      const mod = e.ctrlKey || e.metaKey;
      const ui = doc.ui;
      const consume = () => { e.preventDefault(); e.stopPropagation(); };
      if (e.key === ' ' && !mod) { if (!spaceHeld.current) { spaceHeld.current = true; cursorRef.current('grab'); } consume(); return; }
      if (e.key === 'Escape') {
        if (ctl.transform || ctl.crop || ctl.overlay.lasso) { ctl.cancelAll(); consume(); }
        return;
      }
      if (e.key === 'Enter') {
        if (ctl.transform) { ctl.commitTransform(); consume(); }
        else if (ctl.crop) { ctl.commitCrop(true); viewApi.current?.fit(); consume(); }
        else if (ctl.overlay.lasso) { ctl.closePoly(); consume(); }
        return;
      }
      if (e.key === 'Backspace' && ctl.overlay.lasso) { ctl.popPolyPoint(); consume(); return; }
      if (e.key.startsWith('Arrow') && !mod && (ui.tool === 'move' || ctl.transform)) {
        const n = e.shiftKey ? 10 : 1;
        ctl.nudge(e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0);
        consume();
        return;
      }
      if (mod || e.altKey) return;
      const k = e.key.length === 1 ? e.key.toUpperCase() : '';
      if (k === 'X') { [ui.fg, ui.bg] = [ui.bg, ui.fg]; doc.emit(); consume(); return; }
      if (k === 'D') { ui.fg = '#000000'; ui.bg = '#FFFFFF'; doc.emit(); consume(); return; }
      if (e.key === '[' || e.key === ']') {
        const s = ui.brush.size;
        const step = s < 10 ? 1 : s < 50 ? 5 : s < 200 ? 10 : 50;
        ui.brush.size = Math.max(1, Math.min(2500, s + (e.key === ']' ? step : -step)));
        ctl.overlay.cursor && (ctl.overlay.cursor.r = ui.brush.size / 2);
        doc.emit(); viewApi.current?.redrawOverlay(); consume(); return;
      }
      if (/^[0-9]$/.test(e.key) && ['brush', 'pencil', 'eraser', 'clone', 'historyBrush'].includes(ui.tool)) {
        ui.brush.opacity = e.key === '0' ? 100 : Number(e.key) * 10; doc.emit(); consume(); return;
      }
      const g = TOOL_GROUPS.find((x) => x.key === k);
      if (g) {
        const cur = groupOf(ui.tool);
        if (e.shiftKey && cur === g) {
          const working = g.variants.filter((v) => v.working);
          const i = working.findIndex((v) => v.id === ui.tool);
          selectTool(doc, working[(i + 1) % working.length].id);
        } else if (cur !== g) selectTool(doc, ui.groupVariant[g.id] ?? defaultVariant(g));
        consume();
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ' && spaceHeld.current) { spaceHeld.current = false; cursorRef.current('default'); } };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [doc, ctl]);

  // Ctrl+V / Ctrl+Shift+V: let the browser fire a real `paste` event (its clipboardData needs no permission,
  // unlike navigator.clipboard.read, which can hang or be refused in a WebView). Falls back to the menu command.
  useEffect(() => {
    const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable); };
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 'v' || typing(e.target)) return;
      if (!rootRef.current || rootRef.current.offsetParent === null || useApp.getState().dialogs.length) return;
      e.stopImmediatePropagation(); // keep the shell from turning this into a command (and cancelling the paste event)
      const mode = e.shiftKey ? 'inPlace' : 'center';
      let handled = false;
      const onPaste = (pe: ClipboardEvent) => {
        handled = true;
        pe.preventDefault();
        void imagesFromDataTransfer(pe.clipboardData).then((cs) => {
          try { doc.editor?.commitTransient(); pasteCanvases(doc, cs, mode); api.markDirty(); }
          catch (err) { if (err instanceof UserError) api.toast(err.message, 'error'); else throw err; }
        });
      };
      window.addEventListener('paste', onPaste, { once: true, capture: true });
      setTimeout(() => {
        window.removeEventListener('paste', onPaste, true);
        if (!handled) api.runCommand(mode === 'inPlace' ? 'pixel.edit.pasteInPlace' : 'pixel.edit.paste');
      }, 120);
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [doc, api]);

  const ui = doc.ui;
  const bytes = doc.layers.reduce((n, l) => n + (l.canvas ? rgbaBytes(l.canvas.width, l.canvas.height) : 0), 0) || rgbaBytes(doc.width, doc.height);
  const chip = { padding: '4px 8px', background: 'var(--bg1)', border: '1px solid var(--line)', cursor: 'pointer' } as const;

  return (
    <div ref={rootRef} className={compact ? 'compact' : ''} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {ui.showOptions && <OptionsBar doc={doc} ctl={ctl} api={api} compact={compact} onPanels={compact ? () => setPanelsOpen(!panelsOpen) : undefined} />}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {ui.showTools && <ToolRail doc={doc} compact={compact} />}
        <div style={{ flex: 1, position: 'relative', display: 'flex', minWidth: 0, paddingBottom: compact ? 48 : 0 }}>
          <Viewport doc={doc} ctl={ctl} apiRef={viewApi} textEdit={textEdit} spaceHeld={spaceHeld} cursorRef={cursorRef}
            onEditText={(id, isNew) => { textRef.current = { id, isNew }; setTextEdit({ id, isNew }); }} onTextDone={finishText} />
          <div style={{ position: 'absolute', left: 16 + (ui.showRulers ? 18 : 0), bottom: (compact ? 62 : 14), display: 'flex', gap: 4, font: 'var(--type-mono)', color: 'var(--mute)', flexWrap: 'wrap', zIndex: 5 }}>
            <div style={chip} className="hov-ink" title="Zoom in (Ctrl +) · click for 100%" onClick={() => viewApi.current?.zoomTo(1)}>{fmtZoom(ui.zoom)}</div>
            <div style={chip} className="hov-ink" onClick={() => viewApi.current?.fit()}>Fit</div>
            <div style={chip} className="hov-ink" onClick={() => viewApi.current?.zoomTo(1)}>100%</div>
            {!compact && <DropMenu label={<span style={{ font: 'var(--type-mono)', color: 'var(--mute)' }}>Rulers · Guides · Snap</span>} style={{ padding: '4px 8px', background: 'var(--bg1)' }} items={[
              { label: `${ui.showRulers ? '✓ ' : ''}Rulers`, hint: 'Ctrl R', onClick: () => { ui.showRulers = !ui.showRulers; doc.emit(); } },
              { label: `${ui.showGuides ? '✓ ' : ''}Guides`, hint: 'Ctrl ;', onClick: () => { ui.showGuides = !ui.showGuides; doc.emit(); } },
              { label: `${ui.snap ? '✓ ' : ''}Snap`, hint: 'Ctrl Shift ;', onClick: () => { ui.snap = !ui.snap; doc.emit(); } },
              { label: `${ui.showGrid ? '✓ ' : ''}Grid`, hint: "Ctrl '", onClick: () => { ui.showGrid = !ui.showGrid; doc.emit(); } },
            ]} />}
            {!compact && <div style={{ ...chip, cursor: 'default' }} title={`${doc.width} × ${doc.height} px · ${doc.ppi} ppi`}>Doc {formatBytes(bytes)} · RGB/8 · sRGB</div>}
          </div>
        </div>
        <Inspector doc={doc} api={api} open={!compact || panelsOpen} toast={(m, t) => api.toast(m, t)} />
      </div>
    </div>
  );
}

function fmtZoom(z: number) {
  const p = z * 100;
  return (p >= 100 ? Math.round(p) : Math.round(p * 10) / 10) + '%';
}
