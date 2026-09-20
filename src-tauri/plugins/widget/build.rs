// 注意：驼峰命令名生成的权限标识符同样是驼峰（allow-consumeNewItem），
// 只把 `_` 换成 `-`，不做 kebab-case 转换（见 permissions/default.toml）
const COMMANDS: &[&str] = &[
    "update",
    "pendingTap",
    "clearPendingTap",
    "consumeNewItem",
    "refresh",
];

fn main() {
    let result = tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .try_build();

    // Android 文档构建时插件构建结果永远为 Err()，与 crate 文档无关，忽略
    if !(cfg!(docsrs) && std::env::var("TARGET").unwrap().contains("android")) {
        result.unwrap();
    }
}
