import type {CommandArgs} from '../api/types.ts';
import type {WellState} from '../utils/plate.ts';

export type TabKey =
  | 'overview'
  | 'detail'
  | 'register'
  | 'running'
  | 'history'
  | 'device'
  | 'settings';

/**
 * 화면에서 장비 명령을 보내는 통로. App 의 execute() 가 이 모양으로 내려온다.
 * next 를 주면 성공 후 그 탭으로 이동하고, confirm 이 true 면 확인 모달을 먼저 띄운다.
 */
export type SendCommand = (
  command: string,
  deviceId: number,
  args?: CommandArgs,
  next?: TabKey | null,
  confirm?: boolean,
) => Promise<unknown>;

/** 드로어 메뉴 순서: [키, 한글, 영문] */
export const TABS: readonly (readonly [TabKey, string, string])[] = [
  ['overview', '현황', 'Overview'],
  ['detail', '상세', 'Detail'],
  ['register', '등록', 'Register'],
  ['running', '촬영', 'Capture'],
  ['history', '이력', 'History'],
  ['device', '장비', 'Device'],
  ['settings', '사용자 설정', 'Settings'],
];

/** 촬영 작업의 6단계. 그 외 명령(home/calibrate/reset)은 3단계. */
export const STAGES = ['이송', '물기 제거', '촬영', '수납 복귀', '전송', 'PC 저장'];

export const SHORT_STAGES = ['준비', '구동', '완료 확인'];

/** 플레이트 1매당 Well 수. */
export const WELLS = 6;

/** 스캐너 1대당 슬롯 수 (8단 × 3열). */
export const SLOTS_PER_DEVICE = 24;

/** 이력 표 한 행 높이(px). 화면 높이에 맞춰 페이지당 행 수를 계산하는 데 쓴다. */
export const ROW_HEIGHT = 44;

/** 촬영 이력 표 한 행 높이(px). */
export const RUN_ROW_HEIGHT = 54;

/** 관리자 권한 자동 해제까지의 시간(초). server/controller.mjs 의 5분과 맞춰야 한다. */
export const ADMIN_IDLE_LIMIT_SEC = 300;

/** 자동 해제 경고를 띄우기 시작하는 무조작 시간(ms). */
export const ADMIN_IDLE_WARN_MS = 270000;

/** 트레이 셀 상태 범례. */
export const WELL_LEGEND: readonly (readonly [WellState, string])[] = [
  ['ok', 'Well 있음'],
  ['empty', 'Well 없음'],
  ['busy', '촬영 중'],
  ['done', '작업 완료'],
  ['bad', '문제 발생'],
];

export const WELL_LABEL: Record<WellState, string> = Object.fromEntries(WELL_LEGEND) as Record<
  WellState,
  string
>;
