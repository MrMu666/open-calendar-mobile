import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir } from '@tauri-apps/api/path';
import type { Theme, UserSettings } from '../lib/settings';
import { ACCENT_PRESETS, DEFAULT_SETTINGS } from '../lib/settings';
import { isAllFilesAccessGranted, openAllFilesAccessSettings } from '../lib/allFilesAccess';
import { store } from '../lib/store';
import { WIDGET_LIMIT_OPTIONS, widgetStatus, type WidgetStatus } from '../lib/widget';
import { forceRefreshWidget } from '../lib/widgetSync';
import FolderPicker, { EXTERNAL_ROOT } from './FolderPicker';

/** 把原生侧状态转成给用户看的一行诊断文本。 */
function describeWidgetStatus(status: WidgetStatus): string {
  const parts = [`桌面小组件 ${status.count} 个`, `已推送 ${status.items} 条`];
  // 探针：区分「系统从未拉起组件」与「拉起了但渲染失败」
  if (status.items > 0 || status.lastError) {
    parts.push(
      status.providerUpdateAt > 0
        ? `组件已激活（收到 ${status.providerUpdateIds} 个实例）`
        : '组件从未被系统激活',
    );
  }
  if (status.lastError) parts.push(`渲染报错：${status.lastError}`);
  // 待处理请求：可判断「+ / 点击」有没有写进去、应用有没有消费
  if (status.newItem) parts.push('有未处理的「+」新增请求');
  if (status.pendingTap) parts.push('有未处理的点击事项请求');
  // 「+」流水线：点了加号后这四项应依次 +1，卡在哪个数字就说明断在哪一环
  if (status.plusBroadcast > 0) {
    parts.push(
      `「+」链路 广播${status.plusBroadcast}/登记${status.plusRegistered}/事件${status.plusEvent}/消费${status.plusConsumed}`,
    );
  }
  return parts.join(' · ');
}

interface Props {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  /** 数据目录切换完成：通知上层失效桌面小组件指纹并重推。 */
  onStorePathChanged: () => void;
  refreshTick: number;
}

