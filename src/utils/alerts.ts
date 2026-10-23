import type {Alarm, AlarmKind, AppState} from '../api/types.ts';
import {active, faultLabel, pos} from './plate.ts';

export type AlertKind = AlarmKind | 'shot';

/** 알람 줄 앞의 꼬리표. 'shot'(촬영 완료)만 손댈 일이 아닌 알림이다. */
export const ALERT_TAG: Record<AlertKind, string> = {
  device: '오류',
  env: '환경',
  plate: '주의',
  done: '반출',
  shot: '촬영',
};

/** 손대야 하는 알람 수 — 촬영 완료 알림은 세지 않는다. */
export const actionable = (items: AlertItem[]) => items.filter(a => a.kind !== 'shot').length;

/** 촬영 완료 알림을 남기는 최대 줄 수. */
const SHOT_NOTES = 5;

export interface AlertItem {
  id: string;
  kind: AlertKind;
  /** 어디서 난 일인지 — 3단 · SCANNER 1 */
  where: string;
  /** 무슨 일인지 */
  what: string;
  /** 언제 난 일인지(ms). 목록은 이 값의 최신순이다. */
  at: number;
  /** 사용자가 「확인」을 눌렀는지(서버 알람만). */
  acked?: boolean;
  /** 반출 사유(반출 알람만) — 기간 만료 / 조기 양성. */
  reason?: 'expired' | 'positive';
  go?: () => void;
  /** 서버 알람이면 확인 처리할 수 있다. */
  ack?: () => void;
}

interface Go {
  /** 관리자가 장비 오류를 고치러 간다. */
  onDevice: () => void;
  /** 플레이트를 손보러 상세로 간다. */
  onPlate: (deviceId: number, slot: number) => void;
  /** 분석자가 장비 오류 줄을 눌렀을 때 — 할 수 없는 일이라고 알린다. */
  onNeedAdmin: (where: string, what: string) => void;
  /** 환경 알람을 눌렀을 때 — 온도·습도 추이를 연다. */
  onEnv?: () => void;
  /** 알람 확인(alarm.ack). */
  onAck?: (id: string) => void;
}

/** 지금 걸려 있는 서버 알람. */
export const activeAlarms = (state: AppState): Alarm[] => (state.alarms ?? []).filter(a => !a.clearedAt);

/** 해제된 알람 이력(최신순). */
export const alarmHistory = (state: AppState): Alarm[] => (state.alarms ?? []).filter(a => !!a.clearedAt);

/**
 * 홈·현황의 알람 목록. 서버가 만든 알람 객체(장비 오류 · 환경 · 플레이트 · 반출)를 그대로 쓰고,
 * 그 아래에 최근 촬영 완료 알림을 붙인다(한 주기 안, 최근 것부터 다섯 줄).
 * 서버 알람은 발생·확인·해제가 기록되므로 화면에서 다시 계산하지 않는다(1차 피드백 3.4).
 */
export function alertItems(state: AppState, {onDevice, onPlate, onNeedAdmin, onEnv, onAck}: Go): AlertItem[] {
  const isAdmin = state.session.role === 'admin';
  const one = state.devices.length === 1;
  const name = (id: number) => state.devices.find(d => d.id === id)?.name ?? `SCANNER ${id}`;
  const at = (id: number, slot: number) => (one ? pos(slot) : `${name(id)} · ${pos(slot)}`);
  const plateOf = (id?: string) => state.plates.find(p => p.id === id);

  const server = activeAlarms(state).map<AlertItem>(a => {
    const p = plateOf(a.plateId);
    const d = state.devices.find(x => x.id === a.deviceId);
    const go =
      a.kind === 'device'
        ? isAdmin
          ? onDevice
          : () => onNeedAdmin(a.where, a.what || (d ? (faultLabel(d) ?? '') : ''))
        : a.kind === 'env'
          ? onEnv
          : p
            ? () => onPlate(p.deviceId, p.slot)
            : undefined;
    return {
      id: a.id,
      kind: a.kind,
      where: a.where,
      what: a.what,
      at: a.at,
      acked: !!a.ackAt,
      reason: a.reason,
      go,
      ack: onAck ? () => onAck(a.id) : undefined,
    };
  });

  const shots = active(state)
    .flatMap(p =>
      p.runs
        .filter(r => r.imageState !== 'failed' && state.serverTime - r.at < state.routine.cycleHours * 3600000)
        .map(r => ({p, r})),
    )
    .sort((a, b) => b.r.at - a.r.at)
    .slice(0, SHOT_NOTES)
    .map<AlertItem>(({p, r}) => ({
      id: `s${p.id}-${r.n}`,
      kind: 'shot',
      where: at(p.deviceId, p.slot),
      what: `${r.n}회차 촬영 완료`,
      at: r.at,
      go: () => onPlate(p.deviceId, p.slot),
    }));

  return [...server, ...shots].sort((a, b) => b.at - a.at);
}
