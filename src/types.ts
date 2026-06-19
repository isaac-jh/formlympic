/**
 * 프로젝트 공용 타입 정의.
 */

/**
 * 페이로드 템플릿.
 *  - key   : 'entry.xxxxxxxxx' 형태의 구글 폼 필드 ID
 *  - value : 단일 값(string) 또는 복수 값(string[])
 */
export interface PayloadTemplate {
  [entryKey: string]: string | string[];
}

/**
 * 구글 서버 요청 시 함께 보낼 인증/브라우저 모사 옵션.
 *  - 로그인 필수 폼 대응을 위해 Cookie 를 전달한다.
 */
export interface RequestAuthOptions {
  /** 로그인 세션 Cookie 헤더 값 (선택) */
  cookie?: string;
  /** Referer 헤더 (보통 viewform 주소) */
  referer?: string;
  /** Origin 헤더 (보통 https://docs.google.com) */
  origin?: string;
}

/** 예약 발사 설정. */
export interface ScheduleConfig {
  /** 토큰 수급용 GET 대상 (.../viewform) */
  viewFormUrl: string;
  /** 실제 제출 POST 대상 (.../formResponse) */
  formResponseUrl: string;
  /** 목표 시간 (epoch milliseconds) */
  targetTime: number;
  /** 네트워크 지연 보정값 (ms) */
  latencyOffsetMs: number;
  /** 입력 데이터 템플릿 */
  payloadTemplate: PayloadTemplate;
  /** 로그인 세션 Cookie (선택) */
  cookie?: string;
  /** 실패 시 리바운드(재시도) 최대 횟수 (선택, 기본 DEFAULT_MAX_RETRIES) */
  maxRetries?: number;
}

/** fbzx 추출 + 폼 메타 정보 결과. */
export interface InspectResult {
  /** 추출된 fbzx 토큰 (없으면 null) */
  fbzx: string | null;
  /** HTML 에서 감지된 entry.* 필드 ID 목록 */
  detectedEntryIds: string[];
  /** 추출에 사용된 방식 ('cheerio' | 'regex' | 'none') */
  source: 'cheerio' | 'regex' | 'none';
}

/** 제출 결과. */
export interface SubmitResult {
  /** HTTP 상태 코드 */
  status: number;
  /** 최종 응답 URL (리다이렉트 추적 결과) */
  finalUrl: string;
  /** 응답 본문(HTML) */
  html: string;
  /** 실제 발사된 시각 (epoch ms) */
  firedAt: number;
}

/** ping(왕복 지연) 측정 결과. */
export interface PingResult {
  /** 최소 RTT (ms) */
  minRttMs: number;
  /** 평균 RTT (ms) */
  avgRttMs: number;
  /** 추정 편도 지연 (minRtt/2, ms) */
  estimatedOneWayMs: number;
  /** 측정 샘플 수 */
  samples: number;
}

/** 예약 발사 진행 상황 스트리밍 이벤트. */
export type ScheduleEvent =
  | {type: 'log'; message: string; at: number}
  | {type: 'token'; fbzx: string | null; at: number}
  | {type: 'payload'; preview: string; at: number}
  | {type: 'fired'; at: number}
  | {type: 'retry'; attempt: number; max: number; reason: string; at: number}
  | {
      type: 'response';
      status: number;
      finalUrl: string;
      htmlBase64: string;
      recorded: boolean;
      attempts: number;
    }
  | {type: 'error'; message: string}
  | {type: 'done'};
