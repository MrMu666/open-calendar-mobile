import type { ScheduleEvent } from '../types';

/** 标签候选（桌面端 TagChoices，编辑器下拉用）。 */
export const TAG_CHOICES = ['工作', '生活', '学习', '健康', '财务'] as const;

/** 优先级显示文案（桌面端 ComboBox：紧急/优先/一般/长期）。 */
export const PRIORITY_LABELS: Record<number, string> = {
  1: '紧急',
  2: '优先',
  3: '一般',
  4: '长期',
};

/** 标签颜色表（桌面端 ScheduleEventItem.TagColors）。 */
const TAG_COLORS: Record<string, string> = {
  工作: '#3B82F6',
  生活: '#22C55E',
  学习: '#8B5CF6',
  健康: '#EF4444',
  财务: '#F59E0B',
};

/** 取标签（或 "工作-生活" 多标签中的第一个已知标签）的颜色；未知返回灰色。 */
export function resolveTagColor(tags: string): string {
  if (!tags.trim()) return '#64748B';
  for (const part of tags.split('-')) {
    if (TAG_COLORS[part]) return TAG_COLORS[part];
  }
  return '#64748B';
}

/** 事项条背景色：P1=20% 红、P2=10% 红、默认近白（桌面端 ItemBackground）。 */
export function itemBackground(priority: number): string {
  switch (priority) {
    case 1:
      return 'rgba(255, 77, 77, 0.2)';
    case 2:
      return 'rgba(255, 77, 77, 0.1)';
    default:
      return 'rgba(255, 255, 255, 0.12)';
  }
}

/** 标签 chip 背景：标签色 30% 透明度（桌面端 TagBackground）。 */
export function tagBackground(tags: string): string {
  const color = resolveTagColor(tags);
  const m = /^#?([0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.3)`;
}

/** 优先级 + 标签行，如 "P1 · 工作-生活"（桌面端 MetaText）。 */
export function metaText(event: ScheduleEvent): string {
  const parts = [`P${event.priority}`];
  if (event.tags.trim()) parts.push(event.tags);
  return parts.join(' · ');
}
