import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir } from '@tauri-apps/api/path';
import type { UserSettings } from '../lib/settings';
import { ACCENT_PRESETS, COLOR_PRESETS } from '../lib/settings';
import { store } from '../lib/store';

interface Props {
  settings: UserSettings;
  onChange: (patch: Partial<UserSettings>) => void;
  refreshTick: number;
}

/** 设置页：外观（背景色/透明度/强调色）+ 数据说明 + 关于。 */
export default function SettingsView({ settings, onChange, refreshTick }: Props) {
  const [dataDir, setDataDir] = useState('');
  const [itemCount, setItemCount] = useState<number | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    appDataDir()
      .then((p) => setDataDir(p))
      .catch(() => setDataDir('（不可用）'));
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

  return (
    <div className="view settings-view">
      <div className="settings-section">
        <div className="settings-title">外观</div>

        <div className="setting-row">
          <span className="setting-label">背景色</span>
          <div className="swatch-row">
            {COLOR_PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${settings.backgroundColor === c ? ' active' : ''}`}
                style={{ background: c }}
                aria-label={`背景色 ${c}`}
                onClick={() => onChange({ backgroundColor: c })}
              />
            ))}
          </div>
        </div>

        <div className="setting-row">
          <span className="setting-label">透明度 {Math.round(settings.backgroundOpacity * 100)}%</span>
          <input
            type="range"
            min={10}
            max={100}
            value={Math.round(settings.backgroundOpacity * 100)}
            onChange={(e) => onChange({ backgroundOpacity: Number(e.target.value) / 100 })}
          />
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
        <p className="settings-note">
          事项以 Markdown 文件保存在应用私有目录，结构与桌面版一致
          （items / archive / deleted），可整体拷贝迁移。
        </p>
        <div className="setting-info">
          <span className="setting-label">存储位置</span>
          <span className="setting-value mono">{dataDir}/calendar</span>
        </div>
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
