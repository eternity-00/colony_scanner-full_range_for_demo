import {useState} from 'react';
import type {AppState, Device} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {Modal} from '../../shared/Modal.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {elapsedLabel, kdt} from '../../utils/datetime.ts';
import {pending, platesFor, pos, totalRuns, wellState} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  device: Device;
  send: SendCommand;
  onClose: () => void;
}

/**
 * 홈의 「플레이트 반출」 (2차 피드백: 홈에서 반출로 바로 간다).
 *
 * 트레이에서 꺼낼 칸을 고르고 반출한다. 처음에는 반출을 기다리는 판(촬영을
 * 다 마친 판) 중 첫 칸을 골라 둔다 — 반출하러 온 사람 대부분이 꺼낼 판이다.
 * 아직 배양 중인 판도 고를 수 있다. 다 찍기 전에 꺼내야 하는 일도 있다.
 *
 * 이 팝업이 곧 확인이다. 고른 판을 크게 다시 보여 주고 반출을 누르게 하므로,
 * 확인 팝업을 한 번 더 띄우지 않는다.
 */
export function RemoveDialog({state, device, send, onClose}: Props) {
  const plates = platesFor(state, device.id);
  const need = totalRuns(state);
  const [slot, setSlot] = useState<number | undefined>(
    () => plates.filter(p => p.runs.length >= need).sort((a, b) => a.slot - b.slot)[0]?.slot,
  );
  const plate = plates.find(p => p.slot === slot);
  const done = plate ? plate.runs.length >= need : false;

  return (
    <Modal title="플레이트 반출" onClose={onClose} wide bare>
      <div className="remove-pick">
        <Tray state={state} deviceId={device.id} selected={slot} removal onSelect={setSlot} />
        <div className="remove-side">
          {plate ? (
            <>
              <div className="pick-box">
                <i className={`pick-cell w-${wellState(state, plate, device)}`} aria-hidden />
                <div>
                  <b>
                    {device.name} · {pos(plate.slot)}
                  </b>
                  <span>{plate.id}</span>
                </div>
              </div>
              <dl className="pick-info">
                <dt>투입 시각</dt>
                <dd>{kdt(plate.registeredAt)}</dd>
                <dt>경과</dt>
                <dd>{elapsedLabel(plate.registeredAt, state.serverTime)}</dd>
                <dt>회차</dt>
                <dd className={done ? '' : 'warnv'}>
                  {plate.runs.length} / {need}회{done ? ' · 촬영 완료' : ' · 아직 배양 중'}
                </dd>
                <dt>미전송</dt>
                <dd className={pending(plate) ? 'badv' : ''}>{pending(plate)}건</dd>
              </dl>
              <p className="pick-ask">
                반출하면 보유 영상 파일을 삭제하고 슬롯을 비웁니다. 촬영 이력은 유지됩니다.
              </p>
            </>
          ) : (
            <p className="pick-ask">꺼낼 플레이트의 칸을 왼쪽에서 고르세요.</p>
          )}
          <div className="actions">
            <button onClick={onClose}>취소</button>
            <button
              className="danger"
              disabled={!plate}
              onClick={() => {
                if (!plate) return;
                onClose();
                void send('remove', device.id, {plateId: plate.id});
              }}
            >
              반출
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
