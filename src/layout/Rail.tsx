import {useEffect, useState} from 'react';
import {APP_VERSION, TABS, tabsFor, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';

interface Props {
  tab: TabKey;
  isAdmin: boolean;
  onSelect: (tab: TabKey) => void;
  onExit: () => void;
}

const KO = new Map(TABS.map(([key, ko]) => [key, ko]));
/*
 * 판에 적는 짧은 이름. 「사용자 설정」은 94px 칸을 넘어 모서리 밖으로 삐져
 * 나간다. 여기서는 어차피 설정이 하나뿐이라 두 글자면 헷갈릴 일이 없다.
 * 화면 이름(헤더·aria-label)은 긴 쪽을 그대로 쓴다.
 */
const SHORT: Partial<Record<TabKey, string>> = {settings: '설정'};

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
 *
 * 계정과 시계는 헤더로 올렸다. 판이 숨는 순간 그 둘도 같이 사라지는데,
 * 지금 몇 시인지와 누가 쓰고 있는지는 늘 보여야 하는 값이다.
 */
export function Rail({tab, isAdmin, onSelect, onExit}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const fn = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', fn);
    return () => document.removeEventListener('keydown', fn);
  }, [open]);

  /*
   * 가장자리를 밀어도 열린다.
   *
   * 손잡이는 26px 이라 조준해야 닿는다. 화면 왼쪽 끝 어디를 잡아 오른쪽으로
   * 밀어도 열리게 하면, 손잡이는 「여기에 뭔가 있다」는 표시로만 남고 실제로는
   * 아무 데나 밀면 된다. 열린 뒤에는 판을 왼쪽으로 밀어 닫는다.
   *
   * 가로로 민 것만 센다(|dx| > |dy|). 세로로 끄는 것은 목록을 넘기는
   * 동작이라 dragscroll 이 맡는다 — 둘이 같은 손짓을 두고 다투면 안 된다.
   */
  useEffect(() => {
    /** 화면 왼쪽에서 이 안쪽을 잡아야 「가장자리에서 민 것」으로 본다. */
    const EDGE = 56;
    /** 이만큼 밀어야 연다/닫는다. 스쳐 지나간 손가락에 열리지 않을 만큼. */
    const GO = 44;
    let x0 = 0;
    let y0 = 0;
    let dir = 0;

    const swallow = (e: Event) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const down = (e: PointerEvent) => {
      const el = e.target as Element | null;
      if (e.button !== 0) {
        dir = 0;
        return;
      }
      const inRail = !!el?.closest?.('.rail, .rail-grip');
      dir = !open && e.clientX <= EDGE ? 1 : open && inRail ? -1 : 0;
      x0 = e.clientX;
      y0 = e.clientY;
    };

    const move = (e: PointerEvent) => {
      if (!dir) return;
      const dx = e.clientX - x0;
      const dy = e.clientY - y0;
      if (Math.abs(dx) < GO || Math.abs(dy) >= Math.abs(dx)) return;
      const want = dir === 1 ? dx > 0 : dx < 0;
      dir = 0;
      if (!want) return;
      setOpen(dx > 0);
      // 민 뒤에 따라오는 click 한 번을 삼킨다 — 밀었을 뿐인데 손을 뗀 자리의
      // 항목이 눌리면 화면이 엉뚱한 데로 간다.
      document.addEventListener('click', swallow, {capture: true, once: true});
    };

    const up = () => {
      dir = 0;
    };

    document.addEventListener('pointerdown', down, {passive: true});
    document.addEventListener('pointermove', move, {passive: true});
    document.addEventListener('pointerup', up, {passive: true});
    document.addEventListener('pointercancel', up, {passive: true});
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', up);
    };
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
              {/* 이름을 그림 아래 적는다. 아이콘만 두면 처음 쓰는 사람은
                  눌러 봐야 알고, 판이 덮는 방식이라 폭은 공짜다. */}
              <span>{SHORT[key] ?? KO.get(key)}</span>
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
        title={open ? '접기 (왼쪽으로 밀어도 됩니다)' : '펼치기 (가장자리를 밀어도 됩니다)'}
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
