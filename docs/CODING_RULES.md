# Coding Rules

이 문서는 Colony Counter 소프트웨어의 공통 코딩 규칙이다. 이 프로젝트는 UI,
백엔드, 하드웨어 제어, AI 분석이 함께 동작하므로, 기능 구현보다 인터페이스와
상태 일관성을 우선한다.

## 공통 규칙

1. 하드코딩된 IP, 포트, 파일 경로, 장비 포트는 새로 추가하지 않는다.
2. 설정값은 config 파일, 환경 변수, command option 중 하나로 주입한다.
3. 외부 인터페이스는 schema와 예외 응답을 문서화한다.
4. 상태값은 문자열 임의 조합 대신 enum, const, typed value를 사용한다.
5. 타임아웃, 재시도, 실패 상태를 성공 흐름과 함께 구현한다.
6. 로그에는 동작 단계, 대상 장비, job id, image path처럼 추적 가능한 값을 남긴다.
7. 비밀번호, 토큰, 장비 인증 정보, 내부망 주소는 commit하지 않는다.
8. 하나의 PR에는 하나의 목적만 담는다.

## Repository 구조

권장 구조:

```text
docs/                 Project documentation
.github/              GitHub templates and metadata
frontend/             UI application
backend/              API, DB, WebSocket, service logic
system/               Hardware control core
ai/                   AI inference and training code
scripts/              Build, setup, maintenance scripts
tests/                Cross-module tests and fixtures
```

실제 코드 이관 시 기존 구조가 다르다면, 한 번에 대규모 rename을 하지 말고
기능 단위로 이동한다.

## API 규칙

1. 외부 UI가 사용하는 API는 `/api/v1`처럼 version을 가진다.
2. 성공 응답과 실패 응답의 JSON shape를 분리하지 않는다.
3. 빈 결과는 error가 아니라 빈 배열 또는 count 0으로 반환한다.
4. API handler에는 장비 제어 세부 구현을 직접 넣지 않는다.
5. 요청/응답 구조체에는 의미 있는 이름을 붙인다.

예:

```json
{
  "total_detections": 0,
  "detect_type": "colony",
  "threshold": 0.5,
  "instances": []
}
```

## Backend 규칙

1. Go 코드는 `gofmt`와 `go test ./...`를 통과해야 한다.
2. DB model, API DTO, hardware message 구조체를 무분별하게 공유하지 않는다.
3. 장비 명령은 command/service layer를 통해 전달한다.
4. WebSocket event는 event name과 payload schema를 문서화한다.
5. 시작 시 테스트 함수나 샘플 분석 함수가 실행되지 않게 한다.
6. 파일 경로는 job 또는 storage service에서 생성하고 검증한다.

## UI 규칙

1. UI는 현재 장비 상태, 작업 상태, 오류 상태를 명확히 구분해 표시한다.
2. 장비 동작 버튼은 진행 중, 실패, 비활성 상태를 가진다.
3. 사용자가 중복 명령을 보낼 수 있는 버튼은 pending 상태에서 잠근다.
4. API 호출 실패는 화면에서 확인 가능한 메시지로 표시한다.
5. UI component는 표시 로직과 API 호출 로직을 분리한다.
6. 화면 문구는 장비 작업자의 행동 기준으로 작성한다.

## Hardware Control 규칙

1. 카메라, 엔진, 온도 제어 명령은 상태머신을 거쳐 실행한다.
2. serial packet header, command id, checksum은 named constant로 관리한다.
3. raw byte offset을 사용할 경우 구조체 layout과 endian을 주석 또는 문서로 남긴다.
4. 장비 응답 timeout은 반드시 error state로 연결한다.
5. main/sub board port mapping은 설정으로 관리한다.
6. 카메라 접근 경로는 하나의 owner를 정하고 중복 제어를 피한다.

## AI 분석 규칙

1. AI 응답 schema는 성공/실패/빈 결과에서 동일한 형태를 유지한다.
2. threshold, model path, endpoint는 설정으로 관리한다.
3. 분석 결과에는 model version 또는 weight 식별자를 남긴다.
4. bbox 좌표계와 image crop 기준을 문서화한다.
5. backend가 파싱할 수 없는 legacy 응답을 새로 만들지 않는다.

## C/C++ 규칙

1. compiler warning을 무시하지 않는다.
2. hardware state와 command id는 header에서 중앙 관리한다.
3. thread 간 공유 상태는 lock 또는 atomic ownership을 명확히 한다.
4. callback에서 오래 걸리는 작업을 직접 수행하지 않는다.
5. resource open/close, mmap/unmap, file descriptor lifecycle을 같은 module에서 닫는다.

## JavaScript / TypeScript 규칙

1. API client는 화면 component와 분리한다.
2. 서버 응답 type을 명시한다.
3. 전역 상태에는 여러 화면이 공유하는 값만 둔다.
4. 날짜, 경로, 상태 문자열 formatting은 helper로 분리한다.
5. UI에서 backend 내부 경로나 장비 raw code를 그대로 노출하지 않는다.

## 테스트 기준

변경 유형별 최소 검증:

| 변경 | 최소 검증 |
|---|---|
| UI | 주요 화면 수동 확인, API 실패 표시 확인 |
| Backend API | handler/service test 또는 수동 API 호출 결과 |
| Hardware command | 명령 생성 test, timeout/error path 확인 |
| AI schema | 빈 결과, 성공 결과, 오류 결과 parsing 확인 |
| Documentation | 링크와 명령어가 현재 repo 기준인지 확인 |

## 금지 항목

- 운영 경로에서 sample/test 함수 자동 실행
- 새 하드코딩 내부망 IP 추가
- 새 하드코딩 `/dev/ttyUSB*` 매핑 추가
- schema 없는 WebSocket event 추가
- Issue 없는 대규모 구조 변경
- unrelated formatting change와 기능 변경을 같은 PR에 포함
