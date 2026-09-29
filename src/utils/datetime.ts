import {ELAPSED_MIXED_AFTER_HOURS} from '../config/defines.ts';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 2026-09-22 */
export const ymd = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** 10:37 */
export const hm = (t: number) => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** 10:37:49 */
export const hms = (t: number) => {
  const d = new Date(t);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
};

/** 2026-09-22 10:37 */
export const kdt = (t: number) => `${ymd(t)} ${hm(t)}`;

/** 남은 시간을 HH:MM 으로. */
export const countdown = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
};

/** <input type="datetime-local"> 이 받는 로컬 시각 문자열. */
export const dateInput = (t: number) => {
  const d = new Date(t - new Date(t).getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};

/**
 * 투입 후 경과 시간. 피드백 5.1 — 시간 단위가 기본이고,
 * 길어지면 "12일 4시간" 처럼 일+시간 혼합으로 바꾼다.
 */
export const elapsedLabel = (from: number, now: number) => {
  const hours = Math.max(0, Math.floor((now - from) / 3600000));
  if (hours < ELAPSED_MIXED_AFTER_HOURS) return `${hours}시간`;
  return `${Math.floor(hours / 24)}일 ${hours % 24}시간`;
};

/**
 * 값이 없으면 –, 있으면 날짜+시각.
 * 짧은 줄표(–)를 쓴다 — 긴 줄표(—)는 좁은 칸 안에서 글자가 아니라 선처럼 보인다.
 */
export const fmt = (t?: number | null) => (t ? kdt(t) : '–');
