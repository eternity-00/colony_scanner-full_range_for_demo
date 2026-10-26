import {useEffect, useMemo, useState} from 'react';
import type {AppState, Routine} from '../../api/types.ts';
import {WELLS, type SendCommand, type TabKey} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {Tray} from '../../shared/Tray.tsx';
import {kdt} from '../../utils/datetime.ts';
import {currentLayout, isBusy, platesFor, pos, samePlace, slotsPerDevice, status} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
  setTab: (tab: TabKey) => void;
  /** 현황 화면에서 넘어올 때 미리 고른 스캐너. */
  device?: number;
  /** 현황에서 빈 칸을 눌러 왔을 때 그 칸. 비어 있지 않으면 첫 빈 칸으로 떨어진다. */
  slot?: number;
}

type Step = 'slot' | 'recipe' | 'door' | 'trial' | 'start';
const STEPS: readonly (readonly [Step, string])[] = [
  ['slot', '위치'],
  ['recipe', '레시피'],
  ['door', '투입'],
  ['trial', '시험 촬영'],
  ['start', '배양 시작'],
];

const summary = (r: Routine) => `${r.cycleHours}시간 주기 · ${r.days}일 · 지연 ${r.delay}분 · Well ${r.wellShots}장`;

/**
 * 플레이트 등록 마법사 (M3 A5 · A6 · A7).
 *
 * 위치 → 레시피 → 투입(도어 확인) → 등록 → 시험 촬영(선택) → 배양 시작.
 * 서버는 등록(register)마다 촬영을 5분 붙잡아 두고(등록 중 장비가 움직이지 않게), 「배양 시작」
 * (registerDone)에서 푼다. 도어 센서가 없어 투입 단계는 확인 버튼이다(M3 B3). 시험 촬영은
 * 회차로 세지 않는 한 번의 촬영으로, 웰 6개 검출과 바코드 판독 결과를 보여준다.
 */
