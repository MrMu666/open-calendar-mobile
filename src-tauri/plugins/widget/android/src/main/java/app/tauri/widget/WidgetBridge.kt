package app.tauri.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.util.Log
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

/**
 * 应用侧（Tauri Kotlin 插件）与桌面小组件之间的唯一通道。
 *
 * 小组件运行在 launcher 进程，无法直接持有插件实例，因此这里保存一份插件静态引用：
 *   - 应用内数据变化 → [pushFromJson]：落盘 SharedPreferences 并立即刷新桌面
 *   - 小组件被点击 → [WidgetPrefs.setPendingTap]，插件实例存活且有监听时另发
 *     [EVENT_LAUNCH_ITEM] 事件即时打开；否则由前端轮询 `pendingTap` 兜底
 *   - 应用回到前台 → [sync] 向仍存活的前端发 [EVENT_RESYNC] 要一次最新数据
 *
 * 注意：这里刻意不访问 `Plugin` 的 activity 字段（tauri 2.11.5 的
 * `Plugin(private val activity: Activity)` 是私有构造属性），需要 Context 时用
 * [attach] 传入的 applicationContext，前台可见性由插件 onResume/onPause 维护。
 */
object WidgetBridge {

    private const val TAG = "OpenCalendarWidget"

    /** 前端打开某条事项的事件（payload.id = 事项稳定 id）。 */
    const val EVENT_LAUNCH_ITEM = "widget://launch-item"

    /** 请求前端重新推送数据的事件（onResume 等场景）。 */
    const val EVENT_RESYNC = "widget://resync"

    @Volatile
    private var plugin: Plugin? = null

    /** 应用级 Context（由插件构造时传入），通知/落盘/重绘都用它。 */
    @Volatile
    private var appContext: Context? = null

    /** 应用是否处于前台（由插件 onResume/onPause 维护）。 */
    @Volatile
    private var foreground = false

    /** 注册插件实例（在 [WidgetPlugin] 构造时调用）。 */
    fun attach(instance: Plugin, context: Context) {
        plugin = instance
        appContext = context.applicationContext
    }

    fun detach(instance: Plugin) {
        if (plugin === instance) plugin = null
    }

    fun isAttached(): Boolean = plugin != null

    fun setForeground(value: Boolean) {
        foreground = value
    }

    /** 应用是否在前台：由 [WidgetPlugin] 的 onResume/onPause 维护，不触碰超类私有字段。 */
    fun isAppVisible(): Boolean = foreground

    /** 前端是否已注册监听（未注册时点击事件留给 pendingTap 兜底，不清除）。 */
    fun hasLaunchListener(): Boolean =
        try {
            plugin?.hasListener(EVENT_LAUNCH_ITEM) == true
        } catch (e: Exception) {
            false
        }

    fun hasResyncListener(): Boolean =
        try {
            plugin?.hasListener(EVENT_RESYNC) == true
        } catch (e: Exception) {
            false
        }

    /** 数据推送：解析 JSON → 落盘 → 立即重绘全部小组件实例。 */
    fun pushFromJson(context: Context, json: String) {
        WidgetPrefs.saveFromJson(context, json)
        updateNow(context)
    }

    /** 只重绘（沿用已落盘快照，用于系统重启后、onResume、设置页按钮等）。 */
    fun updateNow(context: Context) {
        val mgr = AppWidgetManager.getInstance(context) ?: return
        val ids = mgr.getAppWidgetIds(ComponentName(context, TodoWidgetProvider::class.java))
        for (id in ids) {
            try {
                mgr.updateAppWidget(id, TodoWidgetProvider.buildViews(context, id))
            } catch (e: Exception) {
                Log.w(TAG, "刷新小组件失败（id=$id）", e)
            }
        }
    }

    /**
     * 冷启动/回到前台时向仍存活的前端要一次最新数据。
     * persist = true 时顺带重绘（系统重启后 launcher 恢复小组件、应用未启动过时的兜底）。
     */
    fun sync(force: Boolean, persist: Boolean) {
        val current = plugin ?: return
        val context = appContext
        try {
            if (!hasResyncListener()) return
            if (!force && !isAppVisible()) return
            if (persist && context != null) {
                updateNow(context)
            }
            val payload = JSObject()
            payload.put("persist", persist)
            current.trigger(EVENT_RESYNC, payload)
        } catch (e: Exception) {
            Log.w(TAG, "请求前端同步失败", e)
        }
    }

    /** 小组件被点击后：应用存活且有监听时直接下发事件（前端立即可开编辑器）。 */
    fun notifyPendingTap(context: Context) {
        val current = plugin ?: return
        if (!hasLaunchListener()) return
        val id = WidgetPrefs.getPendingTap(context, false) ?: return
        try {
            val payload = JSObject()
            payload.put("id", id)
            current.trigger(EVENT_LAUNCH_ITEM, payload)
        } catch (e: Exception) {
            Log.w(TAG, "下发小组件点击事件失败", e)
        }
    }
}
