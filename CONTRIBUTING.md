# Contributing

이 저장소는 하나의 repository 안에서 제품, 시스템 구조, UI, 백엔드,
하드웨어 제어, AI 분석 작업을 함께 관리한다. 작업 분리는 repository 분리가
아니라 GitHub Issue, Label, Milestone, Project, Pull Request, Release로 한다.

## 기본 원칙

1. 모든 개발 작업은 Issue에서 시작한다.
2. Issue에는 `area:*`, `type:*`, `priority:*` label을 붙인다.
3. 구현은 Issue 번호가 포함된 branch에서 진행한다.
4. 변경사항은 Pull Request로 main에 병합한다.
5. PR은 관련 Issue를 `Closes #번호` 또는 `Fixes #번호`로 연결한다.
6. 동작 가능한 기준점은 tag와 GitHub Release로 남긴다.

## Branch 규칙

```text
feature/12-camera-settings
fix/23-ai-response-schema
docs/31-architecture-summary
refactor/42-device-config
```

## Commit 규칙

Conventional Commits 형식을 사용한다.

```text
feat(ui): add camera setting panel
fix(ai): normalize empty detection response
docs: add system architecture workflow
refactor(backend): separate device config loading
test(api): add job lifecycle tests
```

사용 가능한 type:

| Type | Meaning |
|---|---|
| `feat` | 사용자 기능 추가 |
| `fix` | 버그 수정 |
| `docs` | 문서 변경 |
| `refactor` | 동작 변경 없는 구조 개선 |
| `test` | 테스트 추가 또는 수정 |
| `chore` | 빌드, 설정, 관리 작업 |
| `ci` | CI 설정 |

## Pull Request 기준

PR에는 다음 항목을 포함한다.

- 변경 목적
- 주요 변경사항
- 테스트 결과
- 연결 Issue
- 하드웨어 또는 환경 의존성

PR을 병합하기 전에 다음을 확인한다.

- 관련 Issue가 연결되어 있다.
- 직접 영향을 받는 기능의 테스트 또는 수동 검증 결과가 있다.
- 하드코딩된 IP, 경로, 장비 포트가 새로 추가되지 않았다.
- UI 변경은 주요 화면 상태를 확인했다.
- 하드웨어 제어 변경은 실패/타임아웃 경로를 포함한다.

## Release 기준

Release는 동작 가능한 기준점에만 만든다.

```text
v0.1.0 - 기본 프로젝트 구조와 관리 체계
v0.2.0 - 장비 초기화와 카메라 설정 흐름
v0.3.0 - 촬영 및 colony 분석 흐름
v1.0.0 - 데모 가능한 통합 버전
```

각 Release note에는 다음을 적는다.

- 추가된 기능
- 수정된 문제
- 알려진 제한사항
- 검증 환경
