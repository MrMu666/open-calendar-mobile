import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { listFolders } from 'tauri-plugin-scoped-storage-api';
import type { ScheduleEvent } from './types';
import { store } from './lib/store';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type UserSettings } from './lib/settings';
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

  /** 统一刷新入口：先归档过期事项（幂等），再通知各视图重载。 */
  const refresh = useCallback(() => {
    store
      .archiveExpiredItems()
      .catch(() => undefined)
      .then(() => setRefreshTick((t) => t + 1));
  }, []);

  useEffect(() => {
    store.onItemsChanged = refresh;
    store.onChange = refresh;
    // 先读设置（含数据目录），再按设置初始化存储
    void loadSettings().then(async (s) => {
      setSettings(s);
      if (s.storageMode === 'external' && s.folderId) {
        // 校验 SAF 句柄是否仍有效（用户可能已撤销授权 / 卸载重装插件状态丢失）
        const folders = await listFolders().catch(() => []);
        if (folders.some((f) => f.id === s.folderId)) {
          await store.setExternalFolder(s.folderId).catch(() => store.setRoot(DEFAULT_SETTINGS.dataDir));
          return;
        }
        // 句柄失效 → 回退应用数据目录并修正设置
        const fallback: UserSettings = { ...s, storageMode: 'appData', folderId: '' };
        setSettings(fallback);
        void saveSettings(fallback);
      }
      await store.setRoot(s.dataDir).catch(() => store.setRoot(DEFAULT_SETTINGS.dataDir));
    });
    return () => {
      store.onItemsChanged = null;
      store.onChange = null;
    };
  }, [refresh]);

  const updateSettings = useCallback((patch: Partial<UserSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      void saveSettings(next);
      return next;
    });
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
          <SettingsView settings={settings} onChange={updateSettings} refreshTick={refreshTick} />
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
