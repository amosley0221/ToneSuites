# Handoff: Tone Suites — cross-platform productivity suite

## Overview
Tone Suites is a single desktop/mobile application with five document modes sharing one window shell:
**Pixel** (raster image editor, Photoshop-class), **Cells** (spreadsheet, Excel-class), **Deck** (slides, PowerPoint-class), **Write** (word processor, Word-class), **Paper** (PDF, Acrobat-class). One title bar with document tabs, one command palette (Ctrl K), one status bar, one sync engine, one convert pipeline. Audience: a single power user (the owner). Depth target: pro-level parity with the apps named above.

## About the design files
Everything in this bundle is a **design reference built in HTML** — a clickable prototype showing intended look and behavior, not production code. Recreate these designs in the target stack (see "Platform build plan"). Use the bundled design system (`../styles.css`, `../tokens/`, `../components/core/`) as the token source; port those tokens into the app's theme layer rather than linking the CSS files.

## Fidelity
**High-fidelity.** Colors, type, spacing, chrome heights and interaction states are final. Recreate pixel-perfectly at 1440×900 and keep the layout fluid above/below that. Feature *content* inside dialogs (slider values, sample data, file names) is illustrative only — see the next section.

## Non-negotiables from the owner
1. **No hard-coded data.** Every list, file name, device, number, slider value, layer, slide, cell, PDF page and storage provider in the prototype is sample content. The real app must start empty and derive everything from the user's files, settings and connected devices. No fixture arrays in production code; no demo documents; no fake "MacBook Pro".
2. **New documents start blank.** Clicking a module tile on Home (or Ctrl N) opens a **new, empty document** in that module: Pixel → "New canvas" dialog (size / resolution / color mode / background) then an empty canvas with one Background layer; Cells → empty "Sheet 1"; Deck → one blank Title slide on the default master; Write → one empty Letter page with the Body style; Paper → an open-file picker (a PDF app has nothing to show without a file) with "Create blank PDF" as a secondary action. Recents only appear once the user has created or opened files.
3. **Update in place on every platform.** The user must never uninstall to upgrade. See "Updates".
4. **Convert stays in-app.** Any document can be converted to another format and the result opens in a new tab in the right module (e.g. Write → PDF opens in Paper), with the original untouched and a banner linking back.
5. **Storage**: local-first, with Google Drive and NAS (SMB / WebDAV) as sync providers. Offline edits queue and sync when reachable. Conflicts ask the user (merge / keep A / keep B / keep both) unless they change the setting.
6. **Session handoff**: if another device has documents open, Home offers to open the same tabs here, in the same order.
7. **Folder workspaces**: a folder can be opened as one tab; a dropdown in the module's menu row lists its files; Ctrl ↑/↓ switches; "Open all as tabs", "Combine", "Batch convert".

## Platform build plan
Recommended: **Tauri 2 + React + TypeScript**, one codebase for Windows, macOS and Android (iOS later if wanted).
- UI: React 18, Vite, TypeScript. Styling via CSS custom properties copied from `../tokens/*.css` (dark default, `[data-theme=light]`). No component library — the primitives in `../components/core/` are small; port them.
- Core (Rust, in the Tauri backend): file system + .tone container (zip: `manifest.json` + module payload + assets), sync engine, converters that need native speed (PDF render via pdfium, image codecs incl. RAW via libraw/rawloader, HEIC), SMB/WebDAV client, OAuth for Google Drive.
- Module engines (web side):
  - Pixel: WebGL2/WebGPU canvas with a tile-based non-destructive layer stack (layers, groups, masks, blend modes, adjustment layers, smart objects, smart filters), 8/16/32-bit, color-managed (sRGB/Display P3/CMYK soft-proof via lcms). PSD import/export via `ag-psd`.
  - Cells: virtualised grid (own renderer on canvas), formula engine **HyperFormula** (400+ functions), pivot and chart layers, XLSX via **SheetJS**.
  - Deck: DOM/canvas slide renderer with masters/layouts, animation timeline, presenter view on a second window (Tauri multiwindow); PPTX via **pptxgenjs** (export) + custom OOXML parser (import); MP4 via ffmpeg sidecar.
  - Write: **ProseMirror** (styles, tables, footnotes, TOC, track changes/comments as marks), pagination layer for Letter/A4; DOCX via `docx` + `mammoth`.
  - Paper: **pdfium** (Rust) for render/text/forms, **pdf-lib** for edits/merge/split/sign/flatten, **Tesseract** (sidecar) for OCR.
- Android: Tauri 2 mobile target. Inspector collapses to a bottom sheet, tool rail to a bottom bar, menus to a ⋮ sheet; everything else identical. Min target Android 10.
- Windows: MSIX or NSIS installer (both supported by Tauri bundler). macOS: notarized .app in a .dmg (universal binary).

