import type { ScheduleEvent } from '../types';
import { store } from './store';
import { loadSettings } from './settings';
import {
  buildWidgetPayload,
  pushWidget,
  refreshWidget,
  takePendingTapId,
  clearPendingTapId,
  widgetItemId,
  WIDGET_DEFAULT_LIMIT,
} from './widget';

/**
 * 应用侧同步逻辑：把内存缓存中的未归档事项推给安卓桌面小组件。
 *
 * 触发时机（见 App.tsx）：
 *   - store 打开/数据变化（应用内增删改、外部文件变动）
 *   - 主题 / 强调色 / 显示条数设置变化
 *   - 原生发来 widget://resync（应用回到前台、系统重启后恢复小组件）
 *   - 系统定时回调 onUpdate 只能读上一次快照，故快照必须随写随推
 */

/** 上次推送的内容指纹：设置或数据没变时不重复 IPC。 */
let lastFingerprint = '';
let inFlight: Promise<boolean> | null = null;

function fingerprint(
  items: ScheduleEvent[],
  settings: { theme: string; accentColor: string; widgetLimit: number },
): string {
  const head = `${settings.theme}|${settings.accentColor}|${settings.widgetLimit}`;
  const body = items
    .map(
      (e) =>
        `${e.fileName ?? e.id}|${e.title}|${e.priority}|${e.tags}|${e.startsAt}|${e.endsAt ?? ''}`,
    )
    .join('\n');
  return `${head}\n${body}`;
}

/**
 * 推送一次快照；force=true 时忽略指纹去重（设置页“立即刷新”）。
 * 返回是否真的推给了原生（无插件/桌面端返回 false）。
 */
export async function syncWidget(force = false): Promise<boolean> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const settings = await loadSettings();
      // 关闭推送：桌面保留最后一次快照（不覆盖、不清空）
      if (!settings.widgetEnabled) return false;
      // 未归档事项（store.getItems 内部按优先级排序）
      const items = await store.getItems();
      const limit = settings.widgetLimit > 0 ? settings.widgetLimit : WIDGET_DEFAULT_LIMIT;
      const fp = fingerprint(items, {
        theme: settings.theme,
        accentColor: settings.accentColor,
        widgetLimit: limit,
      });
      if (!force && fp === lastFingerprint) return false;
      const ok = await pushWidget(
        buildWidgetPayload(items, limit, settings.theme, settings.accentColor, items.length),
      );
      if (ok) lastFingerprint = fp;
      return ok;
    } catch {
      return false;
    }
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** 设置页“立即刷新”：先让桌面显示同步中，再强制推送。 */
export async function forceRefreshWidget(): Promise<void> {
  await refreshWidget();
  lastFingerprint = '';
  await syncWidget(true);
}

/** 指纹失效（切换数据目录等），下次 sync 必定重新推送。 */
export function resetWidgetFingerprint(): void {
  lastFingerprint = '';
}

/**
 * 消费一次桌面点击（应用在前台被拉起或事件到达时调用）。
 * 返回命中的事项；取到 id 但事项已不存在时一并清除，避免反复弹出。
 */
export async function consumePendingWidgetTap(): Promise<ScheduleEvent | null> {
  const id = await takePendingTapId();
  if (id == null) return null;

  const itemId = (e: ScheduleEvent): number => (e.fileName ? widgetItemId(e.fileName) : e.id);
  const items = await store.getItems();
  let hit = items.find((e) => itemId(e) === id) ?? null;
  if (!hit) {
    // 已归档事项不在 items/，再查一次含归档的范围
    try {
      const all = await store.getUpcoming(new Date(0), undefined, 2000);
      hit = all.find((e) => itemId(e) === id) ?? null;
    } catch {
      hit = null;
    }
  }
  // 无论是否命中都清除：避免反复弹出已不存在的事项
  await clearPendingTapId();
  return hit;
}
