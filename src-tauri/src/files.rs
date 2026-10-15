//! Files handed to the app by the OS ("Open with", double-click, drag onto the icon).
//!
//! Windows/Linux pass them as command-line arguments — to this process on first launch, or to a
//! second launch that the single-instance plugin forwards here. macOS delivers them as
//! `RunEvent::Opened`. All of them are queued; the frontend drains the queue on startup and
//! whenever it receives the `open-files` event.

use std::path::Path;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct PendingFiles(pub Mutex<Vec<String>>);

/// Keep only arguments that are existing files (skips the executable and any flags).
pub fn files_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-') && Path::new(a).is_file())
        .collect()
}

// Only called from desktop paths (second launch, macOS Opened); Android/iOS use the startup queue.
#[cfg_attr(mobile, allow(dead_code))]
pub fn queue(app: &AppHandle, files: Vec<String>) {
    if files.is_empty() {
        return;
    }
    if let Some(state) = app.try_state::<PendingFiles>() {
        state.0.lock().unwrap().extend(files);
    }
    let _ = app.emit("open-files", ());
    // Window focus/restore only exists on desktop.
    #[cfg(desktop)]
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn take_open_files(state: tauri::State<PendingFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg(test)]
mod tests {
    use super::files_from_args;

    #[test]
    fn keeps_only_existing_files() {
        let real = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        let args = vec!["--flag".into(), "/definitely/not/here.xlsx".into(), real.clone(), std::env::temp_dir().to_string_lossy().into_owned()];
        assert_eq!(files_from_args(args), vec![real]);
    }
}
