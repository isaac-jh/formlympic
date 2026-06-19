/**
 * ============================================================================
 *  사용자 설정 영역 (USER CONFIGURATION)
 * ----------------------------------------------------------------------------
 *  ⚠️ 가동 전 이 파일의 값만 수정하면 됩니다.
 *
 *  - 이 값들은 웹 UI 의 "기본값"으로 사용됩니다.
 *  - 실제 운영 시에는 웹 UI 의 입력창에서 덮어쓸 수 있으므로,
 *    여기서는 "자주 쓰는 기본 프리셋" 정도로 채워두면 됩니다.
 * ============================================================================
 */

import type {PayloadTemplate} from './types.js';

/** 서버가 바인딩할 포트 (웹 UI 접속용) */
export const SERVER_PORT = 3000;

/**
 * (1) 폼 주소 기본값
 *  - viewFormUrl   : fbzx 토큰을 수급할 GET 대상 (.../viewform)
 *  - formResponseUrl: 실제 제출할 POST 대상      (.../formResponse)
 *
 *  TODO: 폼이 바뀔 때마다 이 두 값을 갱신하거나, 웹 UI 에서 직접 입력하세요.
 */
export const DEFAULT_VIEW_FORM_URL =
  'https://docs.google.com/forms/d/e/XXXXXXXXXXXXXXXXXXXX/viewform';
export const DEFAULT_FORM_RESPONSE_URL =
  'https://docs.google.com/forms/d/e/XXXXXXXXXXXXXXXXXXXX/formResponse';

/**
 * (2) 입력 데이터 템플릿 (페이로드 뼈대)
 *  - key   : 구글 폼 필드 ID (예: 'entry.123456789')
 *  - value : 제출할 값. 체크박스 등 복수 선택은 배열로 작성.
 *
 *  fbzx / submissionTimestamp / dlut 등 시스템 필드는 런타임에 자동 주입되므로
 *  여기에 넣지 않습니다.
 */
export const DEFAULT_PAYLOAD_TEMPLATE: PayloadTemplate = {
  'entry.111111111': '홍길동',
  'entry.222222222': 'example@email.com',
  // 'entry.333333333': ['옵션A', '옵션B'], // 복수 선택(체크박스) 예시
};

/**
 * (3) 목표 시간 기본값 (오늘 기준 HH:mm:ss)
 *  - 웹 UI 에서 datetime-local 로 정밀 지정 가능.
 */
export const DEFAULT_TARGET_HHMMSS = '08:00:00';

/**
 * (4) 네트워크 지연 보정값 (Latency Offset, ms)
 *  - "목표 시간 - 이 값" 시점에 발사하여 요청이 정확히 목표 시간에 도착하도록 보정.
 *  - 권장: ping 으로 측정된 편도 지연(RTT/2) 근처. 기본 50ms.
 */
export const DEFAULT_LATENCY_OFFSET_MS = 50;

/**
 * (5) 토큰 선수급 리드타임 (ms)
 *  - 목표 시간 몇 ms 전에 viewform 으로 GET 하여 fbzx 를 미리 받아둘지.
 *  - 기본 2500ms (요구사항: 약 2.5초 전).
 */
export const TOKEN_PREFETCH_LEAD_MS = 2500;

/**
 * (5-1) 예약 발사 실패 시 리바운드(재시도) 최대 횟수
 *  - 제출 응답이 "정상 기록"이 아니면(폼 재렌더/400/로그인유도 등) fbzx 를 새로 받아 재시도.
 *  - 기본 3회. 0 이면 재시도하지 않음.
 */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * (5-2) 리바운드 재시도 간 지연 (ms)
 *  - 너무 빠른 연속 요청을 피하고 fbzx 가 안정적으로 발급되도록 약간 대기.
 */
export const RETRY_DELAY_MS = 150;

/**
 * (6) 정밀 대기(Busy-wait) 전환 마진 (ms)
 *  - 발사 시점 직전 이 시간만큼은 setTimeout 대신 while-loop 로 정밀 대기.
 *  - 너무 크면 CPU 점유, 너무 작으면 정밀도 저하. 기본 30ms.
 */
export const BUSY_WAIT_MARGIN_MS = 30;

/**
 * (7) ping 측정용 샘플 수
 *  - /api/ping 1회 호출 시 내부적으로 몇 번 왕복 측정하여 최소/평균을 낼지.
 */
export const PING_SAMPLE_COUNT = 3;

/**
 * (8) 로그인 쿠키 기본값 (선택)
 *  - 로그인 사용자 전용 폼(로그인 필수/응답 1회 제한 등)은 인증 쿠키가 없으면
 *    제출이 익명으로 처리되어 거부됩니다.
 *  - 브라우저 개발자도구 → Network → formResponse 요청의 Cookie 헤더 값을 그대로 붙여넣으세요.
 *  - 웹 UI 의 "로그인 쿠키" 입력란에서 덮어쓸 수 있습니다.
 *
 *  ⚠️ 쿠키는 민감 정보입니다. 공유/커밋하지 마세요. (수명도 짧아 곧 만료됩니다.)
 */
export const DEFAULT_COOKIE = '';

/** 구글 서버 요청 시 사용할 공통 헤더 (브라우저 위장) */
export const REQUEST_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
};
