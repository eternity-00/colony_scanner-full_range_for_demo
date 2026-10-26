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
import {Toggle} from '../../shared/Toggle.tsx';
import {download} from '../../utils/download.ts';
import {kdt} from '../../utils/datetime.ts';
import {active as livePlates, slotsPerDevice} from '../../utils/plate.ts';
import {AlignmentSection} from './AlignmentSection.tsx';

interface Props {
  state: AppState;
  send: SendCommand;
  onRole: () => void;
  /** 프로그램 종료. 종료는 여기 한 곳에만 있다. */
  onExit: () => void;
}

type SectionKey = 'recipes' | 'capture' | 'alarms' | 'alignment' | 'environment' | 'network' | 'backup' | 'info';

/** 레시피 편집 초안. base 면 기본 레시피(서버의 routine)라 이름 없이 값만 바꾼다. */
type RecipeDraft = Omit<Recipe, 'id'> & {id: string | null; base?: boolean};
const NEW_RECIPE = (r: Routine): RecipeDraft => ({id: null, name: '', label: '', cycleHours: r.cycleHours, days: r.days, delay: r.delay, wellShots: r.wellShots});
const BASE_DRAFT = (r: Routine): RecipeDraft => ({id: null, base: true, name: '기본', label: '', cycleHours: r.cycleHours, days: r.days, delay: r.delay, wellShots: r.wellShots});

/**
 * 설정 항목 순서(2026-10-26 정리). 화면 전체가 관리자 전용이라 사용자 권한이면 항목 대신
 * 관리자 전환 안내만 보인다.
 */
const NAV: readonly (readonly [SectionKey, string])[] = [
  ['recipes', '레시피'],
  ['capture', '촬영'],
  ['alarms', '알람'],
  ['alignment', '카메라 정렬 · 초점'],
  ['environment', '온도 · 습도'],
  ['network', '연결'],
  ['backup', '로그 · 백업'],
  ['info', '장비 정보'],
];

const REMOTE_MSG = (ok: boolean | undefined, error?: string | null, ms?: number | null) =>
  ok === undefined ? '점검 전' : ok ? `연결됨 · ${ms ?? '?'} ms` : `연결 실패 · ${error ?? ''}`;

const RECIPE_FIELDS = [
  ['cycleHours', '촬영 주기', '시간', 1, 48, 1],
  ['days', '총 배양 기간', '일', 1, MAX_INCUBATION_DAYS, 1],
  ['delay', '주기 시작 지연', '분', 0, 720, 15],
] as const;

/**
 * 사용자 설정(관리자 전용) — 레시피 · 촬영 · 알람 · 카메라 정렬 · 온도 습도 · 연결 · 로그 백업 · 장비 정보.
 *
 * 2026-10-26 정리: 「검사 루틴」은 기본 레시피로 합쳐 레시피 목록의 첫 줄에서 고친다. 종료 예정
 * 기준은 배양 종료 1시간 전으로 고정, 표시 이름은 없애고 권한(사용자 · 관리자)만 보인다.
 * 적용 규칙: 스위치 · 선택 칩은 누르는 즉시, 숫자 · 문자 입력은 카드의 저장 버튼으로.
 */
