# CLAUDE.md — Tone Suites

You are building Tone Suites from the design handoff in this folder. Read README.md first, then open `Tone Suites.dc.html` in a browser to click through every screen.

Rules that override anything else:
- No hard-coded data, fixtures, demo files or fake devices in production code. All content comes from the user's files, settings and connected devices. The app launches empty.
- New documents are blank. Module tiles / Ctrl N create an empty document in that module (Pixel shows a New-canvas dialog first; Paper shows an open-file picker with "Create blank PDF").
- One codebase: Tauri 2 + React + TypeScript for Windows, macOS, Android. In-place updates on all three (Tauri updater with signed manifests; Android via Play or a stable-key self-hosted APK). Never change the Android signing key.
- Recreate the design pixel-accurately from tokens in `tokens/` and the primitives in `components/core/`; radius 0, one accent, 1px lines. Dark default, light theme via `[data-theme=light]`.
- Every menu command listed in the prototype's `menuDefs` (inside `Tone Suites.dc.html`) must exist as a command, even if its UI ships later. Keep a FEATURES.md checklist mapping each to status.
- Convert never leaves the app: result opens in a new tab in the right module, original untouched, banner links back.
- Storage is local-first; Google Drive and SMB/WebDAV NAS are sync providers; conflicts ask the user.

Suggested order: shell + tabs + palette → Write → Cells → Paper → Deck → Pixel → sync/providers → convert pipeline → updater → Android layout.
