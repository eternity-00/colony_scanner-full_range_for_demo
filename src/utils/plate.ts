import type {AlarmSettings, AppState, Device, Plate, Routine, Run} from '../api/types.ts';
import {FAULT_LABEL, TEMP_TOLERANCE_C, type WellState} from '../config/defines.ts';

import type {Layout} from '../api/types.ts';

/**
 * 현재 트레이 배치. 서버 프로필(state.profile.layout)에서 오고 App 이 상태를 받을 때마다
 * 맞춰 둔다. 모듈 변수인 이유: pos()/coord() 가 알람·현황·이력 등 수십 곳에서 슬롯 번호만
 * 받아 쓰므로, 모든 호출에 layout 을 끌고 다니는 것보다 한 곳에서 갈아 끼우는 편이 안전하다.
 */
let layout: Layout = {tiers: 8, columns: 3, slots: 24, tierShared: false, capacity: 24};
export const configureLayout = (next: Layout | undefined) => {
  if (next && next.tiers > 0 && next.columns > 0)
    layout = {...next, slots: next.tiers * next.columns, capacity: next.tierShared ? next.tiers : next.tiers * next.columns};
};
export const currentLayout = () => layout;
/** 스캐너 한 대에 실제로 넣을 수 있는 플레이트 수. tierShared(테스트 지그)면 단 수. */
export const slotsPerDevice = (s?: AppState) => {
  const l = s?.profile?.layout ?? layout;
  return l.capacity ?? (l.tierShared ? l.tiers : l.slots);
};
/** 두 슬롯이 같은 자리인지. tierShared 면 같은 단이면 같은 자리다. */
export const samePlace = (a: number, b: number) => a === b || (!!layout.tierShared && coord(a).tier === coord(b).tier);
/** 그 칸(또는 tierShared 면 그 단)에 수납된 플레이트. */
export const plateAtSlot = (s: AppState, deviceId: number, slot: number): Plate | undefined =>
  platesFor(s, deviceId).find(p => samePlace(p.slot, slot));

/** 슬롯 번호(1~slots) → 단/열. 맨 윗단이 슬롯 1. */
export const coord = (n: number) => ({
  tier: layout.tiers - Math.floor((n - 1) / layout.columns),
  col: ((n - 1) % layout.columns) + 1,
});

/** 슬롯 번호 → "3단 2열" */
export const pos = (n: number) => {
  const {tier, col} = coord(n);
  return layout.columns > 1 && !layout.tierShared ? `${tier}단 ${col}열` : `${tier}단`;
};

/** 아직 반출되지 않은 플레이트. */
export const active = (s: AppState) => s.plates.filter(p => !p.removedAt);

export const platesFor = (s: AppState, deviceId: number) =>
  active(s).filter(p => p.deviceId === deviceId);

/** PC로 아직 보내지 못한 회차 수. */
export const pending = (p: Plate) =>
  p.runs.filter(r => r.imageState !== 'failed' && !r.transferred).length;

/** 플레이트가 따르는 레시피. recipeId 가 없거나 지워졌으면 공통 루틴. */
export const recipeOf = (s: AppState, p?: Plate | null): Routine =>
  (p?.recipeId && (s.recipes ?? []).find(r => r.id === p.recipeId)) || s.routine;

/** 레시피 이름(공통 루틴이면 「기본」). */
export const recipeName = (s: AppState, p?: Plate | null) =>
  (p?.recipeId && (s.recipes ?? []).find(r => r.id === p.recipeId)?.name) || '기본 루틴';

/** 총 촬영 회차 — 플레이트를 주면 그 레시피, 아니면 공통 루틴 기준. */
export const totalRuns = (s: AppState, p?: Plate | null) => {
  const r = recipeOf(s, p);
  return Math.floor((r.days * 24) / r.cycleHours);
};

/**
 * 다음 촬영 예정 시각. 「주기 시작 지연」이 투입 시각과 1회차 사이의 간격이고,
 * 주기는 회차와 회차 사이의 간격이다. 지연이 0분이면 투입 즉시 1회차를 찍는다.
 */
