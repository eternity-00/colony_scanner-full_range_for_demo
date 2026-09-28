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
          // 플레이트가 없으면 찍을 것도 없다. 예전에는 「지금+주기」를 보여 줬는데
          // 빈 트레이에 다음 촬영 시각이 떠 있는 게 더 이상했다.
          //
          // 시각이 지났는데 자동 촬영이 꺼져 있으면 「지금」이라고 해선 안 된다.
          // 아무 일도 일어나지 않는데 곧 찍을 것처럼 보이고, 화면 어디에도
          // 왜 안 찍는지가 없었다. 스케줄러가 멈춰 있다는 것을 여기서 말한다.
          const nextLabel = running
            ? '진행 중'
            : stopped
              ? '정지'
              : next === undefined
                ? '—'
                : next > state.serverTime
                  ? hm(next)
                  : state.autoRun
                    ? '지금'
                    : '자동 꺼짐';

          return (
            <section className={`card scanner ${tone(d)}`} key={d.id}>
              <div className="card-head">
                <h3>{d.name}</h3>
                <span className="head-next">
                  <small>NEXT</small>
                  <b className={running ? 'go' : stopped || nextLabel === '자동 꺼짐' ? 'stop' : ''}>
                    {nextLabel}
                  </b>
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