## Updates (no reinstall)
- **Windows & macOS**: Tauri **updater plugin** with signed update manifests (minisign key). App checks `https://<your-host>/tone/latest.json` on launch and every 6h; downloads delta/full package; prompts "Restart to update" (or silent on next launch per setting). Host releases on GitHub Releases or the NAS. Windows MSIX alternatively self-updates through the Store/App Installer; NSIS builds update through the Tauri updater.
- **Android**: distribute through Google Play (internal testing track is enough for one user) so updates install in place; or self-host the APK with a stable signing key and use the in-app updater (Play Core / `REQUEST_INSTALL_PACKAGES`) — same package name + same key is what makes in-place updates possible. Never change the signing key.
- Version data files forward-compatibly: `.tone` manifest carries `formatVersion`; the app migrates on open and never rewrites older files unless saved.

## Screens (see screenshots/)
01 Home · 02 Pixel · 03 Pixel File menu · 04 Filter gallery · 05 Properties panel · 06 Select & mask · 07 Import & place · 08 Cells · 09 Chart editor · 10 Pivot builder · 11 Deck · 12 Masters & layouts · 13 Presenter view · 14 Write · 15 Track changes pane · 16 Convert & export · 17 Paper · 18 Form builder · 19 OCR · 20 Settings · 21 Sync & conflicts.
Full interactive prototype: open `Tone Suites.dc.html` in a browser (keep `support.js` beside it). Every control described below is clickable there.

