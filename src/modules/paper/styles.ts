// Paper-specific CSS (pdf.js text layer essentials + page overlay classes). Injected once.
import { useSyncExternalStore } from 'react';
import type { PaperModel } from './model';

const CSS = `
.pp-page { position: relative; background: var(--paper); box-shadow: var(--shadow-page); flex-shrink: 0; --scale-round-x: 1px; --scale-round-y: 1px; }
.pp-page canvas.pp-canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.pp-page .textLayer { position: absolute; text-align: initial; inset: 0; overflow: clip; opacity: 1; line-height: 1; text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0; caret-color: CanvasText; z-index: 1; --min-font-size: 1; --text-scale-factor: calc(var(--total-scale-factor) * var(--min-font-size)); --min-font-size-inv: calc(1 / var(--min-font-size)); user-select: text; }
.pp-page .textLayer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0% 0%; }
.pp-page .textLayer > :not(.markedContent), .pp-page .textLayer .markedContent span:not(.markedContent) { z-index: 1; --font-height: 0; font-size: calc(var(--text-scale-factor) * var(--font-height)); --scale-x: 1; --rotate: 0deg; transform: rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv)); }
.pp-page .textLayer .markedContent { display: contents; }
.pp-page .textLayer span[role="img"] { user-select: none; cursor: default; }
.pp-page .textLayer ::selection { background: rgba(255, 90, 31, .3); }
.pp-page .textLayer br::selection { background: transparent; }
.pp-page .textLayer .endOfContent { display: block; position: absolute; inset: 100% 0 0; z-index: 0; cursor: default; user-select: none; }
.pp-page .textLayer.selecting .endOfContent { top: 0; }
.pp-page [data-main-rotation="90"] { transform: rotate(90deg) translateY(-100%); }
.pp-page [data-main-rotation="180"] { transform: rotate(180deg) translate(-100%, -100%); }
.pp-page [data-main-rotation="270"] { transform: rotate(270deg) translateX(-100%); }
.pp-page.no-text .textLayer { pointer-events: none; }
.pp-overlay { position: absolute; inset: 0; z-index: 2; pointer-events: none; overflow: visible; }
.pp-hit { pointer-events: auto; cursor: move; }
.pp-overlay.passive .pp-hit { pointer-events: none; }
.pp-input { position: absolute; z-index: 4; pointer-events: auto; border: 1px solid var(--info); background: rgba(79, 143, 247, .08); color: var(--paper-ink); font: 500 12px var(--font-ui); padding: 0 4px; outline: none; border-radius: 0; }
.pp-input:focus { border-color: var(--accent); background: rgba(255, 90, 31, .06); }
.pp-tool { padding: 6px 12px; cursor: pointer; border: 1px solid var(--line); background: transparent; color: var(--ink); font: 500 12px/1.3 var(--font-ui); white-space: nowrap; flex-shrink: 0; transition: border-color var(--dur-fast), background var(--dur-fast); }
.pp-tool:hover { border-color: var(--ink); }
.pp-tool.on { background: var(--ink); color: var(--bg0); border-color: var(--ink); font-weight: 700; }
.pp-opt { padding: 8px 10px; border: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 8px; cursor: pointer; font: 500 12px/1.4 var(--font-ui); color: var(--ink); background: transparent; text-align: left; transition: border-color var(--dur-fast); width: 100%; }
.pp-opt:hover { border-color: var(--ink); }
.pp-opt.on { border-color: var(--accent); box-shadow: inset 2px 0 0 var(--accent); }
.pp-opt .hint { color: var(--mute); font: var(--type-mono); font-size: 10px; }
.pp-opt.disabled { color: var(--mute); }
.pp-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.pp-grid .pp-opt { padding: 9px 10px; }
.pp-thumb { cursor: pointer; }
.pp-thumb .pp-thumb-img { background: var(--paper); border: 2px solid transparent; display: block; width: 100%; transition: border-color var(--dur-fast); }
.pp-thumb.on .pp-thumb-img { border-color: var(--accent); }
.pp-thumb:hover:not(.on) .pp-thumb-img { border-color: var(--line); }
.pp-num { text-align: center; font: var(--type-mono); font-size: 10px; color: var(--mute); margin-top: 4px; }
.pp-swatch { width: 20px; height: 20px; border: 1px solid var(--line); cursor: pointer; padding: 0; }
.pp-swatch.on { outline: 1px solid var(--ink); outline-offset: 1px; }
`;

let injected = false;
export function ensureStyles() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const s = document.createElement('style');
  s.id = 'paper-module-styles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/** Re-render on any model change. */
export function useModel(model: PaperModel) {
  return useSyncExternalStore(model.subscribe, model.getVersion);
}
