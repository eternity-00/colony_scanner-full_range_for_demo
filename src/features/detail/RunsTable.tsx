import {useLayoutEffect, useRef, useState} from 'react';
import type {ImageState, Plate, Run} from '../../api/types.ts';
import {RUN_ROW_HEIGHT_REM, WELLS} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {fmt} from '../../utils/datetime.ts';
import {imgSrc, shots} from '../../utils/plate.ts';
import {rootFontPx} from '../../utils/viewport.ts';

interface Props {
  plate: Plate;
  onView: (run: Run, wellIndex: number) => void;
  /** 남은 높이를 채우고, 높이에 맞춰 페이지당 행 수를 계산한다. */
  fill?: boolean;
}

/** 한 페이지에 두는 최대 줄 수. 남는 높이는 줄 키가 가져간다. */
const MAX_ROWS = 4;

interface Shot {
  run: Run;
  n: number;
  well: number;
  at: number;
  transferred: boolean;
  state: ImageState;
  image?: string;
}

export function RunsTable({plate, onView, fill = false}: Props) {
  const [page, setPage] = useState(0);
  const [per, setPer] = useState(MAX_ROWS);
  const wrap = useRef<HTMLDivElement>(null);

  // 표 높이가 바뀌면 한 페이지에 들어갈 행 수를 다시 센다.
  // useLayoutEffect 인 이유: useEffect 로 재면 처음 그린 뒤에 줄여서, 넘친 표가
  // 한 번 그려졌다가 접힌다. 느린 화면에서는 그 사이 스크롤바가 떴다 사라진다.
  //
  // 위아래로 남는 높이는 줄 수가 아니라 줄 키로 간다(MAX_ROWS). 한 화면에 여섯
  // 줄이 들어가도 네 줄만 두는 편이 손가락으로 누르기 쉽다.
  useLayoutEffect(() => {
    if (!fill) return;
    const el = wrap.current;
    if (!el) return;
    const calc = () => {
      const head = el.querySelector('thead')?.offsetHeight || 38;
      const rowPx = RUN_ROW_HEIGHT_REM * rootFontPx();
      setPer(Math.max(2, Math.min(MAX_ROWS, Math.floor((el.clientHeight - head) / rowPx))));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fill]);

  // 계산 결과가 1행 넘칠 때가 있어 렌더 후 한 번 더 줄인다.
  useLayoutEffect(() => {
    if (!fill) return;
    const el = wrap.current;
    const table = el?.querySelector('table');
    if (el && table && table.getBoundingClientRect().height > el.clientHeight + 1) {
      setPer(x => Math.max(2, x - 1));
    }
  });

  // 회차 하나가 Well 6칸이므로 표에서는 펼쳐서 보여준다. 최신 회차·마지막 Well 이 위.
  const rows: Shot[] = [];
  for (const run of [...plate.runs].reverse()) {
    const images = shots(run);
    for (let i = WELLS - 1; i >= 0; i--) {
      rows.push({
        run,
        n: run.n,
        well: i + 1,
        at: run.at,
        transferred: run.transferred,
        state: run.imageState,
        image: images[i],
      });
    }
  }

  const last = Math.max(0, Math.ceil(rows.length / per) - 1);
  const pg = Math.min(page, last);
  const shown = rows.slice(pg * per, pg * per + per);

  return (
    <section className={`card runs ${fill ? 'fill' : ''}`}>
      <div className="row between">
        <div>
          <h3>플레이트 촬영 이력</h3>
        </div>
        <div
          className="holdcnt"
          title="스캐너에 아직 남아있는(PC 미전송) 영상. 최근 5회차까지만 보관됩니다."
        >
          <small>기기 보관</small>
          <b>
            {plate.runs.filter(r => r.imageState === 'held').length}
            <em>/5 회차</em>
          </b>
        </div>
      </div>

      <div className="table-wrap" ref={wrap}>
        <table className={shown.length >= per ? 'fillrows' : ''}>
          <thead>
            <tr>
              <th>회차</th>
              <th>Well 번호</th>
              <th>시각</th>
              <th>전송</th>
              <th>촬영 영상</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map(row => (
              <tr key={`${row.n}-${row.well}`}>
                <td>
                  <b className="runno">{row.n}</b>
                </td>
                <td>
                  <b className="wellno">{row.well}</b>
                </td>
                <td>{fmt(row.at)}</td>
                <td>
                  <Badge type={row.transferred ? 'good' : 'warn'}>
                    {row.transferred ? '전송 완료' : '미전송'}
                  </Badge>
                </td>
                <td>
                  {row.state === 'held' && row.image ? (
                    <button className="thumb1" onClick={() => onView(row.run, row.well - 1)}>
                      <img src={imgSrc(row.image)} alt={`Well ${row.well}`} />
                    </button>
                  ) : (
                    <span className={`shotcount ${row.state === 'failed' ? 'fail' : 'gone'}`}>
                      {row.state === 'failed' ? '촬영 실패' : '보존기간 경과'}
                    </span>
                  )}
                </td>
                <td>
                  <button disabled={!row.image} onClick={() => onView(row.run, row.well - 1)}>
                    보기
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <span>
          총 {plate.runs.length}회차 · {rows.length}컷 · {pg + 1}/{last + 1} 페이지
        </span>
        <button disabled={!pg} onClick={() => setPage(pg - 1)}>
          이전
        </button>
        <button disabled={pg >= last} onClick={() => setPage(pg + 1)}>
          다음
        </button>
      </div>
    </section>
  );
}
