import {useState, type ReactNode} from 'react';
import type {AppState, Routine} from '../../api/types.ts';
import {
  ADMIN_IDLE_LIMIT_SEC,
  APP_VERSION,
  MAX_INCUBATION_DAYS,
  WELLS,
  type SendCommand,
} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {NumberPad} from '../../shared/NumberPad.tsx';
import {Toggle} from '../../shared/Toggle.tsx';
import {download} from '../../utils/download.ts';
import {slotsPerDevice} from '../../utils/plate.ts';
import {AlignmentSection} from './AlignmentSection.tsx';

interface Props {
  state: AppState;
  send: SendCommand;
  operator: string;
  setOperator: (name: string) => void;
  onRole: () => void;
  /** 프로그램 종료. 종료는 여기 한 곳에만 있다. */
  onExit: () => void;
}

type SectionKey = 'login' | 'routine' | 'alignment' | 'environment' | 'network' | 'backup' | 'info';

/**
 * [키, 라벨, 관리자 전용 여부]
 * 피드백 2.2 — 장비 설정 변경은 관리자만. 2.3 — 전용 항목은 비활성으로 두지 않고
 * 목록에서 아예 빼서 조작 실수를 줄인다.
 */
const NAV: readonly (readonly [SectionKey, string, boolean])[] = [
  ['login', '로그인 정보', false],
  ['routine', '검사 루틴', false],
  ['alignment', '카메라 정렬 · 초점', false],
  ['environment', '온도 · CO₂', true],
  ['network', '유선 통신', false],
  ['backup', '로그 · 백업', false],
  ['info', '장비 정보', false],
];

interface RoutineField {
  key: keyof Routine;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** −/+ 한 번에 움직이는 폭이자, 허용되는 배수. */
  step: number;
  desc: string;
  /** 키패드에서 한 번에 고를 수 있는 값. */
  presets: readonly number[];
}

const ROUTINE_FIELDS: readonly RoutineField[] = [
  {
    key: 'cycleHours',
    label: '촬영 주기',
    unit: '시간',
    min: 1,
    max: 48,
    step: 1,
    desc: '플레이트 1매를 다시 촬영하기까지의 간격',
    presets: [6, 12, 24],
  },
  {
    key: 'days',
    label: '총 배양 기간',
    unit: '일',
    min: 1,
    max: MAX_INCUBATION_DAYS,
    step: 1,
    desc: `배양을 유지할 전체 기간 · 최대 ${MAX_INCUBATION_DAYS}일`,
    presets: [7, 14, 28, 42],
  },
  {
    key: 'delay',
    label: '주기 시작 지연',
    unit: '분',
    min: 0,
    max: 720,
    step: 15,
    desc: '투입 시각 이후 첫 촬영까지 미루는 시간 · 0분이면 투입 즉시',
    presets: [0, 30, 60, 120],
  },
];

