# Colony Scanner React UI 및 가상장비 전체 명세서

| 항목 | 내용 |
|---|---|
| 문서 ID | CC-REACT-VDEV-SPEC-260914 |
| 버전 | 1.0 |
| 작성일 | 2026-09-14 |
| 대상 | Colony Scanner 인큐베이터 LCD UI 데모 및 가상장비 서버 |
| 기준 문서 | CC_LCD_UI_Spec_v1.1_260911 |
| 구현 위치 | `/home/miru/cc-lcd/react-demo` |
| 실행 URL | `http://127.0.0.1:8787` |
| 상태 | 가상장비 통합 데모 구현 및 자동 검사 완료 |

## 1. 문서 목적

본 문서는 Colony Scanner LCD의 React 사용자 인터페이스, 가상 스캐너, 명령 API, 실시간 상태 통신, 데이터 보존 및 실장비 연동 경계를 정의한다. 개발자, 장비 제어 담당자, 시험 담당자와 현장 운영자가 동일한 상태 및 명령 의미를 사용하도록 하는 것이 목적이다.

이 시스템은 실제 콜로니 판독을 수행하지 않는다. LCD는 플레이트 위치 관리, 촬영 명령, 장비 상태 확인, 촬영 영상 임시 보존 및 PC 전송 상태까지 담당한다. 콜로니 수, 성장 곡선, 판독 결과, 리포트는 PC 판독 소프트웨어의 책임이다.

## 2. 범위

### 2.1 포함 범위

- React 기반 1200×800 LCD 사용자 인터페이스
- 스캐너 4대, 각 8단×3열, 총 96슬롯
- 플레이트 등록·일정 정지·촬영·재전송·반출
- 가상 스캐너의 센서 입력과 액추에이터 출력
- 촬영 6단계 진행 및 합성 6-well 영상 생성
- HTTP 명령 API와 Server-Sent Events 실시간 상태
- 명령 ACK/NACK 및 I/O 패킷 모니터
- 플레이트당 최근 성공 영상 5장 보존
- 서버 재시작 후 등록·촬영·반출·설정 복구
- 자동 촬영 스케줄러
- 서버 및 브라우저 자동 검사

### 2.2 제외 범위

- 실제 카메라, 모터, 히터, 조명, PLC 제어
- 실제 JPEG 촬영과 EXIF 생성
- 실제 PC 판독 소프트웨어로의 파일 전송
- 콜로니 판독·분석·리포트
- 네트워크 다중 사용자 인증과 TLS
- 실장비 하드웨어 비상정지 및 안전 인증
- 관리자 PIN 및 권한 모델의 React 버전 적용
- CSV/JSON UI 내보내기와 백업 가져오기
- 제조사 SDK, Modbus TCP, 시리얼 프로토콜 구현

## 3. 구현 기술과 실행 환경

| 계층 | 기술 | 버전/방식 |
|---|---|---|
| UI | React | 19.3.0 |
| UI 빌드 | Vite | 8.3.0 |
| 런타임 | Node.js | 20.19.2에서 검증 |
| 실시간 상태 | Server-Sent Events | `GET /api/events` |
| 명령 | HTTP JSON | `POST /api/commands` |
| 영속 저장 | JSON + SVG 파일 | `data/state.json`, `data/images/` |
| 브라우저 시험 | Chromium + Playwright | 1200×800 |

프로덕션 모드는 Node.js 서버 하나가 빌드된 React 정적 파일, API, SSE와 합성 영상을 함께 제공한다. 개발 모드는 Vite 5173 포트가 UI를 제공하고 `/api`를 8787 포트로 프록시한다.

## 4. 시스템 구성

```text
운영자
  │ 터치/클릭
  ▼
React LCD UI
  ├─ POST /api/commands ───────────► Controller
  ├─ GET  /api/events ◄──────────── Controller 상태 스냅샷
  └─ GET  /api/images/{name}.svg ◄─ 영상 저장소
                                        │
                                        ▼
                             VirtualDeviceAdapter
                              ├─ 가상 센서 입력
                              ├─ 가상 액추에이터 출력
                              ├─ 작업 상태 머신
                              └─ 장비 이벤트
                                        │
                                        ▼
                           state.json + images/*.svg
```

### 4.1 주요 파일

