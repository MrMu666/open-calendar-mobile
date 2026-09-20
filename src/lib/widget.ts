import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ScheduleEvent } from '../types';

/**
 * 安卓桌面小组件桥（本地插件 widget）。
 *
 * 小组件 UI 由原生 RemoteViews 绘制（src-tauri/plugins/widget/android），
 * 这里只负责：把待办快照推给原生 → 由原生落盘并立刻重绘桌面；
 * 以及取回桌面点击的事项 id（应用存活时另走事件即时打开）。
 * 桌面端 / dev（无插件）时 invoke 抛错，全部吞掉（与 allFilesAccess 一致）。
 */

const PLUGIN = 'plugin:widget';

/** 桌面点击某条事项的事件名（原生 WidgetBridge.EVENT_LAUNCH_ITEM）。 */
export const WIDGET_LAUNCH_EVENT = 'widget://launch-item';

/** 应用回到前台时原生请求重推数据的事件名（原生 WidgetBridge.EVENT_RESYNC）。 */
export const WIDGET_RESYNC_EVENT = 'widget://resync';

export type WidgetPhase = 'active' | 'done';

/** 单条待办（与 Kotlin WidgetPrefs.WidgetItem 字段一一对应）。 */
export interface WidgetItem {
  /** 与 store.ts makeId(fileName) 完全一致的稳定 id，用于点击回传定位事项。 */
  id: number;
  title: string;
  tags: string;
  /** 1..4（P1 最紧急）。 */
  priority: number;
  /** 截止时间毫秒时间戳（长期事项为哨兵值）。 */
  startAt: number;
  endAt: number;
  longTerm: boolean;
  phase: WidgetPhase;
  note: string;
}

/** 一次推送的完整快照。 */
export interface WidgetPayload {
  version: 1;
  /** 应用侧生成时间（毫秒）。 */
  updatedAt: number;
  /** 桌面最多显示条数（设置项，3×4 建议 6~12）。 */
  limit: number;
  /** 是否还有未显示的待办。 */
  truncated: boolean;
  theme: 'light' | 'dark';
  accentColor: string;
  items: WidgetItem[];
}

/** 长期事项哨兵：截止年份 2099（与 store.ts LONG_TERM_SENTINEL 一致）。 */
const LONG_TERM_YEAR = 2099;
const LONG_TERM_TS = new Date(LONG_TERM_YEAR, 0, 1, 12, 0, 0).getTime();

/** 与 store.ts 的 makeId 完全相同：由文件名生成稳定 id（点击回传据此定位事项）。 */
export function widgetItemId(fileName: string): number {
  let h = 0;
  const s = fileName.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

/** 事项 → 小组件条目（过期判定与主应用一致：非长期且截止已过 = 已到期）。 */
export function toWidgetItem(e: ScheduleEvent): WidgetItem {
  const start = new Date(e.startsAt);
  const longTerm = e.endsAt != null && new Date(e.endsAt).getFullYear() === LONG_TERM_YEAR;
  const end = longTerm ? new Date(LONG_TERM_TS) : e.endsAt ? new Date(e.endsAt) : start;
  const expired = !longTerm && end.getTime() < Date.now();
  return {
    id: e.fileName ? widgetItemId(e.fileName) : e.id,
    title: e.title,
    tags: e.tags,
    priority: e.priority,
    startAt: start.getTime(),
    endAt: end.getTime(),
    longTerm,
    phase: expired ? 'done' : 'active',
    note: e.notes.replace(/\s+/g, ' ').trim(),
  };
}

/** 按优先级（P1 在前）→ 截止时间排序，与事项列表一致（store.getItems 已排序，此处兜底）。 */
export function sortWidgetItems(items: WidgetItem[]): WidgetItem[] {
  return [...items].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.endAt - b.endAt,
  );
}

/**
 * 组装快照：未归档事项 → 条目，按优先级（P1 在前）→ 截止时间排序，取前 limit 条。
 * total 传事项总数（超出 limit 时 truncated=true，桌面显示「+N 项待办」）；
 * 长标题在原生侧统一截断，这里只做条目级别的裁剪。
 */
export function buildWidgetPayload(
  items: ScheduleEvent[],
  limit: number,
  theme: 'light' | 'dark',
  accentColor: string,
  total = items.length,
): WidgetPayload {
  const mapped = sortWidgetItems(items.map(toWidgetItem));
  const shown = mapped.slice(0, limit);
  return {
    version: 1,
    updatedAt: Date.now(),
    limit,
    truncated: total > shown.length,
    theme,
    accentColor,
    items: shown,
  };
}

/** 推送快照到原生并立即重绘桌面；失败静默（无插件/桌面端）。 */
export async function pushWidget(payload: WidgetPayload): Promise<boolean> {
  try {
    await invoke(`${PLUGIN}|update`, { payload: JSON.stringify(payload) });
    return true;
  } catch {
    return false;
  }
}

/** 标记“正在同步”并重绘（列表为空时桌面显示进度圈），返回当前小组件实例数。 */
export async function refreshWidget(): Promise<number> {
  try {
    const r = await invoke<{ count?: number }>(`${PLUGIN}|refresh`);
    return r?.count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * 取回桌面点击的事项 id；未点击返回 null。
 * clear=true 时立即清除（消费成功），失败重试时传 false 以免丢事件。
 */
export async function takePendingTapId(clear = true): Promise<number | null> {
  try {
    const r = await invoke<{ id?: number }>(`${PLUGIN}|pendingTap`, { clear });
    const id = r?.id ?? 0;
    return id === 0 ? null : id;
  } catch {
    return null;
  }
}

/** 清除待处理点击（事项已找到/已忽略）。 */
export async function clearPendingTapId(): Promise<void> {
  try {
    await invoke(`${PLUGIN}|clearPendingTap`);
  } catch {
    // 无插件（桌面/dev）时忽略
  }
}

/** 监听原生事件（应用存活时点击某条事项）；无插件时返回 no-op。 */
export async function listenWidgetLaunch(
  handler: (id: number) => void,
): Promise<UnlistenFn> {
  try {
    return await listen<{ id?: number }>(WIDGET_LAUNCH_EVENT, (event) => {
      const id = event.payload?.id ?? 0;
      if (id !== 0) handler(id);
    });
  } catch {
    return () => undefined;
  }
}

/** 监听原生“请重推数据”事件（应用回到前台时）。 */
export async function listenWidgetResync(handler: () => void): Promise<UnlistenFn> {
  try {
    return await listen(WIDGET_RESYNC_EVENT, () => handler());
  } catch {
    return () => undefined;
  }
}

export const WIDGET_DEFAULT_LIMIT = 8;
export const WIDGET_LIMIT_OPTIONS = [6, 8, 10, 12] as const;
