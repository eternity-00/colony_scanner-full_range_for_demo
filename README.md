# Colony Scanner UI v2.3 — LCD 화면 + 장비 서버 (통합판)

`feat/lcd-uiux-v2.2` 의 LCD 화면과 테스트베드 운영 앱(실카메라 · MCB 모터 · 웰 중심 자동 정렬 · 초점 조정)을 한 저장소로 합친 것이다 (2026-10-23, 브랜치 `integration/hardware`).

- 화면: `src/` (React + TypeScript, 기능 폴더 구조)
- 장비 서버: `server/` — `controller.mjs`(플레이트 · 일정 · 보존 · 권한), `index.mjs`(HTTP · SSE · 하드웨어 · 점검 API), `real-camera-adapter.mjs`(스캐너 1 실장비), `mcb-motion.mjs`(레시피 → MCB 명령), `camera-service.mjs`, `alignment.mjs`(웰 중심 정렬 보정값), `profile.mjs`(배포 프로필)
- 장치 코드: `device/` — 카메라 스트림(C) · 촬영 세션 · 웰 검출(numpy) · MCB UART 에이전트(python)
- 가상 장비: `simulator-app/` (PC 개발 · CI · 정식 하드웨어 전 건식 검증)
- **프로필**: `profiles/` — 테스트베드 / 정식 하드웨어 / 가상을 `COLONY_PROFILE` 하나로 고른다 → [docs/PROFILES.md](docs/PROFILES.md)
- **관리 툴**: `tools/admin/` — 펌웨어 파라미터(작동 범위 · 속도) · 레시피 · 수동 조작 · 보정을 별도 프로세스에서 → [docs/ADMIN_TOOL.md](docs/ADMIN_TOOL.md)

## 실행

```sh
npm install && npm run build
COLONY_PROFILE=virtual npm run system          # PC: 가상 엔진 + 콘솔 + LCD 서버 (http://127.0.0.1:8787)
COLONY_PROFILE=testbed npm run system          # 파이(테스트베드): 스캐너 1 실장비 (가상 엔진 없이 LCD 서버만)
npm run admin                                  # 관리 툴 http://<파이>:8799
```

파이에서는 `system/colony.service`(앱)와 `system/colony-admin.service`(관리 툴)를 systemd user 유닛으로 두고, 화면은 `system/colony-kiosk.sh` 로 연다. 관리자 PIN 은 `0000`(`ADMIN_PIN`).

## 버전

| 버전 | 내용 |
|---|---|
| 1.2 ~ 1.6, 2.0 ~ 2.2 | LCD 화면 디자인안 (`feat/lcd-uiux-*`). 가상 장비 전용 |
| 운영 앱 (테스트베드) | main(09-16) 구조 위에 실장비 계층. 파이 `/home/miru/colony_scanner-UI` |
| **2.3** | 위 둘의 통합 + 프로필 분리 + 관리 툴. 화면 표시 `v2.3.x` 의 마지막 자리는 파이에 올린 횟수 |

## 검사

```sh
npm test            # 컨트롤러 · 실장비 어댑터 · 모션 · 파이프라인 · 정렬 · 점검 API (Node)
npm run test:py     # 촬영 세션 · UART 파서 (python)
npm run test:ui     # 브라우저 통합 (가상 프로필, Playwright)
npm run check       # 위 셋 + 빌드
```

실장비 확인은 파이에서 `node test/hardware-smoke.mjs` (스캐너 1 로 플레이트 1매 촬영) 와 `test/pipeline-live.mjs` 를 쓴다. 모두 장비가 움직인다.

## 실 장비 점검 기록

[2026-11-04 OvenScanner 축 매칭·운용 범위·M3 수동 제어 상태](docs/commissioning/OVEN_SCANNER_20261104.md).
자동 공정 레시피와 배포 프로필 전환은 포함하지 않습니다.

## 문서

- [docs/HARDWARE.md](docs/HARDWARE.md) 실장비 동작 · 레시피와 펌웨어 파라미터
- [docs/PROFILES.md](docs/PROFILES.md) 배포 프로필
- [docs/ADMIN_TOOL.md](docs/ADMIN_TOOL.md) 관리 툴
- [docs/SYSTEM_SPEC.md](docs/SYSTEM_SPEC.md) · [docs/USER_GUIDE.md](docs/USER_GUIDE.md) v1.2 명세 · 사용설명서 (화면 구성은 2.x 로 바뀌었음)
- [docs/GITHUB_WORKFLOW.md](docs/GITHUB_WORKFLOW.md) · [docs/CODING_RULES.md](docs/CODING_RULES.md)
