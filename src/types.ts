/**
 * 单个日程事项，与桌面端 CalendarApp.Models.ScheduleEvent 对应。
 * 持久化为存储目录中的 Markdown 文件，文件名即数据（规则见 存储目录设计.md）：
 *   items/YYYYMMDD-HHmmss_YYYYMMDD-HHmmss_P<级别>_<净化标题>[_<标签>].md
 * 时间统一存为 ISO UTC 字符串，展示/生成文件名时转本地时间（与桌面端 DateTimeOffset 行为一致）。
 */
export interface ScheduleEvent {
  /** 稳定 id：由文件名哈希得到，仅用于 React key / 编辑定位。 */
  id: number;
  /** 文件名（含 .md）；null 表示解析失败的遗留/未知文件。 */
  fileName: string | null;
  title: string;
  /** P1..P4：1=紧急 2=优先 3=一般 4=长期（文件名段 P<n>）。 */
  priority: number;
  /** 标签，多个用 '-' 连接，如 "工作-生活"。 */
  tags: string;
  /** 文件内容（Markdown）。 */
  notes: string;
  /** 开始时间（ISO UTC）。 */
  startsAt: string;
  /** 截止时间（ISO UTC）；null = 长期事项。 */
  endsAt: string | null;
  allDay: boolean;
  location: string;
  createdAt: string;
  updatedAt: string;
}
