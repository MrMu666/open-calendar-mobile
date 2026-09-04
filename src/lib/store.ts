import {
  BaseDirectory,
  exists as fsExists,
  mkdir as fsMkdir,
  readDir as fsReadDir,
  readTextFile as fsReadTextFile,
  remove as fsRemove,
  rename as fsRename,
  stat as fsStat,
  watch,
  writeTextFile as fsWriteTextFile,
} from '@tauri-apps/plugin-fs';
import type { ScheduleEvent } from '../types';
import { formatFileTime } from './format';

/**
 * 文件夹存储 —— 桌面端 CalendarApp.Data.FolderItemStore 的移动端移植。
 * 数据规则与桌面端完全一致（见根目录 存储目录设计.md）：
 *
 *   <root>/items/YYYYMMDD-HHmmss_YYYYMMDD-HHmmss_P<级别>_<净化标题>[_<标签>].md
 *   <root>/archive/YYYY/  —— 截止时间已过的事项，按开始年份归档
 *   <root>/deleted/       —— 用户删除（软删除）的事项
 *
 * 两种存储后端（StorageAdapter）：
 *   - appData：应用数据目录（$APPDATA）下的任意子目录（默认 calendar），
 *     通过 @tauri-apps/plugin-fs 读写（baseDir = AppData），可监听文件变化。
 *   - external：用户指定的外部绝对路径（如 /storage/emulated/0/Download），
 *     同样走 @tauri-apps/plugin-fs 直接读写（无 baseDir，需 Android 所有文件
 *     访问权限 + capabilities 的 fs:scope 放行），监听与 appData 同级生效。
 *
 * 目录结构与文件格式两种后端完全一致，数据可直接互相拷贝迁移。
 */

/** 默认数据根目录（appData 模式：应用数据目录下的子目录）。 */
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

/** 校验用户输入的外部绝对路径：统一斜杠、去尾斜杠；必须以 / 开头且不含 ..。 */
export function sanitizeExternalPath(input: string): string {
  const cleaned = input.trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!cleaned.startsWith('/')) {
    throw new Error('外部目录必须是绝对路径（如 /storage/emulated/0/Download）。');
  }
  for (const seg of cleaned.split('/')) {
    if (seg === '..') {
      throw new Error('路径中不能包含 ..。');
    }
  }
  if (!cleaned) {
    throw new Error('目录不能为空。');
  }
  return cleaned;
}

/** 长期事项哨兵年份（与桌面端 MarkLongTerm 一致）。 */
export const LONG_TERM_SENTINEL = new Date(2099, 0, 1, 12, 0, 0);

// ── 存储后端抽象 ────────────────────────────────────────

export interface DirEntry {
  name: string;
  isFile: boolean;
  isDir: boolean;
  /** 文件字节数（部分后端 readDir 自带；缺失时走 stat）。 */
  size?: number | null;
  /** 最后修改毫秒时间戳（部分后端 readDir 自带；缺失时走 stat）。 */
  mtimeMs?: number | null;
}

