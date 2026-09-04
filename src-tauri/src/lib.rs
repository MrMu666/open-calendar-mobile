// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(mobile)]
    let builder =
        tauri::Builder::default().plugin(tauri_plugin_all_files_access::init());
    #[cfg(not(mobile))]
    let builder = tauri::Builder::default();
    builder
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
