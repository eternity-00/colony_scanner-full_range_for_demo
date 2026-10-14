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
  /** 스캐너 상태 칸을 눌렀을 때 — 칸별로 보는 현황 화면. */
  onStatus: () => void;
  onNeedAdmin: (where: string, what: string) => void;
}

/** 할 일 칸의 한 줄. 누르면 그 일을 하러 간다. */
interface Todo {
  key: 'wait' | 'send' | 'fault';
  label: string;
  value: number;
  unit: string;
  /** 칩 안의 그림. 24 격자, 선 굵기 2 — 현황 요약 줄과 같은 그림이다. */
  path: string;
  go?: () => void;
}

/** 칸 머리의 작은 색 칩 그림. */
const HEAD_ICON = {
  scanner: 'M4 5h16v14H4zM4 9.5h16M4 14h16M9.5 5v14M14.5 5v14',
  todo: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2',
  alarm: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4',
};

const Chip = ({kind, path}: {kind: string; path: string}) => (
  <i className={`stat-ic ${kind}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  </i>
);

/**
 * 홈 (v2.0) — 큰 버튼 둘과 요약 칸 셋.
 *
 * 2차 피드백(상무님 요구): 홈을 단순하게. 접종기 UI 홈처럼 윗줄에 큰 동작
 * 버튼, 아랫줄에 상태 요약 칸을 둔다. 1.6 까지의 홈(트레이 24칸)은 상세 탭
 * 왼쪽으로 옮겼다 — 칸 하나하나를 보는 일은 상세의 몫이다.
 *
 * 윗줄: 장비 앞에 선 사람이 맨 먼저 하는 두 가지, 등록과 반출.
 * 아랫줄: 스캐너가 지금 어떤지 · 내가 할 일 · 알람. 숫자만 짧게 적고,
 * 자세한 것은 눌러서 들어간다.
 */
export function OverviewScreen({
  state,
  send,
  openDetail,
  openRegister,
  onDevice,
  onStatus,
  onNeedAdmin,
}: Props) {
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
      path: 'M12 3v10M8 9l4 4 4-4M4 20h16',
      go: done.length ? () => setRemoving(true) : undefined,
    },
    {
      key: 'send',
      label: '미전송',
      value: unsent.reduce((a, p) => a + pending(p), 0),
      unit: '건',
      path: 'M12 19V7M6.5 12.5L12 7l5.5 5.5M4 4h16',
      go: unsent.length ? () => openDetail(device.id, unsent[0].slot) : undefined,
    },
    {
      key: 'fault',
      label: '문제 발생',
      value: bad.length,
      unit: '매',
      path: 'M12 4.5l8.5 15h-17zM12 10v4M12 17h.01',
      go: bad.length ? () => openDetail(device.id, bad[0].slot) : undefined,
    },
  ];
  const todoSum = todos.reduce((a, t) => a + t.value, 0);
  const jobLabel = job
    ? `${job.slot ? pos(job.slot) : ''} ${job.status === 'paused' ? '일시정지' : STAGES[job.step] ?? '진행 중'}`.trim()
    : '대기 중';

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

      {/*
        * 아랫줄 — 요약 셋. 세 칸이 같은 뼈대를 쓴다: 머리(색 칩 · 이름 · 오른쪽 끝의
        * 한 마디) / 몸(그 칸의 주인공) / 발(누르면 어디로 가는지). 칸마다 생김새가
        * 다르면 눈이 칸마다 읽는 법을 새로 배운다.
        */}
      <div className="home-sum">
        {/* 스캐너 상태 — 누르면 칸별로 보는 현황으로 간다. */}
        <button className="card hsum" onClick={onStatus}>
          <span className="hsum-head">
            <Chip kind="scanner" path={HEAD_ICON.scanner} />
            <small>스캐너 상태</small>
            <Badge type={next.badgeType}>{next.badge}</Badge>
          </span>
          <span className="hsum-body">
            <small>지금 하는 일</small>
            <b className={`hsum-job ${job ? '' : 'idle'}`}>{jobLabel}</b>
          </span>
          <span className="hsum-facts">
            <span>
              <small>다음 촬영</small>
              <b className={next.scheduled ? '' : 'idle'}>{next.label}</b>
            </span>
            <span>
              <small>배양 중</small>
              <b>
                {plates.length}
                <em>/ {SLOTS_PER_DEVICE}칸</em>
              </b>
            </span>
          </span>
        </button>

        {/* 할 일 — 줄마다 그 일을 하러 간다. 0 인 줄은 누를 데가 없다. */}
        <section className="card hsum">
          <span className="hsum-head">
            <Chip kind="todo" path={HEAD_ICON.todo} />
            <small>할 일</small>
            <em className={todoSum ? '' : 'none'}>{todoSum ? `${todoSum}건` : '없음'}</em>
          </span>
          <div className="hsum-todo">
            {todos.map(t => (
              <button key={t.key} className={t.key} disabled={!t.go} onClick={t.go}>
                <Chip kind={t.key} path={t.path} />
                <span>{t.label}</span>
                <b>
                  {t.value}
                  <em>{t.unit}</em>
                </b>
                <i className="hsum-go" aria-hidden="true">›</i>
              </button>
            ))}
          </div>
        </section>

        {/* 알람 — 위에서부터 몇 줄을 바로 보여 준다. 줄을 누르면 그 일로, 아래 「전체 보기」는 목록 팝업. */}
        <section className="card hsum">
          <span className="hsum-head">
            <Chip kind={alerts.length ? 'fault' : 'alarm'} path={HEAD_ICON.alarm} />
            <small>알람</small>
            <em className={alerts.length ? 'bad' : 'none'}>{alerts.length ? `${alerts.length}건` : '없음'}</em>
          </span>
          {alerts.length ? (
            <>
              <ul className="hsum-alerts">
                {alerts.slice(0, 3).map(i => (
                  <li key={i.id} className={i.kind}>
                    <button disabled={!i.go} onClick={() => i.go?.()}>
                      <b>{i.where.replace(`${device.name} · `, '')}</b>
                      <span>{i.what}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button className="hsum-more" onClick={() => setAlertsOpen(true)}>
                전체 보기 <span aria-hidden="true">›</span>
              </button>
            </>
          ) : (
            <span className="hsum-body hsum-clear">
              <b>처리할 알람이 없습니다</b>
              <small>장비와 플레이트가 모두 정상입니다.</small>
            </span>
          )}
        </section>
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
