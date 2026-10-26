/** 서버(`server/controller.mjs`)의 snapshot() 이 내려주는 상태 모양. */

export type Role = 'analyst' | 'admin';

/** 회차 영상의 보관 상태. */
export type ImageState = 'held' | 'failed' | 'expired';

export type JobStatus = 'running' | 'paused' | 'completed' | 'failed';

export type JobType = 'capture' | 'home' | 'calibrate' | 'reset';

/** 장비가 올릴 수 있는 오류 코드. 정상이면 null. */
export type FaultCode =
  | 'Z_LIMIT'
  | 'HEATER'
  | 'ESTOP'
  | 'DISCONNECTED'
  | 'DOOR_OPEN'
  | 'CAMERA_TIMEOUT'
  | 'ENGINE_OFFLINE'
  | null;

/** 초점 조정 모드(calibrate kind:'focus')의 진행 상태. 실장비 어댑터가 1초마다 갱신한다. */
export interface FocusState {
  stage: 'loading' | 'centring' | 'holding' | 'returning' | 'done' | string;
  frames: number;
  sharpness: number | null;
  best: number | null;
  ratio?: number | null;
  hint?: string | null;
  history?: number[];
  images?: boolean;
  at?: number;
  stopRequested?: boolean;
}

export interface Job {
  id: string;
  type: JobType;
  plateId: string | null;
  slot: number | null;
  requestId: string;
  status: JobStatus;
  step: number;
  progress: number;
  elapsed: number;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  /** 실제 카메라·모터로 도는 작업(스캐너 1). */
  realCamera?: boolean;
  realMotion?: boolean;
  /** 촬영 중 받은 영상(모자이크 PNG 파일명, /api/images/). */
  image?: string | null;
  /** 정렬 보정 작업의 단계. */
  calibrationStage?: 'loading' | 'measuring' | 'returning' | 'done' | string;
  focus?: FocusState;
  plateGrid?: {tier: number; label: string};
  /** 시험 촬영(등록 마법사): 회차로 세지 않는다. */
  trial?: boolean;
  /** Well 당 촬영 장수(1 또는 5). */
  wellShots?: number;
  /** 십자 촬영 중 지금 찍는 위치(C · X+ · Y− · X− · Y+). */
  shot?: string | null;
  /** 바코드 판독 결과(촬영 처리 단계에서 채워진다). */
  barcode?: BarcodeResult | null;
}

/** 십자 촬영의 한 장. shot 'C' 가 Well 레코드 자신이다. */
export interface CaptureShot {
  shot: 'C' | 'X+' | 'Y-' | 'X-' | 'Y+' | string;
  id: string;
  image: string;
  preview: string;
  raw?: string;
  sha256?: string;
  target?: {x: number; y: number} | null;
}

export interface BarcodeHit {
  well: number;
  text: string;
  format: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  source?: 'preview' | 'image' | string;
}

/** 바코드 판독 결과(zxing-cpp). scanned=false 면 판독기가 없거나 실패한 것이다. */
export interface BarcodeResult {
  scanned: boolean;
  decoder: string | null;
  value: string | null;
  values: string[];
  found: BarcodeHit[];
  error?: string | null;
  seconds?: number;
  /** 미리보기에서 못 읽어 원본 판독이 아직 도는 중. */
  pending?: boolean;
  pass?: 'preview' | 'image' | string;
}

/** 회차 간 영상 변화 지표(device/change_score.py). wells: Well 번호 → 0~1. */
export interface ChangeScore {
  wells: Record<string, number>;
  max: number | null;
  maxWell: number | null;
  against?: number;
  at?: number;
}

/** 실장비 어댑터가 스캐너 1에 붙이는 하드웨어 상태. */
export interface DeviceHardware {
  camera: {connected: boolean; device?: string; error?: string | null};
  mcb: {connected: boolean; checkedAt: number | null} | null;
  mode: string;
  alignment: {
    enabled: boolean;
    available: boolean;
    calibrated: boolean;
    calibratedAt: number | null;
    ring: {radius: number; polarity: number} | null;
    rememberedWells: number[];
    umPerPx: number | null;
    wellDiameterMm: number | null;
  } | null;
}

export interface Device {
  id: number;
  name: string;
  connected: boolean;
  pcConnected: boolean;
  doorOpen: boolean;
  fault: FaultCode;
  failCamera: boolean;
  /** 현재 온도(℃). 센서가 없으면 null. */
  temperature: number | null;
  /** 현재 습도(%). 자연 증발식이라 목표값은 없고 범위만 감시한다. 센서가 없으면 null. */
  humidity: number | null;
  targetTemperature: number;
  z: number;
  light: boolean;
  heater: boolean;
  job: Job | null;
  hardware?: DeviceHardware;
}

