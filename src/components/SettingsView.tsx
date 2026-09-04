import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir } from '@tauri-apps/api/path';
import type { Theme, UserSettings } from '../lib/settings';
import { ACCENT_PRESETS, DEFAULT_SETTINGS } from '../lib/settings';
import { isAllFilesAccessGranted, openAllFilesAccessSettings } from '../lib/allFilesAccess';
import { sanitizeExternalPath, store } from '../lib/store';

interface Props {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  refreshTick: number;
}

/** 设置页：外观（亮/暗主题、强调色）+ 数据（存储目录）+ 关于。 */
export default function SettingsView({ settings, onChange, refreshTick }: Props) {
  const [appDir, setAppDir] = useState('');
  const [dirError, setDirError] = useState('');
  const [granted, setGranted] = useState<boolean | null>(null);
  const [pathDraft, setPathDraft] = useState(settings.externalPath);
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

  // external 模式下输入框跟随已保存路径
  useEffect(() => {
    setPathDraft(settings.externalPath);
  }, [settings.externalPath]);

  /** 跳系统设置页开启所有文件访问权限。 */
  const handleOpenSettings = async (): Promise<void> => {
    setDirError('');
    try {
      await openAllFilesAccessSettings();
    } catch (err) {
      setDirError(err instanceof Error ? err.message : '打开系统设置失败。');
    }
  };

  /** 使用输入的外部绝对路径（需先授权，路径不存在会自动创建 items/ 验证）。 */
  const handleUsePath = async (): Promise<void> => {
    setDirError('');
    try {
      const base = sanitizeExternalPath(pathDraft);
      if (granted !== true) {
        setDirError('请先开启所有文件访问权限。');
        return;
      }
      await store.setExternalPath(base);
      onChange({ storageMode: 'external', externalPath: base });
    } catch (err) {
      setDirError(err instanceof Error ? err.message : '切换目录失败。');
    }
  };

  /** 恢复默认：应用数据目录 / calendar。 */
  const handleReset = async (): Promise<void> => {
    setDirError('');
    try {
      await store.setRoot(DEFAULT_SETTINGS.dataDir);
      onChange({ storageMode: 'appData', dataDir: DEFAULT_SETTINGS.dataDir, externalPath: '' });
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
          <input
            className="input mono"
            inputMode="text"
            placeholder="/storage/emulated/0/Download"
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
          />
        </div>
        <div className="dir-row">
          <button type="button" className="btn small primary" onClick={() => void handleUsePath()}>
            使用该目录
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => setPathDraft('/storage/emulated/0/Download')}
          >
            Download
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => setPathDraft('/storage/emulated/0/Documents')}
          >
            Documents
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
      </div>
    </div>
  );
}
