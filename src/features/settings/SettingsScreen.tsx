import {useState, type ReactNode} from 'react';
import type {AppState, Routine} from '../../api/types.ts';
import {ADMIN_IDLE_LIMIT_SEC, SLOTS_PER_DEVICE, type SendCommand} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {Toggle} from '../../shared/Toggle.tsx';
import {download} from '../../utils/download.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  operator: string;
  setOperator: (name: string) => void;
  onRole: () => void;
}

type SectionKey = 'login' | 'routine' | 'environment' | 'network' | 'backup' | 'info';

const NAV: readonly (readonly [SectionKey, string])[] = [
  ['login', '로그인 정보'],
  ['routine', '검사 루틴'],
  ['environment', '온도 · CO₂'],
  ['network', '유선 통신'],
  ['backup', '로그 · 백업'],
  ['info', '장비 정보'],
];

/** [키, 라벨, 단위, 최소, 최대, 설명] */
const ROUTINE_FIELDS: readonly (readonly [keyof Routine, string, string, number, number, string])[] =
  [
    ['cycleHours', '촬영 주기', '시간', 1, 48, '플레이트 1매를 다시 촬영하기까지의 간격'],
    ['days', '총 배양 기간', '일', 1, 90, '배양을 유지할 전체 기간'],
    ['delay', '주기 시작 지연', '분', 0, 720, '투입 시각 이후 첫 촬영까지 미루는 시간'],
  ];