/** 存储后端：所有路径均为相对各后端根目录的路径。 */
export interface StorageAdapter {
  mkdir(path: string): Promise<void>;
  readDir(path: string): Promise<DirEntry[]>;
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, contents: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  /** 取文件元数据；取不到返回 null（调用方回退为必读正文，宁慢勿脏）。 */
  stat(path: string): Promise<{ mtime: number; size: number } | null>;
  rename(oldPath: string, newPath: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** appData 后端：@tauri-apps/plugin-fs + BaseDirectory.AppData。 */
const appDataAdapter: StorageAdapter = {
  async mkdir(path) {
    await fsMkdir(path, { baseDir: BaseDirectory.AppData, recursive: true });
  },
  async readDir(path) {
    return (await fsReadDir(path, { baseDir: BaseDirectory.AppData })).map((e) => ({
      name: e.name,
      isFile: !!e.isFile,
      isDir: !!e.isDirectory,
    }));
  },
  async readTextFile(path) {
    return fsReadTextFile(path, { baseDir: BaseDirectory.AppData });
  },
  async writeTextFile(path, contents) {
    await fsWriteTextFile(path, contents, { baseDir: BaseDirectory.AppData });
  },
  async exists(path) {
    return fsExists(path, { baseDir: BaseDirectory.AppData });
  },
  async stat(path) {
    try {
      const info = await fsStat(path, { baseDir: BaseDirectory.AppData });
      if (info.mtime == null) return null;
      return { mtime: info.mtime.getTime(), size: info.size };
    } catch {
      return null;
    }
  },
  async rename(oldPath, newPath) {
    await fsRename(oldPath, newPath, {
      oldPathBaseDir: BaseDirectory.AppData,
      newPathBaseDir: BaseDirectory.AppData,
    });
  },
  async remove(path) {
    await fsRemove(path, { baseDir: BaseDirectory.AppData });
  },
};

/** external 后端：外部绝对路径直连（@tauri-apps/plugin-fs，无 baseDir）。 */
function directFsAdapter(baseAbs: string): StorageAdapter {
  const abs = (p: string) => `${baseAbs}/${p}`;
  return {
    async mkdir(path) {
      await fsMkdir(abs(path), { recursive: true });
    },
    async readDir(path) {
      return (await fsReadDir(abs(path))).map((e) => ({
        name: e.name,
        isFile: !!e.isFile,
        isDir: !!e.isDirectory,
      }));
    },
    async readTextFile(path) {
      return fsReadTextFile(abs(path));
    },
    async writeTextFile(path, contents) {
      await fsWriteTextFile(abs(path), contents);
    },
    async exists(path) {
      return fsExists(abs(path));
    },
    async stat(path) {
      try {
        const info = await fsStat(abs(path));
        if (info.mtime == null) return null;
        return { mtime: info.mtime.getTime(), size: info.size };
      } catch {
        return null;
      }
    },
    async rename(oldPath, newPath) {
      await fsRename(abs(oldPath), abs(newPath));
    },
    async remove(path) {
      await fsRemove(abs(path));
    },
  };
}

// ── 数据操作 ────────────────────────────────────────────

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

/** 缓存指纹：文件名 + 时间 + 优先级 + 标题 + 标签 + 正文，用于判断磁盘数据是否真变了。 */
function fingerprintEntries(entries: { item: ScheduleEvent; archived: boolean }[]): string {  return entries
    .map(
      (e) =>
        `${e.archived ? 1 : 0}|${e.item.fileName ?? ''}|${e.item.startsAt}|${e.item.endsAt ?? ''}|${e.item.priority}|${e.item.title}|${e.item.tags}|${e.item.notes ?? ''}`,
    )
    .sort()
    .join('\n');
}

/**
 * 持久化缓存条目（localStorage，按存储根分 key，跨启动保留）。
 * 命中条件 = mtime 与 size 双相等：单看 mtime 会踩粗粒度文件系统（如 FAT 2 秒）与
 * 保留时间戳的拷贝，单看 size 会漏同长度修改；两者同时不变才可认为内容无变动。
 */
interface PersistedFile {
  mtime: number;
  size: number;
  archived: boolean;
  item: ScheduleEvent;
}

/** 持久化缓存版本号：解析规则变化时递增，旧缓存整体作废。 */
const PERSISTED_CACHE_VERSION = 1;

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

  private mode: 'appData' | 'external' = 'appData';
  private adapter: StorageAdapter = appDataAdapter;
  /** watch 用的实际路径：appData 为 null（走 itemsDir + baseDir），external 为绝对路径。 */
  private absItemsDir: string | null = null;
  /** 最近一次 watch 启动失败的原因（成功则为 null），供设置页诊断展示。 */
  private watchError: string | null = null;

  /** 当前数据根目录（appData：相对 $APPDATA 的子目录；external：'' = 所选文件夹根）。 */
  private root = DEFAULT_ROOT;
  private itemsDir = `${DEFAULT_ROOT}/items`;
  private archiveDir = `${DEFAULT_ROOT}/archive`;
  private deletedDir = `${DEFAULT_ROOT}/deleted`;

  // ── 内存缓存（跨视图共享） ──────────────────────────────
  // 独立后台监视（open 内启动的 watch/轮询）拥有缓存：启动时全量预取一次，
  // 之后仅在监视到文件变动（watch 事件/轮询指纹变化/应用内写）时整体重读；
  // 各查询（getUpcoming/getItems/count）只读内存，不再扫盘。
  private cache: { item: ScheduleEvent; archived: boolean }[] | null = null;
  private cacheFingerprint = '';
  private loadGen = 0;
  /** 轮询计数：每 10 次强制全量读正文一次，兜底 mtime 被刻意保留的外部修改。 */
  private pollCount = 0;

  /** 存储目录打开/切换后触发（初始化后立即触发一次）。 */
  onChange: (() => void) | null = null;

  /** items/ 目录内容变化后触发（去抖），含应用外部改动。 */
  onItemsChanged: (() => void) | null = null;

  /** 当前存储模式。 */
  getMode(): 'appData' | 'external' {
    return this.mode;
  }

  /**
   * 当前后台监视方式：watch = 文件监听实时生效；
   * poll = 轮询兜底（监听启动失败，如外部路径不可用时）。
   */
  getWatchStatus(): 'watch' | 'poll' {
    return this.unwatch ? 'watch' : 'poll';
  }

  /** 最近一次 watch 启动失败的原因；null = 监听正常或尚未启动。 */
  getWatchError(): string | null {
    return this.watchError;
  }

  /** 当前数据根目录（appData：相对 $APPDATA 的子目录；external：外部绝对路径）。 */
  getRoot(): string {
    return this.root;
  }

  /** 切换为 appData 模式：数据根目录为 $APPDATA 下的任意子目录。 */
  async setRoot(dataDir: string): Promise<void> {
    const cleaned = sanitizeRootPath(dataDir);
    this.mode = 'appData';
    this.adapter = appDataAdapter;
    this.absItemsDir = null;
    this.root = cleaned;
    this.itemsDir = `${cleaned}/items`;
    this.archiveDir = `${cleaned}/archive`;
    this.deletedDir = `${cleaned}/deleted`;
    await this.open();
  }

  /** 切换为 external 模式：数据根目录为外部绝对路径（需所有文件访问权限）。 */
  async setExternalPath(absPath: string): Promise<void> {
    const base = sanitizeExternalPath(absPath);
    this.mode = 'external';
    this.adapter = directFsAdapter(base);
    this.absItemsDir = `${base}/items`;
    this.root = base;
    this.itemsDir = 'items';
    this.archiveDir = 'archive';
    this.deletedDir = 'deleted';
    await this.open();
  }

  async open(): Promise<void> {
    this.stopWatching();
    // 切换根目录：旧缓存失效（loadGen++ 让在途的旧加载结果作废）
    this.cache = null;
    this.cacheFingerprint = '';
    this.loadGen++;
    await this.adapter.mkdir(this.itemsDir);
    await this.adapter.mkdir(this.deletedDir);

    // 独立后台监视：两种后端都走 fs 直接路径，notify watch 同级生效；
    // 注意必须用绝对路径（adapter 内部拼接 base，watch 调用绕不过去）；
    // 监听失败时降级为轮询兜底。
    try {
      // external 用绝对路径（无 baseDir），appData 用相对路径 + baseDir
      this.unwatch = this.absItemsDir
        ? await watch(this.absItemsDir, () => this.scheduleReload(), {
            recursive: false,
            delayMs: 300,
          })
        : await watch(this.itemsDir, () => this.scheduleReload(), {
            baseDir: BaseDirectory.AppData,
            recursive: false,
            delayMs: 300,
          });
      this.watchError = null;
    } catch (err) {
      // 某些 Android 文件系统上 notify 可能不可用：降级为轮询兜底
      console.warn('items 目录监听启动失败，降级为轮询刷新：', err);
      this.unwatch = null;
      this.watchError = err instanceof Error ? err.message : String(err);
    }

    if (!this.unwatch) {
      this.startPolling();
    }

    this.onChange?.();
    // 启动时先同步用持久化缓存预热内存（首屏即时），再后台按 mtime/size 增量刷新
    this.hydrateFromPersistent();
    // 启动时全量预取一次并共享给所有视图；之后仅在监视到变动时重读
    void this.reloadCache()
      .catch(() => undefined)
      .then(() => this.onItemsChanged?.());
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

  /** 未删除事项，开始时间落在 [from, to)，含归档项（桌面端 GetUpcoming；只读内存缓存）。 */
  async getUpcoming(from: Date, to?: Date, limit = 100): Promise<ScheduleEvent[]> {
    const result: ScheduleEvent[] = [];
    for (const { item } of await this.ensureCache()) {
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

  /** 所有未删除事项（仅 items/，未过期项），按优先级排序（桌面端 GetItems；只读内存缓存）。 */
  async getItems(): Promise<ScheduleEvent[]> {
    const cached = await this.ensureCache();
    const result = cached.filter((c) => !c.archived).map((c) => c.item);
    result.sort(byPriority);
    return result;
  }

  /** 新增事项：写入 items/，返回文件名（桌面端 Insert）。 */
  async insert(item: ScheduleEvent): Promise<string> {
    const fileName = await this.writeItemFile(item, this.itemsDir);
    this.afterWrite();
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
    this.afterWrite();
    return fileName;
  }

  /** 软删除：把文件移入 deleted/（桌面端 MoveToDeleted）。 */
  async moveToDeleted(item: ScheduleEvent): Promise<string | null> {
    if (!item.fileName) return null;
    const source = await this.findItemFile(item);
    if (!source) return null;

    await this.adapter.mkdir(this.deletedDir);
    const destination = await this.uniquePath(`${this.deletedDir}/${item.fileName}`);
    await this.adapter.rename(source, destination);
    this.afterWrite();
    return destination;
  }

  /** 把 items/ 中截止已过的事项移入 archive/YYYY/（幂等，桌面端 ArchiveExpiredItems）。 */
  async archiveExpiredItems(): Promise<void> {
    const cached = await this.ensureCache();
    let changed = false;
    for (const { item, archived } of cached) {
      if (archived || !item.fileName) continue;
      if (!isExpired(item)) continue;

      const source = `${this.itemsDir}/${item.fileName}`;
      // 缓存与磁盘之间可能存在竞态：源文件已不在则跳过
      if (!(await this.adapter.exists(source))) continue;
      const directory = await this.getArchiveDirectory(item);
      await this.adapter.mkdir(directory);
      const destination = await this.uniquePath(`${directory}/${item.fileName}`);
      await this.adapter.rename(source, destination);
      changed = true;
    }
    if (changed) this.afterWrite();
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
    return (await this.ensureCache()).filter((c) => !c.archived).length;
  }

  // ── 内部实现 ──────────────────────────────────────────

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
    await this.adapter.mkdir(directory);
    await this.adapter.writeTextFile(fileName, item.notes ?? '');
    return fileName;
  }

  /** 目标路径已存在时追加时间后缀（桌面端 "_HHmmssfff" 思路）。 */
  private async uniquePath(relPath: string): Promise<string> {
    if (!(await this.adapter.exists(relPath))) {
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

  /** 在 items/ 和所有 archive/YYYY/ 中查找文件，返回相对各后端根目录的路径。 */
  private async findItemFile(item: ScheduleEvent): Promise<string | null> {
    if (!item.fileName) return null;
    const inItems = `${this.itemsDir}/${item.fileName}`;
    if (await this.adapter.exists(inItems)) {
      return inItems;
    }
    for (const dir of await this.enumerateArchiveDirectories()) {
      const path = `${dir}/${item.fileName}`;
      if (await this.adapter.exists(path)) {
        return path;
      }
    }
    return null;
  }

  private async deleteItemFileAnywhere(item: ScheduleEvent): Promise<void> {
    const path = await this.findItemFile(item);
    if (!path) return;
    await this.adapter.remove(path);
  }

  private async enumerateArchiveDirectories(): Promise<string[]> {
    try {
      const entries = await this.adapter.readDir(this.archiveDir);
      return entries.filter((e) => e.isDir).map((e) => `${this.archiveDir}/${e.name}`);
    } catch {
      return [];
    }
  }

  private async listMd(
    dir: string,
  ): Promise<{ path: string; name: string; size?: number; mtimeMs?: number }[]> {
    try {
      const entries = await this.adapter.readDir(dir);
      return entries
        .filter((e) => e.isFile && e.name.endsWith('.md'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((e) => ({
          path: `${dir}/${e.name}`,
          name: e.name,
          size: e.size ?? undefined,
          mtimeMs: e.mtimeMs ?? undefined,
        }));
    } catch {
      return [];
    }
  }

  // ── 持久化缓存（localStorage，跨启动） ───────────────────

  /** 缓存 key 按存储位置隔离：切换目录互不干扰。 */
  private persistedKey(): string {
    return `ocal.filecache.v1|${this.mode}|${this.root}`;
  }

  private readPersisted(): Record<string, PersistedFile> {
    try {
      const raw = localStorage.getItem(this.persistedKey());
      if (!raw) return {};
      const data = JSON.parse(raw) as { v?: number; files?: Record<string, PersistedFile> };
      if (data?.v !== PERSISTED_CACHE_VERSION || !data.files || typeof data.files !== 'object') {
        return {};
      }
      return data.files;
    } catch {
      return {};
    }
  }

  private writePersisted(files: Record<string, PersistedFile>): void {
    try {
      localStorage.setItem(this.persistedKey(), JSON.stringify({ v: PERSISTED_CACHE_VERSION, files }));
    } catch (err) {
      // 配额不足等：仅告警，本次靠内存缓存，重启后回退全量读取
      console.warn('持久化缓存写入失败：', err);
    }
  }

  /** 启动时同步预热内存：首屏查询即时返回，后台增量刷新纠偏。 */
  private hydrateFromPersistent(): void {
    const entries = Object.values(this.readPersisted());
    if (!entries.length) return;
    this.cache = entries.map((f) => ({ item: f.item, archived: f.archived }));
    this.cacheFingerprint = fingerprintEntries(this.cache);
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
      notes = await this.adapter.readTextFile(path);
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

  // ── 内存缓存 + 独立后台监视 ─────────────────────────────

  /** 读缓存；未命中时整体重读（与启动预取/监视刷新共享同一加载路径）。 */
  private async ensureCache(): Promise<{ item: ScheduleEvent; archived: boolean }[]> {
    if (this.cache) return this.cache;
    await this.reloadCache();
    return this.cache ?? [];
  }

  /** 整体重读磁盘并更新缓存，返回数据是否发生变化（指纹比较）。 */
  private async reloadCache(force = false): Promise<boolean> {
    const gen = ++this.loadGen;
    const entries = await this.loadAllFiles(force);
    // 已被更新的加载取代：丢弃本次结果，避免旧数据覆盖新缓存
    if (gen !== this.loadGen) return false;
    const fp = fingerprintEntries(entries);
    const changed = fp !== this.cacheFingerprint;
    this.cache = entries;
    this.cacheFingerprint = fp;
    return changed;
  }

  /**
   * 全量扫描 items/ + archive/。
   * 持久化缓存命中（mtime+size 双相等且归档位置一致）时跳过正文读取；
   * force=true（应用内写后、定期兜底）时全部重读正文。
   */
  private async loadAllFiles(force = false): Promise<{ item: ScheduleEvent; archived: boolean }[]> {
    const itemFiles = await this.listMd(this.itemsDir);
    const archiveDirs = await this.enumerateArchiveDirectories();
    const archivedLists = await Promise.all(archiveDirs.map((d) => this.listMd(d)));
    const all: { path: string; name: string; archived: boolean; size?: number; mtimeMs?: number }[] = [
      ...itemFiles.map((f) => ({ ...f, archived: false })),
      ...archivedLists.flatMap((list) => list.map((f) => ({ ...f, archived: true }))),
    ];
    const persisted = this.readPersisted();
    const out: { item: ScheduleEvent; archived: boolean }[] = [];
    let dirty = false;
    const LIMIT = 24;
    for (let i = 0; i < all.length; i += LIMIT) {
      await Promise.all(
        all.slice(i, i + LIMIT).map(async (f) => {
          // 元数据优先用列表自带的，缺失再逐文件 stat（免一次 IPC）
          let meta: { mtime: number; size: number } | null =
            f.size != null && f.mtimeMs != null ? { size: f.size, mtime: f.mtimeMs } : null;
          if (!meta) {
            try {
              meta = await this.adapter.stat(f.path);
            } catch {
              meta = null;
            }
          }
          const prev = persisted[f.path];
          if (
            !force &&
            prev &&
            meta &&
            prev.mtime === meta.mtime &&
            prev.size === meta.size &&
            prev.archived === f.archived
          ) {
            out.push({ item: prev.item, archived: f.archived });
            return;
          }
          const item = await this.parseItemFile(f.path, f.name);
          if (!item) {
            if (persisted[f.path]) {
              delete persisted[f.path];
              dirty = true;
            }
            return;
          }
          out.push({ item, archived: f.archived });
          if (meta) {
            persisted[f.path] = { mtime: meta.mtime, size: meta.size, archived: f.archived, item };
            dirty = true;
          } else if (persisted[f.path]) {
            // 无元数据可校验：删掉旧条目，避免下次误命中读脏
            delete persisted[f.path];
            dirty = true;
          }
        }),
      );
    }
    // 清理磁盘上已不存在的条目
    const onDisk = new Set(all.map((f) => f.path));
    for (const p of Object.keys(persisted)) {
      if (!onDisk.has(p)) {
        delete persisted[p];
        dirty = true;
      }
    }
    if (dirty) this.writePersisted(persisted);
    return out;
  }

  /** 外部文件变化去抖（桌面端 300ms Timer）：重读缓存，变化才通知视图。 */
  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => void this.pollCheck(), 300);
  }

  /** 应用内写操作：已知已变更，强制重读正文后直接通知视图（不等 watcher）。 */
  private afterWrite(): void {
    // force=true：同秒写入在粗粒度文件系统上 mtime 可能不变，必须重读
    void this.reloadCache(true)
      .catch(() => undefined)
      .then(() => this.onItemsChanged?.());
  }

  /** 后台监视的一次检查：重读 + 指纹比对；无变化时只做过期归档检查。 */
  private async pollCheck(): Promise<void> {
    // 每 10 次强制全读一次正文，兜底 mtime 被刻意保留的外部修改
    const force = ++this.pollCount % 10 === 0;
    let changed = false;
    try {
      changed = await this.reloadCache(force);
    } catch {
      return;
    }
    if (changed) {
      this.onItemsChanged?.();
      return;
    }
    // 文件无变化，但可能有事项随时间自然过期 → 归档（有归档动作时内部会再通知）
    await this.archiveExpiredItems();
  }

  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => {
      // 监听不可用时的 30s 轮询兜底
      void this.pollCheck();
    }, 30_000);
  }
}

/** 模块级单例（对应桌面端 AppServices.Items）。 */
export const store = new FolderStore();
