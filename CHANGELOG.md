# Changelog

Every release gets an entry here. The release pipeline copies the section for the
version being released onto the GitHub Release page (which Vault and the desktop
updater show), and the app shows it in "What's new" after updating.

## [Unreleased]

### Fixed
- Update prompts on Windows and macOS always show the update notes.

## [0.1.0] - 2026-10-14

### New
- First build of Tone Suites for Windows, macOS and Android from one codebase.
- Shell: document tabs, command palette (Ctrl K), menus with keyboard shortcuts, status bar, dark/light theme and accent colors.
- Home: blank-document tiles for all five modules, recent files, devices and storage at a glance.
- Modules: Pixel (images), Cells (spreadsheets), Deck (slides), Write (documents) and Paper (PDF).
- Convert & export: turn any document into another format; results open in the right module in a new tab and the original stays untouched.
- Folder workspaces: open a folder as one tab and step through its files (Ctrl ↑/↓).
- Sync: local-first workspace that syncs to your UGREEN NAS (WebDAV) and Google Drive, with offline queueing and conflict handling (ask / keep newest / keep both).
- Session handoff: Home offers to open the documents another device has open.
- Open files directly from your NAS or anywhere in your Google Drive.
- In-place updates: desktop apps update themselves; Android updates install over the existing app (Vault or direct download). Update notes are shown before installing and in "What's new" afterwards.
