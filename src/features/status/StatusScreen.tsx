import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {WELL_LABEL} from '../../config/defines.ts';
import {Modal} from '../../shared/Modal.tsx';
import {ScannerHead} from '../../shared/ScannerHead.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {elapsedLabel, kdt} from '../../utils/datetime.ts';
import {nextAt, platesFor, pos, totalRuns, wellState} from '../../utils/plate.ts';
import {StatBar} from './StatBar.tsx';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
}

/**
 * 현황 (1.6 까지의 홈).
 *
 * v1.7 에서 홈을 「큰 버튼 + 요약」으로 바꾸면서, 칸 하나하나를 보던 이 화면은
 * 메뉴의 「현황」으로 옮겼다. 내용은 1.6 그대로다 — 요약 한 줄과 스캐너 카드.
 */
export function StatusScreen({state, openDetail, openRegister}: Props) {
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
      <div className={`scanner-grid n${state.devices.length}`}>
        {state.devices.map(d => (
          <section className="card scanner" key={d.id}>
            <ScannerHead state={state} device={d} />
            <div className="tray-box">
              <Tray state={state} deviceId={d.id} compact onSelect={slot => tap(d.id, slot)} />
            </div>
          </section>
        ))}
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