| 경로 | 책임 |
|---|---|
| `src/App.jsx` | 화면, 공용 트레이, 명령 실행, 모달, 상태 표시 |
| `src/api.js` | 상태 조회, 명령 요청, SSE 구독 |
| `src/styles.css` | 1200×800 산업용 LCD 스타일 |
| `server/index.mjs` | HTTP/SSE/정적 파일/영상 서버 |
| `server/controller.mjs` | 도메인 검증, 저장, 보존, 스케줄러, I/O 기록 |
| `server/virtual-device.mjs` | 가상 스캐너와 촬영 상태 머신 |
| `test/server.test.mjs` | 컨트롤러·가상장비 회귀 검사 |
| `test/ui.mjs` | React UI 통합 검사 |

## 5. 사용자 인터페이스 명세

### 5.1 전역 골격

- 헤더 높이: 64px
- 본문: 남은 높이를 사용하며 내용 초과 시 내부 스크롤
- 하단 탭: 76px
- 최소 가로 폭: 1200px
- 기본 색상: 헤더 `#131F4D`, 주 액션 `#2A4BC7`, 페이지 `#EEF1F7`
- 상태 색상: 정상 녹색, 대기 파랑, 경고 주황, 오류 빨강, 연결 끊김 빨강
- 모달은 배경을 차단하고 Esc로 닫을 수 있다.

### 5.2 화면 목록

| 화면 | 기능 | 주요 명령 |
|---|---|---|
| 현황 | 스캐너 4대, 점유율, 미전송, 장비 상태, 진행률 | 화면 이동 |
| 상세 | 트레이 좌표 선택, 플레이트 메타데이터와 촬영 이력 | capture, platePause, retry, remove |
| 등록 | 등록 가능 장비·빈 슬롯·투입 시각 선택 | register |
| 진행 | 작업 단계, 진행률, Z축·조명·히터 출력 | pause, resume, stop |
| 이력 | ID·위치 검색, 수납·반출 이력 | 상세/영상 열기 |
| 장비 | 환경값, 링크, 도어, 축, 오류와 로그 | home, calibrate, reset, clearError |
| 가상장비 | 연결·PC 링크·도어·카메라 실패·오류 입력 | sim.input, clearError |
| 설정 | 공통 루틴, 자동 스케줄러, 가상 환경 목표값 | routine, autoRun, environment |

### 5.3 트레이 좌표

슬롯 번호는 상단 8단부터 하단 1단 방향으로 증가한다.

| 단 | 1열 | 2열 | 3열 |
|---|---:|---:|---:|
| 8단 | 1 | 2 | 3 |
| 7단 | 4 | 5 | 6 |
| 6단 | 7 | 8 | 9 |
| 5단 | 10 | 11 | 12 |
| 4단 | 13 | 14 | 15 |
| 3단 | 16 | 17 | 18 |
| 2단 | 19 | 20 | 21 |
| 1단 | 22 | 23 | 24 |

현황의 미니 트레이는 읽기 전용이다. 상세 트레이는 슬롯 선택용이며, 등록 트레이에서는 수납된 셀을 선택할 수 없다.

## 6. 도메인 데이터 모델

### 6.1 서버 상태 스냅샷

| 필드 | 형식 | 의미 |
|---|---|---|
| `revision` | number | 서버 실행 중 상태 변경 번호 |
| `serverTime` | Unix ms | 서버 시각 |
| `mode` | `virtual` | 현재 어댑터 모드 |
| `devices` | Device[4] | 스캐너 상태 |
| `plates` | Plate[] | 수납 및 반출 플레이트 |
| `routine` | Routine | 공통 검사 루틴 |
| `autoRun` | boolean | 자동 촬영 스케줄러 활성 상태 |
| `logs` | Log[] | 최근 이벤트 최대 100개 전송 |
| `io` | IoRecord[] | 최근 I/O 최대 150개 |
| `capabilities` | string[] | 장비 지원 명령 |
| `storage` | `server-json` | 서버 저장 방식 |

### 6.2 Device

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | 1..4 | 스캐너 번호 |
| `name` | string | `SCANNER N` |
| `connected` | boolean | 장비 통신 연결 입력 |
| `pcConnected` | boolean | PC 전송 링크 입력 |
| `doorOpen` | boolean | 도어 센서 입력, true이면 인터록 |
| `fault` | string/null | 오류 코드 |
| `failCamera` | boolean | 촬영 단계 실패 입력 |
| `temperature` | number | 가상 현재 온도 |
| `co2` | number | 가상 현재 CO₂ |
| `targetTemperature` | number | 환경 목표 온도 |
| `targetCo2` | number | 환경 목표 CO₂ |
| `z` | number | 가상 Z축 위치 mm |
| `light` | boolean | 조명 출력 |
| `heater` | boolean | 히터 접촉 출력 |
| `job` | Job/null | 현재 또는 최근 작업 |

