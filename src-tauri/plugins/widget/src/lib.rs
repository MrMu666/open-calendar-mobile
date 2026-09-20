//! Android 桌面小组件（AppWidgetProvider + RemoteViews）桥。
//!
//! 小组件运行在系统桌面进程中，无法用 WebView/React 渲染，UI 全部由原生
//! RemoteViews 绘制；本插件只承担“数据下发 + 点击回传”：
//!   - JS `plugin:widget|update` 把待办列表 JSON 交给 Android 侧落盘并重绘
//!   - 桌面上的点击落进 SharedPreferences，JS `plugin:widget|pendingTap` 取回后
//!     打开对应事项（或由 Kotlin 侧 onResume 主动发 `widget://launch-item` 事件）
//! Rust 侧无命令实现：Android 上由 Kotlin `WidgetPlugin` 处理，桌面/dev 编译为空
//! 插件，前端调用前需自行捕获异常（与 all-files-access 一致）。

#[cfg(all(mobile, target_os = "android"))]
mod mobile {
    use tauri::{
        plugin::{Builder, TauriPlugin},
        Runtime,
    };

    /// Initializes the plugin.
    pub fn init<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("widget")
            .setup(|_app, api| {
                const PLUGIN_IDENTIFIER: &str = "app.tauri.widget";
                let _handle: tauri::plugin::PluginHandle<R> =
                    api.register_android_plugin(PLUGIN_IDENTIFIER, "WidgetPlugin")?;
                Ok(())
            })
            .build()
    }
}

#[cfg(all(mobile, target_os = "android"))]
pub use mobile::init;

/// 非 Android（桌面/dev）空实现：不注册任何命令，JS 调用会失败并被前端吞掉。
#[cfg(not(all(mobile, target_os = "android")))]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("widget").build()
}
