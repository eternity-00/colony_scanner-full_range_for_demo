import type {AppState} from '../api/types.ts';
import {TABS, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';
import {envAlarmActive} from '../utils/plate.ts';

interface Props {
  state: AppState;
  tab: TabKey;
  /** 08:40:29 */
  clock: string;
  /** 2026-09-30 */
  day: string;
  /** 왼쪽 색면(햄버거)을 눌렀을 때 — 서랍을 연다. */
  onMenu: () => void;
  /** 계정 칩을 눌렀을 때 — 말풍선을 연다. */
  onAccount: () => void;
  /** 홈 버튼 — 어느 화면에서든 한 번에 홈으로. */
  onHome: () => void;
}


/**
 * 헤더 (v2.0 · 도안 3-1).
 *
 * 흰 바탕 한 줄. 왼쪽 끝 파란 색면이 곧 메뉴 버튼이다 — 서랍형이라 메뉴가
 * 평소에 보이지 않으므로, 여는 곳은 헤더에서 가장 눈에 띄는 자리여야 한다.
 *
 * 여기에는 **장비 전체에 하나뿐인 값**만 둔다. 배양 진행이나 다음 촬영처럼
 * 플레이트마다 다른 값은 하나만 골라 적는 순간 나머지를 가리는 거짓말이 된다.
 *
 * 알림 종은 없다 — 알람은 홈의 알람 칸이 맡는다.
 */
export function Header({state, tab, clock, day, onMenu, onAccount, onHome}: Props) {
  const devices = state.devices;
  const linked = devices.filter(d => d.connected).length;
  const envAlarm = envAlarmActive(state);
  const role = state.session.role === 'admin' ? '관리자' : '사용자';
  const name = TABS.find(([key]) => key === tab) ?? (tab === 'running' ? (['running', '촬영', 'Capture', false] as const) : undefined);

  return (
    <header>
      {/*
        * 왼쪽 파란 네모 칸 = 메뉴. 사선 없이 일자로 끊는다(혜원님 10/15).
        * 로고는 칸 밖 흰 바탕에 두고, 누르면 홈 — 따로 홈 버튼을 두지 않는다(혜원님 10/15).
        */}
      <div className="hd-brand">
        <button className="hd-menu" onClick={onMenu} aria-label="메뉴 열기">
          <span />
          <span />
          <span />
        </button>
      </div>
      <button
        className="wm wm-home"
        onClick={onHome}
        aria-label="홈으로"
        aria-current={tab === 'overview' ? 'page' : undefined}
      >
        <TabIcon tab="overview" />
        <span>
          Colony<i>Scanner</i>
        </span>
      </button>
      <span className="sub">
        {name?.[1]}
        <em>{name?.[2]}</em>
      </span>

      <div className="head-status">
        {/* 온도·습도 수치는 홈 카드가 맡는다(1차 피드백 2.2: 사용자는 이상 시에만). 헤더는 이상일 때만 알린다. */}
        {envAlarm && (
          <span className="hstat bad">
            환경 이상 <b>온도 · 습도 확인</b>
          </span>
        )}
        <span className={`hstat ${linked === devices.length ? '' : 'bad'}`}>
          <i className="dot" />
          유선 연결{' '}
          <b>
            {linked} / {devices.length}
          </b>
        </span>
        <span className="clock">
          {day} {clock}
        </span>

        <button className={`role-chip ${state.session.role}`} onClick={onAccount}>
          <i>{role.slice(0, 1)}</i>
          <span className="who">{role}</span>
        </button>
      </div>
    </header>
  );
}