### 6.3 Plate

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | string | 서버 생성 `PL-XXXXXXXX` |
| `deviceId` | 1..4 | 수납 스캐너 |
| `slot` | 1..24 | 트레이 슬롯 |
| `registeredAt` | Unix ms | 투입 시각 |
| `removedAt` | Unix ms/null | 반출 시각 |
| `paused` | boolean | 자동 촬영 일정 정지 |
| `runs` | Run[] | 촬영 회차, 반출 후에도 유지 |

### 6.4 Run

| 필드 | 형식 | 설명 |
|---|---|---|
| `n` | number | 플레이트 촬영 회차 |
| `at` | Unix ms | 촬영 완료 또는 실패 시각 |
| `imageState` | held/expired/failed | 영상 상태 |
| `image` | filename/null | 보유 합성 영상 이름 |
| `transferred` | boolean | PC 전송 상태 |
| `error` | string/null | 실패 원인 |

### 6.5 Job

| 필드 | 형식 | 설명 |
|---|---|---|
| `id` | UUID | 장비 작업 ID |
| `type` | capture/home/calibrate/reset | 작업 유형 |
| `plateId`, `slot` | string/null, number/null | 촬영 대상 |
| `requestId` | string | 명령 요청 ID |
| `status` | running/paused/completed/failed | 작업 상태 |
| `step` | number | 현재 단계, 0부터 시작 |
| `progress` | 0..100 | 진행률 |
| `startedAt`, `finishedAt` | Unix ms/null | 작업 시각 |
| `error` | string/null | 실패 설명 |

## 7. 가상장비 I/O 명세

### 7.1 가상 입력

| 입력 | 형식 | 정상값 | 효과 |
|---|---|---|---|
| 장비 연결 | boolean | true | false 전환 시 진행 작업 실패, 명령 거부 |
| PC 전송 링크 | boolean | true | false 상태 촬영 성공 시 `transferred=false` |
| 도어 센서 | boolean | false | true 전환 시 진행 작업 실패와 `DOOR_OPEN` 오류 |
| 카메라 실패 | boolean | false | 촬영 단계에서 `CAMERA_TIMEOUT` 발생 |
| 오류 주입 | Z_LIMIT/HEATER | null | 장비 오류 발생, 새 작업 거부 |
| 목표 온도 | 4..55 ℃ | 37 | 현재값이 목표값으로 점진 수렴 |
| 목표 CO₂ | 0..20 % | 5 | 현재값이 목표값으로 점진 수렴 |

### 7.2 가상 출력

| 출력 | 형식 | 동작 |
|---|---|---|
| Z축 위치 | number mm | 촬영 이송 중 증가, 종료 시 0 복귀 |
| 조명 | boolean | 촬영 단계에서 ON |
| 히터 | boolean | 물기 제거 단계에서 ON |
| 작업 단계 | number | 단계 진행에 따라 변경 |
| 진행률 | 0..100 | 작업 경과에 따라 변경 |
| 합성 영상 | SVG | 성공 촬영 후 생성 |
| 이벤트 | JSON | 시작·단계·정지·완료·실패 알림 |

### 7.3 촬영 상태 머신

```text
대기
 └─ capture → running/이송
                ├─ pause → paused ─ resume → running
                ├─ 연결 끊김/도어/카메라 실패/stop → failed + fault
                └─ 이송 → 물기 제거 → 촬영 → 수납 복귀 → 전송 → PC 저장
                                                               └─ completed
```

기본 단계 시간은 1.6초이며 `STAGE_MS` 환경변수로 변경할 수 있다. capture는 6단계, home·calibrate·reset은 3단계다.

## 8. HTTP 및 실시간 API

### 8.1 공통 규칙

- 기본 주소: `http://127.0.0.1:8787`
- JSON 인코딩: UTF-8
- 명령 요청 본문 최대 크기: 1MB
- 성공 명령: HTTP 202
- 검증 실패: HTTP 400, 404 또는 409
- 서버 내부 오류: HTTP 500, 내부 상세 정보는 응답에서 숨긴다.
- 명령 `requestId`는 8~100자의 영문·숫자·밑줄·하이픈이다.
- 같은 `requestId`와 동일한 명령은 기존 결과를 `replayed=true`로 반환한다.
- 같은 `requestId`를 다른 내용에 사용하면 `REQUEST_ID_REUSED`를 반환한다.

