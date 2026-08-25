import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { ScheduleEvent } from './types';
import { store } from './lib/store';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type UserSettings } from './lib/settings';
import { blendOverBlack } from './lib/format';
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
    void store.open();
    void loadSettings().then(setSettings);
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

  const panelBg = blendOverBlack(settings.backgroundColor, settings.backgroundOpacity);

  const style = {
    '--accent': settings.accentColor,
    '--accent-hover': settings.accentColor,
    '--panel-bg': panelBg,
  } as CSSProperties;

  return (
    <div className="app" style={style}>
      <main className="app-main">
        {tab === 'calendar' && (
          <CalendarView
            refreshTick={refreshTick}
            accentColor={settings.accentColor}
            onEdit={(e) => openEditor(e)}
            onNew={() => openEditor(null)}
          />
        )}
        {tab === 'tasks' && (
          <TasksView refreshTick={refreshTick} onEdit={(e) => openEditor(e)} onNew={() => openEditor(null)} />
        )}
        {tab === 'settings' && <SettingsView settings={settings} onChange={updateSettings} refreshTick={refreshTick} />}
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
