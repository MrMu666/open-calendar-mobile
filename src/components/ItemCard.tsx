import { useState } from 'react';
import type { ScheduleEvent } from '../types';
import { store } from '../lib/store';
import { collapseWhitespace, hmText, isLongTerm, mdText } from '../lib/format';
import { itemBackground, metaText, PRIORITY_LABELS, tagBackground } from '../lib/tags';

interface Props {
  event: ScheduleEvent;
  /** 打开编辑器（传入事项 = 编辑）。 */
  onEdit: (e: ScheduleEvent) => void;
  /** 完成 / 长期 / 删除 等操作后的刷新回调。 */
  onAction: () => void;
}

/** 事项条：左日期两行、中标题+内容预览、右标签+编辑；点击展开详情与操作。 */
export default function ItemCard({ event, onEdit, onAction }: Props) {
  const [expanded, setExpanded] = useState(false);

  const start = new Date(event.startsAt);
  const end = event.endsAt ? new Date(event.endsAt) : start;
  const endText = isLongTerm(event.endsAt) ? '-' : mdText(end);
  const hasContent = event.notes.trim().length > 0;
  const hasTag = event.tags.trim().length > 0;

  const handleMarkLongTerm = async () => {
    await store.markLongTerm(event);
    onAction();
  };

  const handleMarkCompleted = async () => {
    await store.markCompleted(event);
    onAction();
  };

  const handleDelete = async () => {
    if (!window.confirm(`删除「${event.title}」？文件将移入 deleted/ 目录。`)) return;
    await store.moveToDeleted(event);
    onAction();
  };

  return (
    <div className="item-card-wrap">
      <div
        className="item-card"
        style={{ background: itemBackground(event.priority) }}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="item-dates">
          <span className="item-start">{mdText(start)}</span>
          <span className="item-end">{endText}</span>
        </div>
        <div className="item-main">
          <div className="item-title-row">
            <span className="item-title">{event.title}</span>
            {hasTag && (
              <span className="item-tag" style={{ background: tagBackground(event.tags) }}>
                {event.tags}
              </span>
            )}
          </div>
          {hasContent && <div className="item-preview">{collapseWhitespace(event.notes)}</div>}
          <div className="item-meta">
            {metaText(event)}
            {!isLongTerm(event.endsAt) && end.getTime() < Date.now() && ' · 已归档'}
          </div>
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="编辑"
          onClick={(e) => {
            e.stopPropagation();
            onEdit(event);
          }}
        >
          ✏️
        </button>
      </div>

      {expanded && (
        <div className="item-detail">
          <div className="item-detail-notes">{hasContent ? event.notes : '（无内容）'}</div>
          <div className="item-detail-times">
            {`开始 ${mdText(start)} ${hmText(start)} · 截止 ${endText === '-' ? '长期' : `${mdText(end)} ${hmText(end)}`} · ${PRIORITY_LABELS[event.priority] ?? '一般'}`}
          </div>
          <div className="item-actions">
            <button type="button" className="btn small" onClick={handleMarkLongTerm}>
              设为长期事项
            </button>
            <button type="button" className="btn small" onClick={handleMarkCompleted}>
              设为已完成
            </button>
            <button type="button" className="btn small danger" onClick={handleDelete}>
              删除
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
