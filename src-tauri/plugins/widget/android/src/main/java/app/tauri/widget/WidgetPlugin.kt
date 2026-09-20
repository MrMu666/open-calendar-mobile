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
 *
 * 生命周期用构造参数里的 activity（子类自己的属性），不访问超类 Plugin 的
 * 私有 activity 字段；可见性由 onResume/onPause 维护（见 [WidgetBridge]）。
 */
@TauriPlugin
class WidgetPlugin(private val activity: Activity) : Plugin(activity) {

    init {
        WidgetBridge.attach(this, activity.applicationContext)
    }

    override fun load(webView: android.webkit.WebView) {
        // 冷启动兜底：应用一起来就重绘一次（沿用上次快照），并请求前端推送最新数据
        WidgetBridge.updateNow(activity.applicationContext)
        WidgetBridge.sync(force = true, persist = false)
    }

    /**
     * 回到前台：标记可见 + 重绘一次（可能停在旧快照），并向存活的前端要最新数据。
     * 注意签名：tauri 2.11.5 的 Plugin 只有无参 onResume()（onPause 同样无参）。
     */
    override fun onResume() {
        WidgetBridge.setForeground(true)
        WidgetBridge.updateNow(activity.applicationContext)
        WidgetBridge.sync(force = true, persist = false)
    }

    override fun onPause() {
        WidgetBridge.setForeground(false)
    }

    override fun onDestroy(activity: AppCompatActivity) {
        WidgetBridge.setForeground(false)
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

    /**
     * 附带诊断信息：小组件实例数、已落盘条目数、最近一次渲染失败原因。
     * launcher 进程里的渲染异常会被系统吞掉（桌面只剩空白框架），只能这样回传出来定位。
     */
    private fun result(): JSObject {
        val context = activity.applicationContext
        val mgr = AppWidgetManager.getInstance(context)
        val ids = mgr?.getAppWidgetIds(ComponentName(activity, TodoWidgetProvider::class.java))
        val out = JSObject()
        out.put("count", ids?.size ?: 0)
        out.put("attached", WidgetBridge.isAttached())
        out.put("items", WidgetPrefs.itemCount(context))
        out.put("lastError", WidgetPrefs.getLastError(context))
        // 探针：provider（launcher 进程）是否被系统拉起过，用于区分「没跑」与「跑了但渲染失败」
        out.put("providerUpdateAt", WidgetPrefs.lastProviderUpdateAt(context))
        out.put("providerUpdateIds", WidgetPrefs.lastProviderUpdateIds(context))
        return out
    }
}
