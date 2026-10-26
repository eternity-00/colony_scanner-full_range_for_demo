import type {AppState, Device} from '../api/types.ts';
import {hm} from '../utils/datetime.ts';
import {nextAt, platesFor, status, tone, totalRuns} from '../utils/plate.ts';
import {Badge} from './Badge.tsx';

/** 다음 촬영 시각과 배지 문구. 홈과 상세가 같은 말을 해야 해서 한 곳에서 셈한다. */
export function scannerNext(state: AppState, d: Device) {
  const next = platesFor(state, d.id)
    .filter(p => !p.paused && p.runs.length < totalRuns(state, p))
    .map(p => nextAt(state, p))
    .sort((a, b) => a - b)[0];
  const running = d.job?.status === 'running';
  const stopped = !d.connected || d.fault || d.doorOpen || d.job?.status === 'paused';
  // 찍을 시각이 정해져 있지 않으면(촬영 중·정지·플레이트 없음·시각이 이미 지남) 비운다.
  const scheduled = next !== undefined && next > state.serverTime && !running && !stopped;
  // 배지는 장비 상태를 말한다. 거기에 「왜 안 찍고 있는지」를 더한다.
  // 시각이 지났는데 멈춰 있는 이유가 화면 어디에도 없으면 고장으로 보인다.
  const due = next !== undefined && next <= state.serverTime;
  const badge =
    !running && !stopped && due
      ? !state.autoRun
        ? '자동 꺼짐'
        : state.captureHold
          ? '등록 중'
          : '촬영 대기'
      : status(d);
  return {
    scheduled,
    // 빈칸도 시각의 꼴을 지킨다 — --:-- 는 「시각이 들어올 자리」로 읽힌다.
    label: scheduled ? hm(next) : '--:--',
    badge,
    badgeType: badge === '자동 꺼짐' ? ('warn' as const) : tone(d),
  };
}

/**
 * 스캐너 카드 머리 — 이름 · NEXT · 상태 배지.
 *
 * NEXT 는 시각만 적는다. 상태를 말하는 낱말은 옆 배지의 몫이다 — 같은 줄에서
 * 둘이 같은 말을 하면 어느 쪽을 읽어야 할지 흐려진다.
 */
export function ScannerHead({state, device}: {state: AppState; device: Device}) {
  const n = scannerNext(state, device);
  return (
    <div className="card-head">
      <h3>{device.name}</h3>
      <span className="head-next">
        <small>NEXT</small>
        <b className={n.scheduled ? '' : 'idle'}>{n.label}</b>
      </span>
      <Badge type={n.badgeType}>{n.badge}</Badge>
    </div>
  );
}
