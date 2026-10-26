import type {AppState, Plate, Run} from '../../api/types.ts';
import {SHORT_STAGES, STAGES, type SendCommand} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {hm} from '../../utils/datetime.ts';
import {active, dueNow, nextAt, platesFor, pos, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  /** 끝난 촬영의 결과를 Well 6장 뷰어로 연다. */
  openViewer?: (plate: Plate, run: Run, wellIndex: number) => void;
}

/** 띠에 그리는 촬영 단계 수 — 전송 · PC 저장은 상세 · 이력이 말한다. */
const SHOWN = 4;
const JOB_NAME = {capture: '촬영', home: '원점 복귀', calibrate: '캘리브레이션', reset: '모듈 초기화'};

/**
 * 촬영 — 메뉴에 없는 화면. 촬영이 시작되면 App 이 띄우고 끝나면 원래 화면으로 돌아간다(2026-10-26).
 *
 * 왼쪽 위(예전 카메라 영상 자리): 큰 버튼 둘 「일시정지 · 중단」. 일시정지 뒤와 중단 뒤에는
 * 둘을 합친 크기의 「재시작」 하나만 남는다(일시정지 → 재개, 중단 → 같은 플레이트를 다시 촬영).
 * 왼쪽 아래: 촬영 단계 띠. 오른쪽: 촬영 큐, 관리자에게만 비상 정지.
 */