### Shell (all modes)
- Window 1440×900 (min 1024×640), bg `--bg0`, 1px `--line` border.
- Title bar 44px: wordmark (14px accent square + "TONE" Archivo 900 16px, -0.04em) → document tabs (DocumentTab component: 18px mono mark, title, active = `--bg1` + 2px accent top) → right cluster: search/command trigger (mono 11px, "Ctrl K" key cap), theme toggle, ⚙ settings, window controls 40px each (close hover #e5484d).
- Converted-file banner (Banner component) under the title bar when a tab was produced by Convert.
- Status bar 28px, `--bg1`, mono 11px: MODE · hint · sync state (green dot) · OS.
- Command palette: 620px, top 120px, input 16px/600, rows 11px pad, mono shortcut right; filters commands + files; Esc closes.
- Dialog shell (Dialog component): backdrop rgba(0,0,0,.6); header 14/18 padding with accent square, title 15/800, mono subtitle; body is a flex row (left list 220–320px, right form).
- Menus: 260px dropdown, items 5/14 padding, 12px, shortcut mono right, dividers 1px; submenu 240px flush right.

### Home
Left: handoff banner (when applicable), "Good morning." 52/900, module tiles 5-col grid (34px ink square with mark, name 17/800, description), Recents table (mark · name · app · location · relative time). Right 320px `--bg1`: DEVICES, STORAGE (per-provider usage bars), SHORTCUTS.

### Pixel
Menu row 32px with 10 menus (File, Edit, Image, Layer, Type, Select, Filter, View, Window, Help) — full inventory is in the prototype's `menuDefs`; every item must exist as a command even where the dialog is not yet designed. Options bar 40px (tool name 11px/800 uppercase + per-tool fields; Free-transform variant with X/Y/W/H/∠/skew + Commit). Tool rail 52px, 21 groups (30px cells, flyouts). Canvas on `--canvas` with checkerboard document, dashed-accent selection, transform box (white handles, thirds grid). Inspector 300px with 10 panel tabs: Layers, Channels, Paths, Properties, Adjust, History, Brush, Type, Color, Actions. Dialogs: Filter gallery (16 filters, params), Curves, Layer properties (15 blend modes, mask), Layer style (11 effects), Select & mask, Content-aware fill, Camera RAW (9 tabs, 13 sliders), Image size, Canvas size, Color picker, Import & place (7 sources, formats list), Export.

### Cells
Menu row + FOLDER switcher (right). Format toolbar 40px. Formula bar 34px (name box 90px, fx, formula; click → editing with autocomplete dropdown 520px). Grid: row header 44px, columns 140px, rows 28px, header row/total row `--bg1` 700; numbers mono right-aligned; negatives `--negative`; selection = 2px accent outline + `--sel`. Sheet tabs bar 34px. Dialogs: Chart editor (8 types, series, live preview), Pivot builder (fields → rows/columns/values/filters + preview), Conditional formatting (rules list + editor), Export.

### Deck
Toolbar: New slide, Masters & layouts, insert group, Transition, Animate (toggles timeline). Thumbnail rail 200px (16:9, 2px border, accent when active). Canvas 736×414 slide (title 54/900 -0.045em, kicker mono 11, body 15). Notes 92px or Timeline 170px (rows + bars on 3s ruler + playhead). Inspector 280px: LAYOUT grid, THEME swatches/fonts, TRANSITION segmented, EXPORT rows. Masters dialog 1240×700 (master + 6 layouts, placeholder editing, background, footer toggles). Presenter: full-screen black, current slide, next slide, elapsed/clock, notes 20px, Prev/Next/Black/End.

### Write
Toolbar: style chips (Body/Title/H1/H2/Quote), font + size, B/I/U, lists/link/image/table, TOC, Footnote, Page setup; Track changes · n (toggles review pane); Export. Page 816px wide, 96px padding, white, 15px/1.65 text; insertions `--insert` underline, deletions `--delete` strike. Inspector 280px: OUTLINE (active = 2px accent left), DOCUMENT stats, COMMENTS. Review pane: filters (All/Insertions/Deletions/Format), change cards with Accept/Reject. Dialogs: TOC (levels, style, preview), Footnote (numbering, position, text), Page setup (paper, orientation, margins, columns, header/footer, preview).

### Paper
Tools row: Annotate, Highlight, Sign, Fill form, Redact, Edit, Organize, Convert (active = ink fill). Thumbnail rail 160px. Page 680×880 white with highlight callout, redaction, dashed-accent signature fields. Inspector 280px: active tool options, DOCUMENT ACTIONS grid (Merge/Split/Compress/OCR/Protect/To Write), ANNOTATIONS list. Dialogs: Form builder (fields on page + list + properties), OCR (scan overlay, recognized text with low-confidence marks, language, make searchable), Organize pages (6-col grid, multi-select, rotate/delete/extract/insert/split/merge).

### Shared dialogs
Convert & export (format list left with ext chip + description; preview; options; "Keep original", "Open result in new tab", "Also save to Google Drive"; CTA "Convert & open in <Module>" or "Export <Format>"). Settings (General, Appearance, Shortcuts, Sync, Modules, Formats). Sync (conflict card with Merge both / Keep A / Keep B / Compare; devices & providers table).

## Interactions & behavior
- Tabs switch mode instantly; chrome never reflows. Ctrl Tab / Ctrl 1–9 switch tabs.
- Ctrl K palette; Ctrl Shift E convert/export; Esc closes any overlay, cancels transform, closes menus.
- Hover: default buttons border → `--ink`; rows → `--bg2`; tool cells → `--bg3`. 120ms transitions only.
- Autosave every 5s locally; sync queue to providers; conflict prompt per Settings › Sync.
- Theme: dark default, light via `[data-theme=light]`; accent user-selectable (orange default; lime, blue, green presets).
- Android: inspector → bottom sheet; tool rail → bottom bar; menus → sheet; tabs scroll horizontally.

## State model (sketch)
```ts
type Doc = { id; mode: 'pixel'|'cells'|'deck'|'write'|'paper'; path: string|null; title; dirty; convertedFrom?: DocId; folderWorkspace?: { folder: string; files: string[] } };
type Session = { docs: Doc[]; activeDocId; theme; accent; providers: Provider[]; devices: Device[]; pendingHandoff?: { device; docs: Doc[] } };
// per-module state lives in that module's engine (layer stack, workbook, deck model, ProseMirror doc, PDF doc)
```

## Design tokens
See `../tokens/colors.css`, `typography.css`, `spacing.css` (copied here as `tokens/`). Key values: bg0 #0c0c0e · bg1 #141417 · bg2 #1c1c20 · bg3 #26262c · line #2b2b32 · ink #f2f1ee · mute #8d8d96 · accent #ff5a1f · on-accent #0c0c0e · canvas #09090a · sel rgba(255,90,31,.14) · positive #2fb98a · negative #e5484d · info #4f8ff7. Light: bg0 #eceae4 · bg1 #f7f6f2 · bg2 #fff · bg3 #e4e2dc · line #d6d4cd · ink #141414 · mute #6c6c74. Fonts: Archivo (500–900), JetBrains Mono (400–500). Radius 0. Shadows: float 0 20px 50px rgba(0,0,0,.5); modal 0 30px 80px rgba(0,0,0,.6); page 0 20px 60px rgba(0,0,0,.45).

## Assets
No logo or icon set exists yet. Wordmark is plain type. Use a 16px outline icon set (Lucide) for production tool icons, keeping shortcut letters in tooltips. Fonts from Google Fonts (bundle the TTFs with the app; do not fetch at runtime).

## Files
- `Tone Suites.dc.html` + `support.js` — interactive prototype (open in a browser)
- `Tone Handoff.dc.html` — early spec page (tokens, flows, module scope)
- `tokens/`, `components/` — design system copies
- `screenshots/` — 21 reference stills
- `CLAUDE.md` — instructions for Claude Code
