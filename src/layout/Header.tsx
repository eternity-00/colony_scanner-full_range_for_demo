import {useEffect, useRef, useState} from 'react';
import type {AppState} from '../api/types.ts';
import type {TabKey} from '../config/defines.ts';
import {Logo} from '../shared/Logo.tsx';
import {hms, ymd} from '../utils/datetime.ts';
import {tempAbnormal} from '../utils/plate.ts';

interface Props {
  state: AppState;
  tab: TabKey;
  operator: string;
  onRole: () => void;
  onMenu: () => void;
}

/**
 * 상호는 고정하고 오른쪽 부제만 화면에 따라 바꾼다.
 * 시안(D1)의 현황 화면이 "Colony Scanner | Incubator #1" 이라, 다른 화면은
 * 그 자리에 화면 이름을 넣어 같은 자리에서 위치를 알 수 있게 한다.
 */
const SUBTITLE: Record<TabKey, string> = {
  overview: 'Incubator #1',
  detail: '스캐너 상세',
  register: '플레이트 등록',
  running: '촬영 진행',
  history: '이력 · 검색',
  device: '장비 상태',
  settings: '설정',
};

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

  // 피드백 2.2 — 인큐베이터 온도 현재값은 관리자에게만 상시 노출하고,
  // 분석자에게는 목표 범위를 벗어났을 때만 보여준다.
  const abnormal = devices.some(tempAbnormal);
  const showTemperature = state.session.role === 'admin' || abnormal;

  return (
    <header>
      {/* 시안에는 메뉴 버튼이 없다. 좌측 64px 색면이 실루엣을 만드는 요소이므로
          그 블록 자체를 메뉴 버튼으로 쓴다 — 터치 타깃이 64px 로 넉넉하다. */}
      <button className="hd-menu" onClick={onMenu} aria-label="메뉴">
        <span />
        <span />
        <span />
      </button>
      <span className="wm">
        <Logo />
        Colony<i>Scanner</i>
      </span>
      <span className="sub">{SUBTITLE[tab]}</span>
      <div className="head-status">
        {showTemperature && (
          <span className={`hstat ${abnormal ? 'bad' : ''}`}>
            {(devices.reduce((a, d) => a + d.temperature, 0) / devices.length).toFixed(1)} ℃
          </span>
        )}
        <span className="hstat">
          CO₂ <b>{(devices.reduce((a, d) => a + d.co2, 0) / devices.length).toFixed(1)} %</b>
        </span>
        <span className={`hstat ${linked === 4 && !errors ? '' : 'bad'}`}>
          <i className="dot" />
          유선 연결 <b>{linked} / 4</b>
        </span>
        <span className="clock">
          {ymd(now)} {hms(now)}
        </span>
        <button className={`role-chip ${state.session.role}`} onClick={onRole}>
          <i>{operator.slice(0, 1)}</i>
          <span className="who">
            {operator} · {state.session.role === 'admin' ? '관리자' : '분석자'}
          </span>
        </button>
      </div>
    </header>
  );
}
