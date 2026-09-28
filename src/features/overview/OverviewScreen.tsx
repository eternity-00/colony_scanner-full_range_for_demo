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
          const nextLabel = running
            ? '진행 중'
            : stopped
              ? '정지'
              : hm(next || Date.now() + state.routine.cycleHours * 3600000);

          return (
            <section className={`card scanner ${tone(d)}`} key={d.id}>
              <div className="card-head">
                <h3>{d.name}</h3>
                <span className="head-next">
                  <small>NEXT</small>
                  <b className={running ? 'go' : stopped ? 'stop' : ''}>{nextLabel}</b>
                </span>
                <Badge type={tone(d)}>{status(d)}</Badge>
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
          title={`SCANNER ${emptyPick.deviceId} · ${pos(emptyPick.slot)}`}
          confirmLabel="등록"
          onConfirm={() => {
            const target = emptyPick;
            setEmptyPick(null);
            openRegister(target.deviceId, target.slot);
          }}
          onClose={() => setEmptyPick(null)}
        >
          <p>빈 슬롯입니다. 이 위치에 플레이트를 등록하시겠습니까?</p>
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
