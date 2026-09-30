import type {AppState} from '../../api/types.ts';
import {SLOTS_PER_DEVICE} from '../../config/defines.ts';
import {WellLegend} from '../../shared/Legend.tsx';
import {active, plateBad, pending, totalRuns} from '../../utils/plate.ts';

/** 칸 이름. 급한 두 칸(wait·fault)만 숫자에 색이 붙는다. */
type Tone = 'wait' | 'slot' | 'send' | 'fault';

interface Stat {
  key: Tone;
  label: string;
  value: number;
  unit: string;
}

/**
 * 현황 화면 맨 위 한 줄 — 통계 4개(왼쪽)와 Well 범례(오른쪽).
 *
 * 시안(D1)에서 세 줄짜리 타일 4개를 한 줄로 줄인 자리다. 타일에 있던 주석
 * ("SCANNER 1 · 4" 등)은 아래 카드의 상태 배지와 Well 원이 이미 말하고 있어 뺐다.
 *
 * 네 칸 모두 분석자가 손을 대야 하는 것이다 — 꺼내라 · 넣을 수 있다 · 보내라 ·
 * 손 봐라. 「촬영 중」은 할 일이 아니라 정보였고 아래 카드 배지 넷이 같은 말을
 * 하고 있어 뺐다. 장비 고장은 분석자가 할 수 있는 게 없어 알림 종이 맡는다.
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
    },
    {
      key: 'slot',
      label: '빈 슬롯',
      value: SLOTS_PER_DEVICE * state.devices.length - plates.length,
      unit: '칸',
    },
    {
      key: 'send',
      label: '미전송',
      value: plates.reduce((a, p) => a + pending(p), 0),
      unit: '건',
    },
    {
      // 장비가 아니라 플레이트를 센다. 장비 고장은 분석자가 할 수 있는 일이
      // 없어서 알림 종과 「관리자에게 문의하세요」 배너가 맡는다. 여기 네 칸은
      // 분석자가 손을 대야 하는 것만 센다.
      key: 'fault',
      label: '문제 발생',
      value: plates.filter(plateBad).length,
      unit: '매',
    },
  ];

  return (
    <div className="overview-head">
      <div className="stats">
        {stats.map(s => (
          <span className={`stat ${s.key}`} key={s.key}>
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
