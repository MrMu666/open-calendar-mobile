package app.tauri.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.text.SpannableString
import android.text.Spanned
import android.text.style.StrikethroughSpan
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
        for (id in appWidgetIds) {
            try {
                appWidgetManager.updateAppWidget(id, buildViews(context, id))
            } catch (e: Exception) {
                // 单个实例失败不影响其它实例
            }
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action
        if (ACTION_OPEN_ITEM == action) {
            handleOpenItem(context, intent)
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

    private fun handleOpenItem(context: Context, intent: Intent) {
        val id = intent.getLongExtra(EXTRA_ITEM_ID, 0L)
        if (id != 0L) {
            // 点击回传只落盘：应用存活时由插件实例发事件即时打开，否则前端轮询兜底
            WidgetPrefs.setPendingTap(context, id)
            WidgetBridge.notifyPendingTap(context)
        }
        launchApp(context)
    }

    private fun launchApp(context: Context) {
        val pm = context.packageManager
        var intent = pm.getLaunchIntentForPackage(context.packageName)
        if (intent == null) {
            intent = Intent().setClassName(context.packageName, "${context.packageName}.MainActivity")
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
        /** 点击单条事项的广播 action（由 Kotlin 侧 PendingIntent 发出）。 */
        const val ACTION_OPEN_ITEM = "app.tauri.widget.ACTION_OPEN_ITEM"

        /** 请求应用重推数据的广播 action。 */
        const val ACTION_RESYNC = "app.tauri.widget.ACTION_RESYNC"

        private const val EXTRA_ITEM_ID = "item_id"

        private const val META_MAX_CHARS = 14
        private const val TITLE_MAX_CHARS = 22

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
            views.setInt(R.id.widget_date, "setTextColor", subColor)
            views.setInt(R.id.widget_footer, "setTextColor", subColor)
            views.setInt(R.id.widget_empty_text, "setTextColor", subColor)
            views.setInt(R.id.widget_progress, "setColorFilter", accent)

            val now = System.currentTimeMillis()
            views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_name))
            views.setTextViewText(R.id.widget_date, dayText(context, Date(now)))

            // 事项行：可见条数受 limit 限制（widgets 大小决定，设置页可调）
            views.removeAllViews(R.id.widget_items)
            val visible = payload.items.take(payload.limit)
            if (visible.isEmpty()) {
                views.setTextViewText(R.id.widget_count, "")
                views.setViewVisibility(R.id.widget_items, View.GONE)
                views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
                val syncing = WidgetPrefs.isSyncing(context)
                views.setViewVisibility(R.id.widget_progress, if (syncing) View.VISIBLE else View.GONE)
                views.setViewVisibility(R.id.widget_empty_text, if (syncing) View.GONE else View.VISIBLE)
                views.setTextViewText(R.id.widget_empty_text, context.getString(R.string.widget_empty))
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
            // 点击空白区域（非事项行）直接打开应用
            val openIntent = Intent(context, TodoWidgetProvider::class.java).setAction(ACTION_RESYNC)
            views.setOnClickPendingIntent(R.id.widget_root, PendingIntent.getBroadcast(
                context, appWidgetId, openIntent, pendingFlags()))

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
            row.setImageViewResource(
                R.id.widget_item_phase,
                if (done) R.drawable.widget_dot_done else R.drawable.widget_dot_active
            )

            // 优先级徽标：P1 红 / P2 橙 / P3 强调色 / P4 灰；已到期统一灰 + OK
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
            row.setTextViewText(R.id.widget_item_title, if (done) strike(title) else title)
            row.setInt(R.id.widget_item_title, "setTextColor", if (done) subColor else textColor)

            val metaText = if (item.longTerm) {
                context.getString(R.string.widget_long_term)
            } else {
                val whenText = "${dayText(context, Date(item.endAt))} ${timeText(Date(item.endAt))}"
                if (expired) "$whenText · ${context.getString(R.string.widget_expired)}" else whenText
            }
            val meta = if (metaText.length > META_MAX_CHARS) metaText.substring(metaText.length - META_MAX_CHARS) else metaText
            row.setTextViewText(R.id.widget_item_meta, meta)
            row.setInt(R.id.widget_item_meta, "setTextColor", subColor)

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

        /** 已到期事项标题加删除线（RemoteViews 只能传 CharSequence，用 Spannable 实现）。 */
        private fun strike(text: String): CharSequence {
            val spannable = SpannableString(text)
            spannable.setSpan(StrikethroughSpan(), 0, spannable.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            return spannable
        }

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