### 8.2 엔드포인트

| 메서드 | 경로 | 응답 |
|---|---|---|
| GET | `/api/health` | 서버 상태와 virtual 모드 |
| GET | `/api/state` | 전체 상태 스냅샷 |
| GET | `/api/events` | SSE `state` 이벤트 |
| POST | `/api/commands` | 명령 ACK 또는 NACK |
| GET | `/api/images/{uuid}.svg` | 보유 합성 영상 |

### 8.3 명령 공통 형식

```json
{
  "requestId": "8자_이상의_고유_ID",
  "command": "capture",
  "deviceId": 3,
  "args": {
    "plateId": "PL-1234ABCD"
  }
}
```

성공 예:

```json
{
  "requestId": "8자_이상의_고유_ID",
  "accepted": true,
  "command": "capture",
  "deviceId": 3
}
```

실패 예:

```json
{
  "code": "DEVICE_BUSY",
  "message": "스캐너가 작업 중입니다."
}
```

### 8.4 명령 목록

| command | deviceId | args | 전제·결과 |
|---|---:|---|---|
| register | 1..4 | slot, registeredAt | 빈 슬롯·정상 장비에 등록 |
| capture | 1..4 | plateId | 플레이트와 장비 일치, 촬영 시작 |
| platePause | 1..4 | plateId, paused | 자동 촬영 일정 정지/재개 |
| retry | 1..4 | plateId | 연결 및 PC 링크 필요, 보유 영상만 전송 |
| remove | 1..4 | plateId | 진행 작업 없음, 영상 삭제·이력 유지 |
| pause | 1..4 | 없음 | running 작업 정지 |
| resume | 1..4 | 없음 | paused 작업, 정상 인터록 필요 |
| stop | 1..4 | 없음 | 진행 작업 실패, ESTOP 오류 설정 |
| home | 1..4 | 없음 | 3단계 원점 복귀 작업 |
| calibrate | 1..4 | 없음 | 3단계 캘리브레이션 작업 |
| reset | 1..4 | 없음 | 3단계 초기화 작업 |
| clearError | 1..4 | 없음 | 도어 닫힘 필요, 오류 제거 |
| sim.input | 1..4 | 가상 입력 한 개 이상 | 입력 및 인터록 적용 |
| routine | 0 | cycleHours, days, delay | 공통 루틴 저장 |
| autoRun | 0 | enabled | 자동 스케줄러 설정 |
| environment | 0 | temperature, co2 | 모든 장비 목표값 변경 |

### 8.5 오류 코드

| 코드 | 조건 |
|---|---|
| BAD_JSON | 요청 JSON 파싱 실패 |
| TOO_LARGE | 요청 본문 1MB 초과 |
| INVALID_REQUEST_ID | requestId 형식 오류 |
| REQUEST_ID_REUSED | 동일 ID를 다른 명령에 사용 |
| INVALID_DEVICE | 장비 번호 범위 오류 |
| INVALID_ARGS | args가 객체가 아님 |
| INVALID_SLOT | 슬롯 범위 오류 |
| INVALID_TIME | 투입 시각 오류 또는 미래 시각 |
| SLOT_OCCUPIED | 같은 장비·슬롯에 수납 중 플레이트 존재 |
| PLATE_NOT_FOUND | 수납 중인 대상 플레이트 없음 |
| DEVICE_MISMATCH | 플레이트와 장비 불일치 |
| DEVICE_BUSY | running/paused 작업 존재 |
| DEVICE_OFFLINE | 장비 연결 끊김 |
| DEVICE_FAULT | 오류 상태 |
| DOOR_OPEN | 도어 열림 |
| INTERLOCK | 재개 전 도어·오류 해제 필요 |
| PC_OFFLINE | 재전송 연결 조건 미충족 |
| NO_JOB | 정지·재개할 작업 없음 |
| INVALID_ROUTINE | 루틴 입력 범위 오류 |
| INVALID_ENV | 환경 목표값 범위 오류 |
| INVALID_INPUT | 가상 입력 키 오류 |
| INVALID_FAULT | 지원하지 않는 오류 주입 값 |

## 9. 영상 보존 정책