export function SettingsScreen({state, send, operator, setOperator, onRole,
  onExit,
}: Props) {
  const [section, setSection] = useState<SectionKey>('login');
  const [routine, setRoutine] = useState<Routine>(state.routine);
  /** 키패드를 열어 둔 항목. null 이면 닫혀 있다. */
  const [pad, setPad] = useState<RoutineField | null>(null);
  const [askSave, setAskSave] = useState(false);
  const [env, setEnv] = useState({
    temperature: state.devices[0]?.targetTemperature || 37,
    co2: state.devices[0]?.targetCo2 || 5,
  });

  /** 범위를 벗어나지 않게 step 만큼 옮긴다. */
  const bump = (f: RoutineField, by: number) =>
    setRoutine(r => ({...r, [f.key]: Math.min(f.max, Math.max(f.min, r[f.key] + by))}));

  const isAdmin = state.session.role === 'admin';
  const nav = NAV.filter(([, , adminOnly]) => isAdmin || !adminOnly);
  // 관리자 권한이 자동 해제되면 보고 있던 관리자 전용 항목에서 빠져나온다.
  const active = nav.some(([key]) => key === section) ? section : 'login';

  const sections: Record<SectionKey, ReactNode> = {
    login: (
      <section className="card stack">
        <h2>로그인 정보</h2>
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
      <section className="sg-routine">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>검사 루틴</h2>
            <p>등록된 모든 플레이트에 함께 적용됩니다</p>
            <span className="p-tag warn">변경 시 진행 중 배양 일정 재산정</span>
          </div>
          <div className="sg-fields">
            {ROUTINE_FIELDS.map(f => (
              <div className="sg-field" key={f.key}>
                <small>{f.label}</small>
                <span className="sg-step">
                  <button
                    onClick={() => bump(f, -f.step)}
                    disabled={routine[f.key] <= f.min}
                    aria-label={`${f.label} 줄이기`}
                  >
                    −
                  </button>
                  {/* 값을 누르면 키패드가 열린다. */}
                  <button className="sg-val" onClick={() => setPad(f)}>
                    <b>{routine[f.key]}</b>
                    <i>{f.unit}</i>
                  </button>
                  <button
                    onClick={() => bump(f, f.step)}
                    disabled={routine[f.key] >= f.max}
                    aria-label={`${f.label} 늘리기`}
                  >
                    ＋
                  </button>
                </span>
                <em>{f.desc}</em>
              </div>
            ))}
          </div>
          <div className="sg-sum">
            <small>현재 설정 기준</small>
            <b>
              총 {Math.floor((routine.days * 24) / routine.cycleHours)} 회 촬영 · 플레이트 1 매당 사진{' '}
              {(
                Math.floor((routine.days * 24) / routine.cycleHours) *
                WELLS *
                routine.wellShots
              ).toLocaleString()}{' '}
              장
            </b>
            <button className="primary" onClick={() => setAskSave(true)}>
              루틴 저장
            </button>
          </div>
        </div>

        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>촬영 옵션</h2>
          </div>
          {/*
            * Well 한 칸을 가운데 한 장만 찍을지, 상하좌우까지 다섯 장을 찍을지.
            * 쓰는 값이 1 과 5 둘뿐이라 스위치로 둔다. 루틴 저장 때 함께 저장된다.
            */}
          <div className="sg-opts">
            <div>
              <span>
                <b>Well 십자 촬영</b>
                <em>Well 한 칸을 가운데 · 상하좌우 다섯 장으로 나눠 찍습니다 · 루틴 저장 시 적용</em>
              </span>
              <Toggle
                label={`Well당 ${routine.wellShots}장`}
                checked={routine.wellShots === 5}
                onChange={on => setRoutine(r => ({...r, wellShots: on ? 5 : 1}))}
              />
            </div>
            <div>
              <span>
                <b>자동 촬영 스케줄러</b>
                <em>끄면 주기가 와도 촬영하지 않습니다 · 바로 적용</em>
              </span>
              <Toggle
                label={state.autoRun ? '켜짐' : '꺼짐'}
                checked={state.autoRun}
                onChange={enabled => send('autoRun', 0, {enabled})}
              />
            </div>
          </div>
        </div>
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

    alignment: <AlignmentSection state={state} send={send} />,

    network: (
      <section className="card stack">
        <h2>유선 통신</h2>
        {state.devices.map(d => (
          <div className="setting-row" key={d.id}>
            <b>{d.name}</b>
            <Badge type={d.connected && d.pcConnected ? 'good' : 'bad'}>
              {d.hardware
                ? d.hardware.mcb?.connected
                  ? 'MCB UART 연결'
                  : 'MCB UART 확인 필요'
                : d.connected && d.pcConnected
                  ? '연결'
                  : '연결 끊김'}
            </Badge>
          </div>
        ))}
        {(state.network ?? []).map(n => (
          <div className="setting-row" key={n.name}>
            <b>
              {n.kind === 'wifi' ? '무선' : n.kind === 'wired' ? '유선' : '기타'} · {n.name}
            </b>
            <Badge type="good">{n.address}</Badge>
          </div>
        ))}
        {!(state.network ?? []).length && (
          <div className="setting-row">
            <b>네트워크</b>
            <Badge type="bad">연결된 인터페이스 없음</Badge>
          </div>
        )}
        <p className="muted">
          프로필 {state.profile.title} ({state.profile.name}) · 장비 설정 변경은 관리 툴(포트 8799)에서 합니다.
        </p>
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
          <dd>{APP_VERSION}</dd>
          <dt>장비 엔진</dt>
          <dd>외부 프로세스 · 8790</dd>
          <dt>스캐너</dt>
          <dd>
            {state.devices.length}대 · 각 {slotsPerDevice(state)}슬롯 ({state.profile.layout.tiers}단 × {state.profile.layout.columns}열)
          </dd>
          <dt>시리얼</dt>
          <dd>미등록</dd>
        </dl>
        {/*
          * 프로그램 종료. 종료는 이 한 곳에만 둔다(메뉴 서랍에서는 뺐다) — 장비
          * 정보를 보러 온 사람이 찾는 자리가 여기다. 잘못 눌려도 확인 팝업이 받는다.
          */}
        <div className="quit">
          <p>
            <b>프로그램 종료</b>
            <em>Colony Scanner 를 끝내고 바탕화면으로 돌아갑니다. 진행 중인 촬영은 중단됩니다.</em>
          </p>
          <button className="outline-danger" onClick={onExit}>
            종료
          </button>
        </div>
      </section>
    ),
  };

  return (
    <div className="settings-shell">
      <aside className="settings-nav">
        {nav.map(([key, label]) => (
          <button
            className={active === key ? 'selected' : ''}
            key={key}
            onClick={() => setSection(key)}
          >
            {label}
          </button>
        ))}
      </aside>
      {sections[active]}
      {pad && (
        <NumberPad
          title={pad.label}
          unit={pad.unit}
          value={routine[pad.key]}
          min={pad.min}
          max={pad.max}
          step={pad.step}
          presets={pad.presets}
          onClose={() => setPad(null)}
          onConfirm={v => {
            setRoutine(r => ({...r, [pad.key]: v}));
            setPad(null);
          }}
        />
      )}
      {askSave && (
        <Modal
          title="검사 루틴 저장"
          confirmLabel="확인"
          onClose={() => setAskSave(false)}
          onConfirm={() => {
            setAskSave(false);
            // 성공하면 현황으로 돌아간다. 권한에 막히면 send 가 여기서 멈춘다.
            void send('routine', 0, {...routine}, 'overview');
          }}
        >
          <p>
            이 값은 <b>장비의 모든 플레이트에 함께 적용</b>됩니다. 바꾸면 지금 배양 중인
            플레이트의 남은 촬영 일정까지 다시 계산됩니다.
          </p>
          <p className="muted">
            주기 {routine.cycleHours}시간 · 배양 {routine.days}일 · 지연 {routine.delay}분 · Well당{' '}
            {routine.wellShots}장 · 총 {Math.floor((routine.days * 24) / routine.cycleHours)}회 촬영
          </p>
        </Modal>
      )}
    </div>
  );
}
