import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE, STAGES, type SendCommand} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {scannerNext} from '../../shared/ScannerHead.tsx';
import {alertItems} from '../../utils/alerts.ts';
import {active, pending, plateBad, pos, totalRuns} from '../../utils/plate.ts';
import {RemoveDialog} from './RemoveDialog.tsx';

interface Props {
  state: AppState;
  send: SendCommand;
  openDetail: (deviceId: number, slot?: number) => void;
  openRegister: (deviceId: number, slot?: number) => void;
  onDevice: () => void;
  onNeedAdmin: (where: string, what: string) => void;
}

/** 할 일 칸의 한 줄. 누르면 그 일을 하러 간다. */
interface Todo {
  key: 'wait' | 'send' | 'fault';
  label: string;
  value: number;
  unit: string;
  go?: () => void;
}

/**
 * 홈 (v1.7) — 큰 버튼 둘과 요약 칸 셋.
 *
 * 2차 피드백(상무님 요구): 홈을 단순하게. 접종기 UI 홈처럼 윗줄에 큰 동작
 * 버튼, 아랫줄에 상태 요약 칸을 둔다. 1.6 까지의 홈(트레이 24칸)은 상세 탭
 * 왼쪽으로 옮겼다 — 칸 하나하나를 보는 일은 상세의 몫이다.
 *
 * 윗줄: 장비 앞에 선 사람이 맨 먼저 하는 두 가지, 등록과 반출.
 * 아랫줄: 스캐너가 지금 어떤지 · 내가 할 일 · 알람. 숫자만 짧게 적고,
 * 자세한 것은 눌러서 들어간다.
 */
export function OverviewScreen({state, send, openDetail, openRegister, onDevice, onNeedAdmin}: Props) {
  const [removing, setRemoving] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const device = state.devices[0];
  if (!device) return null;

  const plates = active(state).filter(p => p.deviceId === device.id);
  const need = totalRuns(state);
  const done = plates.filter(p => p.runs.length >= need);
  const unsent = plates.filter(p => pending(p) > 0);
  const bad = plates.filter(plateBad);
  const free = SLOTS_PER_DEVICE - plates.length;
  const next = scannerNext(state, device);
  const job = device.job && ['running', 'paused'].includes(device.job.status) ? device.job : null;
  const alerts = alertItems(state, {
    onDevice,
    onPlate: (deviceId, slot) => openDetail(deviceId, slot),
    onNeedAdmin,
  });

  const todos: Todo[] = [
    {
      key: 'wait',
      label: '반출 대기',
      value: done.length,
      unit: '매',
      go: done.length ? () => setRemoving(true) : undefined,
    },
    {
      key: 'send',
      label: '미전송',
      value: unsent.reduce((a, p) => a + pending(p), 0),
      unit: '건',
      go: unsent.length ? () => openDetail(device.id, unsent[0].slot) : undefined,
    },
    {
      key: 'fault',
      label: '문제 발생',
      value: bad.length,
      unit: '매',
      go: bad.length ? () => openDetail(device.id, bad[0].slot) : undefined,
    },
  ];

  return (
    <div className="home">
      {/* 윗줄 — 홈에서 가장 큰 두 칸. */}
      <div className="home-acts">
        <button className="home-act primary" onClick={() => openRegister(device.id)} disabled={!free}>
          <ActIcon name="plus" />
          <span>
            <b>플레이트 등록</b>
            <small>{free ? `빈 슬롯 ${free}칸` : '빈 슬롯 없음'}</small>
          </span>
        </button>
        <button className="home-act" onClick={() => setRemoving(true)} disabled={!plates.length}>
          <ActIcon name="eject" />
          <span>
            <b>플레이트 반출</b>
            <small>{done.length ? `반출 대기 ${done.length}매` : `배양 중 ${plates.length}매`}</small>
          </span>
        </button>
      </div>

      {/* 아랫줄 — 요약 셋. */}
      <div className="home-sum">
        {/* 스캐너 상태 — 누르면 칸별로 보는 상세로 간다. */}
        <button className="card hsum" onClick={() => openDetail(device.id)}>
          <span className="hsum-head">
            <small>스캐너 상태</small>
            <Badge type={next.badgeType}>{next.badge}</Badge>
          </span>
          <b className="hsum-main">
            {job
              ? `${job.slot ? pos(job.slot) : ''} ${job.status === 'paused' ? '일시정지' : STAGES[job.step] ?? '진행 중'}`.trim()
              : '대기'}
          </b>
          <dl className="hsum-rows">
            <dt>다음 촬영</dt>
            <dd className={next.scheduled ? '' : 'idle'}>{next.label}</dd>
            <dt>배양 중</dt>
            <dd>
              {plates.length} / {SLOTS_PER_DEVICE}칸
            </dd>
          </dl>
        </button>

        {/* 할 일 — 줄마다 그 일을 하러 간다. 0 인 줄은 누를 데가 없다. */}
        <section className="card hsum">
          <span className="hsum-head">
            <small>할 일</small>
          </span>
          <div className="hsum-todo">
            {todos.map(t => (
              <button key={t.key} className={t.key} disabled={!t.go} onClick={t.go}>
                <span>{t.label}</span>
                <b>
                  {t.value}
                  <em>{t.unit}</em>
                </b>
              </button>
            ))}
          </div>
        </section>

        {/* 알람 — 건수와 맨 위 한 줄만. 누르면 헤더 종과 같은 목록을 편다. */}
        <button className="card hsum" onClick={() => setAlertsOpen(true)} disabled={!alerts.length}>
          <span className="hsum-head">
            <small>알람</small>
          </span>
          <b className={`hsum-main ${alerts.length ? 'alarm' : 'quiet'}`}>
            {alerts.length}
            <em>건</em>
          </b>
          <span className="hsum-line">
            {alerts.length ? (
              <>
                {alerts[0].where.replace(`${device.name} · `, '')} · {alerts[0].what}
              </>
            ) : (
              '지금 처리할 일이 없습니다.'
            )}
          </span>
        </button>
      </div>

      {alertsOpen && (
        <Modal title={`알람 · ${alerts.length}건`} onClose={() => setAlertsOpen(false)} bare>
          <ul className="alert-list home-alert-list">
            {alerts.map(i => (
              <li key={i.id} className={i.kind}>
                <button
                  disabled={!i.go}
                  onClick={() => {
                    setAlertsOpen(false);
                    i.go?.();
                  }}
                >
                  <b>{i.where}</b>
                  <span>{i.what}</span>
                </button>
              </li>
            ))}
          </ul>
        </Modal>
      )}

      {removing && <RemoveDialog state={state} device={device} send={send} onClose={() => setRemoving(false)} />}
    </div>
  );
}
