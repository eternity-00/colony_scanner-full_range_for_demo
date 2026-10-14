import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE, WELL_LABEL, WELLS} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {WellLegend} from '../../shared/Legend.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {ALERT_TAG, actionable, alertItems} from '../../utils/alerts.ts';
import {elapsedLabel, kdt} from '../../utils/datetime.ts';
import {
  dueNow,
  nextAt,
  plateBad,
  platesFor,
  pos,
  totalRuns,
  wellState,
} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
  onRunning: () => void;
  onDevice: () => void;
  onNeedAdmin: (where: string, what: string) => void;
}

const JOB_NAME = {capture: '촬영', home: '원점 복귀', calibrate: '캘리브레이션', reset: '모듈 초기화'};

/**
 * 현황 (v2.1) — 초안(260911) 홈을 스캐너 한 대로 줄인 꼴.
 *
 * 왼쪽: 스캐너 카드 하나 — 이름 · 상태 · 범례 · 24칸 트레이.
 * 오른쪽: 촬영 진행 · 요약 셋 · 알람 · 등록 버튼.
 * 칸을 누르면 플레이트가 있으면 요약 팝업, 비어 있으면 등록 확인 팝업이 뜬다.
 */
export function StatusScreen({
  state,
  openDetail,
  openRegister,
  onRunning,
  onDevice,
  onNeedAdmin,
}: Props) {
  const [picked, setPicked] = useState<{deviceId: number; slot: number} | null>(null);
  const [emptyPick, setEmptyPick] = useState<{deviceId: number; slot: number} | null>(null);

  const d = state.devices[0];
  if (!d) return null;

  /** 칸을 누르면 — 플레이트가 있으면 요약 팝업, 비어 있으면 등록 확인 팝업. */
  const tap = (deviceId: number, slot: number) => {
    const plate = platesFor(state, deviceId).find(p => p.slot === slot);
    if (plate) setPicked({deviceId, slot});
    else setEmptyPick({deviceId, slot});
  };

  const plate = picked
    ? platesFor(state, picked.deviceId).find(p => p.slot === picked.slot)
    : undefined;
  const device = picked ? state.devices.find(x => x.id === picked.deviceId) : undefined;

  const plates = platesFor(state, d.id);
  const need = totalRuns(state);
  const free = SLOTS_PER_DEVICE - plates.length;
  const waiting = plates.filter(p => p.runs.length >= need).length;
  const bad = plates.filter(plateBad).length;
  const next = scannerNext(state, d);
  const job = d.job && ['running', 'paused'].includes(d.job.status) ? d.job : null;
  const capturing = job?.type === 'capture';
  /** 지금 찍을 차례가 와 줄 서 있는 판 수(촬영 중인 판 제외). 「오늘」로 자르지 않는다 —
   *  등록하면 루틴은 언제든 이어 붙는다(혜원님 10/14). */
  const waitingShots = plates.filter(p => p.id !== job?.plateId && dueNow(state, p)).length;
  const well = job ? Math.min(WELLS, Math.floor((job.progress / 100) * WELLS) + 1) : 0;
  const alerts = alertItems(state, {
    onDevice,
    onPlate: (deviceId, slot) => openDetail(deviceId, slot),
    onNeedAdmin,
  });

  return (
    <div className="st-page">
      <section className="p-card st-scanner">
        <div className="st-head">
          <h3>{d.name}</h3>
          <Badge type={next.badgeType}>{next.badge}</Badge>
          <WellLegend />
        </div>
        <div className="p-tray st-tray">
          <Tray state={state} deviceId={d.id} compact onSelect={slot => tap(d.id, slot)} />
        </div>
        <p className="st-hint">칸을 누르면 플레이트 요약, 빈 칸을 누르면 등록으로 갑니다.</p>
      </section>

      <div className="st-side">
        {/* 지금 도는 작업 — 없으면 다음 촬영 시각. 누르면 촬영 화면. */}
        <button className="p-panel st-run" onClick={onRunning}>
          <span className="st-run-top">
            <small>{job ? (capturing ? '지금 촬영' : '장비 작업') : '다음 촬영'}</small>
            <small>자세히 →</small>
          </span>
          {job ? (
            <>
              <span className="st-run-main">
                <b>{job.slot ? pos(job.slot) : JOB_NAME[job.type]}</b>
                <em>
                  {capturing ? `WELL ${well} / ${WELLS}` : `${Math.round(job.progress)}%`}
                </em>
              </span>
              <i className="p-bar">
                <i style={{width: `${Math.max(2, job.progress)}%`}} />
              </i>
              <span className="st-run-foot">
                <small>{job.status === 'paused' ? '일시정지됨' : '진행 중'}</small>
                <small>대기 중인 촬영 {waitingShots} 매</small>
              </span>
            </>
          ) : (
            <>
              <span className="st-run-main">
                <b className={next.scheduled ? '' : 'idle'}>{next.label}</b>
                <em className={next.badgeType}>{next.badge}</em>
              </span>
              <span className="st-run-foot">
                <small>배양 중 {plates.length} 매</small>
                <small>대기 중인 촬영 {waitingShots} 매</small>
              </span>
            </>
          )}
        </button>

        {/* 홈 아랫줄과 같은 넷, 같은 색(혜원님 10/14). 미전송은 따로 세지 않고 문제 발생에 든다. */}
        <div className="p-card st-facts">
          <span className={plates.length ? 'grow' : ''}>
            <small>배양 중</small>
            <b className={plates.length ? '' : 'zero'}>
              {plates.length}
              <em>/ {SLOTS_PER_DEVICE}</em>
            </b>
          </span>
          <span className={waiting ? 'ready' : ''}>
            <small>반출 대기</small>
            <b className={waiting ? '' : 'zero'}>
              {waiting}
              <em>매</em>
            </b>
          </span>
          <span>
            <small>빈 슬롯</small>
            <b className={free ? '' : 'zero'}>
              {free}
              <em>칸</em>
            </b>
          </span>
          <span className={bad ? 'bad' : ''}>
            <small>문제 발생</small>
            <b className={bad ? '' : 'zero'}>
              {bad}
              <em>매</em>
            </b>
          </span>
        </div>

        <section className="p-card st-alerts">
          <div className="p-card-head">
            <h3>알람</h3>
            <em className={actionable(alerts) ? '' : 'none'}>
              {actionable(alerts) ? `${actionable(alerts)}건` : '없음'}
            </em>
          </div>
          {alerts.length ? (
            <ul>
              {alerts.map(a => (
                <li key={a.id}>
                  <button className={a.kind} onClick={a.go}>
                    <span className={`p-tag ${a.kind}`}>{ALERT_TAG[a.kind]}</span>
                    <span>
                      <b>{a.where}</b>
                      <small>{a.what}</small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="st-clear">처리할 알람이 없습니다</p>
          )}
        </section>

        <button className="primary st-reg" disabled={!free} onClick={() => openRegister(d.id)}>
          ＋ 플레이트 등록
        </button>
      </div>

      {emptyPick && (
        <Modal
          title="빈 슬롯 등록"
          confirmLabel="등록"
          onConfirm={() => {
            const target = emptyPick;
            setEmptyPick(null);
            openRegister(target.deviceId, target.slot);
          }}
          onClose={() => setEmptyPick(null)}
        >
          {/* 누른 칸을 트레이에서 보던 모양 그대로 다시 보여 준다. */}
          <div className="pick-box">
            <i className="pick-cell" aria-hidden />
            <div>
              <b>
                {state.devices.find(d => d.id === emptyPick.deviceId)?.name} · {pos(emptyPick.slot)}
              </b>
              <span>현재 비어 있습니다</span>
            </div>
          </div>
          <p className="pick-ask">이 위치에 플레이트를 등록하시겠습니까?</p>
          <dl className="pick-info">
            <dt>검사 루틴</dt>
            <dd>
              {state.routine.cycleHours}시간 · {state.routine.days}일
            </dd>
            <dt>첫 촬영</dt>
            <dd>
              {!state.autoRun
                ? '자동 촬영이 꺼져 있습니다'
                : state.routine.delay
                  ? `등록 완료 ${state.routine.delay}분 뒤`
                  : '등록 완료 직후'}
            </dd>
          </dl>
        </Modal>
      )}

      {picked && plate && (
        <Modal
          title={`${device?.name ?? ''} · ${pos(picked.slot)}`}
          confirmLabel="상세"
          onConfirm={() => {
            const target = picked;
            setPicked(null);
            openDetail(target.deviceId, target.slot);
          }}
          onClose={() => setPicked(null)}
        >
          <dl className="plate-info">
            <dt>플레이트</dt>
            <dd>{plate.id}</dd>
            <dt>상태</dt>
            <dd>{WELL_LABEL[wellState(state, plate, device)]}</dd>
            <dt>투입 시각</dt>
            <dd>{kdt(plate.registeredAt)}</dd>
            <dt>경과</dt>
            <dd>{elapsedLabel(plate.registeredAt, state.serverTime)}</dd>
            <dt>회차</dt>
            <dd>
              {plate.runs.length} / {totalRuns(state)}회
            </dd>
            <dt>다음 촬영</dt>
            <dd>{plate.paused ? '일시정지' : kdt(nextAt(state, plate))}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}
