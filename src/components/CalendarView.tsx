import { useEffect, useMemo, useRef, useState } from 'react';
import type { ScheduleEvent } from '../types';
import { store } from '../lib/store';
import { addMonths, headerDateText, monthTitle, startOfDay, startOfMonth } from '../lib/format';
import { lunarDayName, lunarMonthDayText } from '../lib/lunar';
import ItemCard from './ItemCard';

interface Props {
  /** 数据刷新信号（每次自增触发重新加载）。 */
  refreshTick: number;
  accentColor: string;
  onEdit: (e: ScheduleEvent) => void;
  onNew: () => void;
}

interface DayCell {
  date: Date;
  isInMonth: boolean;
  hasEvents: boolean;
  isToday: boolean;
  isSelected: boolean;
  lunar: string;
}

const WEEK_HEADERS = ['日', '一', '二', '三', '四', '五', '六'];

/** 月历视图：月份导航 + 6×7 网格（周日开头）+ 选中日日程。 */
export default function CalendarView({ refreshTick, accentColor, onEdit, onNew }: Props) {
  const [displayMonth, setDisplayMonth] = useState<Date>(startOfMonth(new Date()));
  const [selected, setSelected] = useState<Date>(startOfDay(new Date()));
  const [monthEvents, setMonthEvents] = useState<ScheduleEvent[]>([]);
  const [dayEvents, setDayEvents] = useState<ScheduleEvent[]>([]);
  const [jumpMode, setJumpMode] = useState(false);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // 当前显示月内的事项（画圆点）
  useEffect(() => {
    let cancelled = false;
    const from = startOfMonth(displayMonth);
    const to = addMonths(from, 1);
    store.getUpcoming(from, to, 5000).then((items) => {
      if (!cancelled) setMonthEvents(items);
    });
    return () => {
      cancelled = true;
    };
  }, [displayMonth, refreshTick]);

  // 选中日的事项
  useEffect(() => {
    let cancelled = false;
    store.getEventsOnDay(selected).then((items) => {
      if (!cancelled) setDayEvents(items);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, refreshTick]);

  const cells = useMemo<DayCell[]>(() => {
    const first = startOfMonth(displayMonth);
    const gridStart = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const eventDays = new Set(monthEvents.map((e) => {
      const d = new Date(e.startsAt);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    }));
    const today = startOfDay(new Date());
    const out: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      out.push({
        date: d,
        isInMonth: d.getMonth() === first.getMonth(),
        hasEvents: eventDays.has(key),
        isToday: d.getTime() === today.getTime(),
        isSelected: d.getTime() === selected.getTime(),
        lunar: lunarDayName(d),
      });
    }
    return out;
  }, [displayMonth, monthEvents, selected]);

  const showBackToToday =
    selected.getTime() !== startOfDay(new Date()).getTime() ||
    displayMonth.getFullYear() !== new Date().getFullYear() ||
    displayMonth.getMonth() !== new Date().getMonth();

  const handleSelect = (cell: DayCell) => {
    setSelected(cell.date);
  };

  const handleJumpToggle = () => {
    setJumpMode((v) => !v);
    // 下一帧聚焦日期输入框
    setTimeout(() => dateInputRef.current?.focus(), 0);
  };

  const handleJump = (value: string) => {
    if (!value) return;
    const [y, m, d] = value.split('-').map(Number);
    const target = new Date(y, m - 1, d);
    if (target.getFullYear() !== y || target.getMonth() !== m - 1 || target.getDate() !== d) return;
    setSelected(target);
    setDisplayMonth(startOfMonth(target));
    setJumpMode(false);
  };

  return (
    <div className="view calendar-view">
      {/* 月份导航 */}
      <div className="month-nav">
        <button type="button" className="icon-btn nav" onClick={() => setDisplayMonth(addMonths(displayMonth, -1))} aria-label="上个月">
          ‹
        </button>
        <button type="button" className="month-title" onClick={handleJumpToggle}>
          {monthTitle(displayMonth)}
        </button>
        <button type="button" className="icon-btn nav" onClick={() => setDisplayMonth(addMonths(displayMonth, 1))} aria-label="下个月">
          ›
        </button>
      </div>

      {jumpMode && (
        <div className="jump-bar">
          <input
            ref={dateInputRef}
            type="date"
            defaultValue={`${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(
              selected.getDate(),
            ).padStart(2, '0')}`}
            onChange={(e) => handleJump(e.target.value)}
          />
        </div>
      )}

      {/* 星期表头 */}
      <div className="week-head">
        {WEEK_HEADERS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>

      {/* 6×7 网格 */}
      <div className="day-grid">
        {cells.map((cell) => (
          <button
            key={`${cell.date.getTime()}`}
            type="button"
            className={`day-cell${cell.isInMonth ? '' : ' out'}${cell.isToday ? ' today' : ''}${
              cell.isSelected ? ' selected' : ''
            }`}
            style={cell.isSelected ? { background: accentColor } : undefined}
            onClick={() => handleSelect(cell)}
          >
            <span className="day-num">{cell.date.getDate()}</span>
            <span className="day-lunar">{cell.lunar}</span>
            <span className="day-dot" style={{ opacity: cell.hasEvents ? 1 : 0 }} />
          </button>
        ))}
      </div>

      {/* 选中日标题 + 日程 */}
      <div className="day-events-header">
        <div>
          <span className="day-events-title">{headerDateText(selected)}</span>
          <span className="day-events-lunar">农历 {lunarMonthDayText(selected)}</span>
        </div>
        {showBackToToday && (
          <button
            type="button"
            className="btn small back-today"
            onClick={() => {
              const today = startOfDay(new Date());
              setSelected(today);
              setDisplayMonth(startOfMonth(today));
            }}
          >
            ↩ 回到今天
          </button>
        )}
      </div>

      <div className="day-events">
        {dayEvents.length === 0 ? (
          <div className="empty-text">这一天没有日程</div>
        ) : (
          dayEvents.map((e) => (
            <ItemCard key={e.fileName ?? e.id} event={e} onEdit={onEdit} onAction={() => {}} />
          ))
        )}
      </div>

      <button type="button" className="fab" onClick={onNew}>
        ＋ 新增事项
      </button>
    </div>
  );
}
