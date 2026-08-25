import { Solar } from 'lunar-javascript';

/**
 * 农历工具：用 lunar-javascript（纯 JS，无原生依赖）复刻桌面端
 * ChineseLunisolarCalendar 的输出格式（.NET 内置类无法在移动端使用）。
 * 已验证两者行为一致：
 *   - getMonth() 闰月返回负数（.NET: Calendar.GetMonth(date) < 0 表示闰月）
 *   - 月份中文名 "正月".."腊月"，闰月前缀 "闰"（如 "闰六月"）
 *   - 日名 "初一".."三十"
 */

/** 农历月名，如 "正月" / "闰六月"（桌面端 GetMonthName）。 */
export function lunarMonthName(date: Date): string {
  return Solar.fromDate(date).getLunar().getMonthInChinese() + '月';
}

/** 农历日名，如 "初五"（桌面端 GetDayName，日历格子用）。 */
export function lunarDayName(date: Date): string {
  return Solar.fromDate(date).getLunar().getDayInChinese();
}

/** 完整农历日期，如 "正月初一" / "闰四月十五"（桌面端 GetMonthDayText）。 */
export function lunarMonthDayText(date: Date): string {
  return lunarMonthName(date) + lunarDayName(date);
}
