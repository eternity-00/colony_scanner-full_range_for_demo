import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {WELL_LABEL} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {WellLegend} from '../../shared/Legend.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {ALERT_TAG, alarmHistory, alertItems} from '../../utils/alerts.ts';
import type {SendCommand} from '../../config/defines.ts';
import {EnvCard} from '../../shared/EnvCard.tsx';
import {elapsedLabel, hm, kdt} from '../../utils/datetime.ts';
import {
  nextAt,
  plateAtSlot,
  platesFor,
  pos,
  slotsPerDevice,
  totalRuns,
  wellState,
} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
  onDevice: () => void;
  onNeedAdmin: (where: string, what: string) => void;
  send: SendCommand;
}


/**
 * 현황 (v2.1) — 초안(260911) 홈을 스캐너 한 대로 줄인 꼴.
 *
 * 왼쪽: 스캐너 카드 하나 — 이름 · 상태 · 범례 · 24칸 트레이.
 * 오른쪽: 촬영 진행 · 요약 셋 · 알람 · 등록 버튼.
 * 칸을 누르면 플레이트가 있으면 요약 팝업, 비어 있으면 등록 확인 팝업이 뜬다.
 */
export function StatusScreen({
  state,
  openDetail,
  openRegister,
  onDevice,
  onNeedAdmin,
  send,
}: Props) {
  const [history, setHistory] = useState(false);
  const [picked, setPicked] = useState<{deviceId: number; slot: number} | null>(null);
  const [emptyPick, setEmptyPick] = useState<{deviceId: number; slot: number} | null>(null);

  const d = state.devices[0];
  if (!d) return null;

  /** 칸을 누르면 — 플레이트가 있으면 요약 팝업, 비어 있으면 등록 확인 팝업. */
  const tap = (deviceId: number, slot: number) => {
    const plate = plateAtSlot(state, deviceId, slot);
    if (plate) setPicked({deviceId, slot});
    else setEmptyPick({deviceId, slot});
  };

  const plate = picked
    ? plateAtSlot(state, picked.deviceId, picked.slot)
    : undefined;
  const device = picked ? state.devices.find(x => x.id === picked.deviceId) : undefined;

  const plates = platesFor(state, d.id);
  const free = slotsPerDevice(state) - plates.length;
  // 홈과 같이 트레이 원 색으로 센다 — 한 판은 한 칸에만 들어가 넷의 합이 슬롯 수가 된다.
  const states = plates.map(p => wellState(state, p, d));
  const growing = states.filter(w => w === 'ok' || w === 'busy').length;
  const waiting = states.filter(w => w === 'done').length;
  const bad = states.filter(w => w === 'bad').length;
  const next = scannerNext(state, d);
  const alerts = alertItems(state, {
    onDevice,
    onPlate: (deviceId, slot) => openDetail(deviceId, slot),
    onNeedAdmin,
    onAck: id => void send('alarm.ack', 0, {id}),
  });
  const past = alarmHistory(state).slice(0, 30);
  const unacked = alerts.filter(a => a.ack && !a.acked).length;

  return (
    <div className="st-page">
      <section className="p-card st-scanner">
        <div className="st-head">
          <h3>{d.name}</h3>
          <Badge type={next.badgeType}>{next.badge}</Badge>
          {/* 다음 촬영은 작게 한 마디로만(혜원님 10/14). */}
          <span className="st-next">
            다음 촬영 <b className={next.scheduled ? '' : 'idle'}>{next.label}</b>
          </span>
          <WellLegend />
        </div>
        <div className="p-tray st-tray">
          <Tray
            state={state}
            deviceId={d.id}
            compact
            selected={picked?.slot ?? emptyPick?.slot}
            onSelect={slot => tap(d.id, slot)}
          />
        </div>
        <p className="st-hint">칸을 누르면 플레이트 요약, 빈 칸을 누르면 등록으로 갑니다.</p>
      </section>

      <div className="st-side">
        {/* 「지금 촬영」 칸은 뺐다 — 촬영 중인지는 트레이의 파란 원과 왼쪽 위 배지가
            이미 말한다(혜원님 10/14). 진행은 촬영 화면에서 본다. */}
        {/* 홈 아랫줄과 같은 넷, 같은 색(혜원님 10/14 · 10/21). 0 이면 칸 전체를 회색으로 가라앉히고,
            빈 슬롯은 회색 판. 미전송은 따로 세지 않고 문제 발생에 든다. */}
        <div className="p-card st-facts">
          <span className={growing ? 'grow' : 'calm'}>
            <small>배양 중</small>
            <b className={growing ? '' : 'zero'}>
              {growing}
              <em>매</em>
            </b>
          </span>
          <span className={waiting ? 'ready' : 'calm'}>
            <small>반출 대기</small>
            <b className={waiting ? '' : 'zero'}>
              {waiting}
              <em>매</em>
            </b>
          </span>
          <span className={free ? 'free' : 'calm'}>
            <small>빈 슬롯</small>
            <b className={free ? '' : 'zero'}>
              {free}
              <em>칸</em>
            </b>
          </span>
          <span className={bad ? 'bad' : 'calm'}>
            <small>문제 발생</small>
            <b className={bad ? '' : 'zero'}>
              {bad}
              <em>매</em>
            </b>
          </span>
        </div>

        <EnvCard state={state} compact />

        <section className="p-card st-alerts">
          <div className="p-card-head">
            <h3>{history ? '지난 알람' : '알람'}</h3>
            {!history && unacked > 0 && (
              <button className="st-ackall" onClick={() => void send('alarm.ack', 0, {})}>
                모두 확인 ({unacked})
              </button>
            )}
            <button className="st-hist" onClick={() => setHistory(h => !h)}>
              {history ? '현재 알람' : `지난 알람 ${past.length}`}
            </button>
          </div>
          {/* 시간순 한 줄 목록(최신이 위) — 꼬리표가 무슨 일인지, 오른쪽 끝이 언제인지.
              서버 알람은 「확인」을 남길 수 있고(ackAt), 해결돼야 목록에서 빠진다. */}
          {history ? (
            past.length ? (
              <ul className="st-list hist">
                {past.map(a => (
                  <li key={a.id}>
                    <div className={a.kind}>
                      <span className={`p-tag ${a.kind}`}>{ALERT_TAG[a.kind]}</span>
                      <b>{a.where}</b>
                      <small>{a.what}</small>
                      <time>
                        {hm(a.at)} ~ {a.clearedAt ? hm(a.clearedAt) : ''}
                      </time>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="st-clear">지난 알람이 없습니다</p>
            )
          ) : alerts.length ? (
            <ul className="st-list">
              {alerts.map(a => (
                <li key={a.id} className={a.acked ? 'acked' : ''}>
                  <button className={a.kind} onClick={a.go}>
                    <span className={`p-tag ${a.kind}`}>{ALERT_TAG[a.kind]}</span>
                    <b>{a.where}</b>
                    <small>{a.what}</small>
                    <time>{a.kind === 'device' ? '지금' : hm(a.at)}</time>
                  </button>
                  {a.ack && !a.acked && (
                    <button className="st-ack" onClick={a.ack} aria-label="알람 확인">
                      확인
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="st-clear">처리할 알람이 없습니다</p>
          )}
        </section>

        <button className="primary st-reg" disabled={!free} onClick={() => openRegister(d.id)}>
          ＋ 플레이트 등록
        </button>
      </div>

      {emptyPick && (
        <Modal
          title="빈 슬롯 등록"
          confirmLabel="등록"
          onConfirm={() => {
            const target = emptyPick;
            setEmptyPick(null);
            openRegister(target.deviceId, target.slot);
          }}
          onClose={() => setEmptyPick(null)}
        >
          {/* 누른 칸을 트레이에서 보던 모양 그대로 다시 보여 준다. */}
          <div className="pick-box">
            <i className="pick-cell" aria-hidden />
            <div>
              <b>
                {state.devices.find(d => d.id === emptyPick.deviceId)?.name} · {pos(emptyPick.slot)}
              </b>
              <span>현재 비어 있습니다</span>
            </div>
          </div>
          <p className="pick-ask">이 위치에 플레이트를 등록하시겠습니까?</p>
          <dl className="pick-info">
            <dt>검사 루틴</dt>
            <dd>
              {state.routine.cycleHours}시간 · {state.routine.days}일
            </dd>
            <dt>첫 촬영</dt>
            <dd>
              {!state.autoRun
                ? '자동 촬영이 꺼져 있습니다'
                : state.routine.delay
                  ? `등록 완료 ${state.routine.delay}분 뒤`
                  : '등록 완료 직후'}
            </dd>
          </dl>
        </Modal>
      )}

      {picked && plate && (
        <Modal
          title={`${device?.name ?? ''} · ${pos(picked.slot)}`}
          confirmLabel="상세"
          onConfirm={() => {
            const target = picked;
            setPicked(null);
            openDetail(target.deviceId, target.slot);
          }}
          onClose={() => setPicked(null)}
        >
          <dl className="plate-info">
            <dt>플레이트</dt>
            <dd>{plate.id}</dd>
            <dt>상태</dt>
            <dd>{WELL_LABEL[wellState(state, plate, device)]}</dd>
            <dt>투입 시각</dt>
            <dd>{kdt(plate.registeredAt)}</dd>
            <dt>경과</dt>
            <dd>{elapsedLabel(plate.registeredAt, state.serverTime)}</dd>
            <dt>회차</dt>
            <dd>
              {plate.runs.length} / {totalRuns(state)}회
            </dd>
            <dt>다음 촬영</dt>
            <dd>{plate.paused ? '일시정지' : kdt(nextAt(state, plate))}</dd>
          </dl>
        </Modal>
      )}
    </div>
  );
}
