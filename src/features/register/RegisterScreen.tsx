import {useEffect, useMemo, useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE, type SendCommand, type TabKey} from '../../config/defines.ts';
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

  const firstShot = !state.autoRun
    ? '자동 촬영 꺼짐'
    : state.routine.delay
      ? kdt(state.serverTime + state.routine.delay * 60000)
      : '등록 완료 직후';

  return (
    <>
      <div className="rg-page">
        <section className="p-card rg-left">
          <div className="p-card-head">
            <h3>수납 위치 선택</h3>
            <p>빈 슬롯을 눌러 지정합니다 · 플레이트 1 매 = 1 슬롯</p>
            <em>빈 슬롯 {free.length}</em>
          </div>
          {/* 스캐너가 둘 이상일 때만 고르는 탭을 둔다. */}
          {state.devices.length > 1 && (
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
          )}
          <div className="p-tray rg-tray">
            <Tray
              state={state}
              deviceId={deviceId}
              registration
              selected={slot}
              onSelect={setSlot}
            />
          </div>
          <div className="legend rg-legend">
            <span>
              <i className="rg-sel" />
              선택
            </span>
            <span>
              <i className="rg-free" />빈 슬롯
            </span>
            <span>
              <i className="rg-used" />
              사용 중
            </span>
          </div>
        </section>

        <aside className="rg-side">
          <div className="p-panel rg-where">
            <small>선택된 수납 위치</small>
            <b>{slot ? pos(slot) : '선택 불가'}</b>
            <small>
              {slot
                ? `6-well 플레이트 1 매 · 남은 빈 슬롯 ${free.length}`
                : '등록 가능한 빈 슬롯이 없습니다'}
            </small>
          </div>

          {/*
            * 투입 시각은 고르는 것이 아니라 등록한 순간으로 찍힌다.
            * 고를 수 있게 두면 촬영 일정 전체를 앞뒤로 옮길 수 있다.
            */}
          <section className="p-card rg-times">
            <div>
              <small className="p-label">투입 시각</small>
              <span className="rg-box now">
                <b>{kdt(state.serverTime)}</b>
                <em>등록하는 순간으로 기록</em>
              </span>
            </div>
            <div>
              <small className="p-label">첫 촬영 예정 (자동 산정)</small>
              <span className="rg-box">
                <b>{firstShot}</b>
                <em>등록을 마쳐야 촬영이 시작됩니다</em>
              </span>
            </div>
          </section>

          <section className="rg-routine">
            <div className="p-card-head">
              <h3>검사 루틴</h3>
              <button className="link" onClick={() => setTab('settings')}>
                설정에서 변경 →
              </button>
            </div>
            <div className="rg-facts">
              <span>
                <small>촬영 주기</small>
                <b>
                  {state.routine.cycleHours}
                  <em>시간</em>
                </b>
              </span>
              <span>
                <small>총 배양 기간</small>
                <b>
                  {state.routine.days}
                  <em>일</em>
                </b>
              </span>
              <span>
                <small>총 촬영 회차</small>
                <b>
                  {totalRuns(state)}
                  <em>회</em>
                </b>
              </span>
              <span>
                <small>Well 당 촬영</small>
                <b>
                  {state.routine.wellShots}
                  <em>장</em>
                </b>
              </span>
            </div>
            {batch > 0 && <p className="rg-batch">이번에 {batch}매 등록했습니다 · 완료를 누르면 촬영이 시작됩니다</p>}
          </section>

          <div className="rg-acts">
            <button className="p-btn" onClick={() => (batch ? finish() : setTab('overview'))}>
              {batch ? '완료' : '취소'}
            </button>
            <button
              className="primary p-btn"
              onClick={() => (blockReason ? setBlockOpen(true) : register())}
            >
              등록
            </button>
          </div>
        </aside>
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
            <button onClick={finish}>완료</button>
            <button className="primary" data-autofocus onClick={closeDone}>
              계속 등록
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
