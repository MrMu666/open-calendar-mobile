import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir } from '@tauri-apps/api/path';
import type { Theme, UserSettings } from '../lib/settings';
import { ACCENT_PRESETS, DEFAULT_SETTINGS } from '../lib/settings';
import { sanitizeRootPath, store } from '../lib/store';

interface Props {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  refreshTick: number;
}

/** 设置页：外观（亮/暗主题、强调色）+ 数据（存储目录）+ 关于。 */
export default function SettingsView({ settings, onChange, refreshTick }: Props) {
  const [appDir, setAppDir] = useState('');
  const [dirInput, setDirInput] = useState(settings.dataDir);
  const [dirError, setDirError] = useState('');
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
    setDirInput(settings.dataDir);
    setDirError('');
  }, [settings.dataDir]);

  useEffect(() => {
    let cancelled = false;
    store.count().then((n) => {
      if (!cancelled) setItemCount(n);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  /** 切换数据目录：净化校验 → 重建 store 根目录 → 保存设置。 */
  const applyDir = async (name: string): Promise<void> => {
    try {
      const cleaned = sanitizeRootPath(name);
      await store.setRoot(cleaned);
      setDirInput(cleaned);
      setDirError('');
      onChange({ dataDir: cleaned });
    } catch (err) {
      setDirError(err instanceof Error ? err.message : '目录名不合法。');
    }
  };

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
          <span className="setting-value mono">{settings.dataDir}</span>
        </div>
        <div className="dir-row">
          <input
            className="dir-input"
            value={dirInput}
            onChange={(e) => {
              setDirInput(e.target.value);
              setDirError('');
            }}
            placeholder="如 calendar"
            aria-label="存储目录名"
          />
          <button type="button" className="btn small primary" onClick={() => void applyDir(dirInput)}>
            切换
          </button>
          <button type="button" className="btn small" onClick={() => void applyDir(DEFAULT_SETTINGS.dataDir)}>
            恢复默认
          </button>
        </div>
        {dirError && <p className="editor-error">{dirError}</p>}
        {appDir && (
          <div className="setting-info">
            <span className="setting-label">完整路径</span>
            <span className="setting-value mono">
              {appDir}/{settings.dataDir}/items
            </span>
          </div>
        )}
        <p className="settings-note">
          事项以 Markdown 文件保存在应用数据目录下的指定子目录（items / archive / deleted），
          结构与桌面版一致。切换目录后仅显示新目录中的事项，原目录数据保留在设备上；
          应用设置保存在独立的 settings.json，不随目录迁移。
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
    </div>
  );
}
