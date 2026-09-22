import {useEffect, useRef, useState} from 'react';
import type {AppState} from '../api/types.ts';
import type {TabKey} from '../config/defines.ts';
import {hms, ymd} from '../utils/datetime.ts';
import {tempAbnormal} from '../utils/plate.ts';

interface Props {
  state: AppState;
  tab: TabKey;
  operator: string;
  onRole: () => void;
  onMenu: () => void;
}

const TITLES = (state: AppState): Record<TabKey, [string, string]> => ({
  overview: ['COLONY SCANNER', 'INCUBATOR #1'],
  detail: ['스캐너 상세', '플레이트 단위 촬영 이력'],
  register: ['플레이트 등록', '수납 위치 · 투입 시각'],
  running: ['촬영 진행', '외부 장비 엔진 연결'],
  history: ['이력 · 검색', '촬영 · 전송 기록'],
  device: ['장비 상태', '모듈 · 통신 · 로그'],
  settings: [
    '설정',
    state.session.role === 'admin' ? '관리자 권한으로 접속됨' : '분석자 권한으로 접속됨',
  ],
});

export function Header({state, tab, operator, onRole, onMenu}: Props) {
  const [, tick] = useState(0);
  const offset = useRef(0);
  offset.current = state.serverTime - Date.now();

  useEffect(() => {
    const t = setInterval(() => tick(x => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now() + offset.current;
  const devices = state.devices;
  const errors = devices.filter(d => d.fault || d.doorOpen).length;
  const linked = devices.filter(d => d.connected).length;
  const titles = TITLES(state);

  // 피드백 2.2 — 인큐베이터 온도 현재값은 관리자에게만 상시 노출하고,
  // 분석자에게는 목표 범위를 벗어났을 때만 보여준다.
  const abnormal = devices.some(tempAbnormal);
  const showTemperature = state.session.role === 'admin' || abnormal;

  return (
    <header>
      <button className="burger" onClick={onMenu} aria-label="메뉴">
        <span />
        <span />
        <span />
      </button>
      <div className="brand">
        <span>{titles[tab]?.[0]}</span>
        <em />
        <small>{titles[tab]?.[1]}</small>
      </div>
      <div className="head-status">
        {showTemperature && (
          <span className={`hstat ${abnormal ? 'bad' : ''}`}>
            {(devices.reduce((a, d) => a + d.temperature, 0) / devices.length).toFixed(1)} ℃
          </span>
        )}
        <span className="hstat">
          CO₂ {(devices.reduce((a, d) => a + d.co2, 0) / devices.length).toFixed(1)} %
        </span>
        <span className={`hstat ${linked === 4 && !errors ? '' : 'bad'}`}>
          유선 연결 {linked} / 4
        </span>
        <span className="clock">
          {ymd(now)} {hms(now)}
        </span>
        <button className={`role-chip ${state.session.role}`} onClick={onRole}>
          <i>{operator.slice(0, 1)}</i>
          {operator} · {state.session.role === 'admin' ? '관리자' : '분석자'}
        </button>
      </div>
    </header>
  );
}
