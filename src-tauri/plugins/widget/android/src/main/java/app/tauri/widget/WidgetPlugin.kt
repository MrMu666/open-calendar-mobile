package app.tauri.widget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class UpdateArgs {
    /** 待办快照 JSON（字段见 src/lib/widget.ts 的 WidgetPayload）。 */
    var payload: String? = null
}

@InvokeArg
class PendingTapArgs {
    /** 取回后是否立即清除（前端已打开对应事项）。 */
    var clear: Boolean = true
}

/**
 * 桌面小组件桥插件（Mobile Plugin）。
 *
 * 小组件 UI 全在原生 RemoteViews 中（[TodoWidgetProvider]），本插件只做四件事：
 *   - update：前端推送待办快照 JSON → 落盘 + 立即重绘
 *   - refresh：标记“正在同步”并重绘（列表为空时桌面显示进度圈）
 *   - pendingTap / clearPendingTap：桌面点击回传的取回与清理（不依赖事件时兜底）
 *
 * 事件（前端 registerListener 注册即可收到）：
 *   - widget://launch-item：应用存活时点击某条事项后即时下发
 *   - widget://resync：应用回到前台时请求前端重推数据
 */
@TauriPlugin
class WidgetPlugin(private val activity: Activity) : Plugin(activity) {

    /** 注册后供 launcher 侧回调使用（见 [WidgetBridge]）。 */
    init {
        WidgetBridge.attach(this)
    }

    override fun load(webView: android.webkit.WebView) {
        // 冷启动兜底：应用一起来就重绘一次（沿用上次快照），并请求前端推送最新数据
        WidgetBridge.updateNow(activity.applicationContext)
    }

    override fun onResume(activity: AppCompatActivity) {
        // 回到前台：拉一次最新数据（widget 可能停留在旧快照）
        WidgetBridge.updateNow(activity.applicationContext)
        WidgetBridge.sync(force = true, persist = false)
    }

    override fun onDestroy(activity: AppCompatActivity) {
        WidgetBridge.detach(this)
    }

    /** 前端推送待办快照。 */
    @Command
    fun update(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(UpdateArgs::class.java)
            val json = args.payload
            if (json.isNullOrBlank()) {
                invoke.reject("payload 不能为空")
                return
            }
            WidgetBridge.pushFromJson(activity.applicationContext, json)
            invoke.resolve(result())
        } catch (e: Exception) {
            invoke.reject(e.message ?: "更新桌面小组件失败")
        }
    }

    /** 标记“正在同步”并重绘（空列表时桌面显示进度圈）。 */
    @Command
    fun refresh(invoke: Invoke) {
        try {
            WidgetPrefs.setSyncing(activity.applicationContext, true)
            WidgetBridge.updateNow(activity.applicationContext)
            WidgetBridge.sync(force = true, persist = false)
            invoke.resolve(result())
        } catch (e: Exception) {
            invoke.reject(e.message ?: "刷新桌面小组件失败")
        }
    }

    /** 取回桌面点击的事项 id（未消费时返回 id=0）。 */
    @Command
    fun pendingTap(invoke: Invoke) {
        try {
            val args = invoke.parseArgs(PendingTapArgs::class.java)
            val id = WidgetPrefs.getPendingTap(activity.applicationContext, args.clear)
            val result = result()
            result.put("id", id ?: 0L)
            invoke.resolve(result)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "读取小组件点击失败")
        }
    }

    /** 清除待处理点击（前端已处理或用户忽略）。 */
    @Command
    fun clearPendingTap(invoke: Invoke) {
        try {
            WidgetPrefs.clearPendingTap(activity.applicationContext)
            invoke.resolve(result())
        } catch (e: Exception) {
            invoke.reject(e.message ?: "清除小组件点击失败")
        }
    }

    private fun result(): JSObject {
        val mgr = AppWidgetManager.getInstance(activity.applicationContext)
        val ids = mgr?.getAppWidgetIds(ComponentName(activity, TodoWidgetProvider::class.java))
        val out = JSObject()
        out.put("count", ids?.size ?: 0)
        out.put("attached", WidgetBridge.isAttached())
        return out
    }
}
