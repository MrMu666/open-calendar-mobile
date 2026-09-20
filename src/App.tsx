import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ScheduleEvent } from './types';
import { store } from './lib/store';
import { isAllFilesAccessGranted } from './lib/allFilesAccess';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type UserSettings } from './lib/settings';
import {
  consumePendingWidgetTap,
  consumeWidgetNewItem,
  resetWidgetFingerprint,
  syncWidget,
} from './lib/widgetSync';
import { listenWidgetLaunch, listenWidgetNewItem, listenWidgetResync } from './lib/widget';
import CalendarView from './components/CalendarView';
import TasksView from './components/TasksView';
import SettingsView from './components/SettingsView';
import ItemEditor from './components/ItemEditor';
import TabBar from './components/TabBar';

export type Tab = 'calendar' | 'tasks' | 'settings';

/** 编辑器状态：null = 关闭；existing = 编辑该事项；existing=null = 新增。 */
interface EditorState {
  existing: ScheduleEvent | null;
}

export default function App() {
  const [tab, setTab] = useState<Tab>('calendar');
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const storeReady = useRef(false);
  /** 点击消费互斥：事件与 visibilitychange 可能同时触发，避免重复弹出。 */
  const consumingTap = useRef(false);

  /** 统一刷新入口：先归档过期事项（幂等），再通知各视图重载 + 同步桌面小组件。 */
  const refresh = useCallback(() => {
    store
      .archiveExpiredItems()
      .catch(() => undefined)
      .then(() => {
        setRefreshTick((t) => t + 1);
        // 桌面小组件快照随数据变化更新（无插件时静默失败）
        void syncWidget();
      });
  }, []);

  /**
   * 消费一次桌面点击（打开对应事项编辑器）。
   * 存储尚未初始化完成时直接返回，等 [storeReady] 就绪后的那次调用再消费，
   * 避免「点击小组件冷启动」时因缓存为空而丢掉这次点击。
   * refreshWhenMissing=true 时，事项已不存在的空点击也刷新一次列表。
   */
  const consumeWidgetTap = useCallback(async (refreshWhenMissing = false): Promise<void> => {
    if (!storeReady.current || consumingTap.current) return;
    consumingTap.current = true;
    try {
      const event = await consumePendingWidgetTap();
      if (event) {
        setEditor({ existing: event });
      } else if (refreshWhenMissing) {
        // 事项可能已被删除/归档：仅刷新一次列表，不弹编辑器
        setRefreshTick((t) => t + 1);
      }
    } finally {
      consumingTap.current = false;
    }
  }, []);

  /**
   * 消费一次小组件右上角「+」的新增请求：打开新增事项编辑器，
   * 与「事项页 → 新增事项」完全同一条路径（onNew = openEditor(null)）。
   */
  const consumeWidgetNew = useCallback(async (): Promise<void> => {
    if (!storeReady.current || consumingTap.current) return;
    consumingTap.current = true;
    try {
      const requested = await consumeWidgetNewItem();
      if (requested) {
        setEditor({ existing: null });
      }
    } finally {
      consumingTap.current = false;
    }
  }, []);

  useEffect(() => {
    store.onItemsChanged = refresh;
    store.onChange = refresh;
    // 先读设置（含数据目录），再按设置初始化存储
    void loadSettings().then(async (s) => {
      setSettings(s);
      let opened = false;
      if (s.storageMode === 'external' && s.externalPath) {
        // 外部直连需所有文件访问权限：无授权或路径不可用 → 回退应用数据目录
        const granted = await isAllFilesAccessGranted().catch(() => false);
        if (granted) {
          opened = await store.setExternalPath(s.externalPath).then(() => true, () => false);
        }
        if (!opened) {
          const fallback: UserSettings = { ...s, storageMode: 'appData', externalPath: '' };
          setSettings(fallback);
          void saveSettings(fallback);
        }
      }
      if (!opened) {
        await store.setRoot(s.dataDir).catch(() => store.setRoot(DEFAULT_SETTINGS.dataDir));
      }
      storeReady.current = true;
      // 冷启动：把最新快照推给桌面（覆盖上次退出前的旧数据）
      void syncWidget(true);
      // 若本次是被桌面小组件点击拉起的，补上这次点击（此时缓存已就绪，能定位事项）
      void consumeWidgetTap(true);
      // 也可能是点了右上角「+」拉起的：补开新增编辑器
      void consumeWidgetNew();
    });
    return () => {
      store.onItemsChanged = null;
      store.onChange = null;
    };
  }, [refresh, consumeWidgetTap, consumeWidgetNew]);

  // 桌面小组件事件：点击某条事项（应用存活时原生直接下发）+ 回到前台时请求重推数据
  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];

    void listenWidgetLaunch(() => {
      void consumeWidgetTap();
    }).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });

    // 右上角「+」：应用存活时原生直接下发，立即打开新增事项编辑器
    void listenWidgetNewItem(() => {
      void consumeWidgetNew();
    }).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });

    void listenWidgetResync(() => {
      void syncWidget(true);
    }).then((un) => {
      if (disposed) un();
      else unlisteners.push(un);
    });

    return () => {
      disposed = true;
      for (const un of unlisteners) un();
    };
  }, [consumeWidgetTap, consumeWidgetNew]);

  // 兜底：页面重新可见（从桌面点击拉起，但原生事件丢失）时消费一次待处理请求
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      void consumeWidgetTap();
      void consumeWidgetNew();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [consumeWidgetTap, consumeWidgetNew]);

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      // 外观/显示条数变化 → 桌面小组件立刻跟着变（强制推送，忽略指纹）
      void syncWidget(true);
      return next;
    });
  }, []);

  /** 切换数据目录后旧指纹失效，强制重推一次。 */
  const handleStorePathChanged = useCallback(() => {
    resetWidgetFingerprint();
    void syncWidget(true);
  }, []);

  const openEditor = useCallback((existing: ScheduleEvent | null = null) => {
    setEditor({ existing });
  }, []);

  const theme = settings.theme;
  const panelBg = theme === 'dark' ? 'rgb(13, 17, 23)' : 'rgb(245, 246, 248)';

  const style = {
    '--accent': settings.accentColor,
    '--accent-hover': settings.accentColor,
    '--panel-bg': panelBg,
  } as CSSProperties;

  return (
    <div className={`app theme-${theme}`} style={style}>
      <main className="app-main">
        {/* keep-alive：三栏常驻挂载、仅显隐，切 Tab 不卸载；数据经 store 内存缓存共享，后台即热 */}
        <div style={{ display: tab === 'calendar' ? '' : 'none' }}>
          <CalendarView
            refreshTick={refreshTick}
            accentColor={settings.accentColor}
            onEdit={(e) => openEditor(e)}
            onNew={() => openEditor(null)}
          />
        </div>
        <div style={{ display: tab === 'tasks' ? '' : 'none' }}>
          <TasksView refreshTick={refreshTick} onEdit={(e) => openEditor(e)} onNew={() => openEditor(null)} />
        </div>
        <div style={{ display: tab === 'settings' ? '' : 'none' }}>
          <SettingsView
            settings={settings}
            onChange={updateSettings}
            onStorePathChanged={handleStorePathChanged}
            refreshTick={refreshTick}
          />
        </div>
      </main>

      <TabBar tab={tab} onChange={setTab} />

      {editor && (
        <ItemEditor
          existing={editor.existing}
          onClose={() => setEditor(null)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
