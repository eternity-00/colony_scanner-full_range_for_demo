import {WELL_LEGEND} from '../config/defines.ts';

/** 현황·등록 화면 우상단의 트레이 상태 범례. */
export function WellLegend({simple = false}: {simple?: boolean}) {
  const items = simple ? WELL_LEGEND.slice(0, 2) : WELL_LEGEND;
  return (
    <div className="legend">
      {items.map(([key, label]) => (
        <span key={key}>
          <i className={`w-${key}`} />
          {label}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 아래 IconLegend 는 현재 어느 화면에서도 쓰이지 않는다.
// 아이콘 병기 범례 시안으로 남아 있는 코드 (v3 검토 대상).
// ─────────────────────────────────────────────────────────────

type IconKey = 'ok' | 'done' | 'untx' | 'fail';

const ICON_PATHS: Record<IconKey, string[]> = {
  ok: ['M12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16'],
  done: ['M4 12.5l5.2 5.2L20 7'],
  untx: ['M12 19V6', 'M6.5 11.5L12 6l5.5 5.5', 'M4 3.5h16'],
  fail: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
};

export function WellIcon({state}: {state: string}) {
  const paths = ICON_PATHS[state as IconKey];
  if (!paths) return null;
  return (
    <svg
      className={`wi wi-${state}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}

const ICON_LEGEND: readonly (readonly [string, string])[] = [
  ['ok', 'Well 있음'],
  ['empty', '빈 슬롯'],
  ['done', '작업 완료'],
  ['untx', '미전송 2건 이상'],
  ['fail', '촬영 실패'],
];

export function IconLegend() {
  return (
    <div className="legend">
      {ICON_LEGEND.map(([key, label]) => (
        <span className="lg" key={key}>
          <i className={`cell w-${key}`}>
            <WellIcon state={key} />
          </i>
          {label}
        </span>
      ))}
    </div>
  );
}
