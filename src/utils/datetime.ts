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

/** 값이 없으면 —, 있으면 날짜+시각. */
export const fmt = (t?: number | null) => (t ? kdt(t) : '—');
