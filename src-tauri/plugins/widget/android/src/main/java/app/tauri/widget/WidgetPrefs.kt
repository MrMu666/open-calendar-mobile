package app.tauri.widget

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/**
 * 小组件数据仓库：应用（Tauri/Kotlin 插件）推数据 → SharedPreferences → 桌面进程读。
 *
 * 桌面小组件跑在 launcher 进程里，无法访问应用私有目录里的 Markdown 文件，
 * 因此待办列表由前台应用按需“快照”到这里；条目自包含（含 phase/priority 判定结果），
 * 桌面侧只做渲染与相对时间计算。这里用标准 org.json（不加额外依赖），
 * 与 Tauri 的 JSObject/JSArray（同为其子类）完全兼容。
 */
object WidgetPrefs {

    private const val FILE = "open_calendar_widget"
    private const val KEY_PAYLOAD = "payload"
    private const val KEY_PENDING = "pending_tap"
    private const val KEY_PENDING_AT = "pending_tap_at"
    /** 应用正在刷新（小组件显示进度圈）标记。 */
    private const val KEY_SYNCING = "syncing"
    private const val KEY_SYNCING_AT = "syncing_at"
    /** 最近一次渲染失败原因（空 = 正常），设置页据此诊断小组件空白问题。 */
    private const val KEY_LAST_ERROR = "last_error"
    /** 探针：provider 侧最近一次 onUpdate 时间戳（0 = 从未被调用）。 */
    private const val KEY_LAST_UPDATE_AT = "last_update_at"
    /** 探针：provider 侧 onUpdate 收到的实例数。 */
    private const val KEY_LAST_UPDATE_IDS = "last_update_ids"

    /** 同步标记最长有效期：超时后桌面不再显示进度圈。 */
    private const val SYNC_TIMEOUT_MS = 20_000L

    /** 单条待办（字段与前端 widgetPayload 一一对应，ID 与 store.ts 的 makeId 一致）。 */
    data class WidgetItem(
        val id: Long,
        val title: String,
        val tags: String,
        val priority: Int,
        val startAt: Long,
        val endAt: Long,
        val longTerm: Boolean,
        /** active = 未到期；done = 已到期（灰色 + 删除线）。 */
        val phase: String,
        val note: String
    )

    /** 一次推送的完整快照。 */
    data class WidgetPayload(
        val items: List<WidgetItem>,
        val limit: Int,
        val theme: String,
        val accent: String,
        val truncated: Boolean,
        val updatedAt: Long,
        /** 上一次渲染失败原因（由渲染侧回写；非空时小组件会把它显示出来）。 */
        val lastError: String = ""
    )

    fun prefs(context: Context): SharedPreferences =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** 解析 Kotlin 插件收到的 JSON 载荷；字段缺失/非法时用安全默认值。 */
    fun saveFromJson(context: Context, json: String) {
        val root = try {
            JSONObject(json)
        } catch (e: Exception) {
            return
        }
        val rawItems = root.optJSONArray("items") ?: JSONArray()
        val items = ArrayList<WidgetItem>(rawItems.length())
        for (i in 0 until rawItems.length()) {
            val o = rawItems.optJSONObject(i) ?: continue
            val title = o.optString("title", "").trim()
            if (title.isEmpty()) continue
            val startAt = o.optLong("startAt", 0L)
            items.add(
                WidgetItem(
                    id = o.optLong("id", 0L),
                    title = title,
                    tags = o.optString("tags", "").trim(),
                    priority = o.optInt("priority", 3),
                    startAt = startAt,
                    endAt = o.optLong("endAt", startAt),
                    longTerm = o.optBoolean("longTerm", false),
                    phase = if (o.optString("phase", "active") == "done") "done" else "active",
                    note = o.optString("note", "")
                )
            )
        }

        val payload = JSONObject()
        try {
            val jsonItems = JSONArray()
            for (item in items) {
                val o = JSONObject()
                o.put("id", item.id)
                o.put("title", item.title)
                o.put("tags", item.tags)
                o.put("priority", item.priority)
                o.put("startAt", item.startAt)
                o.put("endAt", item.endAt)
                o.put("longTerm", item.longTerm)
                o.put("phase", item.phase)
                o.put("note", item.note)
                jsonItems.put(o)
            }
            payload.put("items", jsonItems)
            payload.put("limit", root.optInt("limit", DEFAULT_LIMIT).coerceIn(MIN_LIMIT, MAX_LIMIT))
            payload.put("theme", if (root.optString("theme", "light") == "dark") "dark" else "light")
            payload.put("accentColor", root.optString("accentColor", "").ifEmpty { "#4CAF50" })
            payload.put("truncated", root.optBoolean("truncated", false))
            payload.put("updatedAt", System.currentTimeMillis())
            payload.put("syncing", false)
        } catch (e: Exception) {
            return
        }

        prefs(context).edit()
            .putString(KEY_PAYLOAD, payload.toString())
            .putBoolean(KEY_SYNCING, false)
            .apply()
    }

