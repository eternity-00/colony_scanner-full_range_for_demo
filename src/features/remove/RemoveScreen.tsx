import {useEffect, useMemo, useState} from 'react';
import type {AppState, RemoveReason} from '../../api/types.ts';
import type {SendCommand, TabKey} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {elapsedLabel, fmt} from '../../utils/datetime.ts';
import {REASON_LABEL, RESULT_LABEL, isBusy, plateAtSlot, plateDone, platesFor, pos, totalRuns} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  setTab: (tab: TabKey) => void;
  device?: number;
  /** 홈에서 미리 고른 칸(반출 대기 중 첫 칸). */
  slot?: number;
}

const REASONS: RemoveReason[] = ['done', 'positive', 'contaminated', 'moved', 'other'];

/**
 * 플레이트 제거 (M3 A4) — 홈 「플레이트 제거」에서 들어오는 독립 흐름.
 *
 * 왼쪽 트레이에서 꺼낼 판을 고르고 → 사유를 고르고 → 확인하면 서버가 영상을 지우고 이력에
 * 사유를 남긴다(remove{reason}). 도어 센서가 아직 없어 「문을 열고 꺼낸 뒤 닫았습니다」는
 * 확인 버튼으로 대신한다(M3 B3). 다 찍은 판 · PC 판정이 난 판이 먼저 골라진다.
 */
export function RemoveScreen({state, send, setTab, device = 1, slot: picked}: Props) {
  const d = state.devices.find(x => x.id === device) ?? state.devices[0];
  const plates = useMemo(() => (d ? platesFor(state, d.id) : []), [state, d]);
  const ready = useMemo(() => plates.filter(p => plateDone(state, p)).sort((a, b) => a.slot - b.slot), [plates, state]);
  const [slot, setSlot] = useState<number>(() => {
    if (picked && plates.some(p => p.slot === picked)) return picked;
    return (ready[0] ?? [...plates].sort((a, b) => a.slot - b.slot)[0])?.slot ?? 0;
  });
  const plate = d ? plateAtSlot(state, d.id, slot) : undefined;
  const suggested: RemoveReason = plate?.result === 'positive' ? 'positive' : plate?.result === 'contaminated' ? 'contaminated' : plate && plateDone(state, plate) ? 'done' : 'other';
  const [reason, setReason] = useState<RemoveReason>(suggested);
  const [ask, setAsk] = useState(false);
  const [doorStep, setDoorStep] = useState<{slot: number; id: string} | null>(null);
  const [sending, setSending] = useState(false);

  // 판이 바뀌면 사유 제안도 다시 고른다.
  useEffect(() => setReason(suggested), [suggested, plate?.id]);

  if (!d) return null;
  const busy = isBusy(d) || state.cameraBusy || !!state.maintenance;
  const block = !d.connected ? '장비 연결을 확인하세요.' : busy ? '촬영이 끝난 뒤 제거하세요.' : !plate ? '꺼낼 플레이트를 고르세요.' : '';

  const remove = async () => {
    if (!plate) return;
    setAsk(false);
    setSending(true);
    const target = {slot: plate.slot, id: plate.id};
    const ok = await send('remove', d.id, {plateId: plate.id, reason});
    setSending(false);
    if (ok) setDoorStep(target);
  };

  return (
    <>
      <div className="rm-page">
        <section className="p-card rm-left">
          <div className="p-card-head">
            <h3>꺼낼 플레이트</h3>
            <p>칸을 누르세요 · 초록 = 반출 대기</p>
            <em>{plates.length}매 · 대기 {ready.length}</em>
          </div>
          <div className="p-tray rm-tray">
            <Tray state={state} deviceId={d.id} selected={slot} onSelect={n => plateAtSlot(state, d.id, n) && setSlot(n)} />
          </div>
        </section>

        <aside className="rm-side">
          <div className="p-panel rm-where">
            <small>선택한 플레이트</small>
            {plate ? (
              <>
                <b>
                  {pos(plate.slot)} <em>{plate.id}</em>
                </b>
                <span className="rm-facts">
                  투입 {fmt(plate.registeredAt)} · 경과 {elapsedLabel(plate.registeredAt, state.serverTime)} · {plate.runs.length}/{totalRuns(state, plate)}회
                </span>
                <span className="rm-tags">
                  {plateDone(state, plate) ? <Badge type="good">반출 대기</Badge> : <Badge type="warn">배양 중 · 일정이 남았습니다</Badge>}
                  {plate.result && <Badge type={plate.result === 'negative' ? 'info' : 'bad'}>PC {RESULT_LABEL[plate.result]}</Badge>}
                  {plate.barcode && <Badge type="info">{plate.barcode}</Badge>}
                </span>
              </>
            ) : (
              <b>선택된 플레이트 없음</b>
            )}
          </div>

          <section className="p-card rm-reason">
            <div className="p-card-head">
              <h3>제거 사유</h3>
              <p>이력에 남습니다</p>
            </div>
            <div className="rm-reasons">
              {REASONS.map(r => (
                <button key={r} className={reason === r ? 'selected' : ''} onClick={() => setReason(r)} disabled={!plate}>
                  {REASON_LABEL[r]}
                </button>
              ))}
            </div>
          </section>

          <div className="rm-acts">
            <button onClick={() => setTab('overview')}>취소</button>
            <button className="primary p-btn danger-fill" disabled={!!block || sending} onClick={() => setAsk(true)}>
              플레이트 제거
            </button>
          </div>
          {block && <p className="rm-block">{block}</p>}
        </aside>
      </div>

      {ask && plate && (
        <Modal title="플레이트 제거" confirmLabel="제거" danger onConfirm={remove} onClose={() => setAsk(false)}>
          <div className="pick-box">
            <i className="pick-cell" aria-hidden />
            <div>
              <b>
                {pos(plate.slot)} · {plate.id}
              </b>
              <span>사유 · {REASON_LABEL[reason]}</span>
            </div>
          </div>
          <p className="pick-ask">장비에 남은 이 플레이트의 영상을 삭제하고 칸을 비웁니다. 촬영 이력은 남습니다.</p>
        </Modal>
      )}

      {doorStep && (
        <Modal
          title="플레이트를 꺼내세요"
          confirmLabel="꺼내고 문을 닫았습니다"
          onConfirm={() => {
            setDoorStep(null);
            setTab('overview');
          }}
          onClose={() => {
            setDoorStep(null);
            setTab('overview');
          }}
        >
          <div className="pick-box">
            <i className="pick-cell" aria-hidden />
            <div>
              <b>{pos(doorStep.slot)}</b>
              <span>{doorStep.id} · 칸이 비워졌습니다</span>
            </div>
          </div>
          <p className="pick-ask">도어를 열고 {pos(doorStep.slot)}의 플레이트를 꺼낸 뒤 도어를 닫으세요.</p>
        </Modal>
      )}
    </>
  );
}
