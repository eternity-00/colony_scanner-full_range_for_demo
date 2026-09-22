import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {Badge} from '../../shared/Badge.tsx';
import {WellLegend} from '../../shared/Legend.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {hm} from '../../utils/datetime.ts';
import {nextAt, platesFor, status, tone, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number) => void;
}

/** 칸을 처음 누를 때 한 번만 안내를 띄우고, 이후에는 바로 상세로 보낸다. */
const HINT_KEY = 'colony-cell-hint';

export function OverviewScreen({state, openDetail, openRegister}: Props) {
  const [hint, setHint] = useState<{deviceId: number; slot: number} | null>(null);

  const tap = (deviceId: number, slot: number) => {
    try {
      if (localStorage.getItem(HINT_KEY)) return openDetail(deviceId, slot);
    } catch {
      /* 사생활 보호 모드 등에서 접근이 막히면 안내를 띄운다. */
    }
    setHint({deviceId, slot});
  };

  const goHint = () => {
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* 저장에 실패해도 이동은 진행한다. */
    }
    const h = hint;
    setHint(null);
    if (h) openDetail(h.deviceId, h.slot);
  };

  return (
    <div className="overview">
      <div className="overview-head">
        <WellLegend />
      </div>
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
                <Badge type={tone(d)}>{status(d)}</Badge>
              </div>
              <div className="tray-box">
                <Tray state={state} deviceId={d.id} compact onSelect={slot => tap(d.id, slot)} />
              </div>
              <div className="card-foot">
                <div>
                  <small>다음 촬영</small>
                  <b className={running ? 'go' : stopped ? 'stop' : ''}>{nextLabel}</b>
                </div>
                <div className="foot-btns">
                  <button
                    className="soft"
                    onClick={() => openDetail(d.id, plates.at(-1)?.slot || 1)}
                  >
                    상세
                  </button>
                  <button
                    className="soft accent"
                    disabled={plates.length >= 24}
                    onClick={() => openRegister(d.id)}
                  >
                    등록
                  </button>
                </div>
              </div>
            </section>
          );
        })}
      </div>
      {hint && (
        <Modal
          title="플레이트 상세"
          confirmLabel="상세 보기"
          onConfirm={goHint}
          onClose={() => setHint(null)}
        >
          <p>
            선택한 칸의 플레이트 촬영 이력·영상을 상세 화면에서 볼 수 있습니다. 이후에는 칸을 누르면
            바로 상세로 이동합니다.
          </p>
        </Modal>
      )}
    </div>
  );
}
