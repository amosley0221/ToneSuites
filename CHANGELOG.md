# Changelog

Every release gets an entry here. The release pipeline copies the section for the
version being released onto the GitHub Release page (which Vault and the desktop
updater show), and the app shows it in "What's new" after updating.

## [Unreleased]

### Fixed
- Deck: paste screenshots and images with Ctrl+V, and copy/paste slide objects between decks.
- Deck: Delete and arrow keys keep working after editing text; Delete no longer removes the whole slide unless the slide list is focused.
- Deck: long titles no longer get cut off while editing; switching layouts keeps filled placeholders.
- Deck: Presenter view works on phones (swipe to change slides); the slide list scrolls by touch.
- Shortcuts that use Shift with punctuation (e.g. Bring to front, Ctrl Shift ]) now work in every module.
- Outline files (.toneoutline) open from File › Open as a new deck.
- Write: two-column page setup no longer hides your text, and headings no longer get stranded at the bottom of a page (on screen, PDF and Word).
- Write: Ctrl Space clears formatting; Tab types a tab (and adds a row in the last table cell); numbered lists keep counting when you add to them; undoing a resolved comment brings it back.
- Write: Word export header/footer page numbers are real page numbers.
- Phones: a closed panel no longer peeks out above the gesture bar.
- Cells: CSV files keep leading zeros in IDs (001234) and save back exactly as opened.
- Cells: dates like 03/04/2024 follow your region's day/month order.
- Cells: deleting, clearing, formatting or filling a filtered list only changes the visible rows, and copying copies only visible rows.
- Cells: cut-and-paste, pivot to a new sheet and Import CSV each undo in one step; Ctrl+Enter fills the whole selection; colour-scale rules no longer turn text red.
- Cells: column filters keep what you see when you click away, include rows added below the list, and the row count reflects all column filters together.
- Paper: Search & redact now covers exactly the matched words; before, part of the matched text could stay visible after applying redactions.
- Paper: radio-button choices in PDF forms are now saved, and multiline form fields keep a readable text size.
- Paper: "Flatten form on save" no longer leaves broken references in the saved PDF.
- Paper: clicking away from a note or text box finishes it instead of creating an empty one, and Ctrl Z undoes document edits again afterwards.
- Paper: split and extracted parts save as PDF files (they were saved as .tone).
- Paper (phone): Zoom, Panels and Save have their own toolbar row so they're always reachable.
- Sync: documents you saved no longer reload by themselves a minute later with "updated from another device" (the NAS reported the same version in two spellings).
- Sync: the regular background sync no longer stops after you save a file, so changes from your other devices keep arriving.
- Sync: a new NAS sync folder is created automatically on the first sync, instead of every upload failing until you pressed Test connection.
- Google Drive: files in new subfolders now upload (they failed with "Drive folder could not be created"), Google Docs/Sheets can be opened from Drive and recents, and an expired sign-in is renewed automatically.
- "Install on next launch" updates now really wait for the next launch instead of restarting Tone in the middle of your work.
- Revert (F12) now works for files opened from your NAS or Google Drive, and explains when a document has never been saved.
- Folder workspaces with mixed file types: after switching to a different kind of file, menu commands act on that file (they could still target the previous editor). Switched files now also appear in Recent.
- Cells: the column filter now filters the sheet as you type, shows how many rows match (or "No matches"), and finds values regardless of capitals, spaces or thousands separators (75568 finds 75,568). Cancel puts the previous filter back; OK keeps it, and it's saved with the file.

### Improved
- Deck: Tab moves between table cells (and adds a row in the last one); outline export includes tables; importing an outline into a new deck no longer leaves an empty first slide.
- Write: pasting from Word keeps bullets, numbering, titles and quotes; reopened Word files keep page breaks, quotes and code blocks.
- Write on phones: Panels is first in the toolbar, tapping the page closes the panel, and Page setup / Table of contents fit the screen.
- Settings, Convert & export and Open from storage fit on a phone screen (Galaxy Fold folded): the sections stack and scroll.
- Save as can save an Excel, Word or PDF file as a Tone document (.tone).
- The status bar says "Not synced yet" until the first sync instead of claiming "Synced"; "Sync error"/"Offline" detection is more reliable.
- Removing a storage provider also forgets its password on this device.
- Convert & export: a problem saving the extra Google Drive copy no longer cancels the conversion; the Drive option is greyed out until Drive is connected.
- Command palette: the highlighted row stays visible while you arrow through a long list.

## [0.1.4] - 2026-10-15

### New
- Update notifications: when a new version is out, an "Update" badge appears in the title bar (and a dot on ⚙) until you install it. The popup shows once per new version, so "Later" doesn't lose it.
- Settings › Updates: your version, when Tone last checked, Check now, and Install with the update notes.

## [0.1.3] - 2026-10-15

### Fixed
- Windows and macOS: "Open with → Tone Suites" (and double-clicking a file) now opens the file. If Tone is already running, the file opens as a new tab in the existing window instead of starting a second copy.

### Improved
- Tone documents (.tone) open in Tone Suites when you double-click them.

## [0.1.2] - 2026-10-14

### Improved
- Open from NAS now browses every shared folder on your NAS, not just the synced Tone folder. Files you open there save straight back to the NAS. A new "Browse from" setting lets you choose where browsing starts.

## [0.1.1] - 2026-10-14

### Fixed
- Android: the top bar no longer sits under the status bar (and the bottom bar no longer under the gesture bar) — on foldables too, folded or unfolded. Status bar icons follow the light/dark theme.
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
