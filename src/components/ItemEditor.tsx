import { useMemo, useState } from 'react';
import type { ScheduleEvent } from '../types';
import { store, LONG_TERM_SENTINEL, sanitizeSegment } from '../lib/store';
import { pad2 } from '../lib/format';
import { PRIORITY_LABELS, TAG_CHOICES } from '../lib/tags';

interface Props {
  /** null = 新增；否则编辑该事项。 */
  existing: ScheduleEvent | null;
  onClose: () => void;
  onSaved: () => void;
}

interface DateFields {
  year: string;
  month: string;
  day: string;
  time: string;
}

/** 解析 "HH:mm"；非法返回 null（桌面端 ParseTime）。 */
function parseTime(text: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const h = +match[1];
  const mi = +match[2];
  if (h > 23 || mi > 59) return null;
  return { h, m: mi };
}

/** 解析年/月/日为真实存在的日期；非法返回 null（桌面端 TryGetDate）。 */
function parseDate(year: string, month: string, day: string): Date | null {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || y < 1 || y > 9999) return null;
  if (!Number.isInteger(mo) || mo < 1 || mo > 12) return null;
  if (!Number.isInteger(d) || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  return dt;
}

function defaultEnd(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** 事项编辑器（底部弹层）：标题/开始/截止/标签/优先级/内容，与桌面端 ItemEditorWindow 对齐。 */
export default function ItemEditor({ existing, onClose, onSaved }: Props) {
  const [title, setTitle] = useState(existing?.title ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [tag, setTag] = useState<string>(existing?.tags || TAG_CHOICES[0]);
  const [priority, setPriority] = useState<number>(existing?.priority ?? 3);
  const [error, setError] = useState('');

  const initialStart = useMemo(() => (existing ? new Date(existing.startsAt) : new Date()), [existing]);
  const initialEnd = useMemo(() => {
    if (!existing?.endsAt) return defaultEnd();
    const end = new Date(existing.endsAt);
    return end.getFullYear() === 2099 ? defaultEnd() : end;
  }, [existing]);

  const [start, setStart] = useState<DateFields>(() => ({
    year: String(initialStart.getFullYear()),
    month: String(initialStart.getMonth() + 1),
    day: String(initialStart.getDate()),
    time: `${pad2(initialStart.getHours())}:${pad2(initialStart.getMinutes())}`,
  }));
  const [end, setEnd] = useState<DateFields>(() => ({
    year: String(initialEnd.getFullYear()),
    month: String(initialEnd.getMonth() + 1),
    day: String(initialEnd.getDate()),
    time: `${pad2(initialEnd.getHours())}:${pad2(initialEnd.getMinutes())}`,
  }));

  const endBlank = end.year.trim() === '' && end.month.trim() === '' && end.day.trim() === '';

  const setStartField = (k: keyof DateFields, v: string) => {
    setStart((prev) => ({ ...prev, [k]: v }));
    setError('');
  };
  const setEndField = (k: keyof DateFields, v: string) => {
    setEnd((prev) => ({ ...prev, [k]: v }));
    setError('');
  };

  const handleSave = async () => {
    let finalTitle = title.trim();
    if (!finalTitle) {
      finalTitle = sanitizeSegment(notes.replace(/\r|\n/g, ' ').trim().slice(0, 15));
    }
    if (!finalTitle) {
      setError('请输入标题或内容');
      return;
    }

    const startDate = parseDate(start.year, start.month, start.day);
    if (!startDate) {
      setError('开始日期不合法，请检查年 / 月 / 日');
      return;
    }

    let endOffset: Date;
    if (endBlank) {
      endOffset = LONG_TERM_SENTINEL;
    } else {
      const endDate = parseDate(end.year, end.month, end.day);
      if (!endDate) {
        setError('截止日期不合法，请检查年 / 月 / 日（截止留空表示长期事项）');
        return;
      }
      const t = parseTime(end.time) ?? parseTime(start.time);
      endOffset = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate(), t?.h ?? 12, t?.m ?? 0);
    }

    const startTime = parseTime(start.time);
    const startOffset = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
      startTime?.h ?? new Date().getHours(),
      startTime?.m ?? new Date().getMinutes(),
    );

    const nowIso = new Date().toISOString();
    const item: ScheduleEvent = {
      id: existing?.id ?? 0,
      fileName: existing?.fileName ?? null,
      title: finalTitle,
      notes,
      startsAt: startOffset.toISOString(),
      endsAt: endOffset.toISOString(),
      priority,
      tags: tag,
      allDay: false,
      location: '',
      createdAt: existing?.createdAt ?? nowIso,
      updatedAt: nowIso,
    };

    try {
      if (existing) {
        await store.update(existing, item);
      } else {
        await store.insert(item);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="sheet-overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-header">
          <span>{existing ? '编辑事项' : '新增事项'}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <input
          className="input title-input"
          placeholder="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        <DateRow label="开始" fields={start} onChange={setStartField} />
        <DateRow label="截止" fields={end} onChange={setEndField} hint={endBlank ? '留空 = 长期事项' : undefined} />

        <div className="field-row">
          <span className="field-label">标签</span>
          <div className="chip-row">
            {TAG_CHOICES.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip${tag === t ? ' active' : ''}`}
                onClick={() => setTag(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="field-row">
          <span className="field-label">优先级</span>
          <div className="chip-row">
            {[1, 2, 3, 4].map((p) => (
              <button
                key={p}
                type="button"
                className={`chip${priority === p ? ' active' : ''}`}
                onClick={() => setPriority(p)}
              >
                {PRIORITY_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        <textarea
          className="input notes-input"
          placeholder="内容（支持 Markdown）"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />

        {error && <div className="editor-error">{error}</div>}

        <div className="sheet-actions">
          <button type="button" className="btn" onClick={onClose}>
            取消
          </button>
          <button type="button" className="btn primary" onClick={handleSave}>
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

interface DateRowProps {
  label: string;
  fields: DateFields;
  onChange: (k: keyof DateFields, v: string) => void;
  hint?: string;
}

function DateRow({ label, fields, onChange, hint }: DateRowProps) {
  return (
    <div className="date-row">
      <span className="field-label">{label}</span>
      <input className="input num year" inputMode="numeric" maxLength={4} placeholder="年" value={fields.year} onChange={(e) => onChange('year', e.target.value)} />
      <input className="input num" inputMode="numeric" maxLength={2} placeholder="月" value={fields.month} onChange={(e) => onChange('month', e.target.value)} />
      <input className="input num" inputMode="numeric" maxLength={2} placeholder="日" value={fields.day} onChange={(e) => onChange('day', e.target.value)} />
      <input className="input num time" inputMode="numeric" maxLength={5} placeholder="时:分" value={fields.time} onChange={(e) => onChange('time', e.target.value)} />
      {hint && <span className="date-hint">{hint}</span>}
    </div>
  );
}
