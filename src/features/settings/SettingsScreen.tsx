import {useState, type ReactNode} from 'react';
import type {AppState, Recipe, Routine} from '../../api/types.ts';
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
import {kdt} from '../../utils/datetime.ts';
import {active as livePlates, slotsPerDevice} from '../../utils/plate.ts';
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

type SectionKey = 'login' | 'routine' | 'recipes' | 'alerts' | 'alignment' | 'environment' | 'network' | 'backup' | 'info';

type RecipeDraft = Omit<Recipe, 'id'> & {id: string | null};
const NEW_RECIPE = (r: Routine): RecipeDraft => ({id: null, name: '', label: '', cycleHours: r.cycleHours, days: r.days, delay: r.delay, wellShots: r.wellShots});

/**
 * [키, 라벨, 관리자 전용 여부]
 * 피드백 2.2 — 장비 설정 변경은 관리자만. 2.3 — 전용 항목은 비활성으로 두지 않고
 * 목록에서 아예 빼서 조작 실수를 줄인다.
 */
const NAV: readonly (readonly [SectionKey, string, boolean])[] = [
  ['login', '로그인 정보', false],
  ['routine', '검사 루틴', false],
  ['recipes', '레시피', false],
  ['alerts', '알림 · 대기', false],
  ['alignment', '카메라 정렬 · 초점', false],
  ['environment', '온도 · 습도', true],
  ['network', '외부 연결', false],
  ['backup', '로그 · 백업', false],
  ['info', '장비 정보', false],
];

