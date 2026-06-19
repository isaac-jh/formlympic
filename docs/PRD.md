# PRD: Formlympic - Google Form 선착순 자동 제출기

- **버전**: v0.4.2
- **최종 수정일**: 2026-06-19
- **상태**: 초안(Draft)

## 1. 배경 및 목표 (Background & Goal)

특정 시간에 선착순으로 마감되는 구글 폼(Google Forms)에 대해, 브라우저 UI 클릭보다 빠른
**네트워크 레벨 직접 POST(`formResponse`)** 방식으로 제출을 자동화한다.

핵심 과제:

1. 구글의 매크로 방지 보안 토큰(`fbzx`)을 실시간으로 수급(파싱)하여 우회한다.
2. 네트워크 지연(latency)을 측정/보정하여 **밀리초 단위 정밀 발사**를 수행한다.

## 2. 사용자 시나리오 (Workflow)

1. **사전 준비**: 폼이 열린 직후, 입력 필드 ID(`entry.xxxxxxxxx`)와 제출 값을 매핑한
   페이로드 템플릿을 미리 설정한다.
2. **토큰 수급**: 목표 시간 약 2.5초 전, `viewform` 주소로 GET 요청 → HTML에서 `fbzx` 추출.
3. **페이로드 조립**: 템플릿 + `fbzx` + `submissionTimestamp`/`dlut` 결합 → 최종 POST 페이로드.
4. **정밀 발사**: 측정된 latency offset을 보정하여 목표 시간 직전(예: T-50ms)에
   `formResponse`로 `application/x-www-form-urlencoded` POST 전송.

## 3. 기능 요구사항 (Functional Requirements)

| ID | 요구사항 |
|----|----------|
| FR-1 | `viewform` URL을 사용자가 직접 입력하는 입력창 + 버튼 제공 (토큰/필드 추출 테스트) |
| FR-2 | `formResponse` URL을 사용자가 직접 입력하는 입력창 + 버튼 제공 (즉시 제출) |
| FR-3 | 사용자 설정 영역(폼 URL, 목표 시간, 입력 데이터 템플릿, latency offset)을 명확히 분리 |
| FR-4 | 주기적 ping으로 서버 왕복 지연(latency)을 측정하여 실시간 표시 |
| FR-5 | 측정된 지연시간을 고려하여 목표 시간에 자동으로 제출 요청 발사 |
| FR-6 | `fbzx` 토큰을 HTML 파서(cheerio) + 정규식 폴백으로 추출 |
| FR-7 | 최종 발사 직전 `while (Date.now() < target)` 정밀 대기(Busy-wait) 적용 |
| FR-8 | `formResponse` 응답 HTML을 **새 창**으로 표시 |
| FR-9 | 로그인 필수 폼 대응: 사용자 **Cookie 헤더 passthrough** (viewform/ping/formResponse 모두) + Referer/Origin 자동 설정 |
| FR-10 | 브라우저 제출 페이로드와 동일하게 `partialResponse` 자동 주입, 객관식 `_sentinel` 은 템플릿으로 추가 가능 |
| FR-11 | **프론트 전용 모드**(`public/standalone.html`, 서버 불필요): cURL 붙여넣기→파싱, no-cors RTT 측정, 시간 API 기반 시계 동기화(Cristian), 숨긴 form을 새 창에 POST 제출(쿠키 자동·응답 표시), 요청/에러 로그 분리 |
| FR-12 | 제출 페이로드에서 **`hud` 필드 자동 제거**(서버/프론트 공통): `hud=true` 포함 시 Google이 400으로 제출을 거부함(실측 확인) |
| FR-13 | cURL 붙여넣기 자동 채우기(서버형): viewForm/formResponse cURL을 파싱해 URL·쿠키·데이터 템플릿(entry.* 만)을 자동 입력, `fbzx` 등 시스템 필드는 제외 |
| FR-14 | **예약 발사 실패 시 리바운드 재시도**(서버형, 기본 3회): 응답이 확인 페이지가 아니면(폼 재렌더/400/로그인유도) `fbzx`를 새로 받아 재제출. 성공/실패·시도 횟수를 스트림으로 보고 |

## 4. 비기능 요구사항 (Non-Functional)

- **Runtime**: Node.js (TypeScript, Google TS Style)
- **Libraries**: `express`, `axios`, `cheerio`
- **정밀도**: 토큰 수급 이후 발사까지 OS 스케줄러 오차를 최소화 (hybrid sleep + busy-wait)
- **가독성**: 설정값은 `src/config.ts` 한 곳에 분리

## 5. 범위 외 (Out of Scope) / TODO

- 다중 폼 동시 발사(멀티 타깃) → 차기 버전
- 파일 업로드 필드 / reCAPTCHA v2,v3 우회 → 미지원
- 분산 노드(여러 리전)에서의 동시 발사 → 차기 버전
- **프론트 전용 모드(FR-11) 제약(CORS)**:
  - viewform 응답 본문을 읽을 수 없어 `fbzx` 자동 추출 불가 → formResponse cURL을 이벤트 직전에 새로 복사해 사용
  - 응답의 `Date` 헤더를 읽을 수 없어 Google 서버시간 직접 동기화 불가 → 외부 CORS 시간 API(예: `timeapi.io`)로 로컬 시계 드리프트만 보정
  - 응답을 코드로 읽지 못함(opaque) → 응답 확인은 새 창 렌더링으로 대체

## 6. 버전 히스토리

| 버전 | 일자 | 내용 |
|------|------|------|
| v0.1.0 | 2026-06-19 | 최초 작성: 선착순 자동 제출 웹앱 요구사항 정의 |
| v0.2.0 | 2026-06-19 | 실제 폼 테스트 결과 반영: 로그인 필수 폼 대응(Cookie passthrough, FR-9), `partialResponse` 자동 주입(FR-10) 추가 |
| v0.3.0 | 2026-06-19 | 서버 없이 동작하는 프론트 전용 단일 HTML(`standalone.html`) 추가(FR-11): CORS 제약을 form-submit 방식으로 우회 |
| v0.3.1 | 2026-06-19 | 실제 시트 기록 성공 검증("응답이 기록되었습니다"). `hud=true`가 제출을 400으로 막는 것을 실측 확인 → `hud` 자동 제거(FR-12) |
| v0.4.0 | 2026-06-19 | cURL 붙여넣기 자동 채우기(FR-13), 예약 발사 실패 시 리바운드 재시도(기본 3회, FR-14) 추가 |
| v0.4.1 | 2026-06-19 | 응답 한글 깨짐(mojibake) 수정: 응답을 arraybuffer 로 받아 명시적 UTF-8 디코딩. 성공 판정/새 창 표시 모두 정상화 |
| v0.4.2 | 2026-06-19 | 안전 발사: offset 적용 시 측정 세션 동안 관측된 "가장 작은 편도값"을 사용(평균/직전값 대신). 너무 일찍 도착해 거절되는 상황 방지 |
