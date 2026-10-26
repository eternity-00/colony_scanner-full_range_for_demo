import {useEffect, useMemo, useState} from 'react';
import type {AppState, Plate, Run} from '../../api/types.ts';
import {WELLS} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {CrossViewer} from '../../shared/CrossViewer.tsx';
import {fmt} from '../../utils/datetime.ts';
import {active, elapsedDays, failedWells, imgSrc, isCrossRun, latestCrossRun, pos, recipeName, shots, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  openViewer: (plate: Plate, run: Run, wellIndex: number) => void;
  openDetail: (deviceId: number, slot?: number) => void;
}

type Sort = 'days' | 'slot';

/**
 * 최근 영상 확인 (M3 A1) — 배양 중인 플레이트를 한 장씩 넘겨 가며 최근 회차의 Well 6장을 본다.
 *
 * 머리글은 트레이 번호 · 플레이트 ID · 경과 일수 · 회차. 정렬은 배양 일수(오래된 것부터)와
 * 트레이 번호 둘 중 하나. Well 을 누르면 기존 뷰어(원본 확대 포함)로 들어간다.
 * 판정은 PC 프로그램의 몫이므로 이 화면은 「찍혔는지」만 보여준다.
 */
export function RecentScreen({state, openViewer, openDetail}: Props) {
  const [sort, setSort] = useState<Sort>('days');
  const [index, setIndex] = useState(0);
  const [runIndex, setRunIndex] = useState<number | null>(null);
  const [cross, setCross] = useState<{plate: Plate; run: Run} | null>(null);

  const plates = useMemo(() => {
    const list = active(state).filter(p => state.devices.some(d => d.id === p.deviceId));
    return sort === 'days'
      ? [...list].sort((a, b) => a.registeredAt - b.registeredAt || a.slot - b.slot)
      : [...list].sort((a, b) => a.slot - b.slot);
  }, [state, sort]);

  // 목록이 줄어들면(반출) 범위 안으로 당긴다. 플레이트를 바꾸면 최신 회차로 돌아간다.
  useEffect(() => {
    if (index >= plates.length) setIndex(Math.max(0, plates.length - 1));
  }, [plates.length, index]);

  const plate = plates[index];
  const held = plate ? plate.runs.filter(r => r.imageState === 'held') : [];
  const run = held.length ? held[runIndex === null || runIndex >= held.length ? held.length - 1 : runIndex] : undefined;
  const images = run ? shots(run) : [];
  const al = run?.capture?.alignment;
  const code = run?.capture?.barcode;
  // 십자 촬영: 보고 있는 회차가 십자면 그 회차, 아니면 이 플레이트의 가장 최근 십자 회차(이동 프레임은 최근 1회만 남는다)
  const crossTarget = plate ? (run && isCrossRun(run) ? {plate, run} : latestCrossRun(state, plate)) : null;

  const go = (step: number) => {
    setIndex(i => (plates.length ? (i + step + plates.length) % plates.length : 0));
    setRunIndex(null);
  };

  return (
    <div className="rc-page">
      <div className="rc-head p-card">
        <div className="rc-sort">
          <small>정렬</small>
          <button className={sort === 'days' ? 'selected' : ''} onClick={() => setSort('days')}>
            배양 일수
          </button>
          <button className={sort === 'slot' ? 'selected' : ''} onClick={() => setSort('slot')}>
            트레이 번호
          </button>
        </div>
        {plate ? (
          <div className="rc-title">
            <b className="rc-pos">{pos(plate.slot)}</b>
            <span className="rc-id">
              {plate.id}
              {plate.barcode && <em> · {plate.barcode}</em>}
            </span>
            <span className="rc-day">
              D+{elapsedDays(plate, state.serverTime)}
              <em>
                {' '}
                · {plate.runs.length}/{totalRuns(state, plate)}회 · {recipeName(state, plate)}
              </em>
            </span>
          </div>
        ) : (
          <div className="rc-title">
            <b>배양 중인 플레이트가 없습니다</b>
          </div>
        )}
        <div className="rc-nav">
          <button disabled={plates.length < 2} onClick={() => go(-1)} aria-label="이전 플레이트">
            ‹ 이전
          </button>
          <span>
            {plates.length ? index + 1 : 0} / {plates.length}
          </span>
          <button disabled={plates.length < 2} onClick={() => go(1)} aria-label="다음 플레이트">
            다음 ›
          </button>
        </div>
      </div>

      {plate && (
        <div className="rc-body">
          <div className="rc-meta">
            {run ? (
              <>
                <b>{run.n}회차</b>
                <span>{fmt(run.at)}</span>
                <Badge type={run.transferred ? 'good' : 'warn'}>{run.transferred ? '전송 완료' : '미전송'}</Badge>
                {al?.enabled && (
                  <Badge type={al.unalignedWells?.length ? 'warn' : 'good'}>
                    웰 검출 {al.alignedWells?.length ?? 0}/{WELLS}
                  </Badge>
                )}
                {run.capture?.wellShots === 5 && <Badge type="info">십자 5장</Badge>}
                {code && (
                  <Badge type={code.value ? 'good' : code.scanned ? 'warn' : 'info'}>
                    {code.value ? `바코드 ${code.value}` : code.scanned ? '바코드 미인식' : '바코드 판독 불가'}
                  </Badge>
                )}
                {run.change && run.change.max !== null && (
                  <Badge type={run.change.max > state.settings.alarms.changeThreshold ? 'bad' : 'info'}>
                    변화 {run.change.max.toFixed(2)}
                  </Badge>
                )}
                {failedWells(run).length > 0 && <Badge type="bad">Well {failedWells(run).join('·')} 실패</Badge>}
              </>
            ) : (
              <b>보관 중인 영상이 없습니다{plate.runs.length ? ' (보존 기간 경과)' : ' (촬영 전)'}</b>
            )}
            <span className="rc-grow" />
            {crossTarget && (
              <button className="rc-cross" onClick={() => setCross(crossTarget)}>
                십자 촬영 보기{crossTarget.run !== run ? ` · ${crossTarget.run.n}회차` : ''}
              </button>
            )}
            {held.length > 1 && (
              <select
                aria-label="회차 선택"
                value={runIndex === null ? held.length - 1 : Math.min(runIndex, held.length - 1)}
                onChange={e => setRunIndex(Number(e.target.value))}
              >
                {held.map((r, i) => (
                  <option key={r.n} value={i}>
                    {r.n}회차 · {fmt(r.at)}
                  </option>
                ))}
              </select>
            )}
            <button onClick={() => openDetail(plate.deviceId, plate.slot)}>상세</button>
          </div>
          {run ? (
            <div className="well-set rc-wells">
              {Array.from({length: WELLS}, (_, i) => {
                const file = images[i];
                return (
                  <figure key={i} className={`well-card ${file ? '' : 'miss'}`}>
                    {file ? (
                      <button className="rc-well" onClick={() => openViewer(plate, run, i)} aria-label={`Well ${i + 1} 크게 보기`}>
                        <img src={imgSrc(file)} alt={`Well ${i + 1}`} />
                      </button>
                    ) : (
                      <span className="wc-miss fail">촬영 실패</span>
                    )}
                    <b className="wc-no">{i + 1}</b>
                    <figcaption>
                      Well {i + 1}
                      {al?.unalignedWells?.includes(i + 1) && <em className="wc-al warn"> 미검출</em>}
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          ) : (
            <div className="rc-empty">
              <p>이 플레이트의 영상은 아직 없습니다. 촬영이 끝나면 여기에서 바로 확인할 수 있습니다.</p>
            </div>
          )}
        </div>
      )}
      {cross && <CrossViewer plate={cross.plate} run={cross.run} onClose={() => setCross(null)} />}
    </div>
  );
}
