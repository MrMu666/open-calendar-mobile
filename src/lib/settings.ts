import { BaseDirectory, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { sanitizeRootPath } from './store';

/**
 * 应用设置：对应桌面端 UserSettings（外观部分 + 数据目录）。
 * 存于应用数据目录根 settings.json —— 与事项数据目录相互独立，
 * 应用存储中仅保存应用设置与事项数据目录位置，事项本体在各数据目录下。
 */
export type Theme = 'light' | 'dark';

export interface UserSettings {
  /** 亮色 / 暗色主题（默认亮色）。 */
  theme: Theme;
  /** 强调色：日历选中日 / 新增按钮共用（桌面端默认 #4CAF50）。 */
  accentColor: string;
  /** 事项数据根目录：应用数据目录下的子目录（如 "calendar"），可随意指定。 */
  dataDir: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'light',
  accentColor: '#4CAF50',
  dataDir: 'calendar',
};

/** 强调色预设（设置页用）。 */
export const ACCENT_PRESETS = ['#4CAF50', '#3B82F6', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899'];

/** 设置文件固定位于应用数据目录根（不随数据目录切换而移动）。 */
const SETTINGS_PATH = 'settings.json';
/** 旧版设置位置（在默认数据目录内），仅作一次性迁移读取。 */
const LEGACY_SETTINGS_PATH = 'calendar/settings.json';

export async function loadSettings(): Promise<UserSettings> {
  for (const path of [SETTINGS_PATH, LEGACY_SETTINGS_PATH]) {
    try {
      const raw = await readTextFile(path, { baseDir: BaseDirectory.AppData });
      const parsed = JSON.parse(raw) as Partial<UserSettings>;
      let dataDir = DEFAULT_SETTINGS.dataDir;
      if (typeof parsed.dataDir === 'string' && parsed.dataDir.trim()) {
        try {
          dataDir = sanitizeRootPath(parsed.dataDir);
        } catch {
          dataDir = DEFAULT_SETTINGS.dataDir;
        }
      }
      return { ...DEFAULT_SETTINGS, ...parsed, dataDir };
    } catch {
      // 继续尝试下一个位置
    }
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await writeTextFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}
