import type {AppState} from '../../api/types.ts';
import {WellLegend} from '../../shared/Legend.tsx';
import {active, pending, totalRuns} from '../../utils/plate.ts';

/** 색면 톤 — 글자·아이콘이 올라가므로 깊은 톤을 쓴다. */
type Tone = 'wait' | 'run' | 'send' | 'fault';

interface Stat {
  key: Tone;
  label: string;
  value: number;
  unit: string;
  path: string;
}

/**
 * 현황 화면 맨 위 한 줄 — 통계 4개(왼쪽)와 Well 범례(오른쪽).
 *
 * 시안(D1)에서 세 줄짜리 타일 4개를 한 줄로 줄인 자리다. 타일에 있던 주석
 * ("SCANNER 1 · 4" 등)은 아래 카드의 상태 배지와 Well 원이 이미 말하고 있어 뺐다.
 */
export function StatBar({state}: {state: AppState}) {
  const plates = active(state);
  const need = totalRuns(state);

  const stats: Stat[] = [
    {
      key: 'wait',
      label: '반출 대기',
      value: plates.filter(p => p.runs.length >= need).length,
      unit: '매',
      path: 'M12 3v10M8 9l4 4 4-4M4 20h16',
    },
    {
      key: 'run',
      label: '촬영 중',
      value: state.devices.filter(d => d.job?.status === 'running').length,
      unit: '대',
      path: 'M3 7h5V5h8v2h5v12H3zM9.5 10.5h5v5h-5z',
    },
    {
      key: 'send',
      label: '미전송',
      value: plates.reduce((a, p) => a + pending(p), 0),
      unit: '건',
      path: 'M12 19V7M6.5 12.5L12 7l5.5 5.5M4 4h16',
    },
    {
      key: 'fault',
      label: '점검 필요',
      value: state.devices.filter(d => !d.connected || d.fault || d.doorOpen).length,
      unit: '대',
      path: 'M12 4.5l8.5 15h-17zM12 10v4M12 17h.01',
    },
  ];

  return (
    <div className="overview-head">
      <div className="stats">
        {stats.map(s => (
          <span className="stat" key={s.key}>
            <i className={`stat-ic ${s.key}`}>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={s.path} />
              </svg>
            </i>
            <small>{s.label}</small>
            <b>
              {s.value}
              <em>{s.unit}</em>
            </b>
          </span>
        ))}
      </div>
      <WellLegend />
    </div>
  );
}
