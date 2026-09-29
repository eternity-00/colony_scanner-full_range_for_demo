import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {WELL_LABEL} from '../../config/defines.ts';
import {AdminCall} from '../../shared/AdminCall.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {elapsedLabel, hm, kdt} from '../../utils/datetime.ts';
import {nextAt, platesFor, pos, status, tone, totalRuns, wellState} from '../../utils/plate.ts';
import {StatBar} from './StatBar.tsx';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
}

export function OverviewScreen({state, openDetail, openRegister}: Props) {
  const [picked, setPicked] = useState<{deviceId: number; slot: number} | null>(null);
  const [emptyPick, setEmptyPick] = useState<{deviceId: number; slot: number} | null>(null);

  /** 칸을 누르면 — 플레이트가 있으면 요약 팝업, 비어 있으면 등록 확인 팝업. */
  const tap = (deviceId: number, slot: number) => {
    const plate = platesFor(state, deviceId).find(p => p.slot === slot);
    if (plate) setPicked({deviceId, slot});
    else setEmptyPick({deviceId, slot});
  };

  const plate = picked
    ? platesFor(state, picked.deviceId).find(p => p.slot === picked.slot)
    : undefined;
  const device = picked ? state.devices.find(d => d.id === picked.deviceId) : undefined;

  return (
    <div className="overview">
      <StatBar state={state} />
      <AdminCall state={state} devices={state.devices} />
      <div className="scanner-grid">
        {state.devices.map(d => {
          const plates = platesFor(state, d.id);
          const next = plates
            .filter(p => !p.paused && p.runs.length < totalRuns(state))
            .map(p => nextAt(state, p))
            .sort((a, b) => a - b)[0];
          const running = d.job?.status === 'running';
          const stopped = !d.connected || d.fault || d.doorOpen || d.job?.status === 'paused';
          // NEXT 는 시각만 적는다. 상태를 말하는 낱말은 옆 배지의 몫이다 —
          // 같은 줄에서 둘이 같은 말을 하면 어느 쪽을 읽어야 할지 흐려진다.
          // 찍을 시각이 정해져 있지 않으면(촬영 중·정지·플레이트 없음·시각이 이미
          // 지남) — 로 비워 둔다.
          const scheduled = next !== undefined && next > state.serverTime && !running && !stopped;
          const nextLabel = scheduled ? hm(next) : '—';

          // 배지는 장비 상태를 말한다. 거기에 「왜 안 찍고 있는지」를 더한다.
          // 시각이 지났는데 멈춰 있는 이유가 화면 어디에도 없으면 고장으로 보인다.
          const due = next !== undefined && next <= state.serverTime;
          const badge =
            !running && !stopped && due
              ? !state.autoRun
                ? '자동 꺼짐'
                : state.captureHold
                  ? '등록 중'
                  : '촬영 대기'
              : status(d);

          return (
            <section className={`card scanner ${tone(d)}`} key={d.id}>
              <div className="card-head">
                <h3>{d.name}</h3>
                <span className="head-next">
                  <small>NEXT</small>
                  <b className={scheduled ? '' : 'idle'}>{nextLabel}</b>
                </span>
                <Badge type={badge === '자동 꺼짐' ? 'warn' : tone(d)}>{badge}</Badge>
              </div>
              <div className="tray-box">
                <Tray state={state} deviceId={d.id} compact onSelect={slot => tap(d.id, slot)} />
              </div>
            </section>
          );
        })}
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
                SCANNER {emptyPick.deviceId} · {pos(emptyPick.slot)}
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
          title={`SCANNER ${picked.deviceId} · ${pos(picked.slot)}`}
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