export function SettingsScreen({state, send, onRole, onExit}: Props) {
  const [section, setSection] = useState<SectionKey>('recipes');
  const [askSave, setAskSave] = useState(false);
  const [env, setEnv] = useState({temperature: state.devices[0]?.targetTemperature || 37});
  const [alarmDraft, setAlarmDraft] = useState({...state.settings.alarms});
  const [recipeDraft, setRecipeDraft] = useState<RecipeDraft | null>(null);
  const [server, setServer] = useState({host: state.settings.server.host, port: state.settings.server.port, apiKey: ''});
  const [checking, setChecking] = useState(false);
  const recipeUse = (id: string) => livePlates(state).filter(p => p.recipeId === id).length;
  const baseUse = livePlates(state).filter(p => !p.recipeId || !state.recipes.some(r => r.id === p.recipeId)).length;
  const checkServer = async () => {
    setChecking(true);
    try {
      await fetch('/api/v1/network/check', {method: 'POST'});
    } finally {
      setChecking(false);
    }
  };

  const isAdmin = state.session.role === 'admin';
  if (!isAdmin) {
    return (
      <div className="settings-shell gate">
        <section className="card stack settings-gate">
          <h2>사용자 설정</h2>
          <p>설정은 관리자만 볼 수 있고 바꿀 수 있습니다. PIN 을 입력해 관리자로 전환하세요.</p>
          <button className="primary" onClick={onRole}>
            관리자 전환
          </button>
        </section>
      </div>
    );
  }
  const idleLeft = Math.max(0, ADMIN_IDLE_LIMIT_SEC - Math.floor(state.session.idleFor / 1000));
  const runs = (r: Pick<Routine, 'days' | 'cycleHours'>) => Math.floor((r.days * 24) / r.cycleHours);

  const sections: Record<SectionKey, ReactNode> = {
    recipes: (
      <section className="env-settings rp-settings">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>레시피</h2>
            <p>플레이트를 등록할 때 고르는 촬영 일정 · 「기본」은 레시피를 고르지 않은 플레이트에 적용됩니다</p>
          </div>
          <ul className="rp-list">
            <li className="rp-row base">
              <b>기본</b>
              <small>
                {state.routine.cycleHours}시간 · {state.routine.days}일 · 지연 {state.routine.delay}분 · Well {state.routine.wellShots}장
              </small>
              <em>{baseUse ? `${baseUse}매 사용 중` : '미사용'}</em>
              <button onClick={() => setRecipeDraft(BASE_DRAFT(state.routine))}>수정</button>
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
              <h2>{recipeDraft.base ? '기본 레시피 수정' : recipeDraft.id ? '레시피 수정' : '새 레시피'}</h2>
              <p>
                {recipeDraft.base
                  ? '바꾸면 기본 레시피를 쓰는 플레이트의 남은 촬영 일정이 다시 계산됩니다'
                  : '저장하면 이 레시피를 쓰는 플레이트의 남은 촬영 일정이 다시 계산됩니다'}
              </p>
            </div>
            <div className="fields">
              {!recipeDraft.base && (
                <label className="field">
                  <span className="fl">이름</span>
                  <span className="fi plain">
                    <input value={recipeDraft.name} maxLength={30} onChange={e => setRecipeDraft({...recipeDraft, name: e.target.value})} />
                  </span>
                </label>
              )}
              {!recipeDraft.base && (
                <label className="field">
                  <span className="fl">
                    검사 항목<em>표시용 · 선택</em>
                  </span>
                  <span className="fi plain">
                    <input value={recipeDraft.label ?? ''} maxLength={40} onChange={e => setRecipeDraft({...recipeDraft, label: e.target.value})} />
                  </span>
                </label>
              )}
              {RECIPE_FIELDS.map(([key, label, unit, min, max, step]) => (
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
            <p className="muted">
              총 {runs(recipeDraft)}회 촬영 · 플레이트 1매당 사진 {(runs(recipeDraft) * WELLS * recipeDraft.wellShots).toLocaleString()}장
            </p>
            <div className="rp-acts">
              <button onClick={() => setRecipeDraft(null)}>취소</button>
              <button
                className="primary"
                disabled={!recipeDraft.base && !recipeDraft.name.trim()}
                onClick={async () => {
                  if (recipeDraft.base) {
                    setAskSave(true);
                    return;
                  }
                  const {id, base: _base, ...rest} = recipeDraft;
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

    capture: (
      <section className="env-settings">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>촬영</h2>
            <p>누르는 즉시 적용</p>
          </div>
          <div className="sg-opts">
            <div>
              <span>
                <b>자동 촬영 스케줄러</b>
                <em>끄면 주기가 와도 촬영하지 않습니다</em>
              </span>
              <Toggle label={state.autoRun ? '켜짐' : '꺼짐'} checked={state.autoRun} onChange={enabled => send('autoRun', 0, {enabled})} />
            </div>
            <div>
              <span>
                <b>Well 십자 촬영 (기본 레시피)</b>
                <em>Well 한 칸을 가운데 · 상하좌우 다섯 장으로 나눠 찍습니다 · 레시피별 장수는 레시피에서</em>
              </span>
              <Toggle
                label={`Well당 ${state.routine.wellShots}장`}
                checked={state.routine.wellShots === 5}
                onChange={on => void send('routine', 0, {...state.routine, wellShots: on ? 5 : 1})}
              />
            </div>
            <div>
              <span>
                <b>바코드 판독</b>
                <em>시험 촬영과 매 회차에서 플레이트 바코드를 읽습니다 · 읽히지 않으면 「바코드 미인식」 알람</em>
              </span>
              <Toggle label={state.settings.barcode ? '켜짐' : '꺼짐'} checked={state.settings.barcode} onChange={on => send('settings', 0, {barcode: on})} />
            </div>
          </div>
        </div>
      </section>
    ),

    alarms: (
      <section className="env-settings">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>알람</h2>
            <p>홈 요약 기준과 이상 알람 규칙</p>
          </div>
          <div className="sg-opts">
            <div>
              <span>
                <b>종료 예정</b>
                <em>남은 배양 시간이 이 안이면 홈의 「종료 예정」으로 셉니다 · 고정값</em>
              </span>
              <span className="sg-fixed">종료 1시간 전</span>
            </div>
          </div>
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
        <div className="p-card sg-block">
          <details className="sg-kinds">
            <summary>알람 종류 — 서버가 만들고 이력을 남기는 알람</summary>
            <ul className="sg-alarm-kinds">
              <li>
                <span className="p-tag device">오류</span> 장비 연결 끊김 · 도어 열림 · 모터/카메라 오류
              </li>
              <li>
                <span className="p-tag env">환경</span> 온도 · 습도 이상이 설정 시간 이상 지속
              </li>
              <li>
                <span className="p-tag plate">주의</span> 촬영 실패 · Well 촬영 실패 · Well 미검출 · 바코드 미인식 / 불일치 · 이전 영상과 차이 큼
              </li>
              <li>
                <span className="p-tag done">반출</span> 기간 만료 · 조기 양성 · 오염 판정(PC 판독)
              </li>
            </ul>
          </details>
        </div>
      </section>
    ),

    alignment: <AlignmentSection state={state} send={send} />,

    environment: (
      <section className="env-settings">
        <div className="p-card sg-block">
          <div className="p-card-head">
            <h2>온도 · 습도</h2>
            <p>목표 온도와 현재 값 · 이상 알람 규칙은 「알람」에서</p>
          </div>
          <div className="fields">
            <label className="field">
              <span className="fl">
                목표 온도<em>허용 범위 4 ~ 55 · 히터가 맞추는 값</em>
              </span>
              <span className="fi">
                <input type="number" min="4" max="55" step="0.1" value={env.temperature} onChange={e => setEnv({...env, temperature: Number(e.target.value)})} />
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
      </section>
    ),

    network: (
      <section className="card stack net-settings">
        <h2>연결</h2>
        <div className="fields">
          <label className="field server">
            <span className="fl">
              PC 전송 서버<em>영상을 받는 PC 의 주소와 포트</em>
            </span>
            <span className="fi plain net-host">
              <input placeholder="호스트명 또는 IP" value={server.host} onChange={e => setServer({...server, host: e.target.value})} />
              <input type="number" min={1} max={65535} value={server.port} onChange={e => setServer({...server, port: Number(e.target.value)})} />
            </span>
          </label>
          <label className="field">
            <span className="fl">
              판독 결과 수신 키<em>PC 가 /api/v1/results 로 보낼 때 쓰는 x-api-key · 비우면 유지{state.settings.server.hasKey ? ' (설정됨)' : ' (없음)'}</em>
            </span>
            <span className="fi plain">
              <input value={server.apiKey} maxLength={64} placeholder="변경할 때만 입력" onChange={e => setServer({...server, apiKey: e.target.value})} />
            </span>
          </label>
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
          <button className="primary" onClick={() => void send('serverSettings', 0, {host: server.host, port: server.port, ...(server.apiKey ? {apiKey: server.apiKey} : {})})}>
            서버 설정 저장
          </button>
          <button disabled={checking || !state.settings.server.host} onClick={() => void checkServer()}>
            {checking ? '점검 중…' : '연결 점검'}
          </button>
        </div>
        <h3 className="net-sub">네트워크</h3>
        {(state.network ?? []).map(n => (
          <div className="setting-row" key={n.name}>
            <b>
              {n.kind === 'wifi' ? '무선' : n.kind === 'wired' ? '유선' : '기타'} · {n.name}
              {n.ssid ? <em className="net-ssid"> · {n.ssid}</em> : null}
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
        <p className="muted">무선 네트워크 선택과 비밀번호 입력은 운영체제의 네트워크 설정에서 합니다(프로그램 종료 → 바탕화면 → 네트워크 설정).</p>
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
            download('colony-logs.json', JSON.stringify({exportedAt: new Date().toISOString(), logs: state.logs, io: state.io}, null, 2), 'application/json')
          }
        >
          전체 로그 내보내기
        </button>
        <button onClick={() => download('colony-backup.json', JSON.stringify(state, null, 2), 'application/json')}>상태 백업 내보내기</button>
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
        <h3 className="net-sub">장비 통신</h3>
        {state.devices.map(d => (
          <div className="setting-row" key={d.id}>
            <b>{d.name}</b>
            <Badge type={d.connected && d.pcConnected ? 'good' : 'bad'}>
              {d.hardware ? (d.hardware.mcb?.connected ? 'MCB UART 연결' : 'MCB UART 확인 필요') : d.connected && d.pcConnected ? '연결' : '연결 끊김'}
            </Badge>
          </div>
        ))}
        <h3 className="net-sub">대기 모드</h3>
        <div className="sg-opts">
          <div>
            <span>
              <b>배양할 플레이트가 없을 때</b>
              <em>이 시간이 지나면 카메라 점검을 늦추고 화면을 어둡게 합니다 · 바로 적용</em>
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
        {/* 프로그램 종료. 종료는 이 한 곳에만 둔다(메뉴 서랍에서는 뺐다). 잘못 눌려도 확인 팝업이 받는다. */}
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
        {NAV.map(([key, label]) => (
          <button className={section === key ? 'selected' : ''} key={key} onClick={() => setSection(key)}>
            {label}
          </button>
        ))}
        <div className="settings-role">
          <small>관리자 · 무조작 {idleLeft}초 뒤 사용자로 해제</small>
          <button onClick={() => void send('role.logout', 0)}>사용자로 전환</button>
        </div>
      </aside>
      {sections[section]}
      {askSave && recipeDraft && (
        <Modal
          title="기본 레시피 저장"
          confirmLabel="확인"
          onClose={() => setAskSave(false)}
          onConfirm={async () => {
            setAskSave(false);
            const ok = await send('routine', 0, {cycleHours: recipeDraft.cycleHours, days: recipeDraft.days, delay: recipeDraft.delay, wellShots: recipeDraft.wellShots});
            if (ok) setRecipeDraft(null);
          }}
        >
          <p>
            이 값은 <b>기본 레시피를 쓰는 모든 플레이트에 함께 적용</b>됩니다. 바꾸면 지금 배양 중인 플레이트의 남은 촬영 일정까지 다시 계산됩니다.
          </p>
          <p className="muted">
            주기 {recipeDraft.cycleHours}시간 · 배양 {recipeDraft.days}일 · 지연 {recipeDraft.delay}분 · Well당 {recipeDraft.wellShots}장 · 총 {runs(recipeDraft)}회 촬영
          </p>
        </Modal>
      )}
    </div>
  );
}
