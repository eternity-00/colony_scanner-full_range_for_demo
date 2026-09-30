import {useState, type ReactNode} from 'react';
import type {AppState} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {fmt} from '../../utils/datetime.ts';
import {status, tempAbnormal, tone} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
}

type CalibrationKind = 'camera' | 'axis' | 'heat' | 'light';

const ACTION_ICON = {
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  reset: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 1 2.5 6" />
      <path d="M3 22v-5h5" />
    </>
  ),
  clear: (
    <>
      <path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z" />
      <path d="M9.5 12l1.8 1.8 3.2-3.6" />
    </>
  ),
};

const Stroke = ({children}: {children: ReactNode}) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

export function DeviceScreen({state, send}: Props) {
  const [calibration, setCalibration] = useState<CalibrationKind>('camera');
  const [logOpen, setLogOpen] = useState(false);
  /*
   * 확인을 받는 팝업. 예전에는 window.confirm 을 그대로 썼는데, 그건
   * 브라우저가 그리는 창이라 「127.0.0.1:8787 says」와 Cancel/OK 가 영어로
   * 뜨고 키오스크 화면에서 혼자 다른 옷을 입는다. 손가락으로 누르기에도
   * 작다. 다른 화면과 같은 Modal 로 받는다.
   */
  const [ask, setAsk] = useState<{what: string; danger?: boolean; run: () => void} | null>(null);

  const faulted = state.devices.filter(d => d.fault || d.doorOpen);
  // 피드백 2.2 — 촬영·광학 파라미터 변경은 관리자만.
  // 온도 현재값은 관리자에게만 상시, 분석자에게는 이상 시에만 보여준다.
  const isAdmin = state.session.role === 'admin';

  return (
    <div className="device-page">
      {faulted.length > 0 && (
        <section className="card active-error">
          <h2>활성 오류</h2>
          {faulted.map(d => (
            <div key={d.id}>
              <b>
                {d.name} · {d.fault || 'DOOR_OPEN'}
              </b>
              <span>
                {d.doorOpen
                  ? '도어를 닫은 뒤 오류 해제를 실행하세요.'
                  : '간섭과 모듈 상태를 확인한 뒤 원점 복귀를 실행하세요.'}
              </span>
            </div>
          ))}
        </section>
      )}

      <div className="device-grid">
        {state.devices.map(d => (
          <section className="card stack" key={d.id}>
            <div className="row between">
              <h3>{d.name}</h3>
              <Badge type={tone(d)}>{status(d)}</Badge>
            </div>
            <dl>
              <dt>유선 링크</dt>
              <dd>{d.pcConnected ? '연결 · 238 Mbps' : '끊김'}</dd>
              <dt>카메라</dt>
              <dd>{d.failCamera ? '오류' : '정상'}</dd>
              <dt>구동 4축</dt>
              <dd>{d.fault === 'Z_LIMIT' ? 'Z축 오류' : '정상'}</dd>
              <dt>히팅</dt>
              <dd>
                {d.fault === 'HEATER'
                  ? '오류'
                  : isAdmin || tempAbnormal(d)
                    ? `${d.temperature.toFixed(1)}℃`
                    : '정상'}
              </dd>
              <dt>조명 / 전원</dt>
              <dd>{d.light ? 'ON' : '정상'} / DC 24V</dd>
            </dl>
            <div className="dev-actions">
              <button className="da home" onClick={() => send('home', d.id)}>
                <Stroke>{ACTION_ICON.home}</Stroke>
                원점 복귀
              </button>
              <button className="da reset" onClick={() => send('reset', d.id)}>
                <Stroke>{ACTION_ICON.reset}</Stroke>
                모듈 초기화
              </button>
              <button
                className="da clear"
                disabled={!d.fault || d.doorOpen}
                onClick={() =>
                  setAsk({
                    what: `${d.name}의 오류 상태를 해제하시겠습니까?`,
                    run: () => void send('clearError', d.id),
                  })
                }
              >
                <Stroke>{ACTION_ICON.clear}</Stroke>
                오류 해제
              </button>
            </div>
          </section>
        ))}
      </div>

      <section className="card cal-row">
        <div className="cal-label">
          <h2>{isAdmin ? '캘리브레이션' : '장비 이력'}</h2>
          <small>
            {isAdmin
              ? '선택 항목을 전체 스캐너에 일괄 실행합니다.'
              : '캘리브레이션은 관리자 권한이 필요합니다.'}
          </small>
        </div>
        {isAdmin && (
          <>
            <select
              value={calibration}
              onChange={e => setCalibration(e.target.value as CalibrationKind)}
            >
              <option value="camera">카메라 초점·배율</option>
              <option value="axis">구동 4축 원점</option>
              <option value="heat">히팅 온도</option>
              <option value="light">조명 광량</option>
            </select>
            <button
              className="primary cal-run"
              onClick={() =>
                Promise.all(state.devices.map(d => send('calibrate', d.id, {kind: calibration})))
              }
            >
              실행
            </button>
            <button
              className="outline-danger cal-btn"
              onClick={() =>
                setAsk({
                  what: '스캐너 4대를 모두 재초기화합니다. 진행 중인 촬영은 중단됩니다.',
                  danger: true,
                  run: () => void Promise.all(state.devices.map(d => send('reset', d.id))),
                })
              }
            >
              전체 스캐너 재초기화
            </button>
          </>
        )}
        <button className="ghost cal-btn" onClick={() => setLogOpen(true)}>
          <Stroke>
            <path d="M8 6h13M8 12h13M8 18h13" />
            <path d="M3 6h.01M3 12h.01M3 18h.01" />
          </Stroke>
          이벤트 로그
        </button>
      </section>

      {/*
        * 이벤트 로그는 화면을 덮는 팝업이 아니라 오른쪽에서 밀려 나오는 서랍이다.
        * 촬영 화면의 큐와 같은 꼴이라 손이 따로 배울 것이 없고, 뒤의 장비 카드가
        * 그대로 보여 「무엇을 보다가 로그를 열었는지」가 끊기지 않는다.
        *
        * 표가 아니라 메시지 줄로 그린다. 시각·종류·내용 세 칸으로 나누면 좁은
        * 서랍에서 내용이 잘리는데, 여기서 읽어야 하는 건 문장 그 자체다.
        */}
      {logOpen && (
        <>
          <div className="drawer-scrim" onClick={() => setLogOpen(false)} />
          <aside className="log-drawer" role="dialog" aria-label="이벤트 로그">
            <div className="drawer-head">
              <b>이벤트 로그 · {state.logs.length}건</b>
              <button className="drawer-x" onClick={() => setLogOpen(false)} aria-label="닫기">
                ×
              </button>
            </div>
            {state.logs.length ? (
              state.logs.slice(0, 80).map(row => (
                <div key={row.id} className={`lrow ${row.level.toLowerCase()}`}>
                  <span className="lv">{row.level}</span>
                  <span className="lmain">
                    <b>{row.message}</b>
                    <small>{fmt(row.at)}</small>
                  </span>
                </div>
              ))
            ) : (
              <p className="queue-empty muted">남은 기록이 없습니다.</p>
            )}
          </aside>
        </>
      )}

      {ask && (
        <Modal
          title="확인"
          confirmLabel={ask.danger ? '재초기화' : '해제'}
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
