import {useEffect, useMemo, useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE, type SendCommand, type TabKey} from '../../config/defines.ts';
import {WellLegend} from '../../shared/Legend.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {kdt} from '../../utils/datetime.ts';
import {isBusy, platesFor, pos, status, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  setTab: (tab: TabKey) => void;
  /** 현황 화면에서 넘어올 때 미리 고른 스캐너. */
  device?: number;
  /** 현황에서 빈 칸을 눌러 왔을 때 그 칸. 비어 있지 않으면 첫 빈 칸으로 떨어진다. */
  slot?: number;
}

interface Done {
  place: string;
}

export function RegisterScreen({state, send, setTab, device = 1, slot: picked}: Props) {
  const [deviceId, setDeviceId] = useState(device);

  const free = useMemo(() => {
    const used = new Set(platesFor(state, deviceId).map(p => p.slot));
    return Array.from({length: SLOTS_PER_DEVICE}, (_, i) => i + 1).filter(n => !used.has(n));
  }, [state, deviceId]);

  // 현황에서 누른 칸이 있으면 그 칸으로 시작한다. 그새 찼으면 첫 빈 칸으로 떨어진다.
  const [slot, setSlot] = useState(() => (picked && free.includes(picked) ? picked : free[0] || 0));
  const [done, setDone] = useState<Done | null>(null);
  /** 「완료」를 누를 때까지 이어서 넣은 매수. 팝업을 닫아도 유지된다. */
  const [batch, setBatch] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  useEffect(() => setDeviceId(device), [device]);

  // 고른 칸이 다른 사람 등록으로 차버리면 남은 빈 칸으로 옮긴다.
  // 등록을 보내는 중에는 화면이 튀지 않도록 건드리지 않는다.
  useEffect(() => {
    if (!submitting && !free.includes(slot)) setSlot(free[0] || 0);
  }, [free, slot, submitting]);

  const d = state.devices.find(x => x.id === deviceId);
  if (!d) return null;

  const deviceIssue = !d.connected || !!d.fault || d.doorOpen || isBusy(d);
  const blockReason = !d.connected
    ? '장비 연결을 확인하세요.'
    : d.fault
      ? '점검 필요 상태입니다. 장비 화면에서 오류를 해제하세요.'
      : d.doorOpen
        ? '도어를 닫은 뒤 등록하세요.'
        : isBusy(d)
          ? '촬영 작업 중입니다. 완료 후 등록하세요.'
          : !slot
            ? '빈 슬롯이 없습니다. 다른 스캐너를 선택하세요.'
            : '';

  const register = async () => {
    setSubmitting(true);
    const place = `${d.name} · ${pos(slot)}`;
    // 투입 시각은 서버가 찍는다. 화면은 무엇이 기록될지 미리 보여줄 뿐이다.
    const result = await send('register', deviceId, {slot});
    if (result) {
      setBatch(n => n + 1);
      setDone({place});
    } else setSubmitting(false);
  };

  const closeDone = () => {
    setSubmitting(false);
    setDone(null);
  };

  /**
   * 등록을 끝낸다. 서버는 등록이 들어올 때마다 촬영을 붙잡아 두므로,
   * 여기서 풀어 줘야 밀어 둔 것들이 한꺼번에 돌기 시작한다.
   */
  const finish = () => {
    closeDone();
    setBatch(0);
    void send('registerDone', 0);
    setTab('overview');
  };

  return (
    <>
      <div className="reg-page">
        <div className="overview-head">
          <WellLegend simple />
        </div>
        <div className="register-layout">
          <section className="card stack">
            <div className="device-tabs">
              {state.devices.map(x => (
                <button
                  key={x.id}
                  className={x.id === deviceId ? 'selected' : ''}
                  onClick={() => setDeviceId(x.id)}
                >
                  {x.name}
                  <small>
                    {status(x)} · 빈 슬롯 {SLOTS_PER_DEVICE - platesFor(state, x.id).length}
                  </small>
                </button>
              ))}
            </div>
            <Tray
              state={state}
              deviceId={deviceId}
              registration
              selected={slot}
              onSelect={setSlot}
            />
          </section>

          <aside className="stack">
            <section className="card dark">
              <small>선택된 수납 위치</small>
              <h2>
                {d.name} · {slot ? pos(slot) : '선택 불가'}
              </h2>
            </section>

            <section className="card stack">
              {/*
                * 투입 시각은 고르는 것이 아니라 등록한 순간으로 찍힌다.
                * 고를 수 있게 두면 촬영 일정 전체를 앞뒤로 옮길 수 있다.
                */}
              <dl>
                <dt>투입 시각</dt>
                <dd>{kdt(state.serverTime)}<em>등록하는 순간으로 기록됩니다</em></dd>
                <dt>검사 루틴</dt>
                <dd>
                  {state.routine.cycleHours}시간 · {state.routine.days}일
                </dd>
                <dt>총 촬영</dt>
                <dd>
                  {totalRuns(state)}회
                  <em>Well당 {state.routine.wellShots}장</em>
                </dd>
    <dt>첫 촬영</dt>
                <dd>
                  {state.routine.delay ? `등록 완료 ${state.routine.delay}분 뒤` : '등록 완료 직후'}
                  <em>등록을 마쳐야 촬영이 시작됩니다</em>
                </dd>
              </dl>
              <button className="link" onClick={() => setTab('settings')}>
                설정에서 변경 →
              </button>
            </section>

            <button
              className="primary large"
              onClick={() => (blockReason ? setBlockOpen(true) : register())}
            >
              등록하고 수납
            </button>
          </aside>
        </div>
      </div>

      {blockOpen && (
        <Modal bare title="등록할 수 없습니다" onClose={() => setBlockOpen(false)}>
          <p>{blockReason}</p>
          <div className="actions">
            <button onClick={() => setBlockOpen(false)}>취소</button>
            {deviceIssue && (
              <button
                className="primary"
                onClick={() => {
                  setBlockOpen(false);
                  setTab('device');
                }}
              >
                장비 화면으로
              </button>
            )}
          </div>
        </Modal>
      )}

      {done && (
        <Modal
          bare
          title="등록 완료"
          onClose={finish}
        >
          <div className="done-box">
            <i />
            <div>
              <b>{done.place}</b>
              <span>
                이번에 {batch}매 등록 ·{' '}
                {state.routine.delay
                  ? `첫 촬영은 완료 ${state.routine.delay}분 뒤`
                  : '완료를 누르면 촬영 시작'}
              </span>
            </div>
          </div>
          <p className="done-ask">플레이트를 이어서 등록하시겠습니까?</p>
          <div className="actions">
            <button onClick={closeDone}>계속 등록</button>
            <button className="primary" data-autofocus onClick={finish}>
              완료
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
