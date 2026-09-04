import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir } from '@tauri-apps/api/path';
import { getFolderInfo, isScopedStorageError, pickFolder } from 'tauri-plugin-scoped-storage-api';
import type { Theme, UserSettings } from '../lib/settings';
import { ACCENT_PRESETS, DEFAULT_SETTINGS } from '../lib/settings';
import { store } from '../lib/store';

interface Props {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  refreshTick: number;
}

/** 设置页：外观（亮/暗主题、强调色）+ 数据（存储目录）+ 关于。 */
export default function SettingsView({ settings, onChange, refreshTick }: Props) {
  const [appDir, setAppDir] = useState('');
  const [dirError, setDirError] = useState('');
  const [externalInfo, setExternalInfo] = useState<{ name: string; uri: string } | null>(null);
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [version, setVersion] = useState('');

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

  // external 模式下展示所选文件夹名称与 URI
  useEffect(() => {
    if (settings.storageMode !== 'external' || !settings.folderId) {
      setExternalInfo(null);
      return;
    }
    let cancelled = false;
    getFolderInfo(settings.folderId)
      .then((f) => {
        if (!cancelled) setExternalInfo({ name: f.name ?? '外部目录', uri: f.uri ?? '' });
      })
      .catch(() => {
        if (!cancelled) setExternalInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [settings.storageMode, settings.folderId]);

  /** 打开系统 SAF 目录选择器（从手机存储根开始），选定后切换为外部存储模式。 */
  const handlePickFolder = async (): Promise<void> => {
    setDirError('');
    try {
      const folder = await pickFolder();
      if (!folder) return;
      await store.setExternalFolder(folder.id);
      onChange({ storageMode: 'external', folderId: folder.id });
    } catch (err) {
      if (isScopedStorageError(err) && err.code === 'CANCELLED') return; // 用户取消，静默
      setDirError(err instanceof Error ? err.message : '选择文件夹失败。');
    }
  };

  /** 恢复默认：应用数据目录 / calendar。 */
  const handleReset = async (): Promise<void> => {
    setDirError('');
    try {
      await store.setRoot(DEFAULT_SETTINGS.dataDir);
      onChange({ storageMode: 'appData', dataDir: DEFAULT_SETTINGS.dataDir, folderId: '' });
    } catch (err) {
      setDirError(err instanceof Error ? err.message : '恢复默认目录失败。');
    }
  };

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
            {isExternal
              ? externalInfo
                ? `${externalInfo.name}（外部目录）`
                : '外部目录'
              : `应用数据 / ${settings.dataDir}`}
          </span>
        </div>
        {isExternal && externalInfo && (
          <div className="setting-info">
            <span className="setting-label">完整路径</span>
            <span className="setting-value mono">{externalInfo.uri}/items</span>
          </div>
        )}
        {!isExternal && appDir && (
          <div className="setting-info">
            <span className="setting-label">完整路径</span>
            <span className="setting-value mono">
              {appDir}/{settings.dataDir}/items
            </span>
          </div>
        )}
        <div className="dir-row">
          <button type="button" className="btn small primary" onClick={() => void handlePickFolder()}>
            选择目录…
          </button>
          <button type="button" className="btn small" onClick={() => void handleReset()}>
            恢复默认
          </button>
        </div>
        {dirError && <p className="editor-error">{dirError}</p>}
        <p className="settings-note">
          「选择目录…」会打开系统文件夹选择器，可浏览手机根目录及任意位置，选定后
          需要授予该文件夹的访问权限（仅限所选文件夹，可随时撤销）。事项以 Markdown
          文件保存在所选目录下（items / archive / deleted），结构与桌面版一致；
          切换目录后仅显示新目录中的事项，原目录数据保留在设备上。应用设置保存在
          独立的 settings.json，不随目录迁移。
        </p>
        <div className="setting-info">
          <span className="setting-label">未归档事项</span>
          <span className="setting-value">{itemCount === null ? '…' : itemCount} 条</span>
        </div>
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
            实时监听不可用：外部目录不支持文件监听，当前每 30
            秒轮询一次刷新；应用内修改会即时显示。
          </p>
        ) : (
          <p className="settings-note">
            实时监听启动失败，已降级为每 30 秒轮询刷新；应用内修改仍会即时显示。
          </p>
        )}
      </div>
    </div>
  );
}