export function SettingsScreen({state, send, operator, setOperator, onRole}: Props) {
  const [section, setSection] = useState<SectionKey>('login');
  const [routine, setRoutine] = useState<Routine>(state.routine);
  const [env, setEnv] = useState({
    temperature: state.devices[0]?.targetTemperature || 37,
    co2: state.devices[0]?.targetCo2 || 5,
  });

  const isAdmin = state.session.role === 'admin';

  const sections: Record<SectionKey, ReactNode> = {
    login: (
      <section className="card stack">
        <h2>로그인 정보 — 현재 세션</h2>
        <p className="muted">
          장비 단위 단일 세션입니다. 별도 로그인 화면 없이 PIN으로 권한을 전환합니다.
        </p>
        <div className="fields">
          <label className="field">
            <span className="fl">
              표시 이름<em>화면 우상단 사용자 칩에 표시됩니다</em>
            </span>
            <span className="fi plain">
              <input
                value={operator}
                onChange={e => setOperator(e.target.value)}
                onBlur={() => localStorage.setItem('colony-operator', operator)}
              />
            </span>
          </label>
          <div className="field">
            <span className="fl">
              접속 권한<em>장비 단위 단일 세션 · 별도 로그인 화면 없음</em>
            </span>
            <span className="fv">{isAdmin ? '관리자' : '분석자'}</span>
          </div>
          <div className="field">
            <span className="fl">
              자동 해제<em>관리자 전환 후 무조작 시 분석자로 복귀</em>
            </span>
            <span className="fv">5분</span>
          </div>
          <div className="field">
            <span className="fl">
              잠금 정책<em>PIN 연속 오류 시 입력 차단</em>
            </span>
            <span className="fv">5회 / 60초</span>
          </div>
          {isAdmin && (
            <div className="field">
              <span className="fl">
                잔여 시간<em>무조작 상태가 이어질 경우</em>
              </span>
              <span className="fv accent">
                {Math.max(0, ADMIN_IDLE_LIMIT_SEC - Math.floor(state.session.idleFor / 1000))}초
              </span>
            </div>
          )}
        </div>
        {isAdmin ? (
          <button onClick={() => send('role.logout', 0)}>분석자로 전환</button>
        ) : (
          <button className="primary" onClick={onRole}>
            관리자 전환
          </button>
        )}
      </section>
    ),

    routine: (
      <section className="card stack">
        <h2>검사 루틴 — 장비 전체 공통</h2>
        <p className="muted">변경 시 진행 중 배양 일정이 재산정됩니다.</p>
        <div className="fields">
          {ROUTINE_FIELDS.map(([key, label, unit, min, max, desc]) => (
            <label className="field" key={key}>
              <span className="fl">
                {label}
                <em>{desc}</em>
              </span>
              <span className="fi">
                <input
                  type="number"
                  min={min}
                  max={max}
                  step={key === 'delay' ? 15 : 1}
                  value={routine[key]}
                  onChange={e => setRoutine({...routine, [key]: Number(e.target.value)})}
                />
                <i>{unit}</i>
              </span>
            </label>
          ))}
        </div>
        <div className="calc">
          <span>현재 설정 기준</span>
          <b>
            총 {Math.floor((routine.days * 24) / routine.cycleHours)}
            <em>회 촬영</em>
          </b>
        </div>
        <button
          className="primary"
          onClick={() =>
            window.confirm('전체 플레이트의 촬영 일정을 재산정하고 저장하시겠습니까?') &&
            send('routine', 0, {...routine})
          }
        >
          루틴 저장
        </button>
        <Toggle
          label="자동 촬영 스케줄러"
          checked={state.autoRun}
          onChange={enabled => send('autoRun', 0, {enabled})}
        />
      </section>
    ),

    environment: (
      <section className="card stack">
        <h2>온도 · CO₂</h2>
        <div className="fields">
          <label className="field">
            <span className="fl">
              목표 온도<em>허용 범위 4 ~ 55</em>
            </span>
            <span className="fi">
              <input
                type="number"
                min="4"
                max="55"
                step="0.1"
                value={env.temperature}
                onChange={e => setEnv({...env, temperature: Number(e.target.value)})}
              />
              <i>℃</i>
            </span>
          </label>
          <label className="field">
            <span className="fl">
              목표 CO₂<em>허용 범위 0 ~ 20</em>
            </span>
            <span className="fi">
              <input
                type="number"
                min="0"
                max="20"
                step="0.1"
                value={env.co2}
                onChange={e => setEnv({...env, co2: Number(e.target.value)})}
              />
              <i>%</i>
            </span>
          </label>
        </div>
        <button className="primary" onClick={() => send('environment', 0, {...env})}>
          전체 장비 적용
        </button>
      </section>
    ),

    network: (
      <section className="card stack">
        <h2>유선 통신</h2>
        {state.devices.map(d => (
          <div className="setting-row" key={d.id}>
            <b>{d.name}</b>
            <Badge type={d.connected && d.pcConnected ? 'good' : 'bad'}>
              {d.connected && d.pcConnected ? '연결 · 238 Mbps' : '연결 끊김'}
            </Badge>
          </div>
        ))}
      </section>
    ),

    backup: (
      <section className="card stack">
        <h2>로그 · 백업</h2>
        <p>
          이벤트 로그 {state.logs.length}건 · I/O 기록 {state.io.length}건
        </p>
        <button
          onClick={() =>
            download(
              'colony-logs.json',
              JSON.stringify(
                {exportedAt: new Date().toISOString(), logs: state.logs, io: state.io},
                null,
                2,
              ),
              'application/json',
            )
          }
        >
          전체 로그 내보내기
        </button>
        <button
          onClick={() =>
            download('colony-backup.json', JSON.stringify(state, null, 2), 'application/json')
          }
        >
          상태 백업 내보내기
        </button>
      </section>
    ),

    info: (
      <section className="card stack">
        <h2>장비 정보</h2>
        <dl>
          <dt>LCD 앱</dt>
          <dd>v1.2.0</dd>
          <dt>장비 엔진</dt>
          <dd>외부 프로세스 · 8790</dd>
          <dt>스캐너</dt>
          <dd>
            {state.devices.length}대 · 각 {SLOTS_PER_DEVICE}슬롯
          </dd>
          <dt>시리얼</dt>
          <dd>CC-DEMO-260915</dd>
        </dl>
      </section>
    ),
  };

  return (
    <div className="settings-shell">
      <aside className="card settings-nav">
        {NAV.map(([key, label]) => (
          <button
            className={section === key ? 'selected' : ''}
            key={key}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </aside>
      {sections[section]}
    </div>
  );
}
