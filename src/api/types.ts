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
}

export interface Device {
  id: number;
  name: string;
  connected: boolean;
  pcConnected: boolean;
  doorOpen: boolean;
  fault: FaultCode;
  failCamera: boolean;
  temperature: number;
  co2: number;
  targetTemperature: number;
  targetCo2: number;
  z: number;
  light: boolean;
  heater: boolean;
  job: Job | null;
}

export interface Run {
  n: number;
  at: number;
  imageState: ImageState;
  /** 레거시 단일 영상. 6-well 세트로 옮겨간 뒤로는 null. */
  image: string | null;
  /** well-1..9 중 6장. 만료되면 null. */
  images?: string[] | null;
  transferred: boolean;
  error?: string | null;
}

export interface Plate {
  id: string;
  deviceId: number;
  slot: number;
  registeredAt: number;
  removedAt: number | null;
  paused: boolean;
  runs: Run[];
}

export interface Routine {
  cycleHours: number;
  days: number;
  delay: number;
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

export interface AppState {
  revision: number;
  serverTime: number;
  mode: string;
  devices: Device[];
  plates: Plate[];
  routine: Routine;
  autoRun: boolean;
  /** 등록하는 동안 촬영을 붙잡아 둔 상태. 「완료」를 누르면 풀린다. */
  captureHold: boolean;
  session: SessionState;
  logs: LogEntry[];
  io: IoEntry[];
  capabilities: string[];
  storage: string;
}

/** 명령 인자. 명령마다 모양이 달라 서버에서 assert() 로 검증한다. */
export type CommandArgs = Record<string, unknown>;

/** 서버가 거부한 명령. code 는 controller.mjs 의 DeviceError 코드. */
export interface CommandError extends Error {
  code?: string;
}
