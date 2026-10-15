mod files;
mod fonts;
mod oauth;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Must be registered first: a second launch (e.g. "Open with Tone Suites" while it's already
    // running) hands its file arguments to this instance and exits.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
        files::queue(app, files::files_from_args(args.into_iter().skip(1)));
    }));

    let builder = builder
        .manage(files::PendingFiles(std::sync::Mutex::new(files::files_from_args(std::env::args().skip(1)))))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());

    builder
        .invoke_handler(tauri::generate_handler![oauth::oauth_listen, files::take_open_files, fonts::system_fonts, fonts::system_font_data])
        .build(tauri::generate_context!())
        .expect("error while building Tone Suites")
        .run(|_app, _event| {
            // macOS: files opened from Finder arrive as an event, not as arguments.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls.into_iter().filter_map(|u| u.to_file_path().ok()).map(|p| p.to_string_lossy().into_owned()).collect();
                files::queue(_app, paths);
            }
        });
}
