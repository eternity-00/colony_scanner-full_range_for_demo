import type {CommandArgs} from '../api/types.ts';

/** 트레이 셀 한 칸의 표시 상태. */
export type WellState = 'ok' | 'empty' | 'busy' | 'done' | 'bad';

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

/**
 * 드로어 메뉴 순서: [키, 한글, 영문, 관리자 전용]
 *
 * 촬영·장비 화면은 버튼을 빼고 나면 거의 빈 화면이 되고, 그 내용은 현황 카드의
 * 「촬영 중」·「점검 필요」 배지가 이미 보여준다. 그래서 통째로 감춘다.
 * 나머지는 사용자에게 보여주되 장비를 움직이는 버튼만 잠근다 —
 * 상태를 못 보면 관리자를 불러야 할지 판단할 수 없기 때문이다.
 */
export const TABS: readonly (readonly [TabKey, string, string, boolean])[] = [
  ['overview', '현황', 'Overview', false],
  ['detail', '상세', 'Detail', false],
  ['register', '등록', 'Register', false],
  ['running', '촬영', 'Capture', true],
  ['history', '이력', 'History', false],
  ['device', '장비', 'Device', true],
  ['settings', '사용자 설정', 'Settings', false],
];

/** 역할에 따라 볼 수 있는 탭. */
export const tabsFor = (isAdmin: boolean) =>
  TABS.filter(([, , , adminOnly]) => isAdmin || !adminOnly);

/** 촬영 작업의 6단계. 그 외 명령(home/calibrate/reset)은 3단계. */
export const STAGES = ['이송', '물기 제거', '촬영', '수납 복귀', '전송', 'PC 저장'];

export const SHORT_STAGES = ['준비', '구동', '완료 확인'];

/** 플레이트 1매당 Well 수. */
export const WELLS = 6;

/** 스캐너 1대당 슬롯 수 (8단 × 3열). */
export const SLOTS_PER_DEVICE = 24;

/**
 * 이력 표 한 행 높이(rem). 화면 높이에 맞춰 페이지당 행 수를 계산하는 데 쓴다.
 * CSS 가 rem 이므로 실제 픽셀은 rootFontPx() 를 곱해서 구한다.
 */
export const ROW_HEIGHT_REM = 2.75;

/** 촬영 이력 표 한 행 높이(rem). */
export const RUN_ROW_HEIGHT_REM = 3.375;

/**
 * 최대 배양 기간(일). 피드백 4.3 — 확정 균 작업은 일수 제한이 무의미하지만
 * 시스템상 무제한은 허용하지 않고 상한을 42일로 둔다.
 * server/controller.mjs 의 routine 검증과 값을 맞춰야 한다.
 */
export const MAX_INCUBATION_DAYS = 42;

/**
 * 경과 시간을 "일 + 시간" 혼합으로 바꾸는 기준(시간). 피드백 5.1 —
 * 조기 양성이 3일 차에 나오므로 시간 단위가 기본이고, 42일까지 가면 자릿수가 커진다.
 * 확인 필요 7번(표기 단위 확정)이 열려 있어 잠정값이다.
 */
export const ELAPSED_MIXED_AFTER_HOURS = 48;

/**
 * 인큐베이터 온도가 목표에서 이만큼(℃) 벗어나면 "이상"으로 본다.
 * 피드백 2.2 의 "이상 시에만 노출" 판정에 쓴다.
 * 확인 필요 5번(정상 범위·알림 기준값·지속 시간)이 열려 있어 잠정값이다.
 */
export const TEMP_TOLERANCE_C = 1;

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
