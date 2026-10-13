import type {AppState} from '../api/types.ts';
import type {TabKey} from '../config/defines.ts';
import {AlertBell} from './AlertBell.tsx';
import {tempAbnormal} from '../utils/plate.ts';

interface Props {
  state: AppState;
  tab: TabKey;
  /** 08:40:29 */
  clock: string;
  /** 2026-09-30 */
  day: string;
  operator: string;
  /** 왼쪽 색면(햄버거)을 눌렀을 때 — 서랍을 연다. */
  onMenu: () => void;
  /** 계정 칩을 눌렀을 때 — 말풍선을 연다. */
  onAccount: () => void;
  /** 관리자가 알림에서 곧장 장비 화면으로 넘어간다. */
  onDevice: () => void;
  /** 알림에서 플레이트를 손보러 상세로 넘어간다. */
  onPlate: (deviceId: number, slot: number) => void;
  /** 분석자가 장비 오류를 눌렀을 때. */
  onNeedAdmin: (where: string, what: string) => void;
}

/**
 * 상호는 고정하고 오른쪽 부제만 화면에 따라 바꾼다.
 * 현황 화면이 "Colony Scanner | Incubator #1" 이라, 다른 화면은 그 자리에
 * 화면 이름을 넣어 같은 자리에서 위치를 알 수 있게 한다.
 */
const SUBTITLE: Record<TabKey, string> = {
  overview: 'Incubator #1',
  detail: '상세',
  register: '플레이트 등록',
  running: '촬영',
  history: '이력',
  device: '장비',
  settings: '사용자 설정',
};

/**
 * 헤더 (v1.7 · 도안 3-1).
 *
 * 흰 바탕 한 줄. 왼쪽 끝 파란 색면이 곧 메뉴 버튼이다 — 서랍형이라 메뉴가
 * 평소에 보이지 않으므로, 여는 곳은 헤더에서 가장 눈에 띄는 자리여야 한다.
 *
 * 여기에는 **장비 전체에 하나뿐인 값**만 둔다. 배양 진행이나 다음 촬영처럼
 * 플레이트마다 다른 값은 하나만 골라 적는 순간 나머지를 가리는 거짓말이 된다.
 */
export function Header({state, tab, clock, day, operator, onMenu, onAccount, onDevice, onPlate, onNeedAdmin}: Props) {
  const devices = state.devices;
  const linked = devices.filter(d => d.connected).length;
  const abnormal = devices.some(tempAbnormal);
  const role = state.session.role === 'admin' ? '관리자' : '분석자';

  const avg = (pick: (d: (typeof devices)[number]) => number) =>
    (devices.reduce((a, d) => a + pick(d), 0) / (devices.length || 1)).toFixed(1);

  return (
    <header>
      {/* 색면 자체를 버튼으로 쓴다 — 헤더 높이만큼 넉넉한 터치 타깃이다. */}
      <button className="hd-menu" onClick={onMenu} aria-label="메뉴 열기">
        <span />
        <span />
        <span />
      </button>
      <span className="wm">
        Colony<i>Scanner</i>
      </span>
      <span className="sub">{SUBTITLE[tab]}</span>

      <div className="head-status">
        <span className={`hstat ${abnormal ? 'bad' : ''}`}>
          온도 · CO₂{' '}
          <b>
            {avg(d => d.temperature)} ℃ · {avg(d => d.co2)} %
          </b>
        </span>
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

        {/* 알림은 장비 문제 건수다. 목록은 종 밑에 붙는 말풍선이다. */}
        <AlertBell state={state} onDevice={onDevice} onPlate={onPlate} onNeedAdmin={onNeedAdmin} />

        <button className={`role-chip ${state.session.role}`} onClick={onAccount}>
          <i>{operator.slice(0, 1)}</i>
          <span className="who">
            {operator} · {role}
          </span>
        </button>
      </div>
    </header>
  );
}
