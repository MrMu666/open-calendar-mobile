//! Android 所有文件访问权限（MANAGE_EXTERNAL_STORAGE）桥。
//! 移动端专用插件：桌面端编译为空 crate，JS 调用前需自行捕获异常。

#![cfg(mobile)]

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

/// Initializes the plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("all-files-access")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                const PLUGIN_IDENTIFIER: &str = "app.tauri.allfilesaccess";
                let _handle: tauri::plugin::PluginHandle<R> =
                    api.register_android_plugin(PLUGIN_IDENTIFIER, "AllFilesAccessPlugin")?;
                // 句柄由框架持有注册表，JS 直调 Kotlin 命令，此处无需 manage
                let _ = &app;
            }
            Ok(())
        })
        .build()
}
