# CLAUDE.md — Tone Suites

Read `design/handoff/README.md` and `design/handoff/CLAUDE.md` for the product spec. Its rules override everything else:
no hard-coded data, blank new documents, in-place updates, convert stays in-app, local-first sync.

## Every change
- Add user-facing update notes under `## [Unreleased]` in `CHANGELOG.md` (plain language, grouped
  under `### New`, `### Improved`, `### Fixed`). The owner reads them in the release page, in Vault and in "What's new".
- If you change any `src/modules/*/menus.ts`, run `npm run features` and commit FEATURES.md. Keep
  item `status` honest ('done' only when it really works).
- `npm run typecheck && npm test && npx vite build` must pass.

## Releasing
`npm run release -- patch|minor|major --push` (see docs/SETUP.md). The tag triggers
`.github/workflows/release.yml`. Never change `identifier` in tauri.conf.json or the Android signing key,
or Android updates stop installing over the old app.

## Architecture
- Module contract: `src/core/types.ts` (`ModuleDef`). Modules never import each other. Conversions hand
  bytes to the target module's `openFile` (pdf → Paper, html/md → Write, xlsx/csv → Cells, png → Pixel,
  `.toneoutline` → Deck).
- Menus are pure data (`menus.ts`, relative `.ts` imports only) because `scripts/gen-features.mjs` reads them.
- The core handles `file.*` and `app.*` command ids. Modules handle their own ids.
- Storage: `src/storage/sync.ts` mirrors the local workspace folder to each provider, keeping a per-provider index.
