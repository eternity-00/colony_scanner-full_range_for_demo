import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE, STAGES, type SendCommand} from '../../config/defines.ts';
import {ActIcon} from '../../shared/ActIcon.tsx';
import {Badge} from '../../shared/Badge.tsx';
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

/** 요약 칸 한 개. 누르면 그 일을 하러 간다. */
interface Tile {
  key: 'wait' | 'slot' | 'send' | 'fault';
  label: string;
  value: number;
  unit: string;
  path: string;
  go?: () => void;
}

/**
 * 홈 (v1.7) — 현황 요약과 알람만 둔다.
 *
 * 2차 피드백(상무님 요구): 홈을 단순하게. 트레이 24칸은 상세 왼쪽으로 옮기고,
 * 홈에는 「지금 장비가 어떤지」와 「내가 할 일」만 남긴다. 장비 앞에 선 사람이
 * 맨 먼저 하는 일인 등록과 반출은 홈에서 바로 누른다.
 *
 * 요약 칸 넷은 분석자가 손을 대야 하는 것만 센다 — 꺼내라 · 넣을 수 있다 ·
 * 보내라 · 손 봐라. 숫자가 0 이 아니면 그 일을 하러 바로 갈 수 있게 누를 수 있다.
 */
export function OverviewScreen({state, send, openDetail, openRegister, onDevice, onNeedAdmin}: Props) {
  const [removing, setRemoving] = useState(false);
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

  const tiles: Tile[] = [
    {
      key: 'wait',
      label: '반출 대기',
      value: done.length,
      unit: '매',
      path: 'M12 3v10M8 9l4 4 4-4M4 20h16',
      go: done.length ? () => setRemoving(true) : undefined,
    },
    {
      key: 'slot',
      label: '빈 슬롯',
      value: free,
      unit: '칸',
      path: 'M4 4h16v16H4zM12 8.5v7M8.5 12h7',
      go: free ? () => openRegister(device.id) : undefined,
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

  return (
    <div className="home">
      <div className="home-main">
        {/* 장비가 지금 어떤지. 숫자 셋만 크게 — 다음 촬영 · 배양 중 · 지금 하는 일. */}
        <section className="card home-status">
          <div className="hs-head">
            <h2>{device.name}</h2>
            <Badge type={next.badgeType}>{next.badge}</Badge>
          </div>
          <div className="hs-vals">
            <span className="hs-v">
              <small>다음 촬영</small>
              <b className={next.scheduled ? '' : 'idle'}>{next.label}</b>
            </span>
            <span className="hs-v">
              <small>배양 중</small>
              <b>
                {plates.length}
                <em>/ {SLOTS_PER_DEVICE}칸</em>
              </b>
            </span>
            <span className="hs-v hs-job">
              <small>지금 하는 일</small>
              <b>
                {job
                  ? `${job.slot ? pos(job.slot) : ''} ${job.status === 'paused' ? '일시정지' : STAGES[job.step] ?? '진행 중'}`.trim()
                  : '대기'}
              </b>
            </span>
          </div>
        </section>

        <div className="home-tiles">
          {tiles.map(t => (
            <button
              key={t.key}
              className={`home-tile ${t.value ? 'on' : ''}`}
              disabled={!t.go}
              onClick={t.go}
            >
              <i className={`stat-ic ${t.key}`} aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d={t.path} />
                </svg>
              </i>
              <small>{t.label}</small>
              <b>
                {t.value}
                <em>{t.unit}</em>
              </b>
            </button>
          ))}
        </div>

        {/* 장비 앞에 선 사람이 맨 먼저 하는 두 가지. 홈에서 가장 큰 버튼이다. */}
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
      </div>

      {/* 알람 — 헤더 종과 같은 목록이다. 홈에서는 펼치지 않아도 보이게 늘 깔아 둔다. */}
      <section className="card home-alerts">
        <div className="ha-head">
          <h2>알람</h2>
          <em>{alerts.length}건</em>
        </div>
        {alerts.length === 0 ? (
          <p className="ha-empty">지금 처리할 일이 없습니다.</p>
        ) : (
          <ul className="alert-list">
            {alerts.map(i => (
              <li key={i.id} className={i.kind}>
                <button disabled={!i.go} onClick={() => i.go?.()}>
                  <b>{i.where}</b>
                  <span>{i.what}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {removing && <RemoveDialog state={state} device={device} send={send} onClose={() => setRemoving(false)} />}
    </div>
  );
}
