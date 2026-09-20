const COMMANDS: &[&str] = &["update", "pendingTap", "clearPendingTap", "refresh"];

fn main() {
    let result = tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build();

    // Android 文档构建时插件构建结果永远为 Err()，与 crate 文档无关，忽略
    if !(cfg!(docsrs) && std::env::var("TARGET").unwrap().contains("android")) {
        result.unwrap();
    }
}
