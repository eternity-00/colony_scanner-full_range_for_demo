import logoUrl from '../assets/logo.svg';
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
  /** 09-30 */
  day: string;
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
 * 계정은 좌측 레일에 있다. 시계는 값 줄의 오른쪽 끝에 붙는다 —
 * 하나뿐인 값이라는 점은 같고, 초가 바뀌는 줄이라 읽는 값들과 떨어뜨린다.
 */
export function Header({state, tab, clock, day, onDevice, onPlate, onNeedAdmin}: Props) {
  const devices = state.devices;
  const linked = devices.filter(d => d.connected).length;
  const abnormal = devices.some(tempAbnormal);
  const name = NAME.get(tab);


  const avg = (pick: (d: (typeof devices)[number]) => number) =>
    (devices.reduce((a, d) => a + pick(d), 0) / (devices.length || 1)).toFixed(1);

  return (
    <header>
      <span className="hd-mode">
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
        {/* 초까지 바뀌는 줄이라 다른 값들과 붙여 두면 옆 글자가 흔들려 보인다.
            오른쪽 끝으로 밀고 세로선도 두지 않는다. */}
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

        {/*
          * 제품 로고 원본(2단 락업). 글자와 표식이 한 파일이라 직접 조판하지 않는다.
          * 받은 SVG 원본을 그대로 쓴다. 폰트 참조 없는 순수 도형이라 배율이 바뀌어도
          * 흐려지지 않고, 파이의 UI_SCALE 이 패널마다 달라도 같은 선으로 나온다.
          *
          * public/ 이 아니라 import 로 들여오는 이유: 번들러가 파일 내용으로 이름을
          * 지어 주므로(logo-<해시>.svg) 로고가 바뀌면 주소도 바뀐다. 고정된 주소면
          * 브라우저가 옛 그림을 계속 들고 있어서, 바꿔 올려도 파이 화면이 그대로다.
          */}
        <img className="wm" src={logoUrl} alt="ColonyScanner" />
      </span>
    </header>
  );
}
