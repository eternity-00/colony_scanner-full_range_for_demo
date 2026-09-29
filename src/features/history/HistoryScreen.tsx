import {useLayoutEffect, useRef, useState} from 'react';
import type {AppState, Plate} from '../../api/types.ts';
import {ROW_HEIGHT_REM} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {fmt} from '../../utils/datetime.ts';
import {download} from '../../utils/download.ts';
import {coord, nextAt, pending, pos, totalRuns} from '../../utils/plate.ts';
import {rootFontPx} from '../../utils/viewport.ts';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  /** 이미 반출된 플레이트는 상세 대신 영상 뷰어로 연다. */
  openPlateViewer: (plate: Plate) => void;
}

interface Filters {
  days: number;
  device: number;
  tier: number;
  col: number;
  transfer: 'all' | 'done' | 'pending';
  /** 이력은 플레이트 대장이라 등록만 된 것도 한 줄을 차지한다. 그걸 걸러내는 칸. */
  shot: 'all' | 'shot' | 'none';
}

const NO_FILTER: Filters = {days: 0, device: 0, tier: 0, col: 0, transfer: 'all', shot: 'all'};

export function HistoryScreen({state, openDetail, openPlateViewer}: Props) {
  const [draft, setDraft] = useState<Filters>(NO_FILTER);
  const [applied, setApplied] = useState<Filters>(NO_FILTER);
  const [page, setPage] = useState(0);
  const [per, setPer] = useState(10);
  const wrap = useRef<HTMLDivElement>(null);

  const pick = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setDraft(d => ({...d, [key]: value}));

  const apply = () => {
    setApplied(draft);
    setPage(0);
  };

  // 표 높이에 맞춰 페이지당 행 수를 계산한다.
  // 그리기 전에 재야 한다(useLayoutEffect). 그리고 나서 줄이면 넘친 표가 한 번
  // 보였다가 접히면서 스크롤바가 깜빡인다.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const calc = () => {
      const head = el.querySelector('thead')?.offsetHeight || 38;
      const rowPx = ROW_HEIGHT_REM * rootFontPx();
      setPer(Math.max(3, Math.min(40, Math.floor((el.clientHeight - head) / rowPx))));
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 계산 결과가 1행 넘칠 때가 있어 렌더 후 한 번 더 줄인다.
  useLayoutEffect(() => {
    const el = wrap.current;
    const table = el?.querySelector('table');
    if (el && table && table.getBoundingClientRect().height > el.clientHeight + 1) {
      setPer(p => Math.max(3, p - 1));
    }
  });

  const rows = state.plates
    .filter(p => {
      if (applied.device && p.deviceId !== applied.device) return false;
      if (applied.days && p.registeredAt < Date.now() - applied.days * 86400000) return false;
      if (applied.transfer !== 'all' && (applied.transfer === 'pending') !== !!pending(p))
        return false;
      if (applied.shot !== 'all' && (applied.shot === 'shot') !== p.runs.length > 0) return false;
      if (applied.tier && coord(p.slot).tier !== applied.tier) return false;
      if (applied.col && coord(p.slot).col !== applied.col) return false;
      return true;
    })
    .sort((a, b) => b.registeredAt - a.registeredAt);

  const last = Math.max(0, Math.ceil(rows.length / per) - 1);
  const pg = Math.min(page, last);
  const shown = rows.slice(pg * per, pg * per + per);

  const csv = [
    'ID,위치,투입,회차,다음 촬영,미전송,상태',
    ...rows.map(p =>
      [
        p.id,
        `S${p.deviceId} ${pos(p.slot)}`,
        fmt(p.registeredAt),
        p.runs.length,
        fmt(nextAt(state, p)),
        pending(p),
        p.removedAt ? '반출' : '수납',
      ].join(','),
    ),
  ].join('\n');

  return (
    <div className="hist-page">
      <section className="card filters">
        <select value={draft.days} onChange={e => pick('days', Number(e.target.value))}>
          <option value="0">전체 기간</option>
          <option value="7">최근 7일</option>
          <option value="30">최근 30일</option>
        </select>
        <select value={draft.device} onChange={e => pick('device', Number(e.target.value))}>
          <option value="0">전체 스캐너</option>
          {state.devices.map(d => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select value={draft.tier} onChange={e => pick('tier', Number(e.target.value))}>
          <option value="0">전체 단</option>
          {[8, 7, 6, 5, 4, 3, 2, 1].map(t => (
            <option key={t} value={t}>
              {t}단
            </option>
          ))}
        </select>
        <select value={draft.col} onChange={e => pick('col', Number(e.target.value))}>
          <option value="0">전체 열</option>
          {[1, 2, 3].map(c => (
            <option key={c} value={c}>
              {c}열
            </option>
          ))}
        </select>
        <select value={draft.shot} onChange={e => pick('shot', e.target.value as Filters['shot'])}>
          <option value="all">촬영 전체</option>
          <option value="shot">촬영 시작</option>
          <option value="none">촬영 전</option>
        </select>
        <select
          value={draft.transfer}
          onChange={e => pick('transfer', e.target.value as Filters['transfer'])}
        >
          <option value="all">전송 전체</option>
          <option value="done">전송 완료</option>
          <option value="pending">미전송</option>
        </select>
        <button className="primary" onClick={apply}>
          적용
        </button>
        <button
          className="ghost-btn"
          onClick={() => download('colony-history.csv', '\ufeff' + csv, 'text/csv')}
        >
          CSV 내보내기
        </button>
      </section>

      <section className="card hist-table">
        <div className="table-wrap" ref={wrap}>
          <table className={shown.length >= per ? 'fillrows' : ''}>
            <thead>
              <tr>
                <th>ID</th>
                <th>수납 위치</th>
                <th>회차</th>
                <th>투입 시각</th>
                <th>다음 촬영</th>
                <th>영상</th>
                <th>전송</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map(p => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td>
                    S{p.deviceId} · {pos(p.slot)}
                  </td>
                  <td>
                    {p.runs.length}/{totalRuns(state)}
                  </td>
                  <td>{fmt(p.registeredAt)}</td>
                  <td>{p.removedAt ? '—' : fmt(nextAt(state, p))}</td>
                  <td>{p.runs.filter(r => r.imageState === 'held').length}</td>
                  <td>
                    {/*
                      * 아직 한 번도 안 찍은 플레이트는 보낼 것이 없어서 미전송 0 이 된다.
                      * 그걸 「완료」라고 적으면 전송이 끝난 것처럼 읽힌다.
                      */}
                    {p.runs.length === 0 ? (
                      <Badge>촬영 전</Badge>
                    ) : (
                      <Badge type={pending(p) ? 'warn' : 'good'}>
                        {pending(p) ? `미전송 ${pending(p)}` : '완료'}
                      </Badge>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() =>
                        p.removedAt ? openPlateViewer(p) : openDetail(p.deviceId, p.slot)
                      }
                    >
                      상세
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pager">
          <span>
            총 {rows.length}매 · {pg + 1}/{last + 1} 페이지
          </span>
          <button disabled={!pg} onClick={() => setPage(pg - 1)}>
            이전
          </button>
          <button disabled={pg >= last} onClick={() => setPage(pg + 1)}>
            다음
          </button>
        </div>
      </section>
    </div>
  );
}
