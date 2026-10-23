# 관리 툴 (tools/admin)

장비 설정은 운영 화면(LCD)이 아니라 관리 툴에서 바꾼다. 관리 툴은 별도 프로세스이고 PC 브라우저로 쓴다.

```sh
systemctl --user start colony-admin.service     # 또는 npm run admin
# http://<파이 주소>:8799   (프로필 network.adminPort)
```

## 동작 방식

- 관리 툴은 장비를 직접 만지지 않는다. 모든 요청은 운영 앱의 `/api/v1/maintenance/*` 로 간다. UART 는 운영 앱의 로컬 에이전트(`device/mcb.py --serve`) 하나만 연다.
- 요청마다 관리자 PIN(`x-admin-pin`, 운영 앱 `ADMIN_PIN`, 기본 0000)이 필요하다.
- **점검 모드**: 「점검 모드 시작」을 누르면 운영 앱이 잠금을 잡는다(진행 중 작업이 있으면 거부). 잠금 중에는 운영 화면의 촬영·장비 명령이 `MAINTENANCE` 로 거부되고 자동 촬영도 멈추며, 화면에 붉은 띠가 뜬다. 파라미터 변경·레시피 저장·모터 조작은 잠금 중에만 된다. 읽기(상태·파라미터 표·백업 목록)는 언제나 된다.
- 보정·초점 모드는 운영 앱의 작업(`calibrate`)으로 실행되므로 점검 모드를 **끈 뒤** 실행한다.

## 탭

| 탭 | 기능 | API |
|---|---|---|
| 펌웨어 파라미터 | `GET ALL` 표, 칸 편집 → `SET m KEY v`, `SAVE`, `DEFAULTS`. 검사: HMAX ≥ \|RANGE\|, SPEED/MAXSPEED 공진 구간 밖, USTEP 변경 경고. 프로필 기대값과 다른 칸 표시. 변경 전 자동 백업 | `POST mcb`, `POST params/backup`, `params/restore` |
| 레시피 | tiers · wellColumns/Rows · trayOut · captureZ · wellDiameterMm · speedHz 편집, 검증(RANGE·상한·프로필 layout 일치), 저장(이전 파일은 `config/history/`), 즉시 적용 | `GET/PUT recipe`, `POST recipe/validate` |
| 수동 조작 | HOME ALL, STATUS, MOVE/JOG(RANGE 안에서만), STOP ALL, 바로 가기(카메라 원위치, 트레이 꺼냄/넣음, 촬영 높이, n단 Z) | `POST mcb`, `POST mcb/stop` |
| 카메라 · 정렬 | 카메라 상태, 플레이트 칸 선택 후 정렬 보정 실행 / 초점 조정 위치 이동 / 복귀, 시험 촬영 1장 | `/api/commands`(관리자 로그인 후), `/api/v1/hardware/*` |
| 진단 | PING · VER · INFO, 펌웨어 기대값 검사 결과, 카메라·MCB 상태 | `POST mcb`, `GET status` |
| 프로필 | 현재 프로필 JSON, 레시피, 배치 | `GET profile` |

## 안전 규칙

- 모터 이동은 펌웨어 `RANGE` 밖이면 보내지 않는다. 레시피 저장은 `captureZ ≤ limits.captureZMax` 를 넘으면 거부(강제 저장 시 확인).
- `SET`/`DEFAULTS` 전에 파라미터 백업을 자동으로 남긴다(`<dataDir>/mcb-params/`). 복원은 백업 파일의 값으로 `SET` 하고 선택 시 `SAVE`.
- RANGE 또는 USTEP 을 바꾸면 카메라 정렬 보정값이 맞지 않으므로 보정을 다시 실행한다(USTEP 은 저장소가 자동으로 무효 처리).
- 펌웨어 v19 로 올리기 전에는 v18 에서 `HMAX ≥ |RANGE|` 로 맞추고 `SAVE` 해야 한다.
