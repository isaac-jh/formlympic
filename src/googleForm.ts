/**
 * ============================================================================
 *  핵심 서비스: Google Form 토큰 수급 · 페이로드 조립 · 정밀 발사
 * ----------------------------------------------------------------------------
 *  네트워크 레벨에서 formResponse 로 직접 POST 하기 위한 모든 저수준 로직을
 *  담당하는 모듈입니다. 서버(server.ts)는 이 함수들을 조합해서 사용합니다.
 * ============================================================================
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import {
  BUSY_WAIT_MARGIN_MS,
  PING_SAMPLE_COUNT,
  REQUEST_HEADERS,
} from './config.js';
import type {
  InspectResult,
  PayloadTemplate,
  PingResult,
  RequestAuthOptions,
  SubmitResult,
} from './types.js';

/**
 * 공통 헤더에 인증 쿠키/리퍼러/오리진을 병합한다.
 *  - 로그인 필수 폼 대응을 위해 Cookie 헤더를 그대로 전달한다.
 *  - 브라우저 동작을 모사하기 위해 Referer/Origin 도 함께 설정한다.
 */
function withAuthHeaders(opts?: RequestAuthOptions): Record<string, string> {
  const headers: Record<string, string> = {...REQUEST_HEADERS};
  if (opts?.cookie) headers['Cookie'] = opts.cookie;
  if (opts?.referer) headers['Referer'] = opts.referer;
  if (opts?.origin) headers['Origin'] = opts.origin;
  return headers;
}

/**
 * viewform HTML 을 받아 fbzx 토큰과 entry.* 필드 ID 목록을 추출한다.
 *
 *  추출 전략 (2단계 폴백):
 *   1) cheerio 로 `input[name="fbzx"]` 의 value 를 우선 파싱 (가장 정확).
 *   2) 실패 시 정규식으로 HTML 전체에서 fbzx 값을 탐색.
 *
 *  @param viewFormUrl .../viewform 주소
 *  @param opts        인증 쿠키 등 추가 옵션
 *  @returns 추출된 fbzx, 감지된 entry ID 목록, 사용된 추출 방식
 */
export async function inspectForm(
  viewFormUrl: string,
  opts?: RequestAuthOptions,
): Promise<InspectResult> {
  const {data: html} = await axios.get<string>(viewFormUrl, {
    headers: withAuthHeaders(opts),
    responseType: 'text',
    // 구글 폼은 가끔 큰 HTML 을 반환하므로 변환 방지
    transformResponse: [(d) => d],
    timeout: 10_000,
  });

  return extractTokens(html);
}

/**
 * HTML 문자열에서 fbzx 토큰과 entry ID 들을 추출하는 순수 함수.
 *  (테스트 용이성을 위해 네트워크 로직과 분리)
 */
export function extractTokens(html: string): InspectResult {
  let fbzx: string | null = null;
  let source: InspectResult['source'] = 'none';

  // 1) cheerio 파싱
  try {
    const $ = cheerio.load(html);
    const value = $('input[name="fbzx"]').attr('value');
    if (value) {
      fbzx = value;
      source = 'cheerio';
    }
  } catch {
    // 파싱 실패는 무시하고 정규식 폴백으로 진행
  }

  // 2) 정규식 폴백 (hidden input 또는 FB_PUBLIC_LOAD_DATA_ 내부 모두 대응)
  if (!fbzx) {
    const patterns = [
      /name="fbzx"\s+value="(-?\d+)"/, // hidden input
      /"fbzx"\s*:\s*"?(-?\d+)"?/, // JS 데이터
      /\[null,"(-?\d{10,})"\]\s*$/, // FB_PUBLIC_LOAD_DATA_ 말미 폴백
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) {
        fbzx = m[1];
        source = 'regex';
        break;
      }
    }
  }

  // entry.* 필드 ID 수집 (중복 제거)
  const entryIds = new Set<string>();
  const entryRe = /entry\.\d+/g;
  let match: RegExpExecArray | null;
  while ((match = entryRe.exec(html)) !== null) {
    // entry.123_sentinel 같은 보조 필드는 제외
    entryIds.add(match[0]);
  }

  return {
    fbzx,
    detectedEntryIds: [...entryIds].sort(),
    source,
  };
}

/**
 * 페이로드 템플릿 + 런타임 시스템 필드를 결합하여
 * application/x-www-form-urlencoded 본문 문자열을 만든다.
 *
 *  자동 주입되는 시스템 필드:
 *   - fbzx                : 실시간 수급한 매크로 방지 토큰
 *   - fvv=1               : 폼 버전 검증 플래그
 *   - pageHistory=0       : 단일 페이지 폼 기준
 *   - submissionTimestamp : 제출 시각(ms). 구글이 기대하는 값.
 *   - dlut                : draft last update time(ms). 보조 타임스탬프.
 *
 *  @param template 사용자 입력 데이터 (entry.* → 값)
 *  @param fbzx     실시간 수급 토큰 (없으면 생략)
 *  @returns urlencoded 문자열
 */
