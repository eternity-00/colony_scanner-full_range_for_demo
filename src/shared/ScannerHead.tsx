import type {AppState, Device} from '../api/types.ts';
import {hm} from '../utils/datetime.ts';
import {nextAt, platesFor, status, tone, totalRuns} from '../utils/plate.ts';

/** 다음 촬영 시각과 배지 문구. 홈과 상세가 같은 말을 해야 해서 한 곳에서 셈한다. */
export function scannerNext(state: AppState, d: Device) {
  const next = platesFor(state, d.id)
    .filter(p => !p.paused && p.runs.length < totalRuns(state))
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
