import { invoke } from '@tauri-apps/api/core';

/**
 * 所有文件访问权限桥（本地插件 all-files-access）。
 * 桌面端 / 前端 dev（无插件）时 invoke 抛错，统一吞掉返回 false。
 */

const PLUGIN = 'plugin:all-files-access';

/** 是否已拥有全盘文件访问能力。 */
export async function isAllFilesAccessGranted(): Promise<boolean> {
  try {
    const r = await invoke<{ granted: boolean }>(`${PLUGIN}|check`);
    return !!r?.granted;
  } catch {
    return false;
  }
}

/** 跳系统设置页让用户手动开启（MANAGE 权限无弹窗，只能走设置）。 */
export async function openAllFilesAccessSettings(): Promise<void> {
  await invoke(`${PLUGIN}|settings`);
}
