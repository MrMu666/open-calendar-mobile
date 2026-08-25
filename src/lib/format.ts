/** 日期时间格式化工具：全部使用本地时区，与桌面端 ToLocalTime() 行为一致。 */

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 文件名时间段：yyyyMMdd-HHmmss（桌面端 FormatTimePart）。 */
export function formatFileTime(d: Date): string {
  return (
    `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}` +
    `-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`
  );
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function addMonths(d: Date, months: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + months, 1);
}

/** 顶部日期："8月25日 星期二"（桌面端 "M月d日 dddd"）。 */
const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

export function headerDateText(d: Date): string {
  return `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`;
}

/** 日历标题："2026年8月"。 */
export function monthTitle(d: Date): string {
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
}

/** 事项条左侧开始日期："08.21"。 */
export function mdText(d: Date): string {
  return `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

/** 事项条时间："09:30"。 */
export function hmText(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** 长期事项哨兵年份（桌面端 MarkLongTerm 用 2099-01-01 12:00）。 */
export const LONG_TERM_YEAR = 2099;

/** 是否长期事项（截止年份为 2099）。 */
export function isLongTerm(endsAt: string | null): boolean {
  return endsAt != null && new Date(endsAt).getFullYear() === LONG_TERM_YEAR;
}

/** 压缩空白为单空格（桌面端 CollapseWhitespace），用于预览文本。 */
export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** 十六进制颜色 → rgba() 字符串。 */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** 颜色压暗（桌面端 Theme.Scale，用于按钮 hover/按下）。 */
export function scaleColor(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r}, ${g}, ${b})`;
}

/** 把颜色以 opacity 叠加到黑色上（移动端无壁纸，模拟玻璃暗色底）。 */
export function blendOverBlack(hex: string, opacity: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * opacity);
  const g = Math.round(((n >> 8) & 255) * opacity);
  const b = Math.round((n & 255) * opacity);
  return `rgb(${r}, ${g}, ${b})`;
}
