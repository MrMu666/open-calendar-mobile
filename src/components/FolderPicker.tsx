import { useCallback, useEffect, useState } from 'react';
import { mkdir, readDir } from '@tauri-apps/plugin-fs';

interface Props {
  /** 打开时的初始目录（非法时回退到共享存储根）。 */
  initialPath: string;
  /** 用户确认使用当前目录。 */
  onPick: (absPath: string) => void;
  onClose: () => void;
}

/** 共享存储根：目录浏览不允许越过此级。 */
export const EXTERNAL_ROOT = '/storage/emulated/0';

/** 非法文件夹名片段（Android 文件名禁用字符 + 相对路径）。 */
function sanitizeFolderName(input: string): string {
  const name = input.trim();
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\0]/.test(name)) {
    throw new Error('文件夹名不合法。');
  }
  return name;
}

/** 应用内目录浏览器（底部弹层）：绝对路径导航 + 新建 + 确认。 */
export default function FolderPicker({ initialPath, onPick, onClose }: Props) {
  const start =
    initialPath.startsWith(EXTERNAL_ROOT + '/') || initialPath === EXTERNAL_ROOT
      ? initialPath.replace(/\/+$/g, '') || EXTERNAL_ROOT
      : EXTERNAL_ROOT;
  const [cwd, setCwd] = useState(start);
  const [dirs, setDirs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');

  const load = useCallback(async (dir: string) => {
    setLoading(true);
    setError('');
    try {
      const entries = await readDir(dir);
      const sub = entries
        .filter((e) => e.isDirectory && e.name)
        .map((e) => e.name as string)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
      setDirs(sub);
      setCwd(dir);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取目录失败，请先开启所有文件访问权限。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goParent = () => {
    if (cwd === EXTERNAL_ROOT) return;
    const parent = cwd.slice(0, cwd.lastIndexOf('/')) || EXTERNAL_ROOT;
    void load(parent.startsWith(EXTERNAL_ROOT) ? parent : EXTERNAL_ROOT);
  };

  const handleMkdir = async () => {
    setError('');
    try {
      const name = sanitizeFolderName(newName);
      await mkdir(`${cwd}/${name}`);
      setNewName('');
      await load(cwd);
    } catch (err) {
      setError(err instanceof Error ? err.message : '新建文件夹失败。');
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <span>选择目录</span>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="dir-path mono">{cwd}</div>
        <div className="dir-list">
          {cwd !== EXTERNAL_ROOT && (
            <button type="button" className="dir-item" onClick={goParent}>
              <span>↑ 上一级</span>
            </button>
          )}
          {loading ? (
            <div className="empty-text">读取中…</div>
          ) : dirs.length === 0 ? (
            <div className="empty-text">空文件夹</div>
          ) : (
            dirs.map((d) => (
              <button
                key={d}
                type="button"
                className="dir-item"
                onClick={() => void load(`${cwd}/${d}`)}
              >
                <span>📁 {d}</span>
              </button>
            ))
          )}
        </div>
        <div className="new-folder-row">
          <input
            className="input"
            placeholder="新建文件夹名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="button" className="btn small" onClick={() => void handleMkdir()}>
            新建
          </button>
        </div>
        {error && <p className="editor-error">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={() => onPick(cwd)}>
            使用当前目录
          </button>
        </div>
      </div>
    </div>
  );
}