export function CaptureScreen({state, send, openViewer}: Props) {
  const d = state.devices[0];
  if (!d) return null;

  const isAdmin = state.session.role === 'admin';
  const job = d.job && ['running', 'paused'].includes(d.job.status) ? d.job : null;
  const running = d.job?.status === 'running';
  const paused = d.job?.status === 'paused';
  const finished = !job && d.job && d.job.type === 'capture' && ['completed', 'failed'].includes(d.job.status) ? d.job : null;
  const cancelled = !!finished?.cancelled;
  const finishedPlate = finished?.plateId ? state.plates.find(p => p.id === finished.plateId) : undefined;
  const finishedRun = finished && finishedPlate ? (finishedPlate.runs.find(r => r.requestId === finished.requestId) ?? finishedPlate.runs.at(-1)) : undefined;
  const capture = !job || job.type === 'capture';
  const stages = capture ? STAGES.slice(0, SHOWN) : SHORT_STAGES;
  const plates = platesFor(state, d.id);
  const current = job?.plateId ? plates.find(p => p.id === job.plateId) : undefined;
  const queue = active(state)
    .filter(p => p.id !== current?.id && dueNow(state, p))
    .sort((a, b) => nextAt(state, a) - nextAt(state, b));
  const next = scannerNext(state, d);
  const ref = job ?? finished;
  const refPlate = current ?? finishedPlate;
  const stageLabel = ref ? (capture ? STAGES[Math.min(ref.step, STAGES.length - 1)] : SHORT_STAGES[Math.min(ref.step, SHORT_STAGES.length - 1)]) : null;
  // 재시작: 일시정지면 재개, 중단된 촬영이면 같은 플레이트를 다시 촬영(플레이트가 아직 있을 때만).
  const restartable = cancelled && finishedPlate && !finishedPlate.removedAt;

  return (
    <div className="cp-page">
      <div className="cp-main">
        <div className={`cp-ctrl ${running ? 'live' : ''}`}>
          <div className="cp-ctrl-head">
            <b>
              {job
                ? `${JOB_NAME[job.type]} ${paused ? '일시정지' : '진행 중'}`
                : finished
                  ? cancelled
                    ? '촬영 중단됨'
                    : finished.status === 'failed'
                      ? '촬영 실패'
                      : '촬영 완료'
                  : '촬영 대기'}
            </b>
            {refPlate && (
              <small>
                {pos(refPlate.slot)} · {refPlate.runs.length + (job ? 1 : 0)}/{totalRuns(state, refPlate)}회차
              </small>
            )}
            {job && stageLabel && <small>단계 · {stageLabel}</small>}
            {job?.shot && <small>{job.shot}</small>}
            {finished && !cancelled && finished.status === 'failed' && <small className="bad">{finished.error || '장비 오류'}</small>}
            {ref && <small>{hm(ref.startedAt)} 시작</small>}
            <span className="cp-chips">
              {running && <span className="p-tag bad">REC</span>}
              {job?.realCamera && <span className="p-tag mute">실장비</span>}
              {job?.plateGrid && <span className="p-tag mute">{job.plateGrid.label}</span>}
            </span>
          </div>

          {job && running ? (
            <div className="cp-ctrl-btns">
              <button className="pause" onClick={() => void send('pause', d.id)}>
                <ActIcon name="pause" />
                일시정지
              </button>
              <button className="cancel" onClick={() => void send('cancel', d.id, {}, null, true)}>
                <ActIcon name="stop" />
                중단
              </button>
            </div>
          ) : job && paused ? (
            <div className="cp-ctrl-btns one">
              <button className="restart" onClick={() => void send('resume', d.id)}>
                <ActIcon name="play" />
                재시작
              </button>
            </div>
          ) : cancelled ? (
            <div className="cp-ctrl-btns one">
              <button className="restart" disabled={!restartable} onClick={() => finishedPlate && void send('capture', d.id, {plateId: finishedPlate.id})}>
                <ActIcon name="play" />
                재시작
                {!restartable && <small>플레이트가 없어 다시 촬영할 수 없습니다</small>}
              </button>
            </div>
          ) : (
            <div className="cp-ctrl-done">
              <b>{finished ? (finished.status === 'failed' ? '촬영 실패' : '촬영 완료') : '촬영 대기'}</b>
              <small>
                {finished
                  ? finished.status === 'failed'
                    ? finished.error || '장비 오류'
                    : '잠시 뒤 원래 화면으로 돌아갑니다 · 영상은 최근 영상에서'
                  : '촬영이 시작되면 이 화면이 열립니다'}
              </small>
              {finished && finishedPlate && finishedRun && finishedRun.imageState === 'held' && openViewer && (
                <button className="cp-result" onClick={() => openViewer(finishedPlate, finishedRun, 0)}>
                  촬영 결과 보기 · {finishedRun.n}회차
                  {finishedRun.capture?.alignment?.enabled ? ` · 정렬 ${finishedRun.capture.alignment.alignedWells?.length ?? 0}/6` : ''}
                </button>
              )}
            </div>
          )}
        </div>

        <section className="p-card cp-cycle">
          <div className="p-card-head">
            <h3>{capture ? '촬영 단계' : `${JOB_NAME[job?.type ?? 'capture']} 단계`}</h3>
          </div>
          <ol className="cp-steps">
            {stages.map((label, i) => {
              const st = !ref
                ? ''
                : ref.status === 'completed'
                  ? 'done'
                  : i < ref.step
                    ? 'done'
                    : i === ref.step
                      ? ref.status === 'failed'
                        ? 'fail'
                        : 'now'
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
        <section className="p-card cp-queue">
          <div className="p-card-head">
            <h3>촬영 큐</h3>
            {!job && (
              <span className="cp-next">
                다음 촬영 <b className={next.scheduled ? '' : 'idle'}>{next.label}</b>
              </span>
            )}
            <em>{queue.length + (current ? 1 : 0)} 매</em>
          </div>
          <ul>
            {current && (
              <li>
                <div className="cp-row now">
                  <b>{pos(current.slot)}</b>
                  <small>
                    {current.runs.length + 1}/{totalRuns(state, current)}회차 · {hm(job!.startedAt)} 시작
                  </small>
                  <em>{running ? '촬영 중' : '일시정지'}</em>
                </div>
              </li>
            )}
            {queue.map(p => (
              <li key={p.id}>
                <div className="cp-row">
                  <b>{pos(p.slot)}</b>
                  <small>
                    {p.runs.length + 1}회차 · {hm(nextAt(state, p))} 예정
                  </small>
                  <em>대기</em>
                </div>
              </li>
            ))}
            {!current && !queue.length && <li className="cp-empty">대기 중인 촬영이 없습니다</li>}
          </ul>
        </section>

        {/* 비상 정지는 고장 상황의 조치라 관리자에게만 보인다. 정상 중단은 왼쪽의 「중단」. */}
        {isAdmin && (
          <div className="cp-acts estop">
            <button className="p-btn danger" disabled={!job} onClick={() => send('stop', d.id, {}, null, true)}>
              <ActIcon name="stop" />
              비상 정지
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
