import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {fmt} from '../../utils/datetime.ts';
import {active, dueNow, nextAt, pos, tone, totalRuns} from '../../utils/plate.ts';
import {JobCard} from './JobCard.tsx';

interface Props {
  state: AppState;
  send: SendCommand;
  openDetail: (deviceId: number, slot?: number) => void;
}

type ViewMode = 'single' | 'grid';

export function CaptureScreen({state, send, openDetail}: Props) {
  const [mode, setMode] = useState<ViewMode>('single');
  const [selected, setSelected] = useState(1);
  const [queueOpen, setQueueOpen] = useState(false);

  const devices = state.devices;
  const queue = active(state)
    .filter(p => dueNow(state, p))
    .sort((a, b) => nextAt(state, a) - nextAt(state, b));

  if (!devices.length && !queue.length) {
    return (
      <div className="card empty-state">
        <h2>진행 중이거나 예정된 촬영이 없습니다.</h2>
        <p>상세 화면에서 플레이트 촬영을 실행하세요.</p>
      </div>
    );
  }

  const shown = mode === 'single' ? devices.filter(d => d.id === selected) : devices;

  return (
    <div className="run-page">
      <div className="run-bar">
        <div className="run-tabs">
          {devices.map(d => (
            <button
              key={d.id}
              className={`rt ${tone(d)} ${mode === 'single' && selected === d.id ? 'sel' : ''}`}
              onClick={() => {
                setSelected(d.id);
                setMode('single');
              }}
            >
              <i />
              {d.name}
            </button>
          ))}
        </div>
        <div className="run-right">
          <div className="viewtoggle">
            <button className={mode === 'single' ? 'on' : ''} onClick={() => setMode('single')}>
              단일
            </button>
            <button className={mode === 'grid' ? 'on' : ''} onClick={() => setMode('grid')}>
              4분할
            </button>
          </div>
          <button className="queue-btn" onClick={() => setQueueOpen(true)}>
            촬영 큐 <b>{queue.length}</b>
          </button>
        </div>
      </div>

      <div className={`job-grid ${mode}`}>
        {shown.map(d => (
          <JobCard key={d.id} device={d} state={state} send={send} openDetail={openDetail} />
        ))}
      </div>

      {queueOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setQueueOpen(false)} />
          <aside className="queue-drawer open">
            <div className="drawer-head">
              <b>촬영 큐 · {queue.length}매</b>
              <button className="drawer-x" onClick={() => setQueueOpen(false)} aria-label="닫기">
                ×
              </button>
            </div>
            {queue.length ? (
              queue.slice(0, 20).map((p, i) => (
                <button
                  key={p.id}
                  className="qrow"
                  onClick={() => {
                    setQueueOpen(false);
                    openDetail(p.deviceId, p.slot);
                  }}
                >
                  <span className="qn">{i + 1}</span>
                  <span className="qmain">
                    <b>
                      S{p.deviceId} · {pos(p.slot)}
                    </b>
                    <small>
                      {p.runs.length + 1}/{totalRuns(state)}회차 · {fmt(nextAt(state, p))}
                    </small>
                  </span>
                </button>
              ))
            ) : (
              <p className="muted queue-empty">대기 중인 촬영이 없습니다.</p>
            )}
          </aside>
        </>
      )}
    </div>
  );
}