export function buildPayload(
  template: PayloadTemplate,
  fbzx: string | null,
): string {
  const params = new URLSearchParams();

  // (a) 사용자 데이터: 배열이면 복수 append (체크박스 다중 선택 대응)
  for (const [key, value] of Object.entries(template)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else {
      params.append(key, value);
    }
  }

  // (b) 시스템 필드 주입 (실제 브라우저 제출 페이로드와 동일 구성)
  const now = Date.now();
  if (fbzx) {
    params.append('fbzx', fbzx);
    // partialResponse 는 브라우저가 항상 함께 보내는 값으로, 마지막 원소에 fbzx 가 들어간다.
    params.append('partialResponse', JSON.stringify([null, null, fbzx]));
  }
  params.append('fvv', '1');
  params.append('pageHistory', '0');
  params.append('submissionTimestamp', String(now));
  params.append('dlut', String(now));

  // 참고: 라디오/체크박스(객관식) 필드는 보조 필드 `entry.xxx_sentinel` 를 빈 값으로
  //       함께 보내야 하는 경우가 있습니다. 필요 시 템플릿에 `"entry.xxx_sentinel": ""`
  //       항목을 직접 추가하면 그대로 전송됩니다.
  // TODO: 파일 업로드 필드(entry.*_xxx) 및 reCAPTCHA 토큰은 현재 미지원.
  return params.toString();
}

/**
 * 목표 시각까지 정밀 대기한다. (Hybrid Sleep + Busy-wait)
 *
 *  - OS 스케줄러 오차를 줄이기 위해 두 단계로 나눈다:
 *    1) 목표 - BUSY_WAIT_MARGIN_MS 까지는 setTimeout 으로 저비용 대기.
 *    2) 마지막 마진 구간은 `while (Date.now() < target)` 로 밀리초 정밀 대기.
 *
 *  @param targetMs 목표 시각 (epoch ms)
 */
export async function preciseWaitUntil(targetMs: number): Promise<void> {
  const coarseTarget = targetMs - BUSY_WAIT_MARGIN_MS;

  // (1) Coarse sleep: 남은 시간을 잘게 쪼개 setTimeout (이벤트 루프 양보)
  while (Date.now() < coarseTarget) {
    const remaining = coarseTarget - Date.now();
    await sleep(Math.min(remaining, 50));
  }

  // (2) 정밀 대기: 마지막 구간은 busy-wait 로 ms 오차 최소화
  while (Date.now() < targetMs) {
    /* spin: 의도적으로 CPU 를 점유하며 정확한 시점까지 대기 */
  }
}

/** Promise 기반 sleep 헬퍼. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * formResponse 로 최종 POST 를 전송하고 응답 HTML 을 반환한다.
 *
 *  @param formResponseUrl .../formResponse 주소
 *  @param payloadBody     urlencoded 본문
 *  @param opts            인증 쿠키/리퍼러/오리진 등 추가 옵션
 *  @returns 상태코드 · 최종 URL · 응답 HTML · 발사 시각
 */
export async function submitForm(
  formResponseUrl: string,
  payloadBody: string,
  opts?: RequestAuthOptions,
): Promise<SubmitResult> {
  const firedAt = Date.now();
  const response = await axios.post<string>(formResponseUrl, payloadBody, {
    headers: {
      ...withAuthHeaders(opts),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    responseType: 'text',
    transformResponse: [(d) => d],
    // 성공/실패 페이지 모두 받아서 사용자에게 보여주기 위해 모든 상태 허용
    validateStatus: () => true,
    maxRedirects: 5,
    timeout: 15_000,
  });

  // axios 는 최종 리다이렉트 URL 을 response.request 에 보관
  const finalUrl: string =
    response.request?.res?.responseUrl ??
    response.request?.responseURL ??
    formResponseUrl;

  return {
    status: response.status,
    finalUrl,
    html: typeof response.data === 'string' ? response.data : String(response.data),
    firedAt,
  };
}

/**
 * 대상 서버(viewform)와의 왕복 지연(RTT)을 여러 번 측정하여
 * 최소/평균/추정 편도 지연을 계산한다.
 *
 *  - 정확한 발사 보정값을 얻기 위해 최소 RTT 를 중요하게 사용한다.
 *    (네트워크 jitter 영향이 가장 적은 값)
 *
 *  @param url       측정 대상 URL (보통 viewFormUrl)
 *  @param sampleCount 측정 횟수
 */
export async function measureLatency(
  url: string,
  sampleCount: number = PING_SAMPLE_COUNT,
  opts?: RequestAuthOptions,
): Promise<PingResult> {
  const rtts: number[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const start = performance.now();
    try {
      await axios.get(url, {
        headers: withAuthHeaders(opts),
        responseType: 'text',
        transformResponse: [(d) => d],
        validateStatus: () => true,
        timeout: 8_000,
      });
    } catch {
      // 개별 실패는 건너뛰고 계속 측정
      continue;
    }
    rtts.push(performance.now() - start);
  }

  if (rtts.length === 0) {
    throw new Error('지연시간 측정 실패: 대상 서버에 도달할 수 없습니다.');
  }

  const minRtt = Math.min(...rtts);
  const avgRtt = rtts.reduce((a, b) => a + b, 0) / rtts.length;

  return {
    minRttMs: round1(minRtt),
    avgRttMs: round1(avgRtt),
    estimatedOneWayMs: round1(minRtt / 2),
    samples: rtts.length,
  };
}

/** 소수점 1자리 반올림 헬퍼. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
