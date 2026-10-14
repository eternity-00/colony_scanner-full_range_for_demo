import {useEffect} from 'react';
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

/**
 * 메뉴 서랍 (v2.0 · 도안 3-1).
 *
 * 헤더 왼쪽 색면을 누르면 왼쪽에서 나온다. 항목은 한글 이름을 크게, 영문을
 * 작게 적는다. 항목을 고르면 서랍은 스스로 닫힌다 — 고르러 열었지 보려고
 * 연 것이 아니다.
 *
 * 항목 칸은 1.6 의 판보다 크게 잡았다(2차 피드백: 메뉴 버튼 1.2~1.5배).
 * 장갑을 낀 손가락도 옆 칸을 건드리지 않도록 칸 높이와 칸 사이를 같이 키운다.
 */
export function MenuDrawer({open, tab, isAdmin, onSelect, onExit, onClose}: Props) {
  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [open, onClose]);

  return (
    <>
      {open && <div className="drawer-scrim" role="presentation" onMouseDown={onClose} />}
      <nav className={`drawer ${open ? 'open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <b>메뉴</b>
          <button className="drawer-x" onClick={onClose} aria-label="닫기" tabIndex={open ? 0 : -1}>
            ×
          </button>
        </div>
        <div className="drawer-list">
          {tabsFor(isAdmin).map(([key, ko, en]) => (
            <button
              key={key}
              className={tab === key ? 'active' : ''}
              onClick={() => onSelect(key)}
              aria-current={tab === key ? 'page' : undefined}
              tabIndex={open ? 0 : -1}
            >
              <i className="di">
                <TabIcon tab={key} />
              </i>
              <b>{ko}</b>
              <small>{en}</small>
            </button>
          ))}
        </div>
        {/* 하루에 한 번 쓸까 말까 한 것이라 맨 아래에 둔다. 실수로 눌려도 확인 팝업이 받는다. */}
        <div className="drawer-foot">
          <button className="exit-btn" onClick={onExit} tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 4h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-3" />
              <path d="M10 12H3M3 12l3-3M3 12l3 3" />
            </svg>
            종료
          </button>
          <em>{APP_VERSION.replace(/^v/, '')}</em>
        </div>
      </nav>
    </>
  );
}
