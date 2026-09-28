import {APP_VERSION, tabsFor, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';

interface Props {
  open: boolean;
  tab: TabKey;
  isAdmin: boolean;
  onSelect: (tab: TabKey) => void;
  onExit: () => void;
  onClose: () => void;
}

/** 빌드 시각을 MM-DD HH:MM 으로. 같은 날 여러 번 올리므로 시각까지 필요하다. */
function buildStamp() {
  const d = new Date(__BUILD_AT__);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

export function MenuDrawer({open, tab, isAdmin, onSelect, onExit, onClose}: Props) {
  return (
    <nav className={`drawer ${open ? 'open' : ''}`}>
      <div className="drawer-head">
        <b>메뉴</b>
        <button className="drawer-x" onClick={onClose} aria-label="닫기">
          ×
        </button>
      </div>
      <div className="drawer-list">
        {tabsFor(isAdmin).map(([key, ko, en]) => (
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
        {/* 파이에 여러 버전이 나란히 있어 어느 것이 도는지 화면으로 알 수 있어야 한다. */}
        <span className="drawer-ver">
          {APP_VERSION}
          <em>{buildStamp()}</em>
        </span>
      </div>
    </nav>
  );
}
