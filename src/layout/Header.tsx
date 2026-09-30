import logoUrl from '../assets/logo-white.svg';
import type {AppState} from '../api/types.ts';
import {TABS, type TabKey} from '../config/defines.ts';
import {TabIcon} from '../shared/TabIcon.tsx';
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
  /** 계정 칩을 눌렀을 때 — 말풍선을 연다. */
  onAccount: () => void;
  /** 관리자가 알림에서 곧장 장비 화면으로 넘어간다. */
  onDevice: () => void;
  /** 알림에서 플레이트를 손보러 상세로 넘어간다. */
  onPlate: (deviceId: number, slot: number) => void;
  /** 분석자가 장비 오류를 눌렀을 때. */
  onNeedAdmin: (where: string, what: string) => void;
}

const NAME = new Map(TABS.map(([key, ko, en]) => [key, {ko, en}]));

/**
 * 헤더 (D2).
 *
 * 왼쪽 색면에 지금 보고 있는 화면을 못박고, 그 오른쪽에 작은 라벨 + 큰 값을 한 쌍씩
 * 늘어놓는다. 칩을 늘어놓는 것보다 읽는 순서가 생긴다.
 *
 * 여기에는 **장비 전체에 하나뿐인 값**만 둔다. 배양 진행이나 다음 촬영처럼
 * 플레이트마다 다른 값은 하나만 골라 적는 순간 나머지를 가리는 거짓말이 된다 —
 * 그건 스캐너 카드의 NEXT 와 상세 화면이 각자 말한다.
 *
 * v1.6 에서 자리를 다시 나눴다. 레일이 떠 있는 판이 되면서 늘 보이지 않게
 * 됐으므로, 늘 보여야 하는 것(로고 · 시각 · 누가 쓰고 있는지)을 헤더로 올렸다.
 * 왼쪽 파란 색면 하나에 로고와 화면 이름을 함께 담는다 — 둘을 따로 두면
 * 파란 덩어리가 둘이 되어 어느 쪽이 「지금 화면」인지 흐려진다.
 */
export function Header({state, tab, clock, day, operator, onAccount, onDevice, onPlate, onNeedAdmin}: Props) {
  const devices = state.devices;
  const linked = devices.filter(d => d.connected).length;
  const abnormal = devices.some(tempAbnormal);
  const name = NAME.get(tab);
  const role = state.session.role === 'admin' ? '관리자' : '분석자';


  const avg = (pick: (d: (typeof devices)[number]) => number) =>
    (devices.reduce((a, d) => a + pick(d), 0) / (devices.length || 1)).toFixed(1);

  return (
    <header>
      <span className="hd-mode">
        {/*
          * 제품 로고 원본(2단 락업)에서 색만 흰색으로 바꾼 판. 글자와 표식이 한
          * 파일이라 직접 조판하지 않는다. 폰트 참조 없는 순수 도형이라 배율이
          * 바뀌어도 흐려지지 않고, 파이의 UI_SCALE 이 패널마다 달라도 같은 선이다.
          *
          * public/ 이 아니라 import 로 들여오는 이유: 번들러가 파일 내용으로 이름을
          * 지어 주므로(logo-<해시>.svg) 로고가 바뀌면 주소도 바뀐다. 고정된 주소면
          * 브라우저가 옛 그림을 계속 들고 있어서, 바꿔 올려도 파이 화면이 그대로다.
          */}
        <img className="wm" src={logoUrl} alt="ColonyScanner" />
        <i className="hd-bar" aria-hidden="true" />
        <TabIcon tab={tab} />
        <span className="hd-mode-t">
          <b>{name?.ko}</b>
          <em>{name?.en}</em>
        </span>
      </span>

      <span className="hd-meta">
        <span className="hm">
          <small>인큐베이터</small>
          <b>Incubator #1</b>
        </span>
        <span className="hm">
          <small>온도 · CO₂</small>
          <b className={abnormal ? 'bad' : ''}>
            {avg(d => d.temperature)} ℃ · {avg(d => d.co2)} %
          </b>
        </span>
        <span className="hm">
          <small>유선 연결</small>
          <b className={linked === devices.length ? '' : 'bad'}>
            {linked} / {devices.length}
          </b>
        </span>
        {/* 날짜·시각도 장비에 하나뿐인 값이라 같은 줄에 둔다. 전에는 알림 종
            옆에 따로 있었는데, 읽는 값이 둘로 갈려 눈이 두 번 움직였다. */}
        <span className="hm hm-clock">
          <small>{day}</small>
          <b>{clock}</b>
        </span>
      </span>

      <span className="hd-right">
        {/* 알림은 장비 문제 건수다. 0 이면 숫자를 붙이지 않는다 — 없는 것을
            0 으로 적으면 눈이 한 번 더 확인해야 한다.
            목록은 화면을 덮는 팝업이 아니라 종 밑에 붙는 말풍선이다 — 읽는
            자리라, 누른 곳에 붙어 있어야 어디서 나온 것인지가 눈으로 이어진다. */}
        <AlertBell
          state={state}
          onDevice={onDevice}
          onPlate={onPlate}
          onNeedAdmin={onNeedAdmin}
        />

        {/* 누가 쓰고 있는지. 레일이 숨으면서 갈 곳이 없어져 여기로 올라왔다. */}
        <button className="hd-acc" onClick={onAccount} title={`${operator} · ${role}`}>
          <i aria-hidden="true">{operator.slice(0, 1)}</i>
          <em>{role}</em>
        </button>

      </span>
    </header>
  );
}
