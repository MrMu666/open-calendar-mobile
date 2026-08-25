import {
  BaseDirectory,
  exists,
  mkdir,
  readDir,
  readTextFile,
  remove,
  rename,
  watch,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import type { ScheduleEvent } from '../types';
import { formatFileTime } from './format';

/**
 * 文件夹存储 —— 桌面端 CalendarApp.Data.FolderItemStore 的移动端移植。
 * 数据规则与桌面端完全一致（见根目录 存储目录设计.md）：
 *
 *   calendar/items/YYYYMMDD-HHmmss_YYYYMMDD-HHmmss_P<级别>_<净化标题>[_<标签>].md
 *   calendar/archive/YYYY/  —— 截止时间已过的事项，按开始年份归档
 *   calendar/deleted/       —— 用户删除（软删除）的事项
 *
 * 与桌面端差异：
 *   - 桌面端可任选磁盘文件夹；移动端在应用数据目录（$APPDATA）下由用户指定
 *     任意子目录作为数据根目录（默认 calendar），应用设置单独存于 $APPDATA/settings.json，
 *     目录结构与文件格式一致，数据可直接拷贝迁移。
 *   - 桌面端用 FileSystemWatcher 监听 items/ 外部改动；移动端用
 *     @tauri-apps/plugin-fs 自带的 watch（notify 后端，300ms 去抖），
 *     并额外提供轮询兜底 + 每次写操作后主动通知刷新。
 */

/** 默认数据根目录（应用数据目录下的子目录，可被用户随意指定）。 */
export const DEFAULT_ROOT = 'calendar';

/**
 * 净化用户输入的数据根目录：统一斜杠、去首尾空白与斜杠；
 * 拒绝空值、`.`/`..`、Windows 非法字符。返回规范化的相对路径。
 */
export function sanitizeRootPath(input: string): string {
  const cleaned = input
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
  if (!cleaned) {
    throw new Error('目录名不能为空。');
  }
  for (const seg of cleaned.split('/')) {
    if (!seg || seg === '.' || seg === '..' || /[\\:*?"<>|]/.test(seg)) {
      throw new Error(`目录名「${seg}」不合法，请使用字母、数字、中文或 - _ 。`);
    }
  }
  return cleaned;
}

/** 长期事项哨兵年份（与桌面端 MarkLongTerm 一致）。 */
export const LONG_TERM_SENTINEL = new Date(2099, 0, 1, 12, 0, 0);

/** 净化文件名字段：替换非法字符为空格、折叠空白（桌面端 SanitizeSegment）。 */
export function sanitizeSegment(value: string): string {
  if (!value.trim()) return '';
  const chars = value.trim().split('');
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c.charCodeAt(0) < 32 || /[\\/:*?"<>|_]/.test(c)) {
      chars[i] = ' ';
    }
  }
  return chars.join('').replace(/\s+/g, ' ').trim();
}

/** 解析文件名时间段 "yyyyMMdd-HHmmss" 为本地时间；非法返回 null。 */
function parseTimePart(part: string): Date | null {
  if (part.length !== 15 || part[8] !== '-') return null;
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(part);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const h = +m[4];
  const mi = +m[5];
  const s = +m[6];
  const dt = new Date(y, mo - 1, d, h, mi, s);
  // 回读校验，拒绝 2 月 30 日这类不存在的日期
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** 从文件名生成稳定 id（非持久化，仅作 React key）。 */
function makeId(fileName: string): number {
  let h = 0;
  const s = fileName.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h >>> 0;
}

function isExpired(item: ScheduleEvent): boolean {
  return item.endsAt != null && new Date(item.endsAt).getTime() < Date.now();
}

/** 排序：开始时间 → 标题（桌面端 GetUpcoming）。 */
function byStart(a: ScheduleEvent, b: ScheduleEvent): number {
  const byStart = new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
  return byStart !== 0 ? byStart : a.title.localeCompare(b.title, 'zh-CN');
}

/** 排序：优先级（P1 在前）→ 开始时间（桌面端 GetItems）。 */
function byPriority(a: ScheduleEvent, b: ScheduleEvent): number {
  const byPriority = a.priority - b.priority;
  return byPriority !== 0 ? byPriority : new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime();
}

class FolderStore {
  private unwatch: (() => void) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reloadTimer: ReturnType<typeof setTimeout> | null = null;

  /** 当前数据根目录（相对 $APPDATA，如 "calendar"），可被用户指定。 */
  private root = DEFAULT_ROOT;
  private itemsDir = `${DEFAULT_ROOT}/items`;
  private archiveDir = `${DEFAULT_ROOT}/archive`;
  private deletedDir = `${DEFAULT_ROOT}/deleted`;

  /** 存储目录打开/切换后触发（初始化后立即触发一次）。 */
  onChange: (() => void) | null = null;

  /** items/ 目录内容变化后触发（去抖），含应用外部改动。 */
  onItemsChanged: (() => void) | null = null;

  /** 当前数据根目录（相对 $APPDATA）。 */
  getRoot(): string {
    return this.root;
  }

  /**
   * 初始化 / 切换数据根目录：净化目录名、重建目录、重启监听，
   * 完成后触发 onChange（App 借此刷新各视图）。
   */
  async setRoot(root: string): Promise<void> {
    const cleaned = sanitizeRootPath(root);
    this.root = cleaned;
    this.itemsDir = `${cleaned}/items`;
    this.archiveDir = `${cleaned}/archive`;
    this.deletedDir = `${cleaned}/deleted`;
    await this.open();
  }

  async open(): Promise<void> {
    this.stopWatching();
    await mkdir(this.itemsDir, { baseDir: BaseDirectory.AppData, recursive: true });
    await mkdir(this.deletedDir, { baseDir: BaseDirectory.AppData, recursive: true });

    // 监听 items/ 目录（notify 后端，300ms 去抖，对应桌面端 FileSystemWatcher）
    try {
      this.unwatch = await watch(
        this.itemsDir,
        () => this.scheduleReload(),
        { baseDir: BaseDirectory.AppData, recursive: false, delayMs: 300 },
      );
    } catch (err) {
      // 某些 Android 文件系统上 notify 可能不可用：降级为轮询兜底
      console.warn('items 目录监听启动失败，降级为轮询刷新：', err);
      this.unwatch = null;
    }

    if (!this.unwatch) {
      this.startPolling();
    }

    this.onChange?.();
  }

  /** 停止目录监听与轮询（切换根目录前调用）。 */
  private stopWatching(): void {
    this.unwatch?.();
    this.unwatch = null;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /** 未删除事项，开始时间落在 [from, to)，含归档项（桌面端 GetUpcoming）。 */
  async getUpcoming(from: Date, to?: Date, limit = 100): Promise<ScheduleEvent[]> {
    const result: ScheduleEvent[] = [];
    for (const file of await this.enumerateAllFiles()) {
      const item = await this.parseItemFile(file.path, file.name);
      if (!item) continue;
      const start = new Date(item.startsAt);
      if (start < from) continue;
      if (to && start >= to) continue;
      result.push(item);
      if (result.length >= limit) break;
    }
    result.sort(byStart);
    return result;
  }

  /** 指定本地日历日当天的所有未删除事项（桌面端 GetEventsOnDay）。 */
  async getEventsOnDay(day: Date): Promise<ScheduleEvent[]> {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    return this.getUpcoming(start, end, 500);
  }

  /** 所有未删除事项（仅 items/，未过期项），按优先级排序（桌面端 GetItems）。 */
  async getItems(): Promise<ScheduleEvent[]> {
    const result: ScheduleEvent[] = [];
    for (const file of await this.enumerateItemFiles()) {
      const item = await this.parseItemFile(file.path, file.name);
      if (item) result.push(item);
    }
    result.sort(byPriority);
    return result;
  }

  /** 新增事项：写入 items/，返回文件名（桌面端 Insert）。 */
  async insert(item: ScheduleEvent): Promise<string> {
    const fileName = await this.writeItemFile(item, this.itemsDir);
    this.notifyChanged();
    return fileName;
  }

  /**
   * 更新事项：无论文件当前在 items/ 还是 archive/YYYY/，都重写到
   * 新截止时间对应的位置（桌面端 Update）。
   */
  async update(oldItem: ScheduleEvent, newItem: ScheduleEvent): Promise<string> {
    await this.deleteItemFileAnywhere(oldItem);
    const directory = isExpired(newItem) ? await this.getArchiveDirectory(newItem) : this.itemsDir;
    const fileName = await this.writeItemFile(newItem, directory);
    this.notifyChanged();
    return fileName;
  }

  /** 软删除：把文件移入 deleted/（桌面端 MoveToDeleted）。 */
  async moveToDeleted(item: ScheduleEvent): Promise<string | null> {
    if (!item.fileName) return null;
    const source = await this.findItemFile(item);
    if (!source) return null;

    await mkdir(this.deletedDir, { baseDir: BaseDirectory.AppData, recursive: true });
    const destination = await this.uniquePath(`${this.deletedDir}/${item.fileName}`);
    await rename(source, destination, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
    this.notifyChanged();
    return destination;
  }

  /** 把 items/ 中截止已过的事项移入 archive/YYYY/（幂等，桌面端 ArchiveExpiredItems）。 */
  async archiveExpiredItems(): Promise<void> {
    let changed = false;
    for (const file of await this.enumerateItemFiles()) {
      const item = await this.parseItemFile(file.path, file.name);
      if (!item || !isExpired(item)) continue;

      const directory = await this.getArchiveDirectory(item);
      await mkdir(directory, { baseDir: BaseDirectory.AppData, recursive: true });
      const destination = await this.uniquePath(`${directory}/${file.name}`);
      await rename(file.path, destination, {
        oldPathBaseDir: BaseDirectory.AppData,
        newPathBaseDir: BaseDirectory.AppData,
      });
      changed = true;
    }
    if (changed) this.notifyChanged();
  }

  /** 设定截止为长期哨兵（2099-01-01 12:00）并重写文件（桌面端 MarkLongTerm）。 */
  async markLongTerm(item: ScheduleEvent): Promise<void> {
    const updated: ScheduleEvent = {
      ...item,
      endsAt: LONG_TERM_SENTINEL.toISOString(),
    };
    await this.update(item, updated);
  }

  /** 把截止移到过去 1 秒，列表刷新后隐藏（桌面端 MarkCompleted）。 */
  async markCompleted(item: ScheduleEvent): Promise<void> {
    const updated: ScheduleEvent = {
      ...item,
      endsAt: new Date(Date.now() - 1000).toISOString(),
    };
    await this.update(item, updated);
  }

  async count(): Promise<number> {
    return (await this.enumerateItemFiles()).length;
  }

  // ── 内部实现 ──────────────────────────────────────────────

  private async writeItemFile(item: ScheduleEvent, directory: string): Promise<string> {
    const startsAt = new Date(item.startsAt);
    const endsAt = item.endsAt ? new Date(item.endsAt) : startsAt;
    const priority = item.priority >= 1 && item.priority <= 4 ? item.priority : 3;
    const title = sanitizeSegment(item.title);
    const tags = sanitizeSegment(item.tags);

    if (!title) {
      throw new Error('事项标题不能为空。');
    }

    const startPart = formatFileTime(startsAt);
    const endPart = formatFileTime(endsAt);
    const baseName = tags
      ? `${startPart}_${endPart}_P${priority}_${title}_${tags}`
      : `${startPart}_${endPart}_P${priority}_${title}`;

    // 冲突（同一秒 + 同标题 + 同标签）时加后缀，绝不静默覆盖
    const fileName = await this.uniquePath(`${directory}/${baseName}.md`);
    await mkdir(directory, { baseDir: BaseDirectory.AppData, recursive: true });
    await writeTextFile(fileName, item.notes ?? '', { baseDir: BaseDirectory.AppData });
    return fileName;
  }

  /** 目标路径已存在时追加时间后缀（桌面端 "_HHmmssfff" 思路）。 */
  private async uniquePath(relPath: string): Promise<string> {
    if (!(await exists(relPath, { baseDir: BaseDirectory.AppData }))) {
      return relPath;
    }
    const dot = relPath.lastIndexOf('.');
    const stem = dot > 0 ? relPath.slice(0, dot) : relPath;
    const ext = dot > 0 ? relPath.slice(dot) : '';
    const now = new Date();
    const suffix = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(
      now.getSeconds(),
    ).padStart(2, '0')}${String(now.getMilliseconds()).padStart(3, '0')}`;
    return `${stem}_${suffix}${ext}`;
  }

  private async getArchiveDirectory(item: ScheduleEvent): Promise<string> {
    const year = new Date(item.startsAt).getFullYear();
    return `${this.archiveDir}/${year}`;
  }

  /** 在 items/ 和所有 archive/YYYY/ 中查找文件，返回相对 $APPDATA 的路径。 */
  private async findItemFile(item: ScheduleEvent): Promise<string | null> {
    if (!item.fileName) return null;
    const inItems = `${this.itemsDir}/${item.fileName}`;
    if (await exists(inItems, { baseDir: BaseDirectory.AppData })) {
      return inItems;
    }
    for (const dir of await this.enumerateArchiveDirectories()) {
      const path = `${dir}/${item.fileName}`;
      if (await exists(path, { baseDir: BaseDirectory.AppData })) {
        return path;
      }
    }
    return null;
  }

  private async deleteItemFileAnywhere(item: ScheduleEvent): Promise<void> {
    const path = await this.findItemFile(item);
    if (!path) return;
    await remove(path, { baseDir: BaseDirectory.AppData });
  }

  /** items/ 下所有 .md 文件。 */
  private async enumerateItemFiles(): Promise<{ path: string; name: string }[]> {
    return this.listMd(this.itemsDir);
  }

  /** items/ + 所有 archive/YYYY/ 下的 .md 文件（桌面端 EnumerateAllFiles）。 */
  private async enumerateAllFiles(): Promise<{ path: string; name: string }[]> {
    const all = await this.listMd(this.itemsDir);
    for (const dir of await this.enumerateArchiveDirectories()) {
      all.push(...(await this.listMd(dir)));
    }
    return all;
  }

  private async enumerateArchiveDirectories(): Promise<string[]> {
    try {
      const entries = await readDir(this.archiveDir, { baseDir: BaseDirectory.AppData });
      return entries.filter((e) => e.isDirectory).map((e) => `${this.archiveDir}/${e.name}`);
    } catch {
      return [];
    }
  }

  private async listMd(dir: string): Promise<{ path: string; name: string }[]> {
    try {
      const entries = await readDir(dir, { baseDir: BaseDirectory.AppData });
      return entries
        .filter((e) => e.isFile && e.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({ path: `${dir}/${e.name}`, name: e.name }));
    } catch {
      return [];
    }
  }

  /** 解析单个事项文件（桌面端 TryParseItemFile）。 */
  private async parseItemFileInternal(path: string, fileName: string): Promise<ScheduleEvent | null> {
    const baseName = fileName.endsWith('.md') ? fileName.slice(0, -3) : fileName;
    const parts = baseName.split('_');
    if (parts.length < 4) return null;

    const start = parseTimePart(parts[0]);
    const end = parseTimePart(parts[1]);
    if (!start || !end) return null;

    let priority = 3;
    const p = parts[2];
    if (p.length >= 2 && (p[0] === 'P' || p[0] === 'p')) {
      const n = parseInt(p.slice(1), 10);
      if (!Number.isNaN(n)) priority = n;
    }

    const title = parts[3];
    const tags = parts.length >= 5 ? parts.slice(4).join('_') : '';

    let notes = '';
    try {
      notes = await readTextFile(path, { baseDir: BaseDirectory.AppData });
    } catch {
      notes = '';
    }

    return {
      id: makeId(fileName),
      fileName,
      title,
      notes,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      priority,
      tags,
      allDay: false,
      location: '',
      createdAt: start.toISOString(),
      updatedAt: end.toISOString(),
    };
  }

  private async parseItemFile(path: string, fileName: string): Promise<ScheduleEvent | null> {
    try {
      return await this.parseItemFileInternal(path, fileName);
    } catch (err) {
      console.warn('解析事项文件失败：', path, err);
      return null;
    }
  }

  /** 外部文件变化去抖通知（桌面端 300ms Timer）。 */
  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => this.onItemsChanged?.(), 300);
  }

  private notifyChanged(): void {
    // 应用内写操作：直接触发刷新（无需等 watcher）
    this.onItemsChanged?.();
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      // 移动端无桌面文件管理器场景，30s 兜底足够
      this.onItemsChanged?.();
    }, 30_000);
  }
}

/** 模块级单例（对应桌面端 AppServices.Items）。 */
export const store = new FolderStore();
