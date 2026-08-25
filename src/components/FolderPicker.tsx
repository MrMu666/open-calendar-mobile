import { useCallback, useEffect, useState } from 'react';
import { BaseDirectory, mkdir, readDir } from '@tauri-apps/plugin-fs';
import { sanitizeRootPath } from '../lib/store';

interface Props {
  /** 当前数据根目录（相对应用数据目录，如 "calendar"）。 */
  initialPath: string;
  /** 用户确认选择某目录（参数为相对应用数据目录的路径，非空）。 */
  onPick: (relPath: string) => void;
  onClose: () => void;
}

/**
 * 应用内文件夹选择器（底部弹层）：浏览应用数据目录下的子目录，
 * 可进入/返回上级/新建文件夹，确认后选择为事项存储目录。
 *
 * 说明：Tauri v2 的 dialog/fs 插件在 Android 上不支持系统 SAF 目录选择
 * （无持久权限、content:// 不可读写），故采用应用内目录浏览。
 */
export default function FolderPicker({ initialPath, onPick, onClose }: Props) {
  const [path, setPath] = useState(initialPath);
  const [dirs, setDirs] = useState<string[]>([]);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (rel: string) => {
    try {
      const entries = await readDir(rel || '.', { baseDir: BaseDirectory.AppData });
      setDirs(
        entries
          .filter((e) => e.isDirectory)
          .map((e) => e.name)
          .sort((a, b) => a.localeCompare(b, 'zh-CN')),
      );
    } catch {
      setDirs([]);
    }
  }, []);

  useEffect(() => {
    setPath(initialPath);
  }, [initialPath]);

  useEffect(() => {
    setError('');
    void load(path);
  }, [path, load]);

  const segments = path ? path.split('/') : [];

  const goTo = (index: number) => {
    setPath(segments.slice(0, index + 1).join('/'));
  };

  const goUp = () => {
    if (!path) return;
    const idx = path.lastIndexOf('/');
    setPath(idx < 0 ? '' : path.slice(0, idx));
  };

  const createFolder = async () => {
    const name = newName.trim();
    if (!name) {
      setError('请输入文件夹名称');
      return;
    }
    try {
      const target = path ? `${path}/${name}` : name;
      sanitizeRootPath(target);
      await mkdir(target, { baseDir: BaseDirectory.AppData, recursive: true });
      setNewName('');
      setPath(target);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建文件夹失败');
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <span>选择存储目录</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        {/* 面包屑 */}
        <div className="picker-crumbs">
          <button type="button" className={`crumb${!path ? ' current' : ''}`} onClick={() => setPath('')}>
            应用数据
          </button>
          {segments.map((seg, i) => (
            <span key={`${seg}-${i}`} className="crumb-wrap">
              <span className="crumb-sep">/</span>
              <button
                type="button"
                className={`crumb${i === segments.length - 1 ? ' current' : ''}`}
                onClick={() => goTo(i)}
              >
                {seg}
              </button>
            </span>
          ))}
        </div>

        {/* 新建文件夹 */}
        <div className="dir-row">
          <input
            className="dir-input"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              setError('');
            }}
            placeholder="新建文件夹名称"
            aria-label="新建文件夹名称"
          />
          <button type="button" className="btn small" onClick={() => void createFolder()}>
            新建
          </button>
        </div>

        {/* 目录列表 */}
        <div className="picker-list">
          {path && (
            <button type="button" className="picker-item" onClick={goUp}>
              <span>↑ 返回上级</span>
            </button>
          )}
          {dirs.length === 0 && <div className="empty-text">（当前目录下没有子文件夹）</div>}
          {dirs.map((d) => (
            <button key={d} type="button" className="picker-item" onClick={() => setPath(path ? `${path}/${d}` : d)}>
              <span className="picker-folder">📁 {d}</span>
              <span className="picker-chevron">›</span>
            </button>
          ))}
        </div>

        {error && <div className="editor-error">{error}</div>}

        <p className="settings-note">
          选择后，事项将保存在「应用数据/{path || '…'}」目录下（items / archive / deleted）。
          原目录的数据会保留在设备上，可随时切换回来。
        </p>

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" disabled={!path} onClick={() => onPick(path)}>
            选择此目录
          </button>
        </div>
      </div>
    </div>
  );
}