    /** 已落盘快照；无数据或解析失败时返回空快照。 */
    fun load(context: Context): WidgetPayload {
        val raw = prefs(context).getString(KEY_PAYLOAD, null) ?: return emptyPayload()
        return try {
            val root = JSONObject(raw)
            val rawItems = root.optJSONArray("items") ?: JSONArray()
            val items = ArrayList<WidgetItem>(rawItems.length())
            for (i in 0 until rawItems.length()) {
                val o = rawItems.optJSONObject(i) ?: continue
                val startAt = o.optLong("startAt", 0L)
                items.add(
                    WidgetItem(
                        id = o.optLong("id", 0L),
                        title = o.optString("title", ""),
                        tags = o.optString("tags", ""),
                        priority = o.optInt("priority", 3),
                        startAt = startAt,
                        endAt = o.optLong("endAt", startAt),
                        longTerm = o.optBoolean("longTerm", false),
                        phase = if (o.optString("phase", "active") == "done") "done" else "active",
                        note = o.optString("note", "")
                    )
                )
            }
            WidgetPayload(
                items = items,
                limit = root.optInt("limit", DEFAULT_LIMIT).coerceIn(MIN_LIMIT, MAX_LIMIT),
                theme = if (root.optString("theme", "light") == "dark") "dark" else "light",
                accent = root.optString("accentColor", "").ifEmpty { "#4CAF50" },
                truncated = root.optBoolean("truncated", false),
                updatedAt = root.optLong("updatedAt", 0L),
                // 渲染侧失败原因写在这里，让小组件自己就能把它显示出来
                lastError = prefs(context).getString(KEY_LAST_ERROR, "") ?: ""
            )
        } catch (e: Exception) {
            emptyPayload()
        }
    }

    private fun emptyPayload(): WidgetPayload =
        WidgetPayload(
            items = emptyList(),
            limit = DEFAULT_LIMIT,
            theme = "light",
            accent = "#4CAF50",
            truncated = false,
            updatedAt = 0L
        )

    /** 应用正在刷新：桌面侧据此显示进度圈而不是“暂无待办”。 */
    fun setSyncing(context: Context, syncing: Boolean) {
        prefs(context).edit()
            .putBoolean(KEY_SYNCING, syncing)
            .putLong(KEY_SYNCING_AT, System.currentTimeMillis())
            .apply()
    }

    /**
     * 是否仍在同步：超过 [SYNC_TIMEOUT_MS] 未收到数据即视为已结束
     * （应用被杀死/推送失败时避免桌面永远显示进度圈）。
     */
    fun isSyncing(context: Context): Boolean {
        val p = prefs(context)
        if (!p.getBoolean(KEY_SYNCING, false)) return false
        val at = p.getLong(KEY_SYNCING_AT, 0L)
        if (at > 0 && System.currentTimeMillis() - at > SYNC_TIMEOUT_MS) {
            p.edit().putBoolean(KEY_SYNCING, false).apply()
            return false
        }
        return true
    }

    /** 桌面点击某条事项后写入（值为事项 id，与主应用 store.ts 的稳定 id 一致）。 */
    fun setPendingTap(context: Context, id: Long) {
        prefs(context).edit()
            .putLong(KEY_PENDING, id)
            .putLong(KEY_PENDING_AT, System.currentTimeMillis())
            .apply()
    }

    /** 取待处理点击；clear = true 时同时清除（应用已消费）。 */
    fun getPendingTap(context: Context, clear: Boolean): Long? {
        val p = prefs(context)
        val v = p.getLong(KEY_PENDING, 0L)
        if (v == 0L) return null
        if (clear) p.edit().remove(KEY_PENDING).apply()
        return v
    }

    fun clearPendingTap(context: Context) {
        prefs(context).edit().remove(KEY_PENDING).remove(KEY_PENDING_AT).apply()
    }

    /**
     * 记录/清除最近一次渲染失败原因。
     * launcher 进程里的异常会被系统吞掉（小组件只剩空白），所以必须自己留痕，
     * 由设置页读取展示，否则线上完全无法定位。
     */
    fun setLastError(context: Context, message: String?) {
        prefs(context).edit().putString(KEY_LAST_ERROR, message ?: "").apply()
    }

    fun getLastError(context: Context): String = prefs(context).getString(KEY_LAST_ERROR, "") ?: ""

    /**
     * 探针：provider 侧 onUpdate 是否真的被系统调用过。
     * 这一步写在最前面，即使后面渲染失败也能证明「组件已激活、代码已执行」，
     * 用于区分「provider 没跑」与「跑了但渲染失败」。
     */
    fun markProviderUpdate(context: Context, widgetCount: Int) {
        prefs(context).edit()
            .putLong(KEY_LAST_UPDATE_AT, System.currentTimeMillis())
            .putInt(KEY_LAST_UPDATE_IDS, widgetCount)
            .apply()
    }

    /** 探针读数：provider 最近一次 onUpdate 时间（0 = 从未调用）。 */
    fun lastProviderUpdateAt(context: Context): Long = prefs(context).getLong(KEY_LAST_UPDATE_AT, 0L)

    /** 探针读数：provider 最近一次 onUpdate 收到的实例数。 */
    fun lastProviderUpdateIds(context: Context): Int = prefs(context).getInt(KEY_LAST_UPDATE_IDS, 0)

    /** 已落盘快照的条目数（诊断用）。 */
    fun itemCount(context: Context): Int = load(context).items.size

    const val DEFAULT_LIMIT = 8
    const val MIN_LIMIT = 4
    const val MAX_LIMIT = 12
}
