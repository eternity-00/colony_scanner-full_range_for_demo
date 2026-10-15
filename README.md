# Colony Scanner React + External Virtual Device v1.2

`Colony Scanner App (standalone).html`과 `CC_LCD_UI_Spec_v1.1_260911.docx`의 확정 요구를 구현한 React LCD 데모다. 분석자·관리자 권한, 플레이트 등록·촬영·이력·장비·설정 UI와 독립 프로세스 가상장비를 포함한다.

## 실행

```sh
cd /home/miru/cc-lcd/react-demo
./open-demo.sh
```

LCD 창(`:8787`)과 Virtual Device Console 창(`:8792`)이 따로 열린다. 가상장비 엔진은 독립 프로세스(`:8790`)다. 종료는 `./stop-demo.sh`를 사용한다. 관리자 데모 PIN은 `0000`이며 `ADMIN_PIN` 환경변수로 주입할 수 있다.

## 버전

LCD UI 버전은 브랜치로 구분한다. 화면 메뉴 아래 표시되는 마지막 자리는 장비에 올린 횟수다.

| 버전 | 브랜치 | 비고 |
| --- | --- | --- |
| 1.2 ~ 1.6 | `feat/lcd-uiux-vN` (1.N) | 데모 · 디자인안 비교. `main` 의 v1.2 와는 별개다 |
| **2.0** | `feat/lcd-uiux-v2.0` | 2차 피드백 반영: 도안 3-1, 스캐너 1대, 새 홈(등록·반출 + 요약), 현황은 메뉴로 |
| **2.1** | `feat/lcd-uiux-v2.1` | 초안(260911) 구성으로 현황·등록·촬영·이력·장비·설정을 다시 짬. 메뉴 서랍 · 상세는 2.0 구성(겉모습만 맞춤), 홈은 윗줄 등록·반출 버튼 + 아랫줄 정보 4칸(배양 중·반출 대기·빈 슬롯·문제 발생), 색은 밝게 |
| **2.2** | `feat/lcd-uiux-v2.2` | 2.1 배치 그대로, 색만 1.2 무드로 — 남색 헤더 · 노란 로고 · 남색 계열(#1d3a8a) 버튼 · 푸른 회색 바탕 (`src/styles/v22.css`) |

## 구성

- `src/`: React LCD UI
- `server/index.mjs`: LCD·API·SSE 서버
- `server/controller.mjs`: 플레이트, 일정, 영상 보존, 역할 세션
- `server/remote-device.mjs`: 외부 장비 엔진 통신
- `simulator-app/engine.mjs`: 가상장비 상태 머신 독립 런타임
- `simulator-app/`: 별도 I/O 콘솔

촬영 영상 보기는 6-well 전체를 표시하지 않고 원형 프레임 안에 WELL 1/6 한 개만 표시한다. 데모는 Wikimedia Commons CC0 이미지를 모든 회차에 공통 사용하며 최근 5회차 참조만 보유한다.

## 검사

```sh
npm run check
```

단위·브라우저 통합 검사는 PIN 잠금·자동 복귀, 등록·촬영·보존, 외부 엔진·콘솔, 단일 웰 보기, 오류 전파와 엔진 단절을 검증한다.

## 문서

- [v1.2 전체 시스템 명세](docs/SYSTEM_SPEC.md)
- [v1.2 사용설명서](docs/USER_GUIDE.md)
- [저장소 작업 방식](docs/GITHUB_WORKFLOW.md)
- [코딩 규칙](docs/CODING_RULES.md)
