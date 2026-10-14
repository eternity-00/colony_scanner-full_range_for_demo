import {useState} from 'react';
import type {AppState} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {Modal} from '../../shared/Modal.tsx';
import {hm} from '../../utils/datetime.ts';
import {faultLabel, tempAbnormal} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
}

type Mod = 'ok' | 'warn' | 'bad';

/** 캘리브레이션 목록 — 초안(260911)처럼 항목마다 「실행」을 둔다. */
const CALIBRATIONS = [
  {kind: 'camera', name: '카메라 초점 · 배율', note: '촬영 영상이 흐리거나 크기가 다를 때'},
  {kind: 'axis', name: '구동 4축 원점', note: '이송 위치가 어긋날 때'},
  {kind: 'heat', name: '히팅 스테이션 온도', note: '물기 제거 온도가 맞지 않을 때'},
  {kind: 'light', name: '조명 광량', note: '영상 밝기가 고르지 않을 때'},
] as const;

/**
 * 장비 (v2.1) — 초안(260911)의 장비 상태.
 *
 * 왼쪽: 유선 통신 한 줄 · 모듈 상태 다섯 칸 · 이벤트 로그.
 * 오른쪽: 활성 오류(없으면 정상) · 캘리브레이션 · 스캐너 재초기화.
 */
export function DeviceScreen({state, send}: Props) {
  /*
   * 확인을 받는 팝업. window.confirm 은 브라우저가 그리는 창이라 영어로 뜨고
   * 키오스크 화면에서 혼자 다른 옷을 입는다. 다른 화면과 같은 Modal 로 받는다.
   */
  const [ask, setAsk] = useState<{what: string; label: string; danger?: boolean; run: () => void} | null>(
    null,
  );
  const d = state.devices[0];
  if (!d) return null;

  const fault = faultLabel(d);
  const linked = d.connected && d.pcConnected;
  const mods: [string, Mod, string][] = [
    ['카메라', d.failCamera || d.fault === 'CAMERA_TIMEOUT' ? 'bad' : 'ok', d.failCamera ? '오류' : '정상'],
    ['구동 4축', d.fault === 'Z_LIMIT' ? 'bad' : 'ok', d.fault === 'Z_LIMIT' ? 'Z축 오류' : '정상'],
    [
      '히팅',
      d.fault === 'HEATER' ? 'bad' : tempAbnormal(d) ? 'warn' : 'ok',
      d.fault === 'HEATER' ? '오류' : `${d.temperature.toFixed(1)}℃`,
    ],
    ['조명', 'ok', d.light ? 'ON' : '정상'],
    ['도어 · 전원', d.doorOpen ? 'warn' : 'ok', d.doorOpen ? '도어 열림' : 'DC 24V'],
  ];
  const logs = state.logs.slice(0, 40);

  return (
    <div className="dv-page">
      <div className="dv-main">
        <section className="p-card dv-link">
          <i className={linked ? 'ok' : 'bad'} />
          <h3>유선 통신</h3>
          <p className="p-note">{d.name} → 인큐베이터 메인 하드웨어</p>
          <b>{linked ? '238 Mbps' : '–'}</b>
          <span className={`p-tag ${linked ? 'good' : 'bad'}`}>{linked ? '링크 정상' : '연결 끊김'}</span>
        </section>

        <section className="p-card dv-mods">
          <div className="p-card-head">
            <h3>모듈 상태</h3>
            <span className="dv-mod-acts">
              <button onClick={() => send('home', d.id)}>원점 복귀</button>
              <button onClick={() => send('reset', d.id)}>모듈 초기화</button>
            </span>
          </div>
          <div className="dv-mod-grid">
            {mods.map(([name, st, text]) => (
              <span key={name} className={st}>
                <small>{name}</small>
                <b>
                  <i />
                  {text}
                </b>
              </span>
            ))}
          </div>
        </section>

        <section className="p-card dv-log">
          <div className="p-card-head">
            <h3>이벤트 로그</h3>
            <p>최근 {logs.length}건</p>
          </div>
          <ul>
            {logs.length ? (
              logs.map(row => (
                <li key={row.id} className={row.level.toLowerCase()}>
                  <time>{hm(row.at)}</time>
                  <span
                    className={`p-tag ${row.level === 'ERROR' ? 'bad' : row.level === 'WARN' ? 'warn' : 'mute'}`}
                  >
                    {row.level === 'ERROR' ? 'ERR' : row.level}
                  </span>
                  <b>{row.message}</b>
                </li>
              ))
            ) : (
              <li className="dv-none">남은 기록이 없습니다</li>
            )}
          </ul>
        </section>
      </div>

      <div className="dv-side">
        {fault ? (
          <section className="dv-alert bad">
            <small>활성 오류 · {d.name}</small>
            <b>{fault}</b>
            <p>
              {d.doorOpen
                ? '도어를 닫은 뒤 오류 해제를 실행하세요.'
                : '간섭과 모듈 상태를 확인한 뒤 원점 복귀를 실행하세요.'}
            </p>
            <span>
              <button className="danger" onClick={() => send('home', d.id)}>
                원점 복귀
              </button>
              <button
                disabled={!d.fault || d.doorOpen}
                onClick={() =>
                  setAsk({
                    what: `${d.name}의 오류 상태를 해제하시겠습니까?`,
                    label: '해제',
                    run: () => void send('clearError', d.id),
                  })
                }
              >
                오류 해제
              </button>
            </span>
          </section>
        ) : (
          <section className="dv-alert ok">
            <small>활성 오류</small>
            <b>없음</b>
            <p>모든 모듈이 정상입니다.</p>
          </section>
        )}

        <section className="p-card dv-cal">
          <div className="p-card-head">
            <h3>캘리브레이션</h3>
          </div>
          <ul>
            {CALIBRATIONS.map(c => (
              <li key={c.kind}>
                <span>
                  <b>{c.name}</b>
                  <small>{c.note}</small>
                </span>
                <button onClick={() => send('calibrate', d.id, {kind: c.kind})}>실행</button>
              </li>
            ))}
          </ul>
        </section>

        <button
          className="p-btn dv-reset"
          onClick={() =>
            setAsk({
              what: '스캐너를 재초기화합니다. 진행 중인 촬영은 중단됩니다.',
              label: '재초기화',
              danger: true,
              run: () => void send('reset', d.id),
            })
          }
        >
          스캐너 재초기화
        </button>
      </div>

      {ask && (
        <Modal
          title="확인"
          confirmLabel={ask.label}
          danger={ask.danger}
          onConfirm={() => {
            ask.run();
            setAsk(null);
          }}
          onClose={() => setAsk(null)}
        >
          <p>{ask.what}</p>
        </Modal>
      )}
    </div>
  );
}
