import { useEffect, useState } from 'react';
import type { ScheduleEvent } from '../types';
import { store } from '../lib/store';
import ItemCard from './ItemCard';

interface Props {
  refreshTick: number;
  onEdit: (e: ScheduleEvent) => void;
  onNew: () => void;
}

/** 事项视图：未到期事项列表（对应桌面端「未到期事项」）。 */
export default function TasksView({ refreshTick, onEdit, onNew }: Props) {
  const [items, setItems] = useState<ScheduleEvent[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const all = await store.getItems();
      const now = Date.now();
      const upcoming = all
        .filter((i) => i.endsAt == null || new Date(i.endsAt).getTime() >= now)
        .slice(0, 200);
      if (!cancelled) {
        setItems(upcoming);
        setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return (
    <div className="view tasks-view">
      <div className="tasks-header">
        <span className="tasks-title">未到期事项</span>
      </div>
      <div className="tasks-list">
        {loaded && items.length === 0 ? (
          <div className="empty-text">暂无未到期事项</div>
        ) : (
          items.map((e) => (
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
