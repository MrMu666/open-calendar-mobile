package app.tauri.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 3×4 半透明待办小组件（传统 RemoteViews 方案，无 Glance/Compose 依赖）。
 *
 * 数据来源：前台应用通过 Tauri 插件把待办快照写入 SharedPreferences
 * （见 [WidgetPrefs]）；桌面侧只负责渲染 + 相对时间计算，不访问应用私有目录。
 *
 * 刷新时机：
 *   - 应用内数据/设置变化 → [WidgetBridge.pushFromJson]
 *   - 应用回到前台/冷启动 → 向存活前端发 [WidgetBridge.EVENT_RESYNC]，由前端推送
 *   - 系统按 updatePeriodMillis（30 分钟）回调 [onUpdate] 兜底刷新相对时间
 *   - 点击某条事项 → 写入 pending tap 并按需发事件，然后拉起应用
 */
class TodoWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        // 探针写在最前：即使后面渲染失败，也能证明 provider 被系统拉起过
        try {
            WidgetPrefs.markProviderUpdate(context, appWidgetIds.size)
        } catch (e: Exception) {
            Log.w(TAG, "写入 onUpdate 探针失败", e)
        }
        for (id in appWidgetIds) {
            try {
                appWidgetManager.updateAppWidget(id, buildViewsSafe(context, id))
            } catch (e: Exception) {
                // 单个实例失败不影响其它实例
                recordError(context, e)
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (ACTION_OPEN_ITEM == action) {
            handleOpenItem(context, intent)
            return
        }
        if (ACTION_NEW_ITEM == action) {
            handleNewItem(context)
            return
        }
        if (ACTION_RESYNC == action) {
            // 系统重启/桌面恢复小组件，或应用启动时：先重绘 + 请求前端推新数据
            WidgetBridge.updateNow(context)
            WidgetBridge.sync(force = false, persist = false)
            return
        }
        super.onReceive(context, intent)
    }

    /** 右上角「+」：登记新增请求 → 拉起应用（应用存活时另发事件，前端立即开编辑器）。 */
    private fun handleNewItem(context: Context) {
        // 流水线第 1 步：广播确实到达了 provider（如果这个不增长，说明点击没走到这里）
        try {
            WidgetPrefs.notePlusStage(context, "broadcast")
            WidgetPrefs.requestNewItem(context)
            WidgetPrefs.notePlusStage(context, "registered")
        } catch (e: Exception) {
            Log.w(TAG, "写入新增事项请求失败", e)
        }
        WidgetBridge.notifyNewItem(context)
        launchApp(context, openNewItem = true)
    }

    private fun handleOpenItem(context: Context, intent: Intent) {
        val id = intent.getLongExtra(EXTRA_ITEM_ID, 0L)
        if (id != 0L) {
            // 点击回传只落盘：应用存活时由插件实例发事件即时打开，否则前端轮询兜底
            WidgetPrefs.setPendingTap(context, id)
            WidgetBridge.notifyPendingTap(context)
        }
        launchApp(context)
    }

    private fun launchApp(context: Context, openNewItem: Boolean = false) {
        val pm = context.packageManager
        var intent = pm.getLaunchIntentForPackage(context.packageName)
        if (intent == null) {
            intent = Intent().setClassName(context.packageName, "${context.packageName}.MainActivity")
        }
        if (openNewItem) {
            // 除了 SharedPreferences 标记，再带一个 Intent extra：
            // 应用启动/回到前台时由 WidgetPlugin 读 activity.intent，作为第二条可靠通道
            intent.putExtra(EXTRA_OPEN_NEW_ITEM, true)
        }
        intent.addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_SINGLE_TOP or
                Intent.FLAG_ACTIVITY_CLEAR_TOP
        )
        try {
            context.startActivity(intent)
        } catch (e: Exception) {
            // 桌面点击拉起失败（极少数 ROM 限制后台启动）时忽略
        }
    }

    companion object {
        private const val TAG = "OpenCalendarWidget"

        /** 点击单条事项的广播 action（由 Kotlin 侧 PendingIntent 发出）。 */
        const val ACTION_OPEN_ITEM = "app.tauri.widget.ACTION_OPEN_ITEM"

        /** 请求应用重推数据的广播 action。 */
        const val ACTION_RESYNC = "app.tauri.widget.ACTION_RESYNC"

        /** 点击右上角「+」新增事项的广播 action。 */
        const val ACTION_NEW_ITEM = "app.tauri.widget.ACTION_NEW_ITEM"

        /** 拉起应用时附带的 extra：本次应打开「新增事项」（第二条可靠通道）。 */
        const val EXTRA_OPEN_NEW_ITEM = "app.tauri.widget.EXTRA_OPEN_NEW_ITEM"

        private const val EXTRA_ITEM_ID = "item_id"
        private const val EXTRA_WIDGET_ID = "widget_id"

        /** 「+」按钮的 PendingIntent requestCode 基址，避开事项行（appWidgetId*100+index）。 */
        private const val ADD_REQUEST_CODE_BASE = 900_000

        // 标题截断：行内不再显示时间，宽度全给标题，故可放宽到 28 字（配合 maxLines=2）
        private const val TITLE_MAX_CHARS = 28

        /**
         * 渲染并捕获异常：launcher 进程里的崩溃会被系统静默吞掉（桌面只剩空白框架），
         * 所以这里必须把原因写进 SharedPreferences，供设置页展示诊断。
         */
        fun buildViewsSafe(context: Context, appWidgetId: Int): RemoteViews? {
            return try {
                val views = buildViews(context, appWidgetId)
                WidgetPrefs.setLastError(context, null)
                views
            } catch (e: Throwable) {
                recordError(context, e)
                null
            }
        }

        /** 记录渲染失败原因（带上类名，便于区分是哪个 RemoteViews 动作不支持）。 */
        fun recordError(context: Context, e: Throwable) {
            val message = "${e.javaClass.simpleName}: ${e.message ?: "(无消息)"}"
            Log.e(TAG, "小组件渲染失败", e)
            try {
                WidgetPrefs.setLastError(context, message)
            } catch (ignored: Exception) {
                // 连错误都写不进去时只能靠 logcat
            }
        }

        /** 渲染一个小组件实例（也供 [WidgetBridge] 主动刷新使用）。 */
        fun buildViews(context: Context, appWidgetId: Int): RemoteViews {
            val payload = WidgetPrefs.load(context)
            val dark = payload.theme == "dark"
            val views = RemoteViews(context.packageName, R.layout.widget_todo)

            val textColor = color(context, if (dark) R.color.widget_text_dark else R.color.widget_text_light)
            val subColor = color(context, if (dark) R.color.widget_subtext_dark else R.color.widget_subtext_light)
            val rowBg = if (dark) R.drawable.widget_row_bg else R.drawable.widget_row_bg_light
            val accent = parseColor(payload.accent, color(context, R.color.widget_priority_p3))

            views.setInt(R.id.widget_card, "setBackgroundResource",
                if (dark) R.drawable.widget_card_bg else R.drawable.widget_card_bg_light)
            views.setInt(R.id.widget_divider, "setBackgroundColor",
                color(context, if (dark) R.color.widget_divider_dark else R.color.widget_divider_light))
            views.setInt(R.id.widget_title, "setTextColor", textColor)
            views.setInt(R.id.widget_count, "setTextColor", accent)
            views.setInt(R.id.widget_footer, "setTextColor", subColor)
            views.setInt(R.id.widget_empty_text, "setTextColor", subColor)
            // 右上角「+」：贴强调色圆底 + 白色图标
            // （图标用 vector + setImageViewResource；之前用 TextView 的「+」在圆底里
            //   受字体度量影响不居中，也不好看）
            views.setInt(R.id.widget_add, "setBackgroundResource", R.drawable.widget_add_bg)
            views.setInt(R.id.widget_add, "setBackgroundColor", accent)
            // 图标染色（白）是可选项：ImageView#setColorFilter 不带 @RemotableViewMethod，
            // 一旦不受支持会抛 ActionException 让整次 apply 作废，所以单独兜底；
            // 失败也不影响可用性（矢量图标本身就是白色）。
            try {
                views.setInt(R.id.widget_add, "setColorFilter", textColor)
            } catch (e: Exception) {
                Log.w(TAG, "「+」图标染色失败，使用默认白色", e)
            }
            // 注意：这里**不能**用 setInt(..., "setColorFilter", ...) 给进度圈染色。
            // ImageView#setColorFilter 没有 @RemotableViewMethod 标注，
            // launcher 侧 ReflectionAction.apply() 会抛 ActionException，
            // 而**一个 action 失败会让整次 apply 作废**（桌面只剩空白底、点击也失效）——已踩坑。
            // 进度圈颜色直接用 widget_spinner_ring.xml 里的固定色。

            val now = System.currentTimeMillis()
            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_name))
            // 原先右上角显示「今天」，改为「+」新增按钮（相对时间移到每条事项上）

            // 事项行：可见条数受 limit 限制（widgets 大小决定，设置页可调）
            views.removeAllViews(R.id.widget_items)
            val visible = payload.items.take(payload.limit)
            if (visible.isEmpty()) {
                // 自证：显示「已推送 N 条」——0 条说明数据没到原生侧，>0 条说明数据到了但没渲染出来
                views.setTextViewText(
                    R.id.widget_count,
                    if (payload.updatedAt > 0) "已推送 ${payload.items.size} 条" else "未收到数据"
                )
                views.setViewVisibility(R.id.widget_items, View.GONE)
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
                // 渲染过报错时把原因直接显示在小组件上（launcher 进程的异常系统会吞，
                // 用户没有 logcat，只能这样自曝原因）
                val error = payload.lastError
                val syncing = error.isEmpty() && WidgetPrefs.isSyncing(context)
                views.setViewVisibility(R.id.widget_progress, if (syncing) View.VISIBLE else View.GONE)
                views.setViewVisibility(R.id.widget_empty_text, if (syncing) View.GONE else View.VISIBLE)
                views.setTextViewText(
                    R.id.widget_empty_text,
                    if (error.isNotEmpty()) "渲染错误：$error" else context.getString(R.string.widget_empty)
                )
                views.setInt(
                    R.id.widget_empty_text,
                    "setTextColor",
                    if (error.isNotEmpty()) color(context, R.color.widget_phase_active) else subColor
                )
            } else {
                views.setViewVisibility(R.id.widget_items, View.VISIBLE)
                views.setViewVisibility(R.id.widget_empty, View.GONE)
                val active = payload.items.count { it.phase != "done" }
                views.setTextViewText(R.id.widget_count, context.getString(R.string.widget_active_count, active))
                for ((index, item) in visible.withIndex()) {
                    views.addView(
                        R.id.widget_items,
                        buildRow(context, appWidgetId, index, item, rowBg, textColor, subColor, accent, now)
                    )
                }
            }

            // 底部：截断提示
            val hidden = payload.items.size - visible.size
            if (hidden > 0 && visible.isNotEmpty()) {
                views.setTextViewText(R.id.widget_footer, context.getString(R.string.widget_more, hidden))
                views.setViewVisibility(R.id.widget_footer, View.VISIBLE)
            } else {
                views.setViewVisibility(R.id.widget_footer, View.GONE)
            }
            // 点击空白区域（非事项行、非「+」）直接打开应用
            val openIntent = Intent(context, TodoWidgetProvider::class.java).setAction(ACTION_RESYNC)
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getBroadcast(
                context, appWidgetId, openIntent, pendingFlags()))

            // 右上角「+」：等同应用内「事项页 → 新增事项」
            val addIntent = Intent(context, TodoWidgetProvider::class.java)
                .setAction(ACTION_NEW_ITEM)
                .putExtra(EXTRA_WIDGET_ID, appWidgetId)
            views.setOnClickPendingIntent(
                R.id.widget_add,
                PendingIntent.getBroadcast(context, ADD_REQUEST_CODE_BASE + appWidgetId, addIntent, pendingFlags())
            )

            return views
        }

        private fun buildRow(
            context: Context,
            appWidgetId: Int,
            index: Int,
            item: WidgetPrefs.WidgetItem,
            rowBg: Int,
            textColor: Int,
            subColor: Int,
            accent: Int,
            now: Long
        ): RemoteViews {
            val row = RemoteViews(context.packageName, R.layout.widget_todo_row)
            val done = item.phase == "done"
            val expired = !item.longTerm && item.endAt in 1 until now

            row.setInt(R.id.widget_item_row, "setBackgroundResource", rowBg)

            // 优先级徽标：P1 红 / P2 橙 / P3 强调色 / P4 灰；已到期统一灰 + OK。
            // 行首的 P 标记本身就是圆点（widget_item_priority 用 widget_badge_bg 圆角底 +
            // 同色文字），所以不再单放状态点——避免一个红点与 P1/P2 分级色不一致。
            val badgeColor = if (done || expired) {
                color(context, R.color.widget_priority_p4)
            } else {
                when (item.priority) {
                    1 -> color(context, R.color.widget_priority_p1)
                    2 -> color(context, R.color.widget_priority_p2)
                    3 -> accent
                    else -> color(context, R.color.widget_priority_p4)
                }
            }
            row.setTextViewText(
                R.id.widget_item_priority,
                if (done) context.getString(R.string.widget_done_badge) else "P${item.priority.coerceIn(1, 4)}"
            )
            row.setInt(R.id.widget_item_priority, "setTextColor", badgeColor)

            val title = if (item.title.length > TITLE_MAX_CHARS) {
                item.title.take(TITLE_MAX_CHARS) + "…"
            } else {
                item.title
            }
            // 刻意不用 SpannableString 删除线：跨进程传递 span 属非标准用法，
            // 一旦 launcher 侧拒绝会连累整次 apply 作废（同 setColorFilter 的坑）。
            // 已到期用灰色 + 「OK」徽标区分。
            row.setTextViewText(R.id.widget_item_title, title)
            row.setInt(R.id.widget_item_title, "setTextColor", if (done) subColor else textColor)

            // 时间行已去掉：3x4 空间有限，标题优先（相对时间仍用于「已推送」等头部/空态文案）

            // 点击该行：广播回 provider（启动应用 + 记录待打开事项）
            val clickIntent = Intent(context, TodoWidgetProvider::class.java)
                .setAction(ACTION_OPEN_ITEM)
                .putExtra(EXTRA_ITEM_ID, item.id)
            row.setOnClickPendingIntent(
                R.id.widget_item_row,
                PendingIntent.getBroadcast(context, appWidgetId * 100 + index, clickIntent, pendingFlags())
            )
            return row
        }

        private fun pendingFlags(): Int =
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE

        /** 取色：Context.getColor 自 API 23 起可用（minSdk 24），无需 androidx 依赖。 */
        private fun color(context: Context, resId: Int): Int = context.getColor(resId)

        /** 十六进制颜色（#RGB/#RRGGBB/#AARRGGBB）解析，非法回退 fallback。 */
        private fun parseColor(hex: String, fallback: Int): Int =
            try {
                Color.parseColor(hex)
            } catch (e: Exception) {
                fallback
            }

        private val DAY_FORMAT = SimpleDateFormat("M月d日", Locale.CHINA)
        private val TIME_FORMAT = SimpleDateFormat("HH:mm", Locale.CHINA)

        private fun timeText(date: Date): String = TIME_FORMAT.format(date)

        /** 相对日期：今天 / 明天 / 昨天 / 其它 M月d日（文案取自 strings.xml，便于本地化）。 */
        private fun dayText(context: Context, date: Date): String {
            val day = Calendar.getInstance().apply {
                time = date
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            val today = Calendar.getInstance().apply {
                set(Calendar.HOUR_OF_DAY, 0)
                set(Calendar.MINUTE, 0)
                set(Calendar.SECOND, 0)
                set(Calendar.MILLISECOND, 0)
            }.timeInMillis
            return when (day - today) {
                0L -> context.getString(R.string.widget_today)
                DAY_MS -> context.getString(R.string.widget_tomorrow)
                -DAY_MS -> context.getString(R.string.widget_yesterday)
                else -> DAY_FORMAT.format(date)
            }
        }

        private const val DAY_MS = 24L * 60 * 60 * 1000
    }
}
