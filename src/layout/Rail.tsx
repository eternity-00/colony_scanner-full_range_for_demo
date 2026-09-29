import {TABS, tabsFor, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';
import {APP_VERSION} from '../config/defines.ts';

interface Props {
  tab: TabKey;
  isAdmin: boolean;
  operator: string;
  clock: string;
  day: string;
  onSelect: (tab: TabKey) => void;
  onRole: () => void;
  onExit: () => void;
}

const KO = new Map(TABS.map(([key, ko]) => [key, ko]));

/**
 * 좌측 아이콘 레일 (D2).
 *
 * D1 의 상단바 + 서랍 메뉴를 대신한다. 글자를 빼고 아이콘만 남겨 64px 에 들어가고,
 * 그만큼 본문이 넓어진다. 이름은 aria-label 과 title 로 남는다 — 보이지 않을 뿐
 * 사라진 것이 아니다.
 *
 * 맨 위는 계정이다. 화면이 바뀌어도 누가 쓰고 있는지가 늘 같은 자리에 있다.
 * 시계도 여기 둔다 — 헤더에서 한 칸을 되찾는다.
 */
export function Rail({tab, isAdmin, operator, clock, day, onSelect, onRole, onExit}: Props) {
  const role = isAdmin ? '관리자' : '분석자';
  return (
    <nav className="rail">
      <button className="rail-acc" onClick={onRole} title={`${operator} · ${role}`}>
        <span>{operator.slice(0, 1)}</span>
        <em>{role}</em>
      </button>
      <div className="rail-clock">
        {day}
        <b>{clock}</b>
      </div>
      <div className="rail-nav">
        {tabsFor(isAdmin).map(([key]) => (
          <button
            key={key}
            className={tab === key ? 'on' : ''}
            onClick={() => onSelect(key)}
            aria-label={KO.get(key)}
            title={KO.get(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            <TabIcon tab={key} />
          </button>
        ))}
      </div>
      <span className="rail-ver">{APP_VERSION.replace(/^v/, '')}</span>
      <button className="rail-exit" onClick={onExit} aria-label="가상 머신 종료" title="가상 머신 종료">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
          <path d="M14 4h5v16h-5" />
          <path d="M10 12H3" />
          <path d="M6 8l-4 4 4 4" />
        </svg>
      </button>
    </nav>
  );
}
