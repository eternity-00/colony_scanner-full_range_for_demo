import type {AppState, Device, Plate, Run} from '../api/types.ts';
import {FAULT_LABEL, TEMP_TOLERANCE_C, type WellState} from '../config/defines.ts';

/** 슬롯 번호(1~24) → 단/열. 8단이 맨 위. */
export const coord = (n: number) => ({tier: 8 - Math.floor((n - 1) / 3), col: ((n - 1) % 3) + 1});

/** 슬롯 번호 → "3단 2열" */
export const pos = (n: number) => {
  const {tier, col} = coord(n);
  return `${tier}단 ${col}열`;
};

/** 아직 반출되지 않은 플레이트. */
export const active = (s: AppState) => s.plates.filter(p => !p.removedAt);

export const platesFor = (s: AppState, deviceId: number) =>
  active(s).filter(p => p.deviceId === deviceId);

/** PC로 아직 보내지 못한 회차 수. */
export const pending = (p: Plate) =>
  p.runs.filter(r => r.imageState !== 'failed' && !r.transferred).length;

/** 루틴 설정 기준 총 촬영 회차. */
export const totalRuns = (s: AppState) => Math.floor((s.routine.days * 24) / s.routine.cycleHours);

/**
 * 다음 촬영 예정 시각. 「주기 시작 지연」이 투입 시각과 1회차 사이의 간격이고,
 * 주기는 회차와 회차 사이의 간격이다. 지연이 0분이면 투입 즉시 1회차를 찍는다.
 */
export const nextAt = (s: AppState, p: Plate) =>
  p.registeredAt + s.routine.delay * 60000 + p.runs.length * s.routine.cycleHours * 3600000;

/** 지금 촬영해야 하는 플레이트인지. */
export const dueNow = (s: AppState, p: Plate) =>
  !p.paused && p.runs.length < totalRuns(s) && nextAt(s, p) <= s.serverTime;

/**
 * 손이 필요한 플레이트인지. 두 가지를 한 뜻으로 묶는다 —
 * 마지막 회차 촬영이 실패했거나 — 회차 전체든 Well 일부든 — (다시 찍어야 한다), PC 로 못 보낸 영상이
 * 2건 이상 쌓였거나(보관 기한 안에 보내야 한다).
 *
 * 트레이의 빨간 원과 현황의 「문제 발생」이 같은 값을 써야 하므로 여기 한 곳에 둔다.
 */
export const plateBad = (p: Plate) => {
  const last = p.runs.at(-1);
  return last?.imageState === 'failed' || (!!last && failedWells(last).length > 0) || pending(p) >= 2;
};

export const wellState = (s: AppState, p: Plate | undefined, d: Device | undefined): WellState => {
  if (!p) return 'empty';
  if (d?.job?.status === 'running' && d.job.plateId === p.id) return 'busy';
  if (plateBad(p)) return 'bad';
  if (p.runs.length >= totalRuns(s)) return 'done';
  return 'ok';
};

export const isBusy = (d: Device) => !!d.job && ['running', 'paused'].includes(d.job.status);

/**
 * 지금 이 장비가 겪고 있는 문제. 정상이면 null.
 * tone()·status() 가 「점검 필요」로 판정하는 것과 같은 조건을 쓴다.
 */
export const faultLabel = (d: Device): string | null => {
  if (!d.connected) return FAULT_LABEL.DISCONNECTED;
  if (d.fault) return FAULT_LABEL[d.fault] ?? d.fault;
  if (d.doorOpen) return FAULT_LABEL.DOOR_OPEN;
  return null;
};

/** 카드 테두리·배지 색. */
export const tone = (d: Device): 'bad' | 'good' | 'warn' | 'info' => {
  if (!d.connected || d.fault || d.doorOpen) return 'bad';
  if (d.job?.status === 'running') return 'good';
  if (d.job?.status === 'paused') return 'warn';
  return 'info';
};

export const status = (d: Device) => {
  if (!d.connected || d.fault || d.doorOpen) return '점검 필요';
  if (d.job?.status === 'running') return '촬영 중';
  if (d.job?.status === 'paused') return '일시정지';
  return '촬영 대기';
};

/** 회차가 보유한 영상 파일 목록(Well 순서). 레거시 단일 영상도 배열로 맞춰준다. 실패한 Well 은 null. */
export const shots = (r: Run): (string | null)[] =>
  r.images?.length ? r.images : r.image ? [r.image] : [];

/** 찍힌 회차에서 촬영에 실패한 Well 번호(1부터). 다 찍혔으면 빈 배열. */
export const failedWells = (r: Run): number[] =>
  r.imageState !== 'held' || !r.images?.length
    ? []
    : r.images.flatMap((f, i) => (f ? [] : [i + 1]));

export const imgSrc = (file: string) =>
  file.startsWith('http') ? file : `/api/images/${file}`;

/** 인큐베이터 온도가 목표 범위를 벗어났는지. 피드백 2.2 의 "이상 시에만 노출" 판정. */
export const tempAbnormal = (d: Device) =>
  d.connected && Math.abs(d.temperature - d.targetTemperature) > TEMP_TOLERANCE_C;
