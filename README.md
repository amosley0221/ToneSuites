# Tone Suites

One app for images (**Pixel**), spreadsheets (**Cells**), slides (**Deck**), documents (**Write**)
and PDFs (**Paper**). It runs on Windows, macOS and Android from one codebase, syncs through your
NAS and Google Drive, and updates in place.

- **Stack:** Tauri 2 (Rust) + React 19 + TypeScript + Vite
- **Design source:** `design/handoff/` (the spec, interactive prototype, tokens and screenshots)
- **Feature status:** [FEATURES.md](FEATURES.md) (generated from the menus)
- **Setup** (NAS, Google Drive, installing, releasing): [docs/SETUP.md](docs/SETUP.md)
- **Update notes:** [CHANGELOG.md](CHANGELOG.md)

## Develop

```bash
npm install
npm run dev          # browser preview at http://localhost:1420 (no file system / sync)
npm run tauri dev    # desktop app (needs Rust + platform deps)
npm run tauri android dev   # Android (needs Android SDK + NDK)
npm run typecheck && npm test
npm run features     # regenerate FEATURES.md after changing menus
```

## Layout

```
src/
  core/       documents, commands & shortcuts, settings, .tone container, updater, platform wrappers
  shell/      title bar & tabs, menus, Home, command palette, status bar, Settings / Sync / Convert dialogs
  storage/    sync engine, WebDAV (NAS) and Google Drive providers
  modules/    pixel, cells, deck, write, paper (each implements ModuleDef from core/types.ts)
  ui/         design-system primitives
  styles/     tokens (from the design) + global styles
src-tauri/    Rust shell: plugins, OAuth loopback listener, bundling and updater config
scripts/      release, changelog and FEATURES.md tooling
.github/      CI and the release pipeline
```

## Principles (from the owner)

1. No hard-coded data: the app starts empty and everything comes from your files, settings and devices.
2. New documents start blank.
3. Updates install in place on every platform. Never change the Android signing key.
4. Converting stays in the app: the result opens in a new tab and the original is untouched.
5. Local-first storage, with the NAS and Google Drive as sync providers. Conflicts ask you.

HyperFormula (the Cells formula engine) is used under its GPLv3 license.
