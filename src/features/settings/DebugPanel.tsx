import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {active, plateBad, pending} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
}

/*
 * ───── 개발용 트리거 (배포 전 제거) ─────
 *
 * LCD 앞에서 손으로 만들기 어려운 상태를 한 번에 만든다. 촬영 실패는 실제로
 * 실패가 날 때까지 기다려야 하고, 반출 대기는 배양 기간이 다 지나야 뜬다.
 * 화면이 그 상태에서 어떻게 보이는지 확인하려고 열두 시간을 기다릴 수는 없다.
 *
 * 지우는 법: 이 파일과 SettingsScreen 의 'debug' 항목, 그리고
 * server/controller.mjs 의 simPlate 메서드와 sim.plate 분기를 지운다.
 */

type Trig = {
  key: string;
  label: string;
  /** 눌렀을 때 실제로 무엇이 바뀌는지. 한 줄. */
  what: string;
  run: (send: SendCommand, deviceId: number) => Promise<unknown>;
  /** 되돌리는 쪽인지 — 색을 달리해 짝을 이룬다. */
  undo?: boolean;
};

/** 장비 상태 — 고른 스캐너 한 대에만 건다. */
const DEVICE: readonly Trig[] = [
  {
    key: 'fault',
    label: 'Z축 오류',
    what: '점검 필요 · 알림 종에 장비 오류',
    run: (s, id) => s('sim.input', id, {fault: 'Z_LIMIT'}),
  },
  {
    key: 'heater',
    label: '히터 오류',
    what: '점검 필요 · 알림 종에 장비 오류',
    run: (s, id) => s('sim.input', id, {fault: 'HEATER'}),
  },
  {
    key: 'door',
    label: '도어 열림',
    what: '촬영 중단 · 등록 막힘',
    run: (s, id) => s('sim.input', id, {doorOpen: true}),
  },
  {
    key: 'off',
    label: '연결 끊김',
    what: '유선 연결 3/4 · 카드 회색',
    run: (s, id) => s('sim.input', id, {connected: false}),
  },
  {
    key: 'pc',
    label: 'PC 전송 끊김',
    what: '재전송 버튼 잠김',
    run: (s, id) => s('sim.input', id, {pcConnected: false}),
  },
  {
    key: 'cam',
    label: '카메라 고장',
    what: '다음 촬영이 실패로 끝난다',
    run: (s, id) => s('sim.input', id, {failCamera: true}),
  },
  {
    key: 'ok',
    label: '정상으로',
    what: '위의 모든 이상을 한 번에 되돌린다',
    undo: true,
    run: (s, id) =>
      s('sim.input', id, {
        fault: null,
        doorOpen: false,
        connected: true,
        pcConnected: true,
        failCamera: false,
      }),
  },
];

/** 데이터 상태 — 고른 스캐너의 플레이트 하나에 건다. */
const PLATE: readonly Trig[] = [
  {
    key: 'seed',
    label: '표본 채우기',
    what: '스캐너마다 정상·미전송·실패·반출 대기 한 장씩',
    run: (s, id) => s('sim.plate', id, {kind: 'seed'}),
  },
  {
    key: 'failed',
    label: '촬영 실패 1건',
    what: 'Well 빨간 점 · 알림 종 · 문제 발생 +1',
    run: (s, id) => s('sim.plate', id, {kind: 'failed'}),
  },
  {
    key: 'pending',
    label: '미전송 2건',
    what: '미전송 +2 · 문제 발생 +1',
    run: (s, id) => s('sim.plate', id, {kind: 'pending'}),
  },
  {
    key: 'done',
    label: '배양 종료',
    what: '반출 대기 +1 · 알림 종에 완료',
    run: (s, id) => s('sim.plate', id, {kind: 'done'}),
  },
  {
    key: 'due',
    label: '촬영 시각 도래',
    what: '자동 촬영이 곧 시작된다',
    run: (s, id) => s('sim.plate', id, {kind: 'due'}),
  },
  {
    key: 'clear',
    label: '전체 반출',
    what: '수납 중인 플레이트를 모두 비운다',
    undo: true,
    run: (s, id) => s('sim.plate', id, {kind: 'clear'}),
  },
];

export function DebugPanel({state, send}: Props) {
  const [deviceId, setDeviceId] = useState(1);
  /** 마지막으로 누른 결과. 눌렀는데 아무 일도 없어 보일 때가 있어서 적는다. */
  const [said, setSaid] = useState('');

  const device = state.devices.find(d => d.id === deviceId);
  const plates = active(state).filter(p => p.deviceId === deviceId);

  const fire = async (t: Trig) => {
    setSaid(`${t.label} …`);
    try {
      await t.run(send, deviceId);
      setSaid(`${t.label} · 보냈습니다`);
    } catch (e) {
      setSaid(`${t.label} · ${e instanceof Error ? e.message : '실패'}`);
    }
  };

  const row = (title: string, list: readonly Trig[]) => (
    <>
      <h3 className="dbg-h">{title}</h3>
      <div className="dbg-grid">
        {list.map(t => (
          <button key={t.key} className={t.undo ? 'dbg-b undo' : 'dbg-b'} onClick={() => fire(t)}>
            <b>{t.label}</b>
            <em>{t.what}</em>
          </button>
        ))}
      </div>
    </>
  );

  return (
    <section className="card stack">
      <h2>개발용 트리거</h2>
      <p className="muted">
        화면 확인용입니다. 손으로 만들기 어려운 상태를 한 번에 만듭니다. 납품 전에 이 항목은
        삭제합니다.
      </p>

      <div className="dbg-pick">
        {state.devices.map(d => (
          <button
            key={d.id}
            className={d.id === deviceId ? 'selected' : ''}
            onClick={() => setDeviceId(d.id)}
          >
            {d.name}
          </button>
        ))}
      </div>

      <p className="dbg-now">
        {device?.name} · 플레이트 {plates.length}매 · 문제 {plates.filter(plateBad).length}매 ·
        미전송 {plates.reduce((a, p) => a + pending(p), 0)}건
        {device?.fault ? ` · 오류 ${device.fault}` : ''}
        {device?.doorOpen ? ' · 도어 열림' : ''}
        {device?.connected ? '' : ' · 연결 끊김'}
        {device?.pcConnected ? '' : ' · PC 끊김'}
      </p>

      {row('장비 상태', DEVICE)}
      {row('플레이트 · 데이터', PLATE)}

      {said && <p className="dbg-said">{said}</p>}
    </section>
  );
}
