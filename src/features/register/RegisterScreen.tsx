import {useEffect, useMemo, useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE, type SendCommand, type TabKey} from '../../config/defines.ts';
import {WellLegend} from '../../shared/Legend.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {dateInput, kdt} from '../../utils/datetime.ts';
import {isBusy, platesFor, pos, status, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  setTab: (tab: TabKey) => void;
  /** 현황 화면에서 넘어올 때 미리 고른 스캐너. */
  device?: number;
}

interface Done {
  place: string;
  first: number;
}

export function RegisterScreen({state, send, setTab, device = 1}: Props) {
  const [deviceId, setDeviceId] = useState(device);

  const free = useMemo(() => {
    const used = new Set(platesFor(state, deviceId).map(p => p.slot));
    return Array.from({length: SLOTS_PER_DEVICE}, (_, i) => i + 1).filter(n => !used.has(n));
  }, [state, deviceId]);

  const [slot, setSlot] = useState(() => free[0] || 0);
  const [when, setWhen] = useState(() => dateInput(Date.now()));
  const [done, setDone] = useState<Done | null>(null);
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
            : !when
              ? '투입 시각을 선택하세요.'
              : '';

  const firstShotAt = (base: number) =>
    base + state.routine.cycleHours * 3600000 + state.routine.delay * 60000;

  const register = async () => {
    setSubmitting(true);
    const place = `${d.name} · ${pos(slot)}`;
    const registeredAt = new Date(when).getTime();
    const result = await send('register', deviceId, {slot, registeredAt});
    if (result) setDone({place, first: firstShotAt(registeredAt)});
    else setSubmitting(false);
  };

  const closeDone = () => {
    setSubmitting(false);
    setDone(null);
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
              <label>
                투입 시각
                <div className="dtview">
                  <b>{when ? kdt(new Date(when).getTime()) : '—'}</b>
                  <button onClick={() => setWhen(dateInput(Date.now()))}>지금</button>
                </div>
                <input
                  className="dtpick"
                  type="datetime-local"
                  value={when}
                  onChange={e => setWhen(e.target.value)}
                />
              </label>
              <dl>
                <dt>검사 루틴</dt>
                <dd>
                  {state.routine.cycleHours}시간 · {state.routine.days}일
                </dd>
                <dt>총 촬영</dt>
                <dd>{totalRuns(state)}회</dd>
                <dt>첫 촬영</dt>
                <dd>{when ? kdt(firstShotAt(new Date(when).getTime())) : '—'}</dd>
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
          onClose={() => {
            closeDone();
            setTab('overview');
          }}
        >
          <div className="done-box">
            <i />
            <div>
              <b>{done.place}</b>
              <span>첫 촬영 {kdt(done.first)}</span>
            </div>
          </div>
          <p className="done-ask">플레이트를 이어서 등록하시겠습니까?</p>
          <div className="actions">
            <button
              onClick={() => {
                closeDone();
                setTab('overview');
              }}
            >
              완료
            </button>
            <button className="primary" onClick={closeDone}>
              계속 등록
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
