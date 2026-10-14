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

export function RegisterScreen({state, send, setTab, device = 1, slot: picked}: Props) {
  const [deviceId, setDeviceId] = useState(device);

  const free = useMemo(() => {
    const used = new Set(platesFor(state, deviceId).map(p => p.slot));
    return Array.from({length: SLOTS_PER_DEVICE}, (_, i) => i + 1).filter(n => !used.has(n));
  }, [state, deviceId]);

  // 현황에서 누른 칸이 있으면 그 칸으로 시작한다. 그새 찼으면 첫 빈 칸으로 떨어진다.
  const [slot, setSlot] = useState(() => (picked && free.includes(picked) ? picked : free[0] || 0));
  /** 「등록」을 눌러 확인을 기다리는 중. */
  const [ask, setAsk] = useState(false);
  /** 방금 등록한 위치. 화면에 남겨 이어서 넣는 동안 무엇을 넣었는지 보이게 한다. */
  const [last, setLast] = useState('');
  /** 「완료」를 누를 때까지 이어서 넣은 매수. */
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

  /**
   * 등록 — 확인 팝업에서 「확인」을 누르면 보낸다. 끝나면 팝업 없이 이 화면에 남고,
   * 다음 빈 칸이 골라진다. 「계속 등록할까요?」를 따로 묻지 않는다 — 완료 / 계속 등록은
   * 예 · 아니오처럼 읽히지 않아 헷갈렸다(혜원님 10/14). 끝낼 때는 왼쪽 아래 「완료」.
   */
  const register = async () => {
    setAsk(false);
    setSubmitting(true);
    const place = pos(slot);
    // 투입 시각은 서버가 찍는다. 화면은 무엇이 기록될지 미리 보여줄 뿐이다.
    const result = await send('register', deviceId, {slot});
    if (result) {
      setBatch(n => n + 1);
      setLast(place);
    }
    setSubmitting(false);
  };

  /**
   * 등록을 끝낸다. 서버는 등록이 들어올 때마다 촬영을 붙잡아 두므로,
   * 여기서 풀어 줘야 밀어 둔 것들이 한꺼번에 돌기 시작한다.
   */
  const finish = () => {
    setBatch(0);
    setLast('');
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
            {!slot && <small>등록 가능한 빈 슬롯이 없습니다</small>}
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
            {batch > 0 && (
              <p className="rg-batch">
                {last} 등록 완료 · 이번에 {batch}매 · 다 넣었으면 「완료」를 누르세요
              </p>
            )}
          </section>

          <div className="rg-acts">
            <button className="p-btn" onClick={() => (batch ? finish() : setTab('overview'))}>
              {batch ? '완료' : '취소'}
            </button>
            <button
              className="primary p-btn"
              onClick={() => (blockReason ? setBlockOpen(true) : setAsk(true))}
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

      {ask && (
        <Modal title="플레이트 등록" confirmLabel="확인" onConfirm={register} onClose={() => setAsk(false)}>
          <div className="pick-box">
            <i className="pick-cell" aria-hidden />
            <div>
              <b>{pos(slot)}</b>
              <span>투입 시각은 확인을 누르는 순간으로 기록됩니다</span>
            </div>
          </div>
          <p className="pick-ask">이 위치에 플레이트를 등록하시겠습니까?</p>
        </Modal>
      )}
    </>
  );
}
