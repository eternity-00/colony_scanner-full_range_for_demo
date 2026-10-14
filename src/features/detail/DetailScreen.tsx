import type {AppState, Plate, Run} from '../../api/types.ts';
import {SLOTS_PER_DEVICE, type SendCommand} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {WellLegend} from '../../shared/Legend.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {elapsedLabel, fmt} from '../../utils/datetime.ts';
import {dueToday, nextAt, pending, platesFor, pos, totalRuns} from '../../utils/plate.ts';
import {RunsTable} from './RunsTable.tsx';

interface Props {
  state: AppState;
  deviceId: number;
  slot: number;
  setSlot: (deviceId: number, slot: number) => void;
  send: SendCommand;
  openRegister: (deviceId: number, slot?: number) => void;
  openViewer: (plate: Plate, run: Run, wellIndex: number) => void;
  onHistory: () => void;
}

/**
 * 상세 (v2.1) — 초안(260911)의 상세.
 *
 * 왼쪽: 트레이 수납도. 칸을 누르면 팝업 없이 오른쪽이 그 칸으로 바뀐다.
 * 오른쪽: 고른 플레이트의 값 한 줄 · 회차별 촬영 이력 · 동작 버튼 줄.
 * 2차 피드백(좌측 전체 플레이트 상태, 우측 플레이트별 상세)과 같은 꼴이다.
 */
export function DetailScreen({
  state,
  deviceId,
  slot,
  setSlot,
  send,
  openRegister,
  openViewer,
  onHistory,
}: Props) {
  const device = state.devices.find(d => d.id === deviceId);
  if (!device) return null;

  const plates = platesFor(state, deviceId);
  const plate = plates.find(p => p.slot === slot);
  const done = plate ? plate.runs.length >= totalRuns(state) : false;
  const busy = ['running', 'paused'].includes(device.job?.status ?? '');

  return (
    <div className="dt-page">
      <section className="p-card dt-left">
        <div className="p-card-head">
          <h3>트레이 수납도</h3>
          <p>8단 × 3열 · 플레이트 단위</p>
        </div>
        <WellLegend />
        <div className="p-tray dt-tray">
          <Tray
            state={state}
            deviceId={deviceId}
            selected={slot}
            showDue
            onSelect={n => setSlot(deviceId, n)}
          />
        </div>
        <div className="dt-left-foot">
          <span>
            수납 {plates.length} / {SLOTS_PER_DEVICE} 매
          </span>
          <span>오늘 촬영 {plates.filter(p => dueToday(state, p)).length} 매</span>
        </div>
      </section>

      <div className="dt-right">
        <section className="p-card dt-info">
          <div className="dt-title">
            <small className="p-label">선택 플레이트</small>
            <b>{pos(slot)}</b>
            {plate && <em>{plate.id}</em>}
          </div>
          {plate ? (
            <>
              <div className="dt-fact">
                <small className="p-label">투입 시각</small>
                <b>{fmt(plate.registeredAt)}</b>
              </div>
              <div className="dt-fact">
                <small className="p-label">검사 루틴</small>
                <b>
                  {state.routine.cycleHours} 시간 주기 · {state.routine.days} 일
                </b>
              </div>
              <div className="dt-fact">
                <small className="p-label">경과 / 회차</small>
                <b>
                  {elapsedLabel(plate.registeredAt, state.serverTime)} · {plate.runs.length} /{' '}
                  {totalRuns(state)} 회
                </b>
              </div>
              <div className="dt-fact">
                <small className="p-label">다음 촬영</small>
                <b className={done || plate.paused ? 'warn' : ''}>
                  {done ? '배양 종료 · 반출 필요' : plate.paused ? '일정 정지' : fmt(nextAt(state, plate))}
                </b>
              </div>
            </>
          ) : (
            <div className="dt-fact">
              <small className="p-label">상태</small>
              <b>빈 슬롯</b>
            </div>
          )}
        </section>

        {plate ? (
          <RunsTable
            state={state}
            plate={plate}
            onView={(run, wellIndex) => openViewer(plate, run, wellIndex)}
            onHistory={onHistory}
          />
        ) : (
          <section className="p-card dt-empty">
            <p>빈 슬롯입니다. 이 위치에 플레이트를 등록할 수 있습니다.</p>
            <button className="primary p-btn" onClick={() => openRegister(deviceId, slot)}>
              ＋ 이 위치에 등록
            </button>
          </section>
        )}

        {/*
          * 장비를 움직이는 버튼도 눌리게 둔다. 서버가 막고 App 이 그걸 받아
          * 「관리자 확인」 팝업을 띄우므로, 무엇을 하려다 막혔는지 알 수 있다.
          */}
        {plate && (
          <div className="dt-acts">
            <button
              className="p-btn"
              disabled={!pending(plate) || !device.pcConnected}
              onClick={() => send('retry', device.id, {plateId: plate.id})}
            >
              <ActIcon name="send" />
              재전송
            </button>
            <button
              className="p-btn"
              onClick={() => send('platePause', device.id, {plateId: plate.id, paused: !plate.paused})}
            >
              <ActIcon name={plate.paused ? 'play' : 'pause'} />
              {plate.paused ? '일정 재개' : '일정 정지'}
            </button>
            <button
              className="p-btn"
              onClick={() => send('remove', device.id, {plateId: plate.id}, null, true)}
            >
              <ActIcon name="eject" />
              플레이트 반출
            </button>
            <button
              className="primary p-btn wide"
              disabled={busy}
              onClick={() => send('capture', device.id, {plateId: plate.id}, 'running')}
            >
              <ActIcon name="play" />
              촬영 시작
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
