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
