import {useState} from 'react';
import type {AppState} from '../api/types.ts';
import {fmt, hm} from '../utils/datetime.ts';
import {envAlarmActive, humidityAbnormal, tempAbnormal} from '../utils/plate.ts';
import {Modal} from './Modal.tsx';

/** 온도·습도 추이 24시간(5분 간격). 점선 = 목표 온도. */
function EnvTrend({state}: {state: AppState}) {
  const pts = state.envHistory ?? [];
  const w = 720;
  const h = 150;
  const target = state.devices[0]?.targetTemperature ?? 37;
  const series = (pick: (p: {t: number | null; h: number | null}) => number | null, lo: number, hi: number) => {
    const vals = pts.map(pick);
    const n = vals.length;
    const y = (v: number) => h - ((v - lo) / (hi - lo || 1)) * (h - 20) - 10;
    const path = vals.map((v, i) => (v === null ? '' : `${(i / Math.max(n - 1, 1)) * w},${y(v)}`)).filter(Boolean).join(' ');
    return {path, y};
  };
  const tv = pts.map(p => p.t).filter((v): v is number => v !== null);
  const hv = pts.map(p => p.h).filter((v): v is number => v !== null);
  const tLo = Math.min(target - 3, ...tv) - 0.5;
  const tHi = Math.max(target + 3, ...tv) + 0.5;
  const t = series(p => p.t, tLo, tHi);
  const hu = series(p => p.h, Math.min(50, ...hv), 100);
  const first = pts[0]?.at;
  const last = pts.at(-1)?.at;
  return (
    <div className="env-trend">
      {!pts.length && <p className="muted">아직 기록된 추이가 없습니다. 5분마다 한 점씩 쌓입니다.</p>}
      {pts.length > 0 && (
        <>
          <div className="env-trend-head">
            <b>온도 (℃)</b>
            <span>
              {first !== undefined && fmt(first)} ~ {last !== undefined && hm(last)} · 점선 = 목표 {target}℃
            </span>
          </div>
          <svg viewBox={`0 0 ${w} ${h}`} className="fc env-svg">
            <line x1="0" y1={t.y(target)} x2={w} y2={t.y(target)} stroke="#2a9d8f" strokeDasharray="4 4" />
            <polyline points={t.path} fill="none" stroke="#b42318" strokeWidth="2" />
            <text x="4" y="14" fontSize="12" fill="#5c6672">{tHi.toFixed(1)}</text>
            <text x="4" y={h - 2} fontSize="12" fill="#5c6672">{tLo.toFixed(1)}</text>
          </svg>
          <div className="env-trend-head">
            <b>습도 (%)</b>
            <span>
              범위 {state.settings.alarms.humidityMin}~{state.settings.alarms.humidityMax}%
            </span>
          </div>
          <svg viewBox={`0 0 ${w} ${h}`} className="fc env-svg">
            <line x1="0" y1={hu.y(state.settings.alarms.humidityMin)} x2={w} y2={hu.y(state.settings.alarms.humidityMin)} stroke="#2a9d8f" strokeDasharray="4 4" />
            <line x1="0" y1={hu.y(state.settings.alarms.humidityMax)} x2={w} y2={hu.y(state.settings.alarms.humidityMax)} stroke="#2a9d8f" strokeDasharray="4 4" />
            <polyline points={hu.path} fill="none" stroke="#2e4a8c" strokeWidth="2" />
            <text x="4" y="14" fontSize="12" fill="#5c6672">100</text>
          </svg>
        </>
      )}
    </div>
  );
}

/**
 * 홈의 온도·습도 카드.
 *
 * 1차 피드백 2.2: 사용자 모드에서는 현재값을 상시 보여주지 않고 **이상 시에만** 드러낸다.
 * 관리자는 상시 조회. 센서가 없으면(테스트베드) 「측정 없음」. 누르면 24시간 추이.
 */
export function EnvCard({state, compact = false}: {state: AppState; compact?: boolean}) {
  const [open, setOpen] = useState(false);
  const d = state.devices[0];
  if (!d) return null;
  const isAdmin = state.session.role === 'admin';
  const alarms = state.settings.alarms;
  const tBad = tempAbnormal(d, alarms);
  const hBad = humidityAbnormal(d, alarms);
  const alarmOn = envAlarmActive(state);
  const sensed = d.temperature !== null || d.humidity !== null;
  const showValues = isAdmin || alarmOn || tBad || hBad;
  const tone = alarmOn ? 'bad' : tBad || hBad ? 'warn' : sensed ? 'ok' : 'none';
  const text = (v: number | null, unit: string, digits: number) => (v === null ? '—' : `${v.toFixed(digits)}${unit}`);
  return (
    <>
      <button className={`env-card ${tone} ${compact ? 'compact' : ''}`} onClick={() => setOpen(true)} aria-label="온도 · 습도 추이 보기">
        <span className="env-item">
          <small>온도</small>
          <b className={tBad ? 'bad' : ''}>{showValues ? text(d.temperature, '℃', 1) : sensed ? '정상' : '측정 없음'}</b>
          {showValues && <em>목표 {d.targetTemperature}℃</em>}
        </span>
        <span className="env-item">
          <small>습도</small>
          <b className={hBad ? 'bad' : ''}>{showValues ? text(d.humidity, '%', 0) : sensed ? '정상' : '측정 없음'}</b>
          {showValues && <em>{alarms.humidityMin}~{alarms.humidityMax}%</em>}
        </span>
        <span className="env-go">{alarmOn ? '환경 이상 · 추이 보기' : '추이'}</span>
      </button>
      {open && (
        <Modal title="온도 · 습도 추이 (최근 24시간)" onClose={() => setOpen(false)} wide bare>
          <EnvTrend state={state} />
          <div className="actions">
            <button className="primary" onClick={() => setOpen(false)}>
              닫기
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
