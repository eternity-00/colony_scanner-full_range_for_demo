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

export function CaptureScreen({state, send, openDetail}: Props) {
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

  // 한 번에 한 대만 본다. 4분할은 카메라 화면이 1/4 로 줄어 정작 무엇이 찍히는지
  // 보이지 않았고, 어차피 스캐너는 한 번에 한 대만 움직인다.
  const shown = devices.filter(d => d.id === selected);

  return (
    <div className="run-page">
      <div className="run-bar">
        <div className="run-tabs">
          {devices.map(d => (
            <button
              key={d.id}
              className={`rt ${tone(d)} ${selected === d.id ? 'sel' : ''}`}
              onClick={() => setSelected(d.id)}
            >
              <i />
              {d.name}
            </button>
          ))}
        </div>
        <div className="run-right">
          <button className="queue-btn" onClick={() => setQueueOpen(true)}>
            {/* 목록을 여는 버튼이라 줄 세 개로 표시한다. */}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 7h16M4 12h16M4 17h10" />
            </svg>
            촬영 큐 <b>{queue.length}</b>
          </button>
        </div>
      </div>

      <div className="job-grid single">
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