1. 성공 촬영은 SVG 합성 영상 파일과 Run 메타데이터를 생성한다.
2. 동일 플레이트에서 성공 영상이 5장을 초과하면 가장 오래된 성공 영상부터 파일을 삭제한다.
3. 삭제된 Run은 `imageState=expired`, `image=null`로 전이한다.
4. 실패 회차는 `imageState=failed`이며 성공 영상 5장 계산에서 제외한다.
5. 플레이트 반출 시 보유 영상을 모두 삭제하고 Run 메타데이터는 유지한다.
6. PC 전송 여부와 파일 보존은 별개다. PC 링크 단절 시 영상은 보유되며 미전송으로 표시한다.
7. 재전송은 `held` 상태의 미전송 영상만 대상으로 한다. 만료 파일은 복구하지 않는다.
8. 미전송 Run이 2건 이상이면 WARN 로그를 남긴다.

실장비 적용 시 합성 SVG를 카메라 JPEG 경로로 교체해야 하며 저장 장치 용량은 원본 명세의 보수적 상한 약 15GB를 기준으로 잡는다.

## 10. 영속 저장과 복구

- 상태 파일: `data/state.json`
- 영상 디렉터리: `data/images/`
- 저장 방식: 임시 파일 작성 후 rename으로 교체
- 저장 시점: 명령 처리, 장비 이벤트, 서버 종료
- 상태 파일 버전: 1
- 로그 최대: 1,000건 저장, API에는 최근 100건 전송
- I/O 최대: 150건
- 명령 영수증 최대: 300건

서버 시작 시 진행 중이던 촬영은 재개하지 않는다. 해당 촬영은 실패로 기록하고 장비 작업은 대기 상태로 초기화한다. 등록·기존 Run·반출·루틴·가상 입력은 복구한다.

## 11. 자동 촬영 스케줄러

다음 촬영 예정 시각은 다음과 같다.

```text
registeredAt + (성립된 Run 수 + 1) × cycleHours + delay
```

스케줄러는 `autoRun=true`일 때 주기적으로 다음 조건을 확인한다.

- 장비 연결
- 도어 닫힘
- fault 없음
- 장비 작업 없음
- 플레이트 수납 중
- 플레이트 일정 정지 아님
- 최대 회차 `floor(days×24/cycleHours)` 미만
- 다음 촬영 예정 시각 도달

조건을 만족하는 각 장비의 첫 번째 플레이트에 capture 명령을 실행한다. 한 장비는 동시에 하나의 작업만 수행한다.

## 12. 실장비 어댑터 계약

현재 Controller는 `VirtualDeviceAdapter`를 사용한다. 실장비 어댑터는 다음 계약을 구현해야 한다.

```js
class RealDeviceAdapter extends EventEmitter {
  snapshot()              // Device[4] 반환
  get(deviceId)           // 장비 확인 또는 DeviceError
  command(id,type,args,requestId) // 명령 접수/거부
  on('event', handler)    // 상태 및 작업 이벤트
  close()                 // 통신 자원 해제
}
```

필수 이벤트는 `job.started`, `job.stage`, `job.paused`, `job.running`, `job.completed`, `job.failed`, `device.recovered`다. 실장비 이벤트에는 `deviceId`, `at`, `requestId`가 포함되어야 한다. capture 완료 이벤트에는 Controller가 Run을 생성할 수 있도록 job과 전송 결과를 포함해야 한다.

실장비 어댑터 구현 전 확정할 항목:

- 전송 매체와 프레임 규격
- 장비별 주소 및 타임아웃
- 명령 수락과 완료의 구분
- 재접속·재시도 정책
- PLC 인터록 및 비상정지 우선순위
- 카메라 파일의 원자적 완료 판단
- PC 전송 ACK 정의
- 펌웨어와 UI 상태 코드 매핑

## 13. 안전 및 보안

현재 서버는 `127.0.0.1`에만 바인딩하므로 기본적으로 같은 장비에서만 접속할 수 있다. 실제 네트워크 배포 전에 다음 항목이 필요하다.

- 사용자/역할 인증과 세션 만료
- 관리자 전용 위험 명령 정책
- HTTPS 및 장비 인증서
- 요청 출처 검증과 CSRF 방어
- 명령별 감사 로그와 작업자 ID
- 설정·데이터 백업 및 복구 절차
- 파일 무결성, 저장장치 장애 감지
- 하드웨어 비상정지와 소프트웨어 stop 분리
- 모터 리밋, 도어, 온도 안전회로를 PLC/컨트롤러에서 강제

UI 버튼 비활성화는 안전장치가 아니다. 실장비의 위험 동작은 장비 제어 계층에서 다시 검증해야 한다.

