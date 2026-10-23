import type {AppState, Plate, Run} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {WellLegend} from '../../shared/Legend.tsx';
import {ScannerHead} from '../../shared/ScannerHead.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {elapsedLabel, fmt} from '../../utils/datetime.ts';
import {nextAt, pending, pos, status, tone, totalRuns} from '../../utils/plate.ts';
import {RunsTable} from './RunsTable.tsx';

interface Props {
  state: AppState;
  deviceId: number;
  slot: number;
  setSlot: (deviceId: number, slot: number) => void;
  send: SendCommand;
  openRegister: (deviceId: number, slot?: number) => void;
  openViewer: (plate: Plate, run: Run, wellIndex: number) => void;
}

export function DetailScreen({
  state,
  deviceId,
  slot,
  setSlot,
  send,
  openRegister,
  openViewer,
}: Props) {
  const device = state.devices.find(d => d.id === deviceId);
  if (!device) return null;


  const plate = state.plates.find(p => p.deviceId === deviceId && p.slot === slot && !p.removedAt);
  const done = plate ? plate.runs.length >= totalRuns(state) : false;

  return (
    <div className="split detail-page">
      {/*
        * 왼쪽은 1.6 까지 홈에 있던 스캐너 카드 그대로다(2차 피드백: 기존 홈 →
        * 상세 왼쪽). v2.1 에서도 상세만은 2.0 구성을 지킨다(혜원님 10/14) —
        * 모서리 · 색 같은 겉모습만 다른 화면에 맞춘다. 칸을 누르면 팝업 없이 오른쪽이 그 칸으로 바뀐다 — 이 화면에서는
        * 칸을 고르는 것 자체가 「자세히 보기」라 한 번 더 묻지 않는다.
        * 스캐너가 한 대라 고르는 상자는 없앴다.
        */}
      <section className="card scanner tray-card">
        <ScannerHead state={state} device={device} />
        <div className="tray-box p-tray">
          <Tray state={state} deviceId={deviceId} selected={slot} onSelect={n => setSlot(deviceId, n)} />
        </div>
        <WellLegend />
      </section>

      <div className="stack">
        <section className="card stack">
          <div className="row between">
            {/* 되돌아가는 단추는 뺐다 — 이 화면은 「어디서 왔는지」가 아니라
                「무엇을 보는지」를 말한다. */}
            <div className="titleline">
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
                  disabled={
                    ['running', 'paused'].includes(device.job?.status ?? '') ||
                    state.cameraBusy ||
                    !!state.maintenance
                  }
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
                {/* 반출은 버튼 넷 중 눈에 띄게 둔다 — 홈 「반출 대기」와 같은 초록.
                    촬영을 다 마친 판이면 꽉 찬 면으로 — 지금 해야 할 일이다. */}
                <button
                  className={`remove-btn ${done ? 'due' : ''}`}
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
              <button className="primary" onClick={() => openRegister(deviceId, slot)}>
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
