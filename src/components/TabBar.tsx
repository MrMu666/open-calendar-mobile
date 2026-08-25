import type { Tab } from '../App';

interface Props {
  tab: Tab;
  onChange: (tab: Tab) => void;
}

/** 底部三栏：日历 / 事项 / 设置。 */
export default function TabBar({ tab, onChange }: Props) {
  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    {
      key: 'calendar',
      label: '日历',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11zM7 11h2v2H7v-2zm4 0h2v2h-2v-2zm4 0h2v2h-2v-2z" />
        </svg>
      ),
    },
    {
      key: 'tasks',
      label: '事项',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M9 11.7l-2.15-2.15L5.5 10.9 9 14.4l5.5-5.5-1.35-1.35L9 11.7zM19 4h-1V2h-2v2H8V2H6v2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 16H5V9h14v11z" />
        </svg>
      ),
    },
    {
      key: 'settings',
      label: '设置',
      icon: (
        <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M12 15.5A3.5 3.5 0 0 1 8.5 12 3.5 3.5 0 0 1 12 8.5a3.5 3.5 0 0 1 3.5 3.5 3.5 3.5 0 0 1-3.5 3.5m7.43-2.53c.04-.32.07-.64.07-.97s-.03-.66-.07-1l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.31-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.37-2.65A.506.506 0 0 0 14 2h-4c-.25 0-.46.18-.5.42l-.37 2.65c-.59.24-1.17.56-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64L4.57 11c-.04.34-.07.67-.07 1s.03.66.07 1l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.31.61.22l2.49-1c.52.4 1.1.74 1.69.98l.37 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.37-2.65c.59-.24 1.17-.56 1.69-.98l2.49 1c.22.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65z" />
        </svg>
      ),
    },
  ];

  return (
    <nav className="tab-bar">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          className={`tab-item${tab === t.key ? ' active' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