## 14. 요구사항 추적표

| 요구사항 | 현재 상태 | 비고 |
|---|---|---|
| React UI | 구현 | React 19.3.0 |
| 4대×24슬롯 | 구현 | 공용 Tray 컴포넌트 |
| 현황·상세·등록·진행·이력·장비·설정 | 구현 | 가상장비 화면 추가 |
| 등록·촬영·반출 | 구현 | 서버 명령과 영속 상태 |
| 최근 영상 5장 | 구현 | 성공 영상 기준 |
| 미전송 2건 경고 | 구현 | 로그와 UI 지표 |
| 실시간 장비 상태 | 구현 | SSE |
| 입력·출력 모니터 | 구현 | TX/RX I/O 기록 |
| 자동 촬영 | 구현 | 가상 스케줄러 |
| 권한 전환/PIN | 미구현 | 원본 명세의 후속 작업 |
| CSV/JSON UI 내보내기 | 미구현 | 서버 데이터 직접 백업 가능 |
| 8인치 밀도 프리셋 | 부분 구현 | 1200×800 레이아웃 검증, 별도 전환 없음 |
| 실제 JPEG와 PC 전송 | 미구현 | 합성 SVG와 boolean 링크 사용 |
| 실장비 연결 | 연동 경계 구현 | 프로토콜·SDK 필요 |
| 하드웨어 안전 인증 | 미구현 | 실장비 단계 필수 |

## 15. 시험 및 합격 기준

### 15.1 자동 검사

`npm run check`가 다음 순서로 실행된다.

1. 서버 단위/통합 검사
2. React 프로덕션 빌드
3. Chromium UI 통합 검사

검증 항목:

- 가상 스캐너 4대 상태
- 기본 플레이트 데이터
- 등록 및 슬롯 충돌 차단
- 동일 요청 replay와 다른 요청 ID 재사용 차단
- 촬영, busy 거부, pause/resume
- 합성 영상 파일 생성
- 6회 이상 성공 촬영 시 보유 영상 5장
- PC 링크 단절, 재전송 거부와 복구
- 도어 인터록
- 카메라 실패
- 반출 후 영상 삭제·이력 유지
- I/O TX, ACK, NACK
- JSON 저장 무결성
- 서버 재시작 복구
- React SSE 연결
- 오류 주입·해제
- UI 등록·촬영과 I/O 모니터

### 15.2 현장 합격 전 추가 검사

- 10.1인치와 8인치 실물 패널 터치 타깃
- 니트릴 장갑 입력
- 1~50일 연속 표시 및 메모리 누수
- 네트워크 단절과 장시간 재접속
- 전원 차단 중 데이터 무결성
- 저장 공간 부족
- 실제 이미지 최대 크기와 전송 시간
- 모든 기계 인터록과 비상정지
- 실제 작업자 권한과 감사 로그

## 16. 실행·빌드·정지

```sh
cd /home/miru/cc-lcd/react-demo

# 빌드 후 서버 실행
./run-demo.sh

# 개발 모드
npm run dev

# 전체 검사
npm run check

# 백그라운드 데모 종료
./stop-demo.sh
```

데스크톱의 `Colony Scanner React Demo` 아이콘은 서버가 없으면 빌드와 서버 시작을 수행한 뒤 Chromium 앱 창을 연다.

## 17. 알려진 제한과 다음 단계

1. 실제 통신 사양이 없으므로 실장비 어댑터는 구현할 수 없다.
2. 가상 온도와 CO₂는 단순 수렴 모델이며 물리 시뮬레이션이 아니다.
3. 합성 SVG는 UI·보존 흐름 검증용이며 화질·압축률 시험에 사용할 수 없다.
4. 자동 스케줄러는 단일 프로세스용이며 다중 서버 락을 제공하지 않는다.
5. 상태 파일이 손상되면 자동 복구하지 않는다. 운영 버전은 DB, 백업, 마이그레이션이 필요하다.
6. 현재 권한 인증이 없으므로 신뢰할 수 없는 네트워크에 공개하면 안 된다.
7. 실장비 연결 전 어댑터 계약을 장비 제어 담당자와 확정하고, 하드웨어 인터록 시험을 선행한다.

## 18. 변경 이력

| 버전 | 일자 | 변경 |
|---|---|---|
| 1.0 | 2026-09-14 | React UI, 가상장비, API, SSE, 영상 보존, I/O 모니터와 시험 명세 최초 작성 |
