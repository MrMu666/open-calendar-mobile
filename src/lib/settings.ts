import { BaseDirectory, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

/**
 * 应用设置：对应桌面端 UserSettings（外观部分）。
 * 桌面端存于 ~/.calendarapp/settings.json；移动端存于应用数据目录
 * calendar/settings.json（与事项数据同目录，便于整体迁移）。
 */
export type Theme = 'dark' | 'light';

export interface UserSettings {
  /** 亮色 / 暗色主题。 */
  theme: Theme;
  /** 强调色：日历选中日 / 新增按钮共用（桌面端默认 #4CAF50）。 */
  accentColor: string;
}

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accentColor: '#4CAF50',
};

/** 强调色预设（设置页用）。 */
export const ACCENT_PRESETS = ['#4CAF50', '#3B82F6', '#EF4444', '#F59E0B', '#8B5CF6', '#EC4899'];

const SETTINGS_PATH = 'calendar/settings.json';

export async function loadSettings(): Promise<UserSettings> {
  try {
    const raw = await readTextFile(SETTINGS_PATH, { baseDir: BaseDirectory.AppData });
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<UserSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  try {
    await mkdir('calendar', { baseDir: BaseDirectory.AppData, recursive: true });
  } catch {
    // 目录已存在
  }
  await writeTextFile(SETTINGS_PATH, JSON.stringify(settings, null, 2), {
    baseDir: BaseDirectory.AppData,
  });
}