/** 设置页：外观（亮/暗主题、强调色）+ 数据（存储目录）+ 桌面小组件 + 关于。 */
export default function SettingsView({ settings, onChange, onStorePathChanged, refreshTick }: Props) {
  const [appDir, setAppDir] = useState('');
  const [dirError, setDirError] = useState('');
  const [granted, setGranted] = useState<boolean | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [version, setVersion] = useState('');
  const [widgetMsg, setWidgetMsg] = useState('');
  /** 存储诊断：模式 / 根目录 / 内存缓存条数 / 磁盘条数（定位「切目录后列表为空」）。 */
  const [storeDiag, setStoreDiag] = useState('');

  useEffect(() => {
    let cancelled = false;
    void store.debugSnapshot().then((s) => {
      if (cancelled) return;
      setStoreDiag(
        `${s.mode === 'external' ? '外部目录' : '应用数据'} ${s.root}｜内存缓存 ${s.cacheCount < 0 ? '未建立' : `${s.cacheCount} 条`}｜磁盘 ${s.diskCount < 0 ? `读取失败(${s.diskError})` : `${s.diskCount} 条`}`,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick, settings.storageMode, settings.dataDir, settings.externalPath]);

  useEffect(() => {
    appDataDir()
      .then((p) => setAppDir(p))
      .catch(() => setAppDir(''));
    getVersion()
      .then(setVersion)
      .catch(() => setVersion(''));
  }, []);

  useEffect(() => {
    let cancelled = false;
    store.count().then((n) => {
      if (!cancelled) setItemCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // 所有文件访问授权状态：挂载/刷新时查一次，从系统设置页返回时（页面重新可见）再查
  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void isAllFilesAccessGranted().then((g) => {
        if (!cancelled) setGranted(g);
      });
    };
    check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshTick]);

  /** 使用目录浏览器选定的外部绝对路径（选择器只产出合法路径，setExternalPath 再做可用性验证）。 */
  const handlePick = async (absPath: string): Promise<void> => {
    setDirError('');
    setPickerOpen(false);
    try {
      await store.setExternalPath(absPath);
      onChange({ storageMode: 'external', externalPath: absPath });
      onStorePathChanged();
    } catch (err) {
      setDirError(err instanceof Error ? err.message : '切换目录失败。');
    }
  };

  /** 跳系统设置页开启所有文件访问权限。 */
  const handleOpenSettings = async (): Promise<void> => {
    setDirError('');
    try {
      await openAllFilesAccessSettings();
    } catch (err) {
      setDirError(err instanceof Error ? err.message : '打开系统设置失败。');
    }
  };

  /** 打开目录浏览器（需先授权）。 */
  const handleOpenPicker = (): void => {
    setDirError('');
    if (granted !== true) {
      setDirError('请先开启所有文件访问权限。');
      return;
    }
    setPickerOpen(true);
  };

  /** 恢复默认：应用数据目录 / calendar。 */
  const handleReset = async (): Promise<void> => {
    setDirError('');
    try {
      await store.setRoot(DEFAULT_SETTINGS.dataDir);
      onChange({ storageMode: 'appData', dataDir: DEFAULT_SETTINGS.dataDir, externalPath: '' });
      onStorePathChanged();
    } catch (err) {
      setDirError(err instanceof Error ? err.message : '恢复默认目录失败。');
    }
  };

  /** 立即把当前数据与外观推给桌面小组件（强制，忽略指纹），并回显状态供诊断。 */
  const handleWidgetRefresh = async (): Promise<void> => {
    setWidgetMsg('推送中…');
    try {
      const status = await forceRefreshWidget();
      if (!status) {
        setWidgetMsg('推送失败：当前环境没有桌面小组件插件（桌面端 / 开发环境）');
        return;
      }
      setWidgetMsg(describeWidgetStatus(status));
    } catch (err) {
      setWidgetMsg(err instanceof Error ? err.message : '推送失败。');
    }
  };

  // 进入设置页 / 数据变化后刷新一次小组件状态（含渲染报错，用于排查桌面空白）
  useEffect(() => {
    let cancelled = false;
    void widgetStatus().then((s) => {
      if (cancelled || !s) return;
      setWidgetMsg(describeWidgetStatus(s));
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  const isExternal = settings.storageMode === 'external';

  return (
    <div className="view settings-view">
      <div className="settings-section">
        <div className="settings-title">外观</div>

        <div className="setting-row">
          <span className="setting-label">主题</span>
          <div className="theme-toggle" role="group" aria-label="主题">
            {(['dark', 'light'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`theme-option${settings.theme === t ? ' active' : ''}`}
                onClick={() => onChange({ theme: t })}
              >
                {t === 'dark' ? '暗色' : '亮色'}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <span className="setting-label">强调色</span>
          <div className="swatch-row">
            {ACCENT_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${settings.accentColor === c ? ' active' : ''}`}
                style={{ background: c }}
                aria-label={`强调色 ${c}`}
                onClick={() => onChange({ accentColor: c })}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-title">数据</div>
        <div className="setting-info">
          <span className="setting-label">存储目录</span>
          <span className="setting-value mono">
            {isExternal ? `${settings.externalPath || '（未设置）'}（外部目录）` : `应用数据 / ${settings.dataDir}`}
          </span>
        </div>
        {!isExternal && appDir && (
          <div className="setting-info">
            <span className="setting-label">完整路径</span>
            <span className="setting-value mono">
              {appDir}/{settings.dataDir}/items
            </span>
          </div>
        )}
        <div className="setting-info">
          <span className="setting-label">所有文件访问</span>
          <span className="setting-value">
            {granted === null ? '检测中…' : granted ? '已授权' : '未授权'}
          </span>
        </div>
        {granted !== true && (
          <div className="dir-row">
            <button type="button" className="btn small primary" onClick={() => void handleOpenSettings()}>
              去系统设置开启…
            </button>
          </div>
        )}
        <div className="setting-info">
          <span className="setting-label">外部目录</span>
          <span className="setting-value mono">{settings.externalPath || '（未设置）'}</span>
        </div>
        <div className="dir-row">
          <button type="button" className="btn small primary" onClick={handleOpenPicker}>
            选择目录…
          </button>
          <button type="button" className="btn small" onClick={() => void handleReset()}>
            恢复默认
          </button>
        </div>
        {dirError && <p className="editor-error">{dirError}</p>}
        <p className="settings-note">
          外部目录通过绝对路径直接访问（需先开启所有文件访问权限），监听与应用数据
          目录同级实时生效。事项以 Markdown 文件保存在所选目录下
          （items / archive / deleted），结构与桌面版一致；切换目录后仅显示新目录
          中的事项，原目录数据保留在设备上。应用设置保存在独立的 settings.json，
          不随目录迁移。
        </p>
        <div className="setting-info">
          <span className="setting-label">未归档事项</span>
          <span className="setting-value">{itemCount === null ? '…' : itemCount} 条</span>
        </div>
        {storeDiag && <p className="settings-note mono">存储状态：{storeDiag}</p>}
      </div>

      <div className="settings-section">
        <div className="settings-title">桌面小组件</div>

        <div className="setting-row">
          <span className="setting-label">数据推送</span>
          <div className="theme-toggle" role="group" aria-label="桌面小组件数据推送">
            {([true, false] as boolean[]).map((on) => (
              <button
                key={String(on)}
                type="button"
                className={`theme-option${settings.widgetEnabled === on ? ' active' : ''}`}
                onClick={() => onChange({ widgetEnabled: on })}
              >
                {on ? '开启' : '关闭'}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <span className="setting-label">显示条数</span>
          <div className="theme-toggle" role="group" aria-label="桌面小组件显示条数">
            {WIDGET_LIMIT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                className={`theme-option${settings.widgetLimit === n ? ' active' : ''}`}
                onClick={() => onChange({ widgetLimit: n })}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="dir-row">
          <button type="button" className="btn small primary" onClick={() => void handleWidgetRefresh()}>
            立即推送数据
          </button>
          {widgetMsg && <span className="setting-value">{widgetMsg}</span>}
        </div>

        <p className="settings-note">
          桌面小组件是安卓原生桌面元素（3×4、半透明），需在系统桌面的「添加小组件」
          里手动添加；本应用只负责把待办快照推给它。显示未归档事项（按优先级排序，
          最多 {settings.widgetLimit} 条），点击某条直接打开对应事项，点击空白处打开应用。
          关闭推送后桌面保留最后一次快照；主题与强调色会同步到小组件。
        </p>
      </div>

      <div className="settings-section">
        <div className="settings-title">关于</div>
        <div className="setting-info">
          <span className="setting-label">版本</span>
          <span className="setting-value">{version || '—'}</span>
        </div>
        <p className="settings-note">
          日程移动端 · 桌面版「日程桌面」的移动端复刻。
        </p>
      </div>

      <div className="settings-section">
        <div className="settings-title">文件监视</div>
        {store.getWatchStatus() === 'watch' ? (
          <p className="settings-note">
            实时监听已生效：事项目录变化会即时刷新。
          </p>
        ) : isExternal ? (
          <p className="settings-note">
            实时监听不可用：外部目录未授权或监听启动失败，当前每 30
            秒轮询一次刷新；应用内修改会即时显示。
          </p>
        ) : (
          <p className="settings-note">
            实时监听启动失败，已降级为每 30 秒轮询刷新；应用内修改仍会即时显示。
          </p>
        )}
        {store.getWatchStatus() !== 'watch' && store.getWatchError() && (
          <p className="settings-note mono">监听失败原因：{store.getWatchError()}</p>
        )}
      </div>

      {pickerOpen && (
        <FolderPicker
          initialPath={settings.externalPath || EXTERNAL_ROOT}
          onPick={(p) => void handlePick(p)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
