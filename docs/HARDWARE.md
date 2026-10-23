# 실제 장비 동작 (스캐너 1, 데모 지그)

스캐너 1은 실제 카메라와 MCB 모터로 동작합니다. 스캐너 2~4는 가상 장비(`simulator-app`)입니다.

```
Pi 4 (이 앱) ── 로컬 UART ──> MCB (STM32) ── 모터 / 센서
            └── USB 카메라 (HQ 카메라, UVC)
```
- MCB 펌웨어: [colony_scanner_MCD_firmware_for_STM32F427ZIT6](https://github.com/eternity-00/colony_scanner_MCD_firmware_for_STM32F427ZIT6)

## 구성 요소
| 파일 | 역할 |
|---|---|
| `server/real-camera-adapter.mjs` | 스캐너 1의 6단계 진행 중 이송·촬영·복귀를 실제 모터와 카메라로 실행 |
| `server/mcb-motion.mjs` | 촬영 순서(레시피)를 MCB 명령으로 바꾸고, 로컬 에이전트(`mcb`, `purge`)를 호출 |
| `server/mcb-config.json` | **레시피**: 축 역할, 단 수, 웰 배치, 트레이 꺼냄 위치, 촬영 높이 |
| `server/camera-service.mjs` | `device/capture-local.py`로 한 장 로컬 촬영 → PNG / 미리보기 변환 |
| `server/controller.mjs` | 촬영 기록과 보관 (플레이트별 최근 5회) |
| `device/` | 로컬 촬영(`capture-local.py`), 카메라·장비 인터페이스(`local_agent.py`), UART 제어(`mcb.py`) |

## 레시피와 펌웨어 파라미터
- **레시피(`mcb-config.json`):** 무엇을 어떤 순서로 할지 정합니다.
  - 축 역할(`axes`): 카메라 X = M1, 트레이 X = M2, 카메라 Y = M3, 트레이 Z = M4
  - `tiers` 8, `wellColumns` 3, `wellRows` 2
  - `trayOut` 450 (트레이 꺼냄 위치), `captureZ` 720 (촬영 높이)
- **펌웨어 파라미터:** 기계가 어떻게 움직이는지 정합니다 (작동 범위, 원점, 속도, 가속도, 공진 회피 구간). MCB 플래시에 있고, 앱은 **작업마다 시작 전에 읽어 옵니다**(`PARAMS` = `GET ALL`).
  - 이것이 **연결 확인**도 겸합니다. MCB가 응답하지 않으면 작업을 시작하지 않고 `MCB_OFFLINE`("모터 보드 연결 확인 실패")을 돌려줍니다.
  - 앱이 시작할 때도 한 번 확인하고 로그에 `{"mcb":"connected"}` 또는 `{"mcb":"offline"}`을 남깁니다.

위치 계산 (각 구간의 가운데, 펌웨어 `RANGE` 기준):

| 항목 | 계산 | 현재 값 |
|---|---|---|
| 단 n의 Z | 트레이 Z 범위(0 ~ M4 `RANGE`)를 8등분 | 163, 488, 813 … 2438 |
| 웰 열 c의 X | 카메라 X 범위(0 ~ M1 `RANGE`)를 3등분 | −83, −250, −417 |
| 웰 행 r의 Y | 카메라 Y 범위(0 ~ M3 `RANGE`)를 2등분 | 75, 225 |
| 원위치 | 각 모터 `HDIR × HPARK` | M1 +5, M2/M3/M4 −5 |

앱 슬롯 → 단: `단 = 8 − ⌊(슬롯 − 1) / 3⌋` (1단 = 아래). 한 단에 6웰 플레이트 1장이 들어간다고 가정하므로, 앱의 같은 단 1~3열은 같은 플레이트입니다.

## 촬영 순서 (플레이트 1장, 약 4분 반)
| 앱 단계 | 실제 동작 |
|---|---|
| 이송 | 원점 확인(필요하면 `HOME ALL`) → Z 단 높이와 카메라 X/Y 첫 웰 위치 동시 이동 → 세 축 완료 확인 → 트레이 꺼냄 → Z 촬영 높이 |
| 물기 제거 | 타이머 (가상) |
| 촬영 | 웰 1 → 2 → 3 → 6 → 5 → 4 순서로 카메라 X/Y 동시 이동 → 1장씩 로컬 촬영·저장. 미리보기 6장을 2×3 모자이크로 합쳐 결과 창에 표시 |
| 수납 복귀 | 카메라 X/Y 원위치 → Z → 단 높이 → 트레이 넣음 → Z 원위치 |
| 전송 · PC 저장 | 타이머 (가상) |

- 정지 버튼이나 오류가 생기면 MCB에 `STOP ALL`을 보냅니다.
- 원점 복귀 버튼과 "구동 4축 원점" 보정은 MCB `HOME ALL`입니다.
- 카메라나 모터 오류가 나면 스캐너 1이 오류 상태로 잠깁니다. 화면에서 **오류 해제**를 눌러야 다시 촬영할 수 있습니다.

## 영상 보관
| 위치 | 내용 |
|---|---|
| `data/images/` | 모자이크 (결과 창) |
| `~/Pictures/colony-pi/` | 웰 원본 (`.yuy2`, `.png`, `-preview.jpg`, `.json`) |

- **플레이트별 최근 5회**(웰 30장)를 남깁니다. 개수는 `COLONY_KEEP_CAPTURES`로 바꿀 수 있습니다.
- 6번째가 저장되면 그 플레이트의 가장 오래된 회차를 폐기합니다. 이때 본체의 결과 이미지와 웰 원본을 지웁니다.
- 촬영이 중간에 실패하면 그때까지 찍은 웰 원본은 바로 지웁니다.

## 점검
```sh
node test/hardware-smoke.mjs [slot]   # 실제 지그가 움직입니다: 플레이트 1장 촬영 후 결과 확인
printf '{"command":"status"}' | python3 device/local_agent.py   # USB 카메라 조회
python3 device/mcb.py PING VER STATUS                         # UART 조회
COLONY_RECEIVE_DIR=/tmp/camera-check python3 device/capture-local.py --format YUYV
```

## 파이4 직접 연결 설정

- USB 카메라는 본체 USB에 연결하며 기본 경로는 `/dev/v4l/by-id/usb-HD_USB_Camera_HD_USB_Camera_01.00.00-video-index0`입니다. 다른 카메라는 `COLONY_CAMERA_DEVICE`로 경로를 지정합니다.
- MCB J11 TX(1) → Pi GPIO15/RX(핀10), RX(3) → GPIO14/TX(핀8), GND(2) → GND(핀6). MCB와 Pi 전원은 별도입니다.
- 기본 UART는 `/dev/serial0`, 115200bps·8N1이며 `COLONY_MCB_PORT`로 USB 시리얼 경로도 지정할 수 있습니다.
- GPIO UART의 로그인 콘솔 서비스를 중지하고 부팅 cmdline의 `console=serial0,115200` 항목을 제거합니다. UART 하드웨어는 활성화한 상태를 유지합니다.
- Python3, python3-serial, v4l-utils, ffmpeg가 필요합니다. SSH와 rsync는 촬영·모터 제어에 사용하지 않습니다.
- `/api/v1/hardware/status`로 카메라와 MCB 연결 상태를 조회합니다. `/api/v1/hardware/capture`는 모터를 움직이지 않고 카메라 한 장만 점검합니다. 장비 화면의 "카메라 점검 촬영" 버튼에서 실행하고 촬영 영상과 원본 다운로드를 확인할 수 있습니다. `/api/v1/hardware/files/<UUID>.<ext>`는 PNG·미리보기·원본·메타데이터를 제공합니다. 플레이트 이력 생성은 기존 `/api/commands` 촬영 경로를 사용합니다.
- 스캐너 2~4, 물기 제거 및 후반 PC 전송 단계는 기존 가상 동작입니다.

## 촬영 영상 자세히 보기

- 장비 화면의 최근 카메라 점검 영상, 또는 촬영 이력의 실제 영상 보기 창에서 **촬영 영상 자세히 보기**를 누릅니다.
- 화면 맞춤, 원본 크기 100%, 확대 비율(2~800%), 마우스 휠, 끌어서 이동과 두 손가락 확대를 지원합니다.
- 6웰 영상은 전체 모자이크와 각 웰의 전체 해상도 영상을 선택할 수 있습니다. PNG와 YUY2 원본 다운로드도 지원합니다.
- Esc는 자세히 보기만 닫고 이전 보기 창과 버튼으로 돌아갑니다. 삭제된 영상은 불러올 수 없다는 안내를 표시합니다.
- 기존 촬영 자료로 브라우저 검사를 실행하려면 `COLONY_SOURCE_DATA_DIR="$PWD/data" npm run test:images`를 사용합니다. 테스트는 별도 데이터 사본과 서버를 사용하고 모터 제어를 비활성화합니다.

## 촬영 준비 시 축 동시 이동

- 촬영 시작의 Z 단 높이 이동과 첫 웰 X/Y 위치 설정은 하나의 병렬 이동 그룹으로 실행합니다.
- 그룹의 UART 명령을 한 번에 전송하고, 모든 축의 ACK와 DONE을 확인한 뒤 트레이 꺼냄과 Z 촬영 높이 이동을 진행합니다.
- 첫 웰은 이미 위치 설정을 마쳤으므로 중복 X/Y 이동 없이 촬영합니다. 이후 웰의 X/Y도 함께 이동하고 두 축이 도착한 뒤 촬영합니다.
- 원점 찾기, 트레이 꺼냄, 촬영 높이, 복귀 순서와 위치는 기존 레시피를 유지합니다.
- 한 축 오류 또는 타임아웃이 발생하면 전체 축에 `STOP ALL`을 보내고 후속 이동·촬영을 진행하지 않습니다.
- 로컬 에이전트 `mcb` 요청의 `steps`에는 문자열 명령과 `{"parallel":["MOVE 4 875","MOVE 1 -83","MOVE 3 75"]}` 형태를 사용할 수 있습니다. 그룹은 서로 다른 축의 `MOVE m pos [hz]`만 허용합니다.
- `npm run test:parallel`은 레시피, 첫 프레임 대기, ACK/DONE 순서 뒤섞임, 타임아웃 및 고장 정지를 실제 UART 없이 검사합니다.

## 프레임 버퍼와 독립 영상 처리 프로세스

스캐너 1은 준비/이송 단계부터 native YUYV 스트림을 열어 둔다.
`device/camera-stream.c`는 V4L2 MMAP 버퍼를 지속적으로 반환하면서 최근
원본 프레임을 RAM ring buffer에 보관한다. 기본 3프레임이며 3840×3040
YUYV 기준 약 70 MB이다. 포맷, 크기, stride, monotonic timestamp를 검증한다.

장비 동작 한 세트는 `acquireWell()`의 XY MOVE 완료 → 촬영 가능 시각 전달
→ 첫 적합 프레임 선택 → 원본 저장이다. 이미 버퍼에 적합 프레임이 있으면
즉시 선택하고, 없으면 첫 적합 프레임이 도착할 때 선택한다. 고정 2프레임
폐기는 하지 않는다. 노출 시작(SOE) timestamp는 이동 완료+settle 시각 이후
프레임을 선택한다. EOF timestamp는 이동 중 노출 가능성을 배제하기 위해
보고된 한 frame period를 추가로 확보한다. 오류/불완전/이동 이전 프레임 및
이미 사용한 sequence를 제외하며 30초 timeout은 작업 실패로 이어진다.

`device/capture-session.py`는 카메라/원본 획득을 맡고,
`device/capture-worker.py`는 별도 OS 프로세스에서 PNG·미리보기 변환과
저장을 맡는다. worker는 카메라나 모터 UART를 열지 않는다. writer thread와
전체 plate를 담을 수 있는 queue로 worker의 pipe/변환 속도를 획득 루틴과
분리한다. 시작 전에 전체 plate 용량과 queue 한도를 검증하고 원본을 모두
수용할 디스크 공간을 확보한다. 획득 중 변환 완료를 기다리지 않는다.

마지막 원본 획득 직후 stream 종료와 MCB 수납/park 복귀를 시작한다.
`acquisition-ended`에서 카메라 lock을 해제하며, 남은 변환은 Pi에서 계속된다.
장비 복귀 상태(`equipmentStatus`)와 처리 상태(`processingStatus`)를
별도로 추적한다. 처리 오류가 복귀 중 발생하면 복귀를 마친 후 전체 작업을
실패 처리한다. 획득/모터 오류, 도어 인터록, 사용자 중단은 즉시 정지시킨다.
모든 원본의 PNG·미리보기 저장과 모자이크 생성, 장비 복귀가 모두 성공해야
최종 이력을 성공으로 확정한다. 일시정지 중에는 다음 이동·촬영 요청을
발행하지 않으며 이미 획득한 원본의 처리는 진행될 수 있다.

설치: 대상 Pi에서 `npm run build:camera`. `gcc`, Linux V4L2 headers,
`v4l2-ctl`, `ffmpeg`, Python 3이 필요하다.

| 환경 변수 | 기본값 | 의미 |
|---|---|---|
| `COLONY_CAMERA_BUFFER_FRAMES` | 3 | RAM ring buffer, 1–8 |
| `COLONY_CAMERA_SETTLE_MS` | 0 | MOVE 완료 후 추가 안정화 시간, 0–10000 ms |
| `COLONY_CAPTURE_QUEUE_FRAMES` | 24 | 한 plate의 최대 원본 수, 1–96 |
| `COLONY_CAPTURE_COUNT` | 6 | 내부 session용 실제 웰 수; Node가 recipe에서 전달 |
| `COLONY_CAMERA_STREAM_BIN` | device/camera-stream | native stream helper 경로 |
| `COLONY_CAPTURE_SESSION_SCRIPT` | device/capture-session.py | 획득 프로세스 경로 |
| `COLONY_CAPTURE_WORKER_SCRIPT` | device/capture-worker.py | 변환 프로세스 경로 |

기존 `COLONY_CAMERA_DEVICE`, `COLONY_RECEIVE_DIR`, `COLONY_PYTHON` 설정은
유지한다. 단일 점검 촬영은 기존 `capture-local.py`를 사용한다.

내부 JSONL protocol:
- 요청: `{"command":"capture","id":"UUID","readyMonotonic":123.45}` 또는
  `{"command":"end"}`. readiness clock은 CLOCK_MONOTONIC seconds이다.
- 응답: `ready`, `acquired`(id/meta), `acquisition-ended`,
  `processed`(id/result), `closed`.
- 실패: `failed`(error, optional id), nonzero exit.
- `acquired`는 전체 native 원본 파일과 SHA256 확인을 뜻한다.
- `acquisition-ended`는 stream 종료를 뜻하며 처리 완료를 뜻하지 않는다.
- `closed`와 정상 process exit는 모든 처리가 완료됐음을 뜻한다.
- metadata는 acquisition/processing PID, readiness/eligibility timestamp,
  frame sequence, buffering/exposure guard, 처리 시작·완료 시각을 기록한다.

검증: `npm test`, `npm run test:pipeline`.
실장비 진단 `node test/pipeline-live.mjs CONFIG_PATH`는 앱을 중지하고
원점 복귀된 대기 상태에서만 실행한다. 실제 6웰 이동·촬영 후 원래 park 위치,
프레임 순서·시각, native 원본 크기·SHA256, PNG 해상도를 확인한다.
마지막 원본 획득 후 즉시 복귀 시작 및 변환 완료보다 먼저 복귀 완료되는지도
검증한다. 출력은 임시 폴더에만 저장되고 운영 이력에는 추가되지 않는다.
