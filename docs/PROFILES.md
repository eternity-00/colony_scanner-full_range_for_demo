# 배포 프로필 (testbed · production · virtual)

앱은 `COLONY_PROFILE=<이름>` 하나로 `profiles/<이름>.json` 을 읽어 어느 장비 위에서 도는지 정한다 (`server/profile.mjs`).
코드에 장비 값을 두지 않는다 — 스캐너 수, 트레이 배치, 레시피 파일, 카메라 장치, 포트, 키오스크 배율, 시험 기능이 모두 프로필에 있다.

| 키 | 뜻 | testbed | production(초안) | virtual |
|---|---|---|---|---|
| `adapter` | `real` = 스캐너 1 이 USB 카메라 + UART MCB, 가상 엔진·콘솔은 **뜨지 않음**(2차 피드백 #2) · `virtual` = 가상 엔진만 | real | real | virtual |
| `layout.tiers` × `layout.columns` | 트레이 배치. 슬롯 = (tiers − 단) × columns + 열, 1단이 맨 아래 | 8 × 1 (단당 플레이트 1매) | 8 × 3 | 8 × 3 |
| `recipe` | 공정 레시피 파일(`config/mcb-config.*.json`). `tiers` 는 layout 과 같아야 한다 | mcb-config.testbed.json | mcb-config.production.json | testbed 파일 |
| `dataDir` | state.json · 촬영 영상 · 정렬 보정값 · 파라미터 백업 | data/testbed | data/production | data/virtual |
| `camera.device` | V4L 장치 경로 (`COLONY_CAMERA_DEVICE` 로 재정의) | HD USB Camera by-id | 미정 | — |
| `mcb.port` / `mcb.expected` | UART 포트, 기동 시 `GET ALL` 과 비교할 기대값(RANGE·USTEP). 다르면 로그·상태에 경고만 | /dev/serial0, M1~M4 | 미정 | — |
| `alignment.enabled` | 첫 기동 때의 「웰 중심 자동 정렬」 기본값(이후는 state.json 의 사용자 설정) | true | true | — |
| `autoRun` | 첫 기동 때의 자동 촬영 기본값 | false | true | true |
| `features.triggers` / `simAlarm` | 알람 시험 페이지(/trigger.html)와 `sim.alarm` 명령 허용 | 켬 | 끔 | 켬 |
| `features.demoPlates` | 빈 데이터로 시작할 때 모든 슬롯에 DEMO 플레이트를 채움(테스트용) | 끔 | 끔 | 끔 |
| `network` | LCD 서버 host/port, 가상 엔진·콘솔 포트, 관리 툴 포트 | 0.0.0.0:8787 / 8790 / 8792 / 8799 | 127.0.0.1:8787 … | 127.0.0.1 |
| `kiosk` | 크로뮴 키오스크 배율·창 크기 | 1.0, 1200×800 | 1.0, 1024×600 | — |
| `limits.captureZMax` | 레시피 저장 때 막는 촬영 높이 상한(트레이 아래 간섭 확인 전) | 1000 | 1000 | — |

환경변수 재정의: `COLONY_CAMERA_DEVICE`, `COLONY_MCB_PORT`, `COLONY_DATA_DIR`, `COLONY_RECIPE`, `PORT`, `HOST`, `COLONY_TRIGGERS=1`, `COLONY_CAMERA_ENABLED=0`(가상으로 강제), `COLONY_MCB_ENABLED=0`(모터 없이).

## 프로필 전환

```sh
# systemd 유닛의 환경변수를 바꾸고 재시작한다
systemctl --user edit colony.service      # [Service] Environment=COLONY_PROFILE=production
systemctl --user restart colony.service
```

프로필마다 `dataDir` 가 다르므로 촬영 기록과 정렬 보정값이 섞이지 않는다. 테스트베드 기존 데이터(`data/`)는 `data/testbed/` 로 옮겨 쓴다.

## 세 층의 설정

| 층 | 무엇 | 어디 | 바꾸는 곳 |
|---|---|---|---|
| 펌웨어 파라미터 | 작동 범위 RANGE, 원점 HDIR/HPARK, 속도·가속도, USTEP, SMOOTH | MCB 플래시 (`GET ALL` / `SET` / `SAVE`) | 관리 툴 > 펌웨어 파라미터 |
| 공정 레시피 | 단 수, 웰 배치, trayOut, captureZ, 웰 안지름, 정렬 중 축 속도 | `config/mcb-config.<profile>.json` | 관리 툴 > 레시피 |
| 정렬 보정값 | px/step 행렬, 백래시, 기준 링, 기억된 웰 위치 | `<dataDir>/camera-alignment.json` | 운영 화면 설정 > 카메라 정렬 · 초점, 관리 툴 > 카메라 · 정렬 |

## 환경값(온도 · 습도)

- CO₂ 는 뺐다(2026-10-23 결정). 장비 모델은 `temperature`, `humidity`, `targetTemperature` 를 가진다. 습도는 자연 증발식이라 목표값이 없고 범위만 감시한다.
- 실장비 프로필에는 아직 센서가 없어 두 값이 `null`(화면: 「측정 없음」)이다. 센서가 붙으면 `server/local-device.mjs` 의 `sensor` 콜백으로 읽는다.
- 이상 알람 규칙(허용 편차 · 지속 시간 · 습도 범위)은 `state.settings.alarms`(관리자 `alarmSettings` 명령). 추이는 5분 간격으로 7일 보관(`envHistory`).
