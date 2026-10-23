import {useState} from 'react';
import type {AppState, Device, FocusState} from '../../api/types.ts';
import type {SendCommand} from '../../config/defines.ts';
import {Badge} from '../../shared/Badge.tsx';
import {Modal} from '../../shared/Modal.tsx';
import {Toggle} from '../../shared/Toggle.tsx';
import {fmt} from '../../utils/datetime.ts';
import {isBusy, platesFor, pos} from '../../utils/plate.ts';

interface Props {
  state: AppState;
  send: SendCommand;
}

const CAL_STAGE: Record<string, string> = {
  loading: '플레이트 이송 중',
  measuring: '측정 중',
  returning: '수납 복귀 중',
  done: '완료',
};
const FOCUS_STAGE: Record<string, string> = {
  loading: '플레이트 이송 중',
  centring: '웰 중심 맞추는 중',
  holding: '유지 중 · 렌즈를 조정하세요',
  returning: '수납 복귀 중',
  done: '완료',
};

/** 초점 조정 중 1초마다 갱신되는 영상: 웰 안쪽 배지 면 1:1 확대와 전체 화면. */
function FocusView({at, umPerPx, zoom, setZoom}: {at?: number; umPerPx: number | null; zoom: number; setZoom: (z: number) => void}) {
  const cw = 960;
  const ch = 760;
  const shown = Math.min(cw * zoom, 960);
  const bar = umPerPx ? Math.round(500 / umPerPx) : null;
  return (
    <div className="fv">
      <div className="fv-tools">
        <span>
          배율{' '}
          {umPerPx
            ? `약 ${umPerPx} µm/px · 50 µm ≈ ${(50 / umPerPx).toFixed(1)} px`
            : '보정 후 표시'}
        </span>
        <span>확대</span>
        {[1, 2, 4].map(z => (
          <button key={z} className={zoom === z ? 'selected' : ''} onClick={() => setZoom(z)}>
            {z}×
          </button>
        ))}
      </div>
      <div className="fv-images">
        <div className="fv-crop" style={{width: shown}}>
          <img
            src={`/api/v1/hardware/focus/crop.jpg?t=${at ?? 0}`}
            alt="웰 안쪽 배지 면, 센서 픽셀 기준"
            style={{width: cw * zoom, height: ch * zoom}}
          />
          {bar && umPerPx && (
            <div className="fv-scale">
              <div style={{width: bar * zoom}} className="fv-bar500" />
              500 µm ·{' '}
              <span
                className="fv-bar50"
                style={{width: Math.max(1, Math.round((50 / umPerPx) * zoom))}}
              />{' '}
              50 µm
            </div>
          )}
        </div>
        <img className="fv-full" src={`/api/v1/hardware/focus/full.jpg?t=${at ?? 0}`} alt="전체 화면" />
      </div>
      <p className="muted">
        확대 영상은 센서 픽셀 그대로입니다(1× = 화면 1픽셀 = 센서 1픽셀, 가로 960px 영역).
        배율은 보정된 웰 테두리 링과 레시피의 웰 안지름으로 환산한 근삿값입니다.
      </p>
    </div>
  );
}