export interface Run {
  n: number;
  at: number;
  imageState: ImageState;
  /** 레거시 단일 영상. 6-well 세트로 옮겨간 뒤로는 null. */
  image: string | null;
  /**
   * Well 1~6 의 영상. 만료되면 null.
   * 칸이 null 이면 그 Well 만 촬영에 실패한 것이다(부분 실패) — 회차는 held 로 남는다.
   */
  images?: (string | null)[] | null;
  transferred: boolean;
  error?: string | null;
  /** 이 회차를 만든 촬영 명령의 requestId(촬영 화면이 끝난 작업과 짝을 맞출 때). */
  requestId?: string;
  /** 실장비 촬영의 원본 정보(6-well 프레임, 모자이크, 정렬 결과). 가상 장비 회차에는 없다. */
  capture?: CaptureRecord | null;
  /** 직전 회차와의 영상 변화(실장비, 비동기로 채워진다). */
  change?: ChangeScore | null;
}

export interface CaptureWell {
  well: number;
  /** 원본 PNG(카메라 폴더, /api/v1/hardware/files/). */
  image?: string;
  preview?: string;
  raw?: string;
  sha256?: string;
  width?: number;
  height?: number;
  alignment?: {aligned: boolean; residual?: {x: number; y: number}; looks?: number} | null;
  /** 십자 촬영이면 다섯 장(가운데 포함), 아니면 없음. */
  shots?: CaptureShot[];
}

export interface CaptureRecord {
  id: string;
  width: number;
  height: number;
  mosaic?: boolean;
  raw?: string;
  sha256?: string;
  plate?: {tier: number; label: string};
  wells?: CaptureWell[];
  alignment?: {
    enabled: boolean;
    alignedWells?: number[];
    unalignedWells?: number[];
    tolerancePx?: number;
    plateModel?: {wells: number[]; shift: {x: number; y: number}; rotation: number; scale: number} | null;
  };
  totalSeconds?: number;
  acquisitionSeconds?: number;
  wellShots?: number;
  /** 십자 촬영 offset(MCB step · mm). */
  cross?: {x: number; y: number; mm: number; source: string} | null;
  barcode?: BarcodeResult | null;
  trial?: boolean;
}

export type RemoveReason = 'done' | 'positive' | 'contaminated' | 'moved' | 'other';
export type PlateResult = 'positive' | 'negative' | 'contaminated';

export interface Plate {
  id: string;
  deviceId: number;
  slot: number;
  registeredAt: number;
  removedAt: number | null;
  paused: boolean;
  runs: Run[];
  /** PC 판독 결과. positive(조기 양성) · contaminated(오염) 면 반출 알람. */
  result?: PlateResult | null;
  resultAt?: number | null;
  resultNote?: string | null;
  /** 레시피(없으면 공통 루틴). */
  recipeId?: string | null;
  /** 플레이트 바코드 — 등록 시 입력했거나 처음 판독된 값. */
  barcode?: string | null;
  barcodeFormat?: string | null;
  /** 등록 직후 시험 촬영 결과(회차 아님). */
  trial?: Run | null;
  removeReason?: RemoveReason | null;
  removeNote?: string | null;
}

export interface Routine {
  cycleHours: number;
  days: number;
  delay: number;
  /** Well 한 칸을 몇 장 찍는지. 1 = 가운데 한 장, 5 = 가운데 + 상하좌우 십자(실장비 구현, 2026-10-26). */
  wellShots: number;
}

