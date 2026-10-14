import type {AppState} from '../api/types.ts';
import {hm} from './datetime.ts';
import {active, failedWells, faultLabel, pending, plateBad, pos, totalRuns} from './plate.ts';

export type AlertKind = 'device' | 'plate' | 'done' | 'shot';

/** 알람 줄 앞의 꼬리표. 'shot'(촬영 완료)만 손댈 일이 아닌 알림이다. */
export const ALERT_TAG: Record<AlertKind, string> = {
  device: '오류',
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
  /** 어디서 난 일인지 — SCANNER 3 · 8단 1열 */
  where: string;
  /** 무슨 일인지 */
  what: string;
  go?: () => void;
}

interface Go {
  /** 관리자가 장비 오류를 고치러 간다. */
  onDevice: () => void;
  /** 플레이트를 손보러 상세로 간다. */
  onPlate: (deviceId: number, slot: number) => void;
  /** 분석자가 장비 오류 줄을 눌렀을 때 — 할 수 없는 일이라고 알린다. */
  onNeedAdmin: (where: string, what: string) => void;
}

/**
 * 지금 손대야 하는 일 목록. 홈 화면의 알람 칸이 쓴다.
 *
 * 세 가지를 센다 — 장비 오류 · 손봐야 하는 플레이트 · 반출을 기다리는 플레이트.
 * 그 아래에 최근 촬영 완료를 알림으로 붙인다(한 주기 안, 최근 것부터 다섯 줄 — 혜원님 10/14).
 * 줄마다 갈 곳이 다르다. 플레이트는 상세로, 장비 오류는 관리자면 장비 화면으로,
 * 분석자면 왜 못 고치는지를 알리는 팝업으로 간다.
 */
export function alertItems(state: AppState, {onDevice, onPlate, onNeedAdmin}: Go): AlertItem[] {
  const isAdmin = state.session.role === 'admin';
  // 스캐너가 한 대면 이름은 늘 같다 — 위치만 적는다.
  const one = state.devices.length === 1;
  const name = (id: number) => state.devices.find(d => d.id === id)?.name ?? `SCANNER ${id}`;
  const at = (id: number, slot: number) => (one ? pos(slot) : `${name(id)} · ${pos(slot)}`);
  const need = totalRuns(state);
  const plates = active(state);

  return [
    ...state.devices
      .filter(d => faultLabel(d))
      .map<AlertItem>(d => ({
        id: `d${d.id}`,
        kind: 'device',
        where: d.name,
        what: faultLabel(d) as string,
        // 관리자는 고치러 가고, 분석자는 왜 못 고치는지를 듣는다.
        go: isAdmin ? onDevice : () => onNeedAdmin(d.name, faultLabel(d) as string),
      })),
    ...plates.filter(plateBad).map<AlertItem>(p => ({
      id: `b${p.id}`,
      kind: 'plate',
      where: at(p.deviceId, p.slot),
      what: p.runs.at(-1)?.imageState === 'failed'
        ? '촬영 실패'
        : failedWells(p.runs.at(-1)!).length
          ? `Well ${failedWells(p.runs.at(-1)!).join('·')} 촬영 실패`
          : `미전송 ${pending(p)}건`,
      go: () => onPlate(p.deviceId, p.slot),
    })),
    ...plates
      .filter(p => p.runs.length >= need)
      .map<AlertItem>(p => ({
        id: `w${p.id}`,
        kind: 'done',
        where: at(p.deviceId, p.slot),
        what: `촬영 완료 ${p.runs.length}/${need} · 반출 대기`,
        go: () => onPlate(p.deviceId, p.slot),
      })),
    ...plates
      .flatMap(p =>
        p.runs
          .filter(
            r =>
              r.imageState !== 'failed' &&
              state.serverTime - r.at < state.routine.cycleHours * 3600000,
          )
          .map(r => ({p, r})),
      )
      .sort((a, b) => b.r.at - a.r.at)
      .slice(0, SHOT_NOTES)
      .map<AlertItem>(({p, r}) => ({
        id: `s${p.id}-${r.n}`,
        kind: 'shot',
        where: at(p.deviceId, p.slot),
        what: `${r.n}회차 촬영 완료 · ${hm(r.at)}`,
        go: () => onPlate(p.deviceId, p.slot),
      })),
  ];
}
