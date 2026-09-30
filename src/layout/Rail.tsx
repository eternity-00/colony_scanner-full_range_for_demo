import {useEffect, useState} from 'react';
import {APP_VERSION, TABS, tabsFor, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';

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
 * 좌측 레일 (v1.6) — 본문 위에 떠 있는 판.
 *
 * v1.5 까지는 레일이 본문 옆에 붙어 72px 을 늘 먹었다. 여기서는 판을 띄워
 * 본문 위로 덮는다. 그래서 **본문 자리가 고정된다** — 판이 들어오고 나가도
 * 아래 내용이 한 픽셀도 움직이지 않는다. 늘 비워 두는 것은 손잡이가 설
 * 26px 뿐이다.
 *
 * 접었다 펴서 버는 74px 자체는 크지 않다. 이 꼴을 쓰는 진짜 이유는 본문이
 * 어떤 상태에서도 같은 크기라는 점이다 — 트레이 8단이 늘 같은 칸에 그려진다.
 *
 * 항목을 고르면 판은 스스로 닫힌다. 고르러 열었지 보려고 연 것이 아니다.
 */
export function Rail({tab, isAdmin, operator, clock, day, onSelect, onRole, onExit}: Props) {
  const [open, setOpen] = useState(false);
  const role = isAdmin ? '관리자' : '분석자';

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [open]);

  const go = (key: TabKey) => {
    onSelect(key);
    setOpen(false);
  };

  return (
    <>
      {/* 판 밖을 눌러도 닫힌다. 옅게 덮어 지금 고르는 중임을 말한다. */}
      {open && <div className="rail-scrim" role="presentation" onMouseDown={() => setOpen(false)} />}

      <nav className={`rail ${open ? 'on' : ''}`} aria-hidden={!open}>
        <button
          className="rail-acc"
          onClick={onRole}
          title={`${operator} · ${role}`}
          tabIndex={open ? 0 : -1}
        >
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
              onClick={() => go(key)}
              aria-label={KO.get(key)}
              title={KO.get(key)}
              aria-current={tab === key ? 'page' : undefined}
              tabIndex={open ? 0 : -1}
            >
              <TabIcon tab={key} />
            </button>
          ))}
        </div>
        <span className="rail-ver">{APP_VERSION.replace(/^v/, '')}</span>
        <button
          className="rail-exit"
          onClick={onExit}
          aria-label="가상 머신 종료"
          title="가상 머신 종료"
          tabIndex={open ? 0 : -1}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M14 4h5v16h-5" />
            <path d="M10 12H3" />
            <path d="M6 8l-4 4 4 4" />
          </svg>
        </button>
      </nav>

      {/*
        * 손잡이 — 판의 오른쪽 모서리에 걸려 있어 판이 빠지면 이것만 남는다.
        * 화살표가 상태를 말한다: 접혀 있으면 ›, 펼쳐져 있으면 ‹.
        * 세로로 긴 것은 손가락이 조준하지 않아도 닿게 하기 위함이다.
        */}
      <button
        className={`rail-grip ${open ? 'on' : ''}`}
        onClick={() => setOpen(v => !v)}
        aria-label={open ? '메뉴 접기' : '메뉴 펼치기'}
        aria-expanded={open}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={open ? 'M15 6l-6 6 6 6' : 'M9 6l6 6-6 6'} />
        </svg>
      </button>
    </>
  );
}
