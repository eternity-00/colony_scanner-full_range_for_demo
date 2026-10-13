import type {AppState} from '../api/types.ts';
import {active, faultLabel, pending, plateBad, pos, totalRuns} from './plate.ts';

export type AlertKind = 'device' | 'plate' | 'done';

export interface AlertItem {
  id: string;
  kind: AlertKind;
  /** 어디서 난 일인지 — SCANNER 3 · 8단 1열 */
  where: string;
  /** 무슨 일인지 */
  what: string;
  go?: () => void;
  /**
   * 누르면 화면이 바뀌는 줄에는 확인을 한 번 받는다. 알림을 읽으려고 눌렀는데
   * 보던 화면이 사라지면 놀란다. 확인이 필요 없는 줄(안내만 뜨는 줄)은 비워 둔다.
   */
  ask?: string;
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
 * 지금 손대야 하는 일 목록. 헤더의 알림 종과 홈 화면의 알람 칸이 같은 목록을 쓴다.
 *
 * 세 가지를 센다 — 장비 오류 · 손봐야 하는 플레이트 · 반출을 기다리는 플레이트.
 * 줄마다 갈 곳이 다르다. 플레이트는 상세로, 장비 오류는 관리자면 장비 화면으로,
 * 분석자면 왜 못 고치는지를 알리는 팝업으로 간다.
 */
export function alertItems(state: AppState, {onDevice, onPlate, onNeedAdmin}: Go): AlertItem[] {
  const isAdmin = state.session.role === 'admin';
  const name = (id: number) => state.devices.find(d => d.id === id)?.name ?? `SCANNER ${id}`;
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
        ask: isAdmin ? '장비 화면으로 이동하시겠습니까?' : undefined,
      })),
    ...plates.filter(plateBad).map<AlertItem>(p => ({
      id: `b${p.id}`,
      kind: 'plate',
      where: `${name(p.deviceId)} · ${pos(p.slot)}`,
      what: p.runs.at(-1)?.imageState === 'failed' ? '촬영 실패' : `미전송 ${pending(p)}건`,
      go: () => onPlate(p.deviceId, p.slot),
      ask: '이 플레이트 상세로 이동하시겠습니까?',
    })),
    ...plates
      .filter(p => p.runs.length >= need)
      .map<AlertItem>(p => ({
        id: `w${p.id}`,
        kind: 'done',
        where: `${name(p.deviceId)} · ${pos(p.slot)}`,
        what: `촬영 완료 ${p.runs.length}/${need}`,
        go: () => onPlate(p.deviceId, p.slot),
        ask: '이 플레이트 상세로 이동하시겠습니까?',
      })),
  ];
}
