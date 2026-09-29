import type {AppState} from '../api/types.ts';
import {TABS, type TabKey} from '../config/defines.ts';
import {Logo} from '../shared/Logo.tsx';
import {TabIcon} from '../shared/TabIcon.tsx';
import {faultLabel, tempAbnormal} from '../utils/plate.ts';

interface Props {
  state: AppState;
  tab: TabKey;
  onAlert: () => void;
}

const NAME = new Map(TABS.map(([key, ko, en]) => [key, {ko, en}]));

/**
 * 헤더 값 앞에 붙는 선 아이콘.
 *
 * 색면을 쓰지 않는다 — 헤더는 흰 면이고, 여기에 채운 사각을 셋 늘어놓으면
 * 그 아래 통계 타일과 무게가 겹쳐 어느 쪽이 지표인지 흐려진다. 선만 남긴다.
 */
const META_ICON = {
  /* 인큐베이터 — 선반이 있는 함 */
  box: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 10h17M3.5 14.5h17" />
    </>
  ),
  /* 온도 · CO₂ — 온도계 */
  temp: (
    <>
      <path d="M14 14.8V5.5a2 2 0 1 0-4 0v9.3a4 4 0 1 0 4 0z" />
      <path d="M12 9.5v5.6" />
    </>
  ),
  /* 유선 연결 — 플러그와 선 */
  link: (
    <>
      <path d="M9 3.5v5M15 3.5v5" />
      <rect x="6.5" y="8.5" width="11" height="5.5" rx="1.5" />
      <path d="M12 14v6.5" />
    </>
  ),
} as const;

function MetaIcon({kind}: {kind: keyof typeof META_ICON}) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      {META_ICON[kind]}
    </svg>
  );
}

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
 * 시계와 계정은 좌측 레일로 내려갔다.
 */
export function Header({state, tab, onAlert}: Props) {
  const devices = state.devices;
  const faults = devices.filter(d => faultLabel(d)).length;
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
          <MetaIcon kind="box" />
          <span>
            <small>인큐베이터</small>
            <b>Incubator #1</b>
          </span>
        </span>
        <span className="hm">
          <MetaIcon kind="temp" />
          <span>
            <small>온도 · CO₂</small>
            <b className={abnormal ? 'bad' : ''}>
              {avg(d => d.temperature)} ℃ · {avg(d => d.co2)} %
            </b>
          </span>
        </span>
        <span className="hm">
          <MetaIcon kind="link" />
          <span>
            <small>유선 연결</small>
            <b className={linked === devices.length ? '' : 'bad'}>
              {linked} / {devices.length}
            </b>
          </span>
        </span>
      </span>

      <span className="hd-right">
        {/* 알림은 장비 문제 건수다. 0 이면 숫자를 붙이지 않는다 — 없는 것을
            0 으로 적으면 눈이 한 번 더 확인해야 한다. */}
        <button className="hd-bell" onClick={onAlert} aria-label={`장비 알림 ${faults}건`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9">
            <path d="M5 18h14l-2-3V10a5 5 0 0 0-10 0v5z" />
            <path d="M10 21h4" />
          </svg>
          {faults > 0 && <i>{faults}</i>}
        </button>
        <span className="wm">
          <Logo size={23} />
          <b>
            Colony<i>Scanner</i>
          </b>
        </span>
      </span>
    </header>
  );
}
