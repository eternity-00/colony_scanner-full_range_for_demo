# GitHub Workflow

이 문서는 Colony Counter 소프트웨어를 하나의 GitHub repository에서 관리하기
위한 기준이다. repository를 기능별로 나누지 않고, GitHub의 작업 관리 기능을
사용해 개발 진행사항, 히스토리, 버전 관리를 유지한다.

## 관리 단위

| GitHub 기능 | 용도 |
|---|---|
| Issues | 실제 작업, 버그, 개선 요청, 문서 작업 |
| Labels | 영역, 작업 유형, 우선순위, 상태 분류 |
| Milestones | 버전별 목표와 완료율 관리 |
| Projects | 현재 진행 상황판 |
| Pull Requests | 코드 변경 이력과 리뷰 단위 |
| Tags | 특정 코드 시점 고정 |
| Releases | 배포 가능한 버전과 변경 이력 |

## 영역 분리

Confluence 문서처럼 repository를 나누는 대신 label로 영역을 구분한다.

| 기존 구분 | GitHub label | 설명 |
|---|---|---|
| S/W-Colony Counter | `area:product` | 제품 목적, 기능 범위, 사용자 흐름 |
| S/W-System Architecture | `area:architecture` | 시스템 구조, 통신, 데이터, 장비 제어 |
| S/W-UI | `area:ui` | 화면, 조작, 표시 상태, 에러 메시지 |

추가 구현 영역은 아래 label을 사용한다.

| Label | 설명 |
|---|---|
| `area:backend` | API, DB, WebSocket, service logic |
| `area:hardware` | camera, engine board, serial, state machine |
| `area:ai` | colony detection, AI API, result schema |
| `area:docs` | repository documentation |
| `area:build` | build, packaging, deployment scripts |

## 작업 유형

| Label | 설명 |
|---|---|
| `type:feature` | 새 기능 |
| `type:bug` | 버그 수정 |
| `type:docs` | 문서 변경 |
| `type:refactor` | 동작 변경 없는 구조 개선 |
| `type:test` | 테스트 추가 또는 수정 |
| `type:chore` | 관리성 변경 |

## 우선순위

| Label | 기준 |
|---|---|
| `priority:p0` | 장비 동작, 데이터 손실, 릴리즈 차단 |
| `priority:p1` | 핵심 기능 또는 데모 차단 |
| `priority:p2` | 일반 개선, 비차단 작업 |
| `priority:p3` | 정리, 후순위 개선 |

## 상태

| Label | 기준 |
|---|---|
| `status:blocked` | 외부 의존성 또는 결정 대기 |
| `status:needs-design` | UI/UX 또는 구조 결정 필요 |
| `status:needs-hardware` | 실제 장비 검증 필요 |
| `status:ready-for-review` | 리뷰 가능 |

## Milestone 운영

Milestone은 버전 목표를 의미한다. 하나의 Issue는 가능하면 하나의 Milestone에만
속한다.

권장 초기 Milestone:

| Milestone | 목표 |
|---|---|
| `v0.1.0` | repository 구조, 문서, 기본 관리 체계 |
| `v0.2.0` | 장비 초기화, 카메라 설정, 기본 제어 |
| `v0.3.0` | 촬영, AI 분석, 결과 저장 |
| `v1.0.0` | 데모 가능한 통합 버전 |

## GitHub Project View

하나의 GitHub Project를 만들고 이 repository의 Issue와 PR을 연결한다.

권장 view:

| View | 구성 |
|---|---|
| Board | Todo, In Progress, Review, Done, Blocked |
| Table | Issue, Area, Priority, Milestone, Assignee, Status |
| Roadmap | Milestone 또는 target date 기준 |

## 작업 흐름

1. Issue를 만든다.
2. Issue에 area/type/priority label과 milestone을 지정한다.
3. Issue 번호가 포함된 branch를 만든다.
4. 구현 후 PR을 만든다.
5. PR 본문에 `Closes #IssueNumber`를 적는다.
6. 리뷰와 검증 후 main에 병합한다.
7. 버전 기준점에서는 tag와 Release를 만든다.

## Issue 작성 기준

Issue는 작게 나눈다. 하나의 Issue는 하나의 PR로 닫을 수 있는 크기가 좋다.

Issue에 포함할 내용:

- 목적
- 완료 조건
- 영향 영역
- 검증 방법
- 관련 문서 또는 코드 위치

## PR 작성 기준

PR은 코드 변경의 이유와 검증 결과를 남기는 히스토리다.

PR에 포함할 내용:

- 변경 목적
- 주요 변경사항
- 테스트 결과
- 연결 Issue
- 하드웨어 검증 필요 여부

## Release 작성 기준

Release note에는 사람이 읽을 수 있는 변경 이력을 남긴다.

Release note 항목:

- Added
- Changed
- Fixed
- Known limitations
- Verification
