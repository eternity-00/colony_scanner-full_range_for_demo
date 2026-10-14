import type {AppState} from '../../api/types.ts';
import {SHORT_STAGES, STAGES, WELLS, type SendCommand} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {hm} from '../../utils/datetime.ts';
import {active, dueNow, nextAt, platesFor, pos, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  openDetail: (deviceId: number, slot?: number) => void;
}

/**
 * 띠에 그리는 촬영 단계 수. 장비는 여섯 단계(… 전송 · PC 저장)를 돌지만,
 * 뒤의 둘은 카메라 화면에서 지켜볼 일이 아니다 — 전송은 상세 · 이력이 말한다(혜원님 10/14).
 * 전송 중에는 넷이 모두 끝난 것으로 보인다.
 */
const SHOWN = 4;
const JOB_NAME = {capture: '촬영', home: '원점 복귀', calibrate: '캘리브레이션', reset: '모듈 초기화'};

/**
 * 촬영 (v2.1) — 초안(260911)의 「진행」.
 *
 * 왼쪽: 카메라 영상과 촬영 단계(넷). 오른쪽: 이번 작업 진행 · 촬영 큐 · 버튼.
 * 스캐너가 한 대라 고르는 탭은 없다.
 */
export function CaptureScreen({state, send, openDetail}: Props) {
  const d = state.devices[0];
  if (!d) return null;

  const isAdmin = state.session.role === 'admin';
  const job = d.job && ['running', 'paused'].includes(d.job.status) ? d.job : null;
  const running = d.job?.status === 'running';
  const capture = !job || job.type === 'capture';
  const stages = capture ? STAGES.slice(0, SHOWN) : SHORT_STAGES;
  const well = job && capture ? Math.min(WELLS, Math.floor((job.progress / 100) * WELLS) + 1) : 0;
  const plates = platesFor(state, d.id);
  const current = job?.plateId ? plates.find(p => p.id === job.plateId) : undefined;
  const queue = active(state)
    .filter(p => p.id !== current?.id && dueNow(state, p))
    .sort((a, b) => nextAt(state, a) - nextAt(state, b));
  const next = scannerNext(state, d);

  return (
    <div className="cp-page">
      <div className="cp-main">
        <div className={`cp-cam ${running ? 'live' : ''}`}>
          {running && capture ? (
            <img src={`/api/images/well-${(((d.id - 1) * 2) % 9) + 1}.png`} alt="" />
          ) : (
            <span className="cp-cam-idle">
              <b>{job ? `${JOB_NAME[job.type]} ${job.status === 'paused' ? '일시정지' : '진행 중'}` : '촬영 대기'}</b>
              <small>촬영이 시작되면 실제 촬영 영상이 표시됩니다</small>
            </span>
          )}
          <span className="cp-chips">
            {running && <span className="p-tag bad">REC</span>}
            <span className="p-tag mute">
              {job?.slot ? pos(job.slot) : d.name}
              {well ? ` · WELL ${well} / ${WELLS}` : ''}
            </span>
          </span>
          <span className="cp-cam-foot">
            조명 {d.light ? 'ON' : 'OFF'} · 히팅 {d.heater ? 'ON' : 'OFF'} · 카메라{' '}
            {d.failCamera ? '오류' : '정상'}
          </span>
        </div>

        <section className="p-card cp-cycle">
          <div className="p-card-head">
            <h3>{capture ? '촬영 단계' : `${JOB_NAME[job?.type ?? 'capture']} 단계`}</h3>
          </div>
          <ol className="cp-steps">
            {stages.map((label, i) => {
              const st = !job
                ? ''
                : i < job.step
                  ? 'done'
                  : i === job.step
                    ? 'now'
                    : '';
              return (
                <li key={label} className={st}>
                  <i />
                  <b>{i + 1}</b>
                  <strong>{label}</strong>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <div className="cp-side">
        <div className="p-panel cp-prog">
          <small>{job ? '이번 작업 진행' : '다음 촬영'}</small>
          {job ? (
            <>
              <span className="cp-prog-main">
                <b>{capture ? well : Math.round(job.progress)}</b>
                <em>{capture ? `/ ${WELLS} Well` : '%'}</em>
                <strong>{job.status === 'paused' ? '일시정지' : `${Math.round(job.progress)}%`}</strong>
              </span>
              <i className="p-bar">
                <i style={{width: `${Math.max(2, job.progress)}%`}} />
              </i>
              <span className="cp-prog-foot">
                <small>시작 {hm(job.startedAt)}</small>
                <small>
                  {current ? `${pos(current.slot)} · ${current.runs.length + 1}/${totalRuns(state)}회차` : ''}
                </small>
              </span>
            </>
          ) : (
            <>
              <span className="cp-prog-main">
                <b className={next.scheduled ? '' : 'idle'}>{next.label}</b>
                <strong>{next.badge}</strong>
              </span>
              <span className="cp-prog-foot">
                <small>대기 중인 촬영 {queue.length} 매</small>
              </span>
            </>
          )}
        </div>

        <section className="p-card cp-queue">
          <div className="p-card-head">
            <h3>촬영 큐</h3>
            <em>{queue.length + (current ? 1 : 0)} 매</em>
          </div>
          <ul>
            {current && (
              <li>
                <button className="now" onClick={() => openDetail(d.id, current.slot)}>
                  <b>{pos(current.slot)}</b>
                  <small>{current.runs.length + 1}회차</small>
                  <em>{running ? '촬영 중' : '일시정지'}</em>
                </button>
              </li>
            )}
            {queue.map(p => (
              <li key={p.id}>
                <button onClick={() => openDetail(p.deviceId, p.slot)}>
                  <b>{pos(p.slot)}</b>
                  <small>
                    {p.runs.length + 1}회차 · {hm(nextAt(state, p))} 예정
                  </small>
                  <em>대기</em>
                </button>
              </li>
            ))}
            {!current && !queue.length && <li className="cp-empty">대기 중인 촬영이 없습니다</li>}
          </ul>
        </section>

        {/*
          * 일시정지 · 재개는 정상 운영이라 사용자도 쓴다.
          * 비상 정지는 고장 상황의 조치라 관리자에게만 보인다.
          */}
        <div className={`cp-acts ${isAdmin ? '' : 'one'}`}>
          <button className="p-btn" disabled={!running} onClick={() => send('pause', d.id)}>
            <ActIcon name="pause" />
            일시정지
          </button>
          <button
            className="p-btn"
            disabled={d.job?.status !== 'paused'}
            onClick={() => send('resume', d.id)}
          >
            <ActIcon name="play" />
            재개
          </button>
          {isAdmin && (
            <button
              className="p-btn danger"
              disabled={!job}
              onClick={() => send('stop', d.id, {}, null, true)}
            >
              <ActIcon name="stop" />
              비상 정지
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