const REMOTE_MSG = (ok: boolean | undefined, error?: string | null, ms?: number | null) =>
  ok === undefined ? '점검 전' : ok ? `연결됨 · ${ms ?? '?'} ms` : `연결 실패 · ${error ?? ''}`;

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
  const [env, setEnv] = useState({temperature: state.devices[0]?.targetTemperature || 37});
  const [alarmDraft, setAlarmDraft] = useState({...state.settings.alarms});
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft | null>(null);
  const [server, setServer] = useState({host: state.settings.server.host, port: state.settings.server.port, apiKey: ''});
  const [checking, setChecking] = useState(false);
  const recipeUse = (id: string) => livePlates(state).filter(p => p.recipeId === id).length;
  const checkServer = async () => {
    setChecking(true);
    try {
      await fetch('/api/v1/network/check', {method: 'POST'});
    } finally {
      setChecking(false);
    }
  };

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
                    disabled={routine[f.key] <= f.min || (f.key === 'days' && !isAdmin)}
                    aria-label={`${f.label} 줄이기`}
                  >
                    −
                  </button>
                  {/* 값을 누르면 키패드가 열린다. */}
                  <button className="sg-val" disabled={f.key === 'days' && !isAdmin} onClick={() => setPad(f)}>
                    <b>{routine[f.key]}</b>
                    <i>{f.unit}</i>
                  </button>
                  <button
                    onClick={() => bump(f, f.step)}
                    disabled={routine[f.key] >= f.max || (f.key === 'days' && !isAdmin)}
                    aria-label={`${f.label} 늘리기`}
                  >
                    ＋
                  </button>
                </span>
                <em>{f.key === 'days' && !isAdmin ? `${f.desc} · 변경은 관리자만` : f.desc}</em>
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
            * 쓰는 값이 1 과 5 둘뿐이라 스위치로 둔다. 옆의 자동 촬영 스위치와 같이 누르는 즉시
            * 적용된다(저장 버튼 아래에 있는 스위치가 저장을 기다리면 안 된다, 2026-10-26).
            * 저장된 루틴 값에 장수만 바꿔 보내므로 위 칸의 저장 전 편집값은 건드리지 않는다.
            */}
          <div className="sg-opts">
            <div>
              <span>
                <b>Well 십자 촬영</b>
                <em>Well 한 칸을 가운데 · 상하좌우 다섯 장으로 나눠 찍습니다 · 바로 적용</em>
              </span>
              <Toggle
                label={`Well당 ${state.routine.wellShots}장`}
                checked={state.routine.wellShots === 5}
                onChange={on => {
                  const wellShots = on ? 5 : 1;
                  setRoutine(r => ({...r, wellShots}));
                  void send('routine', 0, {...state.routine, wellShots});
                }}
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

    recipes: (
      <section className="env-settings rp-settings">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>레시피</h2>
            <p>플레이트를 등록할 때 고르는 촬영 일정 · 기본 루틴 외에 검사 항목별로 둘 수 있습니다</p>
          </div>
          <ul className="rp-list">
            <li className="rp-row base">
              <b>기본 루틴</b>
              <small>
                {state.routine.cycleHours}시간 · {state.routine.days}일 · 지연 {state.routine.delay}분 · Well {state.routine.wellShots}장
              </small>
              <em>{livePlates(state).filter(p => !p.recipeId || !state.recipes.some(r => r.id === p.recipeId)).length}매 사용 중</em>
              <button onClick={() => setSection('routine')}>검사 루틴에서 변경</button>
            </li>
            {state.recipes.map(r => (
              <li className="rp-row" key={r.id}>
                <b>
                  {r.name}
                  {r.label ? <i> · {r.label}</i> : null}
                </b>
                <small>
                  {r.cycleHours}시간 · {r.days}일 · 지연 {r.delay}분 · Well {r.wellShots}장
                </small>
                <em>{recipeUse(r.id) ? `${recipeUse(r.id)}매 사용 중` : '미사용'}</em>
                <button onClick={() => setRecipeDraft({...r, label: r.label ?? ''})}>수정</button>
                <button className="outline-danger" disabled={!!recipeUse(r.id)} onClick={() => void send('recipe.delete', 0, {id: r.id})}>
                  삭제
                </button>
              </li>
            ))}
          </ul>
          <button className="primary" onClick={() => setRecipeDraft(NEW_RECIPE(state.routine))}>
            ＋ 레시피 추가
          </button>
        </div>
        {recipeDraft && (
          <div className="p-card sg-block rp-edit">
            <div className="p-card-head">
              <h2>{recipeDraft.id ? '레시피 수정' : '새 레시피'}</h2>
              <p>배양 기간은 기본 루틴과 다르게 두려면 관리자 권한이 필요합니다</p>
            </div>
            <div className="fields">
              <label className="field">
                <span className="fl">이름</span>
                <span className="fi plain">
                  <input value={recipeDraft.name} maxLength={30} onChange={e => setRecipeDraft({...recipeDraft, name: e.target.value})} />
                </span>
              </label>
              <label className="field">
                <span className="fl">
                  검사 항목<em>표시용 · 선택</em>
                </span>
                <span className="fi plain">
                  <input value={recipeDraft.label ?? ''} maxLength={40} onChange={e => setRecipeDraft({...recipeDraft, label: e.target.value})} />
                </span>
              </label>
              {(
                [
                  ['cycleHours', '촬영 주기', '시간', 1, 48, 1],
                  ['days', '총 배양 기간', '일', 1, MAX_INCUBATION_DAYS, 1],
                  ['delay', '주기 시작 지연', '분', 0, 720, 15],
                ] as const
              ).map(([key, label, unit, min, max, step]) => (
                <label className="field" key={key}>
                  <span className="fl">{label}</span>
                  <span className="fi">
                    <input
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      value={recipeDraft[key]}
                      onChange={e => setRecipeDraft({...recipeDraft, [key]: Number(e.target.value)})}
                    />
                    <i>{unit}</i>
                  </span>
                </label>
              ))}
              <div className="field">
                <span className="fl">Well 십자 촬영</span>
                <Toggle label={`Well당 ${recipeDraft.wellShots}장`} checked={recipeDraft.wellShots === 5} onChange={on => setRecipeDraft({...recipeDraft, wellShots: on ? 5 : 1})} />
              </div>
            </div>
            <div className="rp-acts">
              <button onClick={() => setRecipeDraft(null)}>취소</button>
              <button
                className="primary"
                disabled={!recipeDraft.name.trim()}
                onClick={async () => {
                  const {id, ...rest} = recipeDraft;
                  const ok = await send('recipe.save', 0, {...(id ? {id} : {}), ...rest});
                  if (ok) setRecipeDraft(null);
                }}
              >
                저장
              </button>
            </div>
          </div>
        )}
      </section>
    ),

    alerts: (
      <section className="env-settings">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>알림 · 대기</h2>
            <p>홈 요약과 알람 종류 · 바로 적용</p>
          </div>
          <div className="sg-opts">
            <div>
              <span>
                <b>종료 예정 기준</b>
                <em>남은 배양 시간이 이 안이면 홈의 「종료 예정」으로 셉니다</em>
              </span>
              <span className="sg-choice">
                {[6, 12, 24, 48].map(h => (
                  <button key={h} className={state.settings.endSoonHours === h ? 'selected' : ''} onClick={() => send('settings', 0, {endSoonHours: h})}>
                    {h < 24 ? `${h}시간` : `${h / 24}일`}
                  </button>
                ))}
              </span>
            </div>
            <div>
              <span>
                <b>바코드 판독</b>
                <em>시험 촬영과 매 회차에서 플레이트 바코드를 읽습니다 · 읽히지 않으면 「바코드 미인식」 알람</em>
              </span>
              <Toggle label={state.settings.barcode ? '켜짐' : '꺼짐'} checked={state.settings.barcode} onChange={on => send('settings', 0, {barcode: on})} />
            </div>
            <div>
              <span>
                <b>대기 모드</b>
                <em>배양할 플레이트가 없는 상태가 이어지면 카메라 점검을 늦추고 화면을 어둡게 합니다</em>
              </span>
              <span className="sg-choice">
                {[0, 5, 10, 30].map(m => (
                  <button key={m} className={state.settings.idleMinutes === m ? 'selected' : ''} onClick={() => send('settings', 0, {idleMinutes: m})}>
                    {m ? `${m}분 뒤` : '끔'}
                  </button>
                ))}
              </span>
            </div>
          </div>
        </div>
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>알람 종류</h2>
            <p>서버가 만들고 이력을 남기는 알람</p>
          </div>
          <ul className="sg-alarm-kinds">
            <li>
              <span className="p-tag device">오류</span> 장비 연결 끊김 · 도어 열림 · 모터/카메라 오류
            </li>
            <li>
              <span className="p-tag env">환경</span> 온도 · 습도 이상이 설정 시간 이상 지속 (관리자 규칙)
            </li>
            <li>
              <span className="p-tag plate">주의</span> 촬영 실패 · Well 촬영 실패 · <b>Well 미검출</b> · <b>바코드 미인식 / 불일치</b> · <b>이전 영상과 차이 큼</b> · 미전송 2건 이상
            </li>
            <li>
              <span className="p-tag done">반출</span> 기간 만료 · 조기 양성 · 오염 판정(PC 판독)
            </li>
          </ul>
        </div>
      </section>
    ),

    environment: (
      <section className="env-settings">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>온도 · 습도</h2>
            <p>목표 온도와 이상 알람 규칙 · 관리자 전용</p>
          </div>
          <div className="fields">
            <label className="field">
              <span className="fl">
                목표 온도<em>허용 범위 4 ~ 55 · 히터가 맞추는 값</em>
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
            <div className="field">
              <span className="fl">
                현재 값<em>습도는 자연 증발식이라 목표값 없이 범위만 감시합니다</em>
              </span>
              <span className="fv">
                {state.devices[0]?.temperature === null || state.devices[0]?.temperature === undefined
                  ? '온도 측정 없음'
                  : `${state.devices[0].temperature.toFixed(1)}℃`}
                {' · '}
                {state.devices[0]?.humidity === null || state.devices[0]?.humidity === undefined
                  ? '습도 측정 없음'
                  : `${state.devices[0].humidity.toFixed(0)}%`}
              </span>
            </div>
          </div>
          <button className="primary" onClick={() => send('environment', 0, {temperature: env.temperature})}>
            목표 온도 적용
          </button>
        </div>

        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>이상 알람 규칙</h2>
            <p>허용 범위를 벗어난 상태가 아래 시간 이상 이어지면 알람 · 장비 화면과 홈에 표시</p>
          </div>
          <div className="fields">
            {(
              [
                ['tempTolerance', '온도 허용 편차', '℃', 0.1, 10, 0.1],
                ['tempMinutes', '온도 이상 지속 시간', '분', 0, 120, 1],
                ['humidityMin', '습도 하한', '%', 0, 100, 1],
                ['humidityMax', '습도 상한', '%', 0, 100, 1],
                ['humidityMinutes', '습도 이상 지속 시간', '분', 0, 120, 1],
                ['changeThreshold', '영상 변화 알람 임계값', '0~1', 0.01, 1, 0.01],
              ] as const
            ).map(([key, label, unit, min, max, step]) => (
              <label className="field" key={key}>
                <span className="fl">{label}</span>
                <span className="fi">
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={alarmDraft[key]}
                    onChange={e => setAlarmDraft({...alarmDraft, [key]: Number(e.target.value)})}
                  />
                  <i>{unit}</i>
                </span>
              </label>
            ))}
          </div>
          <button className="primary" onClick={() => send('alarmSettings', 0, {...alarmDraft})}>
            알림 규칙 저장
          </button>
        </div>
      </section>
    ),

    alignment: <AlignmentSection state={state} send={send} />,

    network: (
      <section className="card stack net-settings">
        <h2>외부 연결</h2>
        <div className="fields">
          <label className="field">
            <span className="fl">
              PC 전송 서버<em>영상을 받는 PC 의 주소와 포트 · 관리자</em>
            </span>
            <span className="fi plain net-host">
              <input placeholder="호스트명 또는 IP" value={server.host} onChange={e => setServer({...server, host: e.target.value})} disabled={!isAdmin} />
              <input type="number" min={1} max={65535} value={server.port} onChange={e => setServer({...server, port: Number(e.target.value)})} disabled={!isAdmin} />
            </span>
          </label>
          {isAdmin && (
            <label className="field">
              <span className="fl">
                판독 결과 수신 키<em>PC 가 /api/v1/results 로 보낼 때 쓰는 x-api-key · 비우면 유지{state.settings.server.hasKey ? ' (설정됨)' : ' (없음)'}</em>
              </span>
              <span className="fi plain">
                <input value={server.apiKey} maxLength={64} placeholder="변경할 때만 입력" onChange={e => setServer({...server, apiKey: e.target.value})} />
              </span>
            </label>
          )}
          <div className="field">
            <span className="fl">
              연결 상태<em>{state.serverLink ? kdt(state.serverLink.at) + ' 점검' : '설정 뒤 「연결 점검」'}</em>
            </span>
            <span className="fv">
              <Badge type={state.serverLink ? (state.serverLink.ok ? 'good' : 'bad') : 'info'}>
                {REMOTE_MSG(state.serverLink?.ok, state.serverLink?.error, state.serverLink?.ms)}
              </Badge>
            </span>
          </div>
        </div>
        <div className="net-acts">
          {isAdmin && (
            <button className="primary" onClick={() => void send('serverSettings', 0, {host: server.host, port: server.port, ...(server.apiKey ? {apiKey: server.apiKey} : {})})}>
              서버 설정 저장
            </button>
          )}
          <button disabled={checking || !state.settings.server.host} onClick={() => void checkServer()}>
            {checking ? '점검 중…' : '연결 점검'}
          </button>
        </div>
        <h3 className="net-sub">장비 통신</h3>
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
              {n.ssid ? <em className="net-ssid"> · {n.ssid}</em> : null}
            </b>
            <Badge type="good">{n.address}</Badge>
          </div>
        ))}
        <p className="muted">무선 네트워크 선택과 비밀번호 입력은 운영체제의 네트워크 설정에서 합니다(프로그램 종료 → 바탕화면 → 네트워크 아이콘).</p>
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
            {state.devices.length}대 · 각 {slotsPerDevice(state)}매 ({state.profile.layout.tiers}단 × {state.profile.layout.columns}열
            {state.profile.layout.tierShared ? ' · 테스트 지그: 한 단의 세 칸이 플레이트 한 장' : ''})
          </dd>
          <dt>플레이트 배치</dt>
          <dd>
            프로필 {state.profile.title} ({state.profile.name}) · 레시피 {state.profile.recipe ?? '-'} · 변경은 관리 툴(포트 8799)에서
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
