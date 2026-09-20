# 小组件类由系统（AppWidgetManager / 桌面进程）按类名反射加载：
# R8 不得重命名或裁剪，否则桌面加载 Provider 失败（小组件列表里直接消失）。
-keep class app.tauri.widget.** { *; }
-keepclassmembers class app.tauri.widget.** { *; }
