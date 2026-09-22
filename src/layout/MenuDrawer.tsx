import {TABS, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';

interface Props {
  open: boolean;
  tab: TabKey;
  onSelect: (tab: TabKey) => void;
  onExit: () => void;
  onClose: () => void;
}

export function MenuDrawer({open, tab, onSelect, onExit, onClose}: Props) {
  return (
    <nav className={`drawer ${open ? 'open' : ''}`}>
      <div className="drawer-head">
        <b>메뉴</b>
        <button className="drawer-x" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      <div className="drawer-list">
        {TABS.map(([key, ko, en]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => onSelect(key)}>
            <i className="di">
              <TabIcon tab={key} />
            </i>
            <b>{ko}</b>
            <small>{en}</small>
          </button>
        ))}
      </div>
      <div className="drawer-foot">
        <button className="exit-btn" onClick={onExit}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
            <path d="M10 12H3M3 12l3-3M3 12l3 3" />
          </svg>
          가상 머신 종료
        </button>
      </div>
    </nav>
  );
}
