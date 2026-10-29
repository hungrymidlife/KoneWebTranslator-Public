mod kwt_studio_tray; // KWT_STUDIO_TRAY_V1
// KWT_PRIVATE_CHAT_SAVE_V2_6_1: save only user-selected text/code files (local Tauri UI).
#[tauri::command]
fn kwt_save_chat_answer(path: String, content: String) -> Result<(), String> {
    const MAX_BYTES: usize = 16 * 1024 * 1024;
    if content.len() > MAX_BYTES {
        return Err("답변 저장 크기는 최대 16MB입니다.".into());
    }
    let target = std::path::Path::new(&path);
    if !target.is_absolute() {
        return Err("파일 저장 경로는 절대 경로여야 합니다.".into());
    }
    let extension = target
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "md" | "txt" | "json" | "csv" | "html" | "py" | "js" | "ts" | "css" | "sql") {
        return Err("지원하지 않는 답변 파일 확장자입니다.".into());
    }
    if target.file_name().is_none() || !target.parent().is_some_and(|parent| parent.is_dir()) {
        return Err("저장할 폴더가 존재하지 않습니다.".into());
    }
    std::fs::write(target, content.as_bytes()).map_err(|err| format!("파일 저장 실패: {err}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| { kwt_studio_tray::setup(app)?; Ok(()) })
        .invoke_handler(tauri::generate_handler![kwt_save_chat_answer, kwt_studio_tray::kwt_hide_to_tray])
        .run(tauri::generate_context!())
        .expect("error while running KoneWebTranslator Studio");
}
