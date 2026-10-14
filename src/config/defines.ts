import type {CommandArgs} from '../api/types.ts';

/** 트레이 셀 한 칸의 표시 상태. */
export type WellState = 'ok' | 'empty' | 'busy' | 'done' | 'bad';

export type TabKey =
  | 'overview'
  | 'status'
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
 * 장비 화면만 통째로 감춘다. 버튼(원점 복귀·모듈 초기화·오류 해제·캘리브레이션)을
 * 빼고 나면 모듈 상태 목록만 남고, 그건 현황 카드의 「점검 필요」 배지가 이미 보여준다.
 *
 * 촬영 화면은 감추지 않는다. 버튼을 빼도 카메라 영상과 단계 진행이 남고,
 * 그건 사용자가 "내 플레이트가 지금 찍히고 있나"를 아는 유일한 화면이다.
 * 나머지도 같은 이유로 보여주되 장비를 움직이는 버튼만 막는다.
 */
export const TABS: readonly (readonly [TabKey, string, string, boolean])[] = [
  ['overview', '홈', 'Home', false],
  ['status', '현황', 'Status', false],
  ['register', '등록', 'Register', false],
  ['detail', '상세', 'Detail', false],
  ['running', '촬영', 'Capture', false],
  ['history', '이력', 'History', false],
  ['device', '장비', 'Device', true],
  ['settings', '사용자 설정', 'Settings', false],
];

/**
 * 관리자 권한이 필요한 동작의 한글 이름. 서버가 FORBIDDEN 을 돌려줬을 때
 * "무엇을 하려다 막혔는지"를 팝업에 적기 위한 것이다.
 * server/controller.mjs 의 ADMIN_ONLY 와 같은 목록이어야 한다.
 */
export const ADMIN_ACTION: Record<string, string> = {
  capture: '촬영 시작',
  pause: '촬영 일시정지',
  resume: '촬영 재개',
  stop: '비상 정지',
  home: '원점 복귀',
  reset: '모듈 초기화',
  clearError: '오류 해제',
  retry: '재전송',
  autoRun: '자동 촬영 설정',
  calibrate: '캘리브레이션',
  routine: '검사 루틴 변경',
  environment: '온도 · CO₂ 변경',
};

/**
 * 화면에 표시할 UI 버전.
 *
 * 1.x 는 브랜치 feat/lcd-uiux-vN 을 1.N 으로 센다 — 데모였던 v2 가 1.2, … v6 이 1.6.
 * 2차 피드백(2026-10-13) 반영부터 2.x 이고, 브랜치는 feat/lcd-uiux-v2.N 이다.
 * 마지막 자리는 파이에 올린 횟수다. 파이에 올릴 때마다 하나씩 올린다.
 * 파이에 무엇이 도는지 화면만 보고 알 수 있어야 해서 붙인 값이다.
 */
export const APP_VERSION = 'v2.0.1';

/** 장비 오류 코드의 한글 이름. 사용자에게 "무엇이 고장났는지"를 말해주기 위한 것이다. */
export const FAULT_LABEL: Record<string, string> = {
  Z_LIMIT: 'Z축 한계 오류',
  HEATER: '히터 오류',
  ESTOP: '비상 정지됨',
  DISCONNECTED: '연결 끊김',
  DOOR_OPEN: '도어 열림',
  CAMERA_TIMEOUT: '카메라 응답 없음',
  ENGINE_OFFLINE: '장비 엔진 연결 끊김',
};

/** 역할에 따라 볼 수 있는 탭. */
export const tabsFor = (isAdmin: boolean) =>
  TABS.filter(([, , , adminOnly]) => isAdmin || !adminOnly);

/** 촬영 작업의 6단계. 그 외 명령(home/calibrate/reset)은 3단계. */
export const STAGES = ['이송', '물기 제거', '촬영', '수납 복귀', '전송', 'PC 저장'];
/**
 * 촬영 화면의 진행 띠에 그리는 단계 수.
 *
 * 장비는 여섯 단계를 돈다. 그중 앞의 넷이 스캐너가 실제로 움직이는 일이고,
 * 뒤의 둘(전송 · PC 저장)은 여기서 지켜볼 일이 아니다 — 전송 여부는 현황의
 * 「미전송」, 이력의 전송 칸, 상세의 회차별 배지가 각자 말한다.
 * 띠는 앞의 넷만 그리고, 남은 두 단계 동안은 배지의 퍼센트가 진행을 말한다.
 */
export const STAGES_SHOWN = 4;

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
export const RUN_ROW_HEIGHT_REM = 3.5;

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