/** 선명도 추이. 점선 = 지금까지의 최대. */
function FocusCurve({history, best}: {history: number[]; best: number | null}) {
  const w = 600;
  const h = 120;
  const top = Math.max(best || 0, ...history, 1);
  const n = history.length;
  const y = (v: number) => h - (v / top) * (h - 10) - 5;
  const pts = history.map((v, i) => `${(i / Math.max(n - 1, 1)) * w},${y(v)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="fc">
      {best !== null && <line x1="0" y1={y(best)} x2={w} y2={y(best)} stroke="#2a9d8f" strokeDasharray="4 4" />}
      <polyline points={pts} fill="none" stroke="#264653" strokeWidth="2" />
      <circle cx={w} cy={y(history[n - 1] ?? 0)} r="4" fill="#e76f51" />
      <text x="4" y="14" fontSize="12" fill="#2a9d8f">
        최대 {best ?? '—'}
      </text>
    </svg>
  );
}

function FocusPanel({d, focus, umPerPx, send}: {d: Device; focus: FocusState; umPerPx: number | null; send: SendCommand}) {
  const [zoom, setZoom] = useState(2);
  const ratio = focus.ratio ?? null;
  return (
    <div className="stack">
      <div className="row">
        <b>{FOCUS_STAGE[focus.stage] || '준비 중'}</b>
        <Badge type={ratio !== null && ratio >= 95 ? 'good' : ratio !== null && ratio < 85 ? 'bad' : 'info'}>
          선명도 {focus.sharpness ?? '—'} / 최대 {focus.best ?? '—'}
          {ratio !== null ? ` (${ratio}%)` : ''} · {focus.frames}장
        </Badge>
      </div>
      {focus.hint && (
        <p>
          <b>{focus.hint}</b>
        </p>
      )}
      {focus.history && focus.history.length > 1 && <FocusCurve history={focus.history} best={focus.best} />}
      {focus.images && <FocusView at={focus.at} umPerPx={umPerPx} zoom={zoom} setZoom={setZoom} />}
      <button className="primary" disabled={focus.stage !== 'holding'} onClick={() => send('focusStop', d.id)}>
        초점 조정 끝 · 복귀
      </button>
    </div>
  );
}

/**
 * 사용자 설정 > 카메라 정렬 · 초점 (스캐너 1 실장비).
 *
 * 정렬 토글은 사용자 설정이고, 보정 실행과 초점 모드는 장비를 움직이므로 서버가 관리자만
 * 받는다(ADMIN_ONLY). 분석자가 누르면 App 이 PIN 팝업을 띄워 이어서 보낸다.
 */
export function AlignmentSection({state, send}: Props) {
  const scanner = state.devices[0];
  const al = scanner?.hardware?.alignment ?? null;
  const plates = scanner ? platesFor(state, scanner.id).sort((a, b) => a.slot - b.slot) : [];
  const [calSlot, setCalSlot] = useState<number>(plates[0]?.slot ?? 0);
  const [ask, setAsk] = useState<'alignment' | 'focus' | null>(null);
  if (!scanner) return null;
  const slot = plates.some(p => p.slot === calSlot) ? calSlot : (plates[0]?.slot ?? 0);
  const job = scanner.job && ['running', 'paused'].includes(scanner.job.status) ? scanner.job : null;
  const calibrating = !!job && job.type === 'calibrate' && !job.focus;
  const focusing = !!job && !!job.focus;
  const supported = !!al?.available;
  const canStart = supported && !isBusy(scanner) && !state.cameraBusy && !state.maintenance && slot > 0;

  return (
    <>
      <section className="card stack">
        <h2>카메라 웰 중심 정렬 — {scanner.name}</h2>
        <p className="muted">
          켜면 웰마다 촬영 전에 라이브 영상에서 웰 테두리를 찾아 카메라 X·Y를 중심에 맞춘 뒤
          촬영합니다(웰당 약 2초 추가). 끄면 기존 방식대로 격자 위치에서 바로 촬영합니다.
        </p>
        <Toggle
          label="웰 중심 자동 정렬"
          checked={!!state.settings?.alignment}
          onChange={alignment => void send('settings', 0, {alignment})}
        />
        <dl>
          <dt>지원</dt>
          <dd>{al ? (al.available ? '가능' : '모터 또는 카메라 세션 없음') : state.profile.adapter === 'virtual' ? '가상 장비 — 해당 없음' : '—'}</dd>
          <dt>보정 상태</dt>
          <dd>
            {al?.calibrated
              ? `보정됨 · ${fmt(al.calibratedAt ?? 0)} · 기준 링 r=${al.ring?.radius}px`
              : '미보정 · 정렬 촬영 전에 아래 보정을 실행하세요'}
          </dd>
          <dt>기억된 웰 위치</dt>
          <dd>{al?.rememberedWells?.length ? `웰 ${al.rememberedWells.join(', ')}` : '없음'}</dd>
          <dt>영상 배율</dt>
          <dd>
            {al?.umPerPx
              ? `약 ${al.umPerPx} µm/px (웰 안지름 ${al.wellDiameterMm} mm 기준) · 50 µm ≈ ${(50 / al.umPerPx).toFixed(1)} px`
              : '보정 후 표시'}
          </dd>
          {calibrating && (
            <>
              <dt>진행</dt>
              <dd>{CAL_STAGE[job?.calibrationStage ?? ''] || '준비 중'}</dd>
            </>
          )}
        </dl>
        <label className="field">
          <span className="fl">
            보정용 플레이트<em>플레이트가 들어 있는 칸을 고릅니다</em>
          </span>
          <span className="fi plain">
            <select value={slot} onChange={e => setCalSlot(Number(e.target.value))} disabled={!plates.length}>
              {!plates.length && <option value={0}>등록된 플레이트 없음</option>}
              {plates.map(p => (
                <option key={p.id} value={p.slot}>
                  {pos(p.slot)} · {p.id}
                </option>
              ))}
            </select>
          </span>
        </label>
        <div className="actbar">
          <button className="primary" disabled={!canStart || !!job} onClick={() => setAsk('alignment')}>
            카메라 정렬 보정 실행
          </button>
          {!focusing && (
            <button disabled={!canStart || !!job} onClick={() => setAsk('focus')}>
              초점 조정 위치로 이동
            </button>
          )}
        </div>
        <p className="muted">
          보정은 처음 한 번, 그리고 카메라 해상도·렌즈 초점·모터 마이크로스텝이 바뀌었을 때 다시
          실행합니다. 이력의 촬영 결과에서 정렬된 웰 수를 확인할 수 있습니다.
        </p>
      </section>

      <section className="card stack">
        <h2>초점 조정</h2>
        <p className="muted">
          플레이트를 꺼내 웰 1을 촬영 높이에 두고 유지합니다. 선명도는 절대 기준이 없는
          상대값이라, 렌즈를 한쪽으로 돌려 값이 올라갔다 내려오는 것을 확인한 뒤 최대값
          지점으로 되돌아오는 방식으로 맞춥니다. 선명도는 웰 안쪽 배지 면에서만 잽니다.
          초점을 바꾸면 배율도 바뀌므로 끝난 뒤 카메라 정렬 보정을 다시 실행합니다.
        </p>
        {focusing && job?.focus ? (
          <FocusPanel d={scanner} focus={job.focus} umPerPx={al?.umPerPx ?? null} send={send} />
        ) : (
          <p className="muted">위의 「초점 조정 위치로 이동」으로 시작합니다.</p>
        )}
      </section>

      {ask && (
        <Modal
          title={ask === 'alignment' ? '카메라 정렬 보정' : '초점 조정 위치로 이동'}
          confirmLabel="실행"
          onConfirm={() => {
            const kind = ask;
            setAsk(null);
            void send('calibrate', scanner.id, {kind, slot});
          }}
          onClose={() => setAsk(null)}
        >
          <p>
            {ask === 'alignment'
              ? `${pos(slot)}의 플레이트로 카메라 정렬 보정을 실행합니다. 트레이가 이동하며 약 30초 걸립니다.`
              : `${pos(slot)}의 플레이트를 꺼내 웰 1을 촬영 높이에 두고 유지합니다. 끝나면 「초점 조정 끝 · 복귀」를 누르세요.`}
          </p>
        </Modal>
      )}
    </>
  );
}
