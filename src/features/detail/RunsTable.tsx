import {useLayoutEffect, useRef, useState} from 'react';
import type {AppState, Plate, Run} from '../../api/types.ts';
import {RUN_ROW_HEIGHT_REM, WELLS} from '../../config/defines.ts';
import {fmt} from '../../utils/datetime.ts';
import {nextAt, pending, shots, totalRuns} from '../../utils/plate.ts';
import {rootFontPx} from '../../utils/viewport.ts';

interface Props {
  state: AppState;
  plate: Plate;
  onView: (run: Run, wellIndex: number) => void;
  onHistory: () => void;
}

/** 한 줄 = 한 회차(초안 260911). 남는 높이는 줄 키가 가져간다. */
const MAX_ROWS = 6;

interface Row {
  n: number;
  at: number;
  run?: Run;
}

/**
 * 플레이트 촬영 이력 — 회차마다 한 줄.
 *
 * 1.x 에서는 회차 하나를 Well 여섯 줄로 펼쳤다. 초안은 회차 한 줄에 상태 · 영상 ·
 * 「보기」를 두고, Well 은 영상 뷰어 안에서 고른다. 맨 위에는 다음 회차를 「예정」으로
 * 한 줄 세워, 지금까지와 앞으로가 한 표에서 이어진다.
 */
export function RunsTable({state, plate, onView, onHistory}: Props) {
  const [page, setPage] = useState(0);
  const [per, setPer] = useState(MAX_ROWS);
  const wrap = useRef<HTMLDivElement>(null);

  // 표 높이에 맞춰 페이지당 줄 수를 센다. 그리기 전에 재야 넘친 표가 한 번 보였다가 접히지 않는다.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const calc = () => {
      const head = el.querySelector('.rt-head')?.clientHeight || 36;
      const rowPx = RUN_ROW_HEIGHT_REM * rootFontPx();
      setPer(Math.max(2, Math.min(MAX_ROWS, Math.floor((el.clientHeight - head) / rowPx))));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const done = plate.runs.length >= totalRuns(state);
  const rows: Row[] = [
    ...(done || plate.paused ? [] : [{n: plate.runs.length + 1, at: nextAt(state, plate)}]),
    ...[...plate.runs].reverse().map(run => ({n: run.n, at: run.at, run})),
  ];
  const last = Math.max(0, Math.ceil(rows.length / per) - 1);
  const pg = Math.min(page, last);
  const shown = rows.slice(pg * per, pg * per + per);
  const held = plate.runs.filter(r => r.imageState === 'held').length;
  const sent = plate.runs.filter(r => r.transferred).length;

  return (
    <section className="p-card dt-runs">
      <div className="p-card-head">
        <h3>플레이트 촬영 이력</h3>
        <p>촬영 · 전송까지 기록됩니다 · 판독 결과는 PC 에서 확인</p>
        <span
          className="p-tag mute dt-hold"
          title="스캐너에 아직 남아 있는 영상. 최근 5회차까지만 보관됩니다."
        >
          기기 보관 {held}/5 회차
        </span>
        <button className="p-soft" onClick={onHistory}>
          전체 이력
        </button>
      </div>

      <div className="rt" ref={wrap}>
        <div className="rt-head">
          <span>회차</span>
          <span>촬영 시각</span>
          <span>상태</span>
          <span>촬영 영상</span>
          <span>동작</span>
        </div>
        {shown.map(row => {
          const run = row.run;
          const has = !!run && run.imageState === 'held' && shots(run).length > 0;
          const tag = !run
            ? ['mute', '예정', '다음 촬영 예정']
            : run.imageState === 'failed'
              ? ['bad', '촬영 실패', run.error || '다시 촬영이 필요합니다']
              : run.transferred
                ? ['good', '전송 완료', run.n === 1 ? '기준 영상' : 'PC 로 유선 전송']
                : ['warn', '미전송', 'PC 전송 대기'];
          return (
            <div className={`rt-row ${run ? '' : 'plan'}`} key={row.n}>
              <b className="rt-n">{row.n}</b>
              <span className="rt-at">{fmt(row.at)}</span>
              <span className="rt-st">
                <span className={`p-tag ${tag[0]}`}>{tag[1]}</span>
                <small>{tag[2]}</small>
              </span>
              <span className={`rt-shot ${has ? 'has' : ''}`}>
                {has
                  ? `Well ${shots(run).length || WELLS}장`
                  : !run
                    ? '없음'
                    : run.imageState === 'expired'
                      ? '보존기간 경과'
                      : '없음'}
              </span>
              <span className="rt-act">
                <button disabled={!has} onClick={() => run && onView(run, 0)}>
                  보기
                </button>
              </span>
            </div>
          );
        })}
      </div>

      <div className="dt-send">
        <small>전송 상태</small>
        <b>
          촬영 {plate.runs.length} 회 · PC 전송 완료 {sent} 건 · 미전송 {pending(plate)} 건
        </b>
        <span className="dt-pager">
          <em>
            {pg + 1} / {last + 1}
          </em>
          <button disabled={!pg} onClick={() => setPage(pg - 1)}>
            이전
          </button>
          <button disabled={pg >= last} onClick={() => setPage(pg + 1)}>
            다음
          </button>
        </span>
      </div>
    </section>
  );
}