export const nextAt = (s: AppState, p: Plate) => {
  const r = recipeOf(s, p);
  return p.registeredAt + r.delay * 60000 + p.runs.length * r.cycleHours * 3600000;
};

/** 배양 종료 예정 시각(마지막 회차 시각). */
export const endAt = (s: AppState, p: Plate) => {
  const r = recipeOf(s, p);
  return p.registeredAt + r.delay * 60000 + Math.max(0, totalRuns(s, p) - 1) * r.cycleHours * 3600000;
};

/** 종료 예정 — 아직 끝나지 않았고 남은 시간이 설정값(endSoonHours) 안인 플레이트(M3 A2). */
export const endSoon = (s: AppState, p: Plate) =>
  !plateDone(s, p) && endAt(s, p) - s.serverTime <= (s.settings?.endSoonHours ?? 24) * 3600000;

/** 지금 촬영해야 하는 플레이트인지. */
export const dueNow = (s: AppState, p: Plate) =>
  !p.paused && p.runs.length < totalRuns(s, p) && nextAt(s, p) <= s.serverTime;

/** 투입 후 경과 일수(D+n, 0부터). */
export const elapsedDays = (p: Plate, now: number) => Math.max(0, Math.floor((now - p.registeredAt) / 86400000));

/** 제거 사유 · 판독 결과의 한글 이름. 서버(controller.mjs REASON_LABEL)와 같다. */
export const REASON_LABEL: Record<string, string> = {done: '정상 종료', positive: '조기 양성', contaminated: '오염', moved: '위치 이동', other: '기타'};
export const RESULT_LABEL: Record<string, string> = {positive: '조기 양성', negative: '음성', contaminated: '오염 판정'};

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

/** 배양이 끝나 꺼낼 수 있는 판 — 기간 만료 또는 PC 조기 양성 · 오염 판정(1차 피드백 1.1). */
export const plateDone = (s: AppState, p: Plate) =>
  p.result === 'positive' || p.result === 'contaminated' || p.runs.length >= totalRuns(s, p);

/**
 * 확인 필요(M3 홈 3칸) — 문제 발생 플레이트 + 반출 대기 플레이트 + 걸려 있는 장비·환경 알람.
 * 홈의 「확인 필요」 칸과 현황이 같은 값을 쓴다.
 */
export const attentionCount = (s: AppState, deviceId: number) => {
  const d = s.devices.find(x => x.id === deviceId);
  const plates = platesFor(s, deviceId);
  const problem = plates.filter(p => ['bad', 'done'].includes(wellState(s, p, d))).length;
  const other = (s.alarms ?? []).filter(a => !a.clearedAt && (a.kind === 'device' || a.kind === 'env')).length;
  return problem + other;
};

export const wellState = (s: AppState, p: Plate | undefined, d: Device | undefined): WellState => {
  if (!p) return 'empty';
  if (d?.job?.status === 'running' && d.job.plateId === p.id) return 'busy';
  if (plateBad(p)) return 'bad';
  if (plateDone(s, p)) return 'done';
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

/** 회차 영상 URL. 실장비 미리보기는 절대 경로(/api/v1/hardware/files/…)로 들어오고, 데모 이름은 /api/images/ 아래다. */
export const imgSrc = (file: string) =>
  file.startsWith('http') || file.startsWith('/') ? file : `/api/images/${file}`;

/** 인큐베이터 온도가 허용 편차를 벗어났는지(순간값). 알람은 서버가 지속 시간까지 보고 만든다. */
export const tempAbnormal = (d: Device, a?: AlarmSettings) =>
  d.connected && d.temperature !== null && Math.abs(d.temperature - d.targetTemperature) > (a?.tempTolerance ?? TEMP_TOLERANCE_C);

export const humidityAbnormal = (d: Device, a?: AlarmSettings) =>
  d.connected && d.humidity !== null && !!a && (d.humidity < a.humidityMin || d.humidity > a.humidityMax);

/** 지금 걸려 있는 환경 알람(온도·습도)이 있는지 — 사용자 모드에서 수치를 보여줄지 정하는 기준(1차 피드백 2.2). */
export const envAlarmActive = (s: AppState) => (s.alarms ?? []).some(a => a.kind === 'env' && !a.clearedAt);
