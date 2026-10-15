//! Installed font families (Windows, macOS, Linux, Android), so every font on the device can be picked.

#[tauri::command]
pub async fn system_fonts() -> Vec<String> {
    // Scanning font files takes a moment; keep it off the main thread.
    tauri::async_runtime::spawn_blocking(|| {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        // fontdb doesn't scan Android's font folders itself.
        #[cfg(target_os = "android")]
        for dir in ["/system/fonts", "/product/fonts", "/system/product/fonts"] {
            db.load_fonts_dir(dir);
        }
        family_names(db.faces().flat_map(|f| f.families.iter().map(|(name, _)| name.clone())))
    })
    .await
    .unwrap_or_default()
}

/// The font file of an installed family (closest weight/style), so exports can embed the real font.
#[tauri::command]
pub async fn system_font_data(family: String, bold: bool, italic: bool) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut db = fontdb::Database::new();
        db.load_system_fonts();
        #[cfg(target_os = "android")]
        for dir in ["/system/fonts", "/product/fonts", "/system/product/fonts"] {
            db.load_fonts_dir(dir);
        }
        let query = fontdb::Query {
            families: &[fontdb::Family::Name(&family)],
            weight: if bold { fontdb::Weight::BOLD } else { fontdb::Weight::NORMAL },
            stretch: fontdb::Stretch::Normal,
            style: if italic { fontdb::Style::Italic } else { fontdb::Style::Normal },
        };
        let id = db.query(&query)?;
        // Collections (.ttc) can't be embedded as-is; only hand back single-font files.
        let face = db.face(id)?;
        if face.index != 0 { return None; }
        db.with_face_data(id, |data, _| tauri::ipc::Response::new(data.to_vec()))
    })
    .await
    .ok()
    .flatten()
    .ok_or_else(|| "font not found".into())
}

/// Unique, sorted (case-insensitive) family names, skipping hidden system families (".SF NS" etc.).
pub fn family_names<I: IntoIterator<Item = String>>(names: I) -> Vec<String> {
    let mut v: Vec<String> = names.into_iter().filter(|n| !n.is_empty() && !n.starts_with('.')).collect();
    v.sort_by_key(|n| n.to_lowercase());
    v.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    v
}

#[cfg(test)]
mod tests {
    use super::family_names;

    #[test]
    fn dedupes_and_sorts() {
        let got = family_names(["Arial".into(), "arial".into(), ".SF NS".into(), "Calibri".into(), "".into()]);
        assert_eq!(got, vec!["Arial".to_string(), "Calibri".to_string()]);
    }
}
