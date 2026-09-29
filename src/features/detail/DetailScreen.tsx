import type {AppState, Plate, Run} from '../../api/types.ts';
import type {SendCommand, TabKey} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {elapsedLabel, fmt} from '../../utils/datetime.ts';
import {nextAt, pending, platesFor, pos, status, tone, totalRuns} from '../../utils/plate.ts';
import {RunsTable} from './RunsTable.tsx';

interface Props {
  state: AppState;
  deviceId: number;
  slot: number;
  setSlot: (deviceId: number, slot: number) => void;
  send: SendCommand;
  setTab: (tab: TabKey) => void;
  openRegister: (deviceId: number) => void;
  openViewer: (plate: Plate, run: Run, wellIndex: number) => void;
}

export function DetailScreen({
  state,
  deviceId,
  slot,
  setSlot,
  send,
  setTab,
  openRegister,
  openViewer,
}: Props) {
  const device = state.devices.find(d => d.id === deviceId);
  if (!device) return null;


  const plate = state.plates.find(p => p.deviceId === deviceId && p.slot === slot && !p.removedAt);
  const done = plate ? plate.runs.length >= totalRuns(state) : false;

  return (
    <div className="split detail-page">
      <section className="card tray-card">
        <div className="row between">
          <h2>트레이 수납도</h2>
          <select
            value={deviceId}
            onChange={e => {
              const id = Number(e.target.value);
              setSlot(id, platesFor(state, id).at(-1)?.slot || 1);
            }}
          >
            {state.devices.map(d => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <Tray state={state} deviceId={deviceId} selected={slot} onSelect={n => setSlot(deviceId, n)} />
      </section>

      <div className="stack">
        <section className="card stack">
          <div className="row between">
            <div className="titleline">
              <button className="backbtn" onClick={() => setTab('overview')} aria-label="현황으로">
                ←
              </button>
              <h2>
                {device.name} · {pos(slot)}
              </h2>
              {plate && <em>{plate.id}</em>}
            </div>
            <Badge type={tone(device)}>{status(device)}</Badge>
          </div>

          {plate ? (
            <>
              <div className="infogrid">
                <div className="ig">
                  <small>투입 시각</small>
                  <b>{fmt(plate.registeredAt)}</b>
                </div>
                <div className="ig">
                  <small>검사 루틴</small>
                  <b>
                    {state.routine.cycleHours}시간 <em>· {state.routine.days}일</em>
                  </b>
                </div>
                <div className="ig">
                  <small>경과 / 회차</small>
                  <b>
                    {elapsedLabel(plate.registeredAt, state.serverTime)}{' '}
                    <em>
                      · {plate.runs.length}/{totalRuns(state)}회
                    </em>
                  </b>
                </div>
                <div className="ig">
                  <small>다음 촬영</small>
                  <b className={done || plate.paused ? 'warnv' : ''}>
                    {done
                      ? '배양 종료 · 반출 필요'
                      : plate.paused
                        ? '일정 정지'
                        : fmt(nextAt(state, plate))}
                  </b>
                </div>
                <div className="ig">
                  <small>미전송</small>
                  <b className={pending(plate) ? 'badv' : 'okv'}>{pending(plate)}건</b>
                </div>
              </div>

              {/*
                * 장비를 움직이는 버튼도 눌리게 둔다. 서버가 막고 App 이 그걸 받아
                * "관리자 확인" 팝업을 띄우므로, 무엇을 하려다 막혔는지 알 수 있다.
                */}
              <div className="actbar">
                <button
                  className="primary"
                  disabled={['running', 'paused'].includes(device.job?.status ?? '')}
                  onClick={() => send('capture', device.id, {plateId: plate.id}, 'running')}
                >
                  <ActIcon name="play" />
                  촬영 시작
                </button>
                <button
                  onClick={() =>
                    send('platePause', device.id, {plateId: plate.id, paused: !plate.paused})
                  }
                >
                  <ActIcon name={plate.paused ? 'play' : 'pause'} />
                  {plate.paused ? '일정 재개' : '촬영 일시정지'}
                </button>
                <button
                  disabled={!pending(plate) || !device.pcConnected}
                  onClick={() => send('retry', device.id, {plateId: plate.id})}
                >
                  <ActIcon name="send" />
                  재전송
                </button>
                <button
                  className="outline-danger"
                  onClick={() => send('remove', device.id, {plateId: plate.id}, null, true)}
                >
                  <ActIcon name="eject" />
                  플레이트 반출
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <p>빈 슬롯입니다. 이 위치에 플레이트를 등록할 수 있습니다.</p>
              <button className="primary" onClick={() => openRegister(deviceId)}>
                등록 화면으로
              </button>
            </div>
          )}
        </section>

        {plate && (
          <RunsTable
            plate={plate}
            fill
            onView={(run, wellIndex) => openViewer(plate, run, wellIndex)}
          />
        )}
      </div>
    </div>
  );
}
