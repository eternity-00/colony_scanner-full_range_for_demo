import {useEffect} from 'react';
import {tabsFor, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';

interface Props {
  open: boolean;
  tab: TabKey;
  isAdmin: boolean;
  onSelect: (tab: TabKey) => void;
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
 *
 * 종료와 버전은 두지 않는다 — 둘 다 사용자 설정에 있다. 서랍 높이는 전부
 * 메뉴 칸이 쓴다.
 */
export function MenuDrawer({open, tab, isAdmin, onSelect, onClose}: Props) {
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
        {/* 머리 — 헤더의 메뉴 버튼과 같은 자리 · 같은 파란 칸에 닫기(×)를 둔다. 누른 자리에서
            그대로 닫힌다. 옆에는 헤더와 같은 글자 로고(혜원님 10/14). */}
        <div className="drawer-head">
          <button className="drawer-x" onClick={onClose} aria-label="메뉴 닫기" tabIndex={open ? 0 : -1}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <span className="dh-title">
            <b>
              Colony<i>Scanner</i>
            </b>
            <small>메뉴</small>
          </span>
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
      </nav>
    </>
  );
}
