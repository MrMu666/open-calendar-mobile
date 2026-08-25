/**
 * lunar-javascript 的最小类型声明（该包未内置 .d.ts）。
 * 仅声明本项目用到的 API。
 */
declare module 'lunar-javascript' {
  export class Solar {
    static fromDate(date: Date): Solar;
    static fromYmdHms(y: number, m: number, d: number, h: number, min: number, s: number): Solar;
    getLunar(): Lunar;
  }

  export class Lunar {
    /** 农历月号；闰月为负数（与 .NET ChineseLunisolarCalendar 一致）。 */
    getMonth(): number;
    /** 中文月名，如 "正" / "闰六"（不含"月"字）。 */
    getMonthInChinese(): string;
    /** 中文日名，如 "初一"。 */
    getDayInChinese(): string;
  }
}