export function RegisterScreen({state, send, setTab, device = 1, slot: picked}: Props) {
  const [deviceId, setDeviceId] = useState(device);
  const [step, setStep] = useState<Step>('slot');
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [plateId, setPlateId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  const free = useMemo(() => {
    // tierShared(테스트 지그)면 같은 단의 다른 칸도 쓸 수 없다.
    const used = platesFor(state, deviceId).map(p => p.slot);
    return Array.from({length: currentLayout().slots}, (_, i) => i + 1).filter(n => !used.some(u => samePlace(u, n)));
  }, [state, deviceId]);

  const [slot, setSlot] = useState(() => (picked && free.includes(picked) ? picked : free[0] || 0));
  useEffect(() => setDeviceId(device), [device]);
  useEffect(() => {
    if (step === 'slot' && !submitting && !free.includes(slot)) setSlot(free[0] || 0);
  }, [free, slot, submitting, step]);

  const d = state.devices.find(x => x.id === deviceId);
  if (!d) return null;

  const plate = plateId ? state.plates.find(p => p.id === plateId) : undefined;
  const recipe = recipeId ? state.recipes.find(r => r.id === recipeId) : undefined;
  const routine: Routine = recipe ?? state.routine;
  const trialJob = d.job && d.job.trial && ['running', 'paused'].includes(d.job.status) ? d.job : null;
  const trial = plate?.trial ?? null;
  const al = trial?.capture?.alignment;
  const code = trial?.capture?.barcode;

  const deviceIssue = !d.connected || !!d.fault || d.doorOpen || isBusy(d);
  const blockReason = !d.connected
    ? '장비 연결을 확인하세요.'
    : d.fault
      ? '점검 필요 상태입니다. 장비 화면에서 오류를 해제하세요.'
      : d.doorOpen
        ? '도어를 닫은 뒤 등록하세요.'
        : isBusy(d)
          ? '촬영 작업 중입니다. 완료 후 등록하세요.'
          : !slot
            ? '빈 슬롯이 없습니다.'
            : '';

  /** 투입 확인 → 서버에 등록. 성공하면 시험 촬영 단계로. */
  const register = async () => {
    setSubmitting(true);
    const result = (await send('register', deviceId, {slot, ...(recipeId ? {recipeId} : {})})) as {plateId?: string} | null;
    setSubmitting(false);
    if (result?.plateId) {
      setPlateId(result.plateId);
      setStep('trial');
    }
  };

  const testShot = () => plate && void send('testShot', deviceId, {plateId: plate.id});

  /** 배양 시작 — 붙잡아 둔 촬영을 풀고 홈으로. */
  const start = async () => {
    await send('registerDone', 0);
    setTab('overview');
  };

  const firstShot = !state.autoRun ? '자동 촬영 꺼짐' : routine.delay ? kdt(state.serverTime + routine.delay * 60000) : '배양 시작 직후';
  const stepIndex = STEPS.findIndex(([k]) => k === step);

  return (
    <>
      <div className="rg-page">
        <section className="p-card rg-left">
          <div className="p-card-head">
            <h3>{step === 'slot' ? '수납 위치 선택' : '수납 위치'}</h3>
            <p>{step === 'slot' ? '빈 슬롯을 눌러 지정합니다' : `${pos(slot)} 에 등록합니다`}</p>
            <em>빈 슬롯 {slotsPerDevice(state) - platesFor(state, deviceId).length}</em>
          </div>
          {state.devices.length > 1 && step === 'slot' && (
            <div className="device-tabs">
              {state.devices.map(x => (
                <button key={x.id} className={x.id === deviceId ? 'selected' : ''} onClick={() => setDeviceId(x.id)}>
                  {x.name}
                  <small>
                    {status(x)} · 빈 슬롯 {slotsPerDevice(state) - platesFor(state, x.id).length}
                  </small>
                </button>
              ))}
            </div>
          )}
          <div className={`p-tray rg-tray ${step !== 'slot' ? 'locked' : ''}`}>
            <Tray state={state} deviceId={deviceId} registration selected={slot} onSelect={step === 'slot' ? setSlot : undefined} />
          </div>
          <div className="legend rg-legend">
            <span>
              <i className="rg-sel" />
              선택
            </span>
            <span>
              <i className="rg-free" />빈 슬롯
            </span>
            <span>
              <i className="rg-used" />
              사용 중
            </span>
          </div>
        </section>

        <aside className="rg-side">
          <ol className="rg-steps">
            {STEPS.map(([k, label], i) => (
              <li key={k} className={i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}>
                <i>{i + 1}</i>
                <span>{label}</span>
              </li>
            ))}
          </ol>

          {step === 'slot' && (
            <>
              <div className="p-panel rg-where">
                <small>선택된 수납 위치</small>
                <b>{slot ? pos(slot) : '선택 불가'}</b>
                {!slot && <small>등록 가능한 빈 슬롯이 없습니다</small>}
              </div>
              <div className="rg-acts">
                <button className="primary p-btn" onClick={() => (blockReason ? setBlockOpen(true) : setStep('recipe'))}>
                  다음 · 레시피 선택
                </button>
              </div>
            </>
          )}

          {step === 'recipe' && (
            <>
              <section className="p-card rg-recipes">
                <div className="p-card-head">
                  <h3>레시피 선택</h3>
                  <button className="link" onClick={() => setTab('settings')}>
                    레시피 관리 →
                  </button>
                </div>
                <div className="rg-recipe-list">
                  <button className={recipeId === null ? 'selected' : ''} onClick={() => setRecipeId(null)}>
                    <b>기본 루틴</b>
                    <small>{summary(state.routine)}</small>
                  </button>
                  {state.recipes.map(r => (
                    <button key={r.id} className={recipeId === r.id ? 'selected' : ''} onClick={() => setRecipeId(r.id)}>
                      <b>
                        {r.name}
                        {r.label ? <em> · {r.label}</em> : null}
                      </b>
                      <small>{summary(r)}</small>
                    </button>
                  ))}
                </div>
              </section>
              <div className="rg-acts two">
                <button onClick={() => setStep('slot')}>이전</button>
                <button className="primary p-btn" onClick={() => setStep('door')}>
                  다음 · 플레이트 투입
                </button>
              </div>
            </>
          )}

          {step === 'door' && (
            <>
              <section className="p-card rg-door">
                <div className="p-card-head">
                  <h3>플레이트 투입</h3>
                </div>
                <ol className="rg-guide">
                  <li>도어를 엽니다.</li>
                  <li>
                    <b>{pos(slot)}</b> 에 플레이트를 넣습니다 (바코드가 위를 향하게).
                  </li>
                  <li>도어를 닫고 아래 「넣고 닫았습니다」를 누릅니다.</li>
                </ol>
                <dl className="pick-info">
                  <dt>레시피</dt>
                  <dd>
                    {recipe ? recipe.name : '기본 루틴'} · {summary(routine)}
                  </dd>
                  <dt>투입 시각</dt>
                  <dd>확인을 누르는 순간으로 기록</dd>
                  <dt>첫 촬영</dt>
                  <dd>{firstShot}</dd>
                </dl>
              </section>
              <div className="rg-acts two">
                <button onClick={() => setStep('recipe')} disabled={submitting}>
                  이전
                </button>
                <button className="primary p-btn" disabled={submitting} onClick={() => (blockReason ? setBlockOpen(true) : void register())}>
                  {submitting ? '등록 중…' : '넣고 닫았습니다 · 등록'}
                </button>
              </div>
            </>
          )}

          {step === 'trial' && plate && (
            <>
              <section className="p-card rg-trial">
                <div className="p-card-head">
                  <h3>시험 촬영</h3>
                  <p>
                    {plate.id} · {pos(plate.slot)}
                  </p>
                </div>
                {trialJob ? (
                  <div className="rg-trial-run">
                    <span className="spin" />
                    <b>시험 촬영 중 · {trialJob.step < 2 ? '플레이트 이송' : trialJob.step === 2 ? '촬영' : '복귀 · 처리'}</b>
                    <small>Well 검출과 바코드를 확인합니다. 보통 30초 안팎 걸립니다.</small>
                  </div>
                ) : trial ? (
                  <div className="rg-trial-result">
                    {trial.image && <img src={`/api/images/${trial.image}`} alt="시험 촬영 결과" />}
                    <div className="rg-trial-facts">
                      {trial.imageState === 'failed' ? (
                        <Badge type="bad">촬영 실패 · {trial.error || '장비 오류'}</Badge>
                      ) : (
                        <>
                          {al?.enabled ? (
                            <Badge type={(al.alignedWells?.length ?? 0) === WELLS ? 'good' : 'warn'}>
                              Well 검출 {al.alignedWells?.length ?? 0}/{WELLS}
                              {al.unalignedWells?.length ? ` · 미검출 ${al.unalignedWells.join('·')}` : ''}
                            </Badge>
                          ) : (
                            <Badge type="info">Well 검출 안 함 (카메라 정렬 보정 없음)</Badge>
                          )}
                          {code ? (
                            <Badge type={code.value ? 'good' : code.scanned ? 'bad' : 'warn'}>
                              {code.value ? `바코드 ${code.value}` : code.scanned ? '바코드 미인식 · 알람 발생' : `바코드 판독 불가 · ${code.error || '판독기 없음'}`}
                            </Badge>
                          ) : (
                            <Badge type="info">바코드 판독 꺼짐</Badge>
                          )}
                        </>
                      )}
                    </div>
                    {code?.scanned && !code.value && (
                      <p className="rg-hint">바코드가 읽히지 않았습니다. 라벨이 위를 향하는지 확인하고 다시 찍거나, 그대로 진행하면 알람이 남습니다.</p>
                    )}
                  </div>
                ) : (
                  <p className="rg-hint">한 번 촬영해 Well 6개가 모두 보이는지와 바코드를 확인합니다. 건너뛰어도 됩니다.</p>
                )}
              </section>
              <div className="rg-acts two">
                <button disabled={!!trialJob || state.cameraBusy || !!state.maintenance} onClick={testShot}>
                  {trial ? '다시 촬영' : '시험 촬영'}
                </button>
                <button className="primary p-btn" disabled={!!trialJob} onClick={() => setStep('start')}>
                  {trial ? '다음 · 배양 시작' : '건너뛰기'}
                </button>
              </div>
            </>
          )}

          {step === 'start' && plate && (
            <>
              <section className="p-card rg-door">
                <div className="p-card-head">
                  <h3>배양 시작</h3>
                </div>
                <dl className="pick-info">
                  <dt>플레이트</dt>
                  <dd>
                    {plate.id}
                    {plate.barcode ? ` · ${plate.barcode}` : ''}
                  </dd>
                  <dt>위치</dt>
                  <dd>{pos(plate.slot)}</dd>
                  <dt>레시피</dt>
                  <dd>
                    {recipe ? recipe.name : '기본 루틴'} · {summary(routine)}
                  </dd>
                  <dt>첫 촬영</dt>
                  <dd>{firstShot}</dd>
                </dl>
                <p className="rg-hint">「배양 시작」을 누르면 밀어 둔 촬영 일정이 시작됩니다. 플레이트를 더 넣으려면 「하나 더 등록」을 누르세요.</p>
              </section>
              <div className="rg-acts two">
                <button
                  onClick={() => {
                    setPlateId(null);
                    setRecipeId(null);
                    setStep('slot');
                  }}
                >
                  하나 더 등록
                </button>
                <button className="primary p-btn" onClick={() => void start()}>
                  배양 시작
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {blockOpen && (
        <Modal bare title="등록할 수 없습니다" onClose={() => setBlockOpen(false)}>
          <p>{blockReason}</p>
          <div className="actions">
            <button onClick={() => setBlockOpen(false)}>취소</button>
            {deviceIssue && (
              <button
                className="primary"
                onClick={() => {
                  setBlockOpen(false);
                  setTab('device');
                }}
              >
                장비 화면으로
              </button>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