/** 레시피 — 플레이트마다 고를 수 있는 촬영 일정(M3 A7). 기본 레시피는 공통 루틴이다. */
export interface Recipe extends Routine {
  id: string;
  name: string;
  /** 검사 항목 라벨(표시용). */
  label?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface SessionState {
  role: Role;
  /** PIN 잠금 잔여 시간(ms). 0이면 잠겨있지 않음. */
  lockedFor: number;
  /** 관리자 무조작 경과 시간(ms). */
  idleFor: number;
}

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogEntry {
  id: string;
  at: number;
  level: LogLevel;
  message: string;
}

export interface IoEntry {
  id: string;
  at: number;
  direction: 'TX' | 'RX';
  type: string;
  deviceId: number;
  requestId: string;
  payload: unknown;
}

/** 트레이 배치. 슬롯 번호 = (tiers − 단) × columns + 열. 1단이 맨 아래. */
export interface Layout {
  tiers: number;
  columns: number;
  slots: number;
  /** 테스트 지그: 한 단의 열 칸들이 물리적으로 플레이트 한 장이다. 어느 칸을 눌러도 그 단으로 취급. */
  tierShared?: boolean;
  /** 실제로 넣을 수 있는 플레이트 수 — tierShared 면 단 수, 아니면 slots. */
  capacity?: number;
}

/** 배포 프로필(server/profile.mjs). 어느 장비 위에서 도는지와 트레이 배치. */
export interface ProfileInfo {
  name: string;
  title: string;
  adapter: 'real' | 'virtual';
  layout: Layout;
  features: {triggers?: boolean; simAlarm?: boolean; demoPlates?: boolean};
  kiosk?: {scale: number; width: number; height: number};
  recipe?: string;
}

/** 환경 알림 규칙(관리자). 허용 범위를 벗어난 상태가 minutes 이상 이어지면 알람. */
export interface AlarmSettings {
  tempTolerance: number;
  tempMinutes: number;
  humidityMin: number;
  humidityMax: number;
  humidityMinutes: number;
  /** 회차 간 영상 변화 지표(0~1)가 이 값을 넘으면 「이전 영상과 차이 큼」 알람. */
  changeThreshold: number;
}

/** 사용자 설정(state.json). alignment = 웰 중심 자동 정렬 촬영. */
export interface UserSettings {
  alignment: boolean;
  alarms: AlarmSettings;
  /** 「종료 예정」으로 세는 남은 시간(시간). */
  endSoonHours: number;
  /** 촬영마다 바코드를 판독하고 미인식이면 알람. */
  barcode: boolean;
  /** 플레이트가 하나도 없는 상태가 이어지면 대기 모드로(분, 0 = 끔). */
  idleMinutes: number;
  /** PC 전송 서버. API 키는 내려오지 않고 있는지만(hasKey). */
  server: {host: string; port: number; hasKey: boolean};
}

export type AlarmKind = 'device' | 'env' | 'plate' | 'done';

/** 서버가 만들고 이력을 남기는 알람. clearedAt 이 없으면 지금 걸려 있는 일이다. */
export interface Alarm {
  id: string;
  key: string;
  kind: AlarmKind;
  level: 'high' | 'normal';
  /** 반출 대기의 사유 — 기간 만료 / 조기 양성(1차 피드백 1.1) / 오염 판정(PC). */
  reason?: 'expired' | 'positive' | 'contaminated';
  where: string;
  what: string;
  plateId?: string;
  deviceId?: number;
  at: number;
  ackAt: number | null;
  clearedAt: number | null;
}

/** 온도·습도 추이의 한 점(5분 간격). */
export interface EnvSample {
  at: number;
  t: number | null;
  h: number | null;
}

export interface NetworkLink {
  name: string;
  address: string;
  kind: 'wired' | 'wifi' | 'other';
  /** 무선이면 접속 중인 SSID(nmcli). */
  ssid?: string;
}

/** PC 전송 서버 연결 점검 결과(TCP). */
export interface ServerLink {
  at: number;
  ok: boolean;
  ms: number | null;
  error: string | null;
  host?: string;
  port?: number;
}

export interface FirmwareCheck {
  checkedAt: number | null;
  ok: boolean | null;
  mismatches: {motor: number; key: string; expected: number; actual: number | null}[];
}

export interface HardwareInfo {
  camera: {connected: boolean; device?: string; error?: string | null} | null;
  mcb: {enabled: boolean; connected?: boolean; checkedAt?: number | null; error?: string | null; port?: string};
}

export interface AppState {
  revision: number;
  serverTime: number;
  mode: string;
  profile: ProfileInfo;
  devices: Device[];
  plates: Plate[];
  routine: Routine;
  recipes: Recipe[];
  autoRun: boolean;
  settings: UserSettings;
  /** 대기 모드(플레이트 없음) 진입 시각. 아니면 null. */
  idle: {since: number} | null;
  serverLink: ServerLink | null;
  alarms: Alarm[];
  envHistory: EnvSample[];
  /** 등록하는 동안 촬영을 붙잡아 둔 상태. 「완료」를 누르면 풀린다. */
  captureHold: boolean;
  /** 관리 툴이 장비를 잡고 있는 동안. 장비를 움직이는 명령은 거부된다. */
  maintenance: {since: number; by: string} | null;
  /** 스캐너 1의 USB 카메라가 촬영 중(단일 점검 촬영 포함). */
  cameraBusy: boolean;
  session: SessionState;
  logs: LogEntry[];
  io: IoEntry[];
  capabilities: string[];
  storage: string;
  network?: NetworkLink[];
  firmwareCheck?: FirmwareCheck;
  hardware?: HardwareInfo;
}

/** 명령 인자. 명령마다 모양이 달라 서버에서 assert() 로 검증한다. */
export type CommandArgs = Record<string, unknown>;

/** 서버가 거부한 명령. code 는 controller.mjs 의 DeviceError 코드. */
export interface CommandError extends Error {
  code?: string;
}
