/**
 * ============================================================================
 *  Express 서버 / API
 * ----------------------------------------------------------------------------
 *  웹 UI(public/) 를 서빙하고, 프런트엔드가 호출하는 API 를 제공한다.
 *
 *  엔드포인트:
 *   - POST /api/ping        : 왕복 지연(latency) 측정
 *   - POST /api/inspect     : viewform 에서 fbzx / entry 필드 추출
 *   - POST /api/submit-now  : 즉시 제출 (수동 발사)
 *   - POST /api/schedule    : 예약 발사 (NDJSON 스트리밍으로 진행상황 전송)
 * ============================================================================
 */

import express, {type Request, type Response} from 'express';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {
  DEFAULT_COOKIE,
  DEFAULT_FORM_RESPONSE_URL,
  DEFAULT_LATENCY_OFFSET_MS,
  DEFAULT_PAYLOAD_TEMPLATE,
  DEFAULT_TARGET_HHMMSS,
  DEFAULT_VIEW_FORM_URL,
  SERVER_PORT,
  TOKEN_PREFETCH_LEAD_MS,
} from './config.js';
import {
  buildPayload,
  inspectForm,
  measureLatency,
  preciseWaitUntil,
  submitForm,
} from './googleForm.js';
import type {ScheduleConfig, ScheduleEvent} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const app = express();
app.use(express.json({limit: '1mb'}));
app.use(express.static(PUBLIC_DIR));

/**
 * 설정 기본값 노출.
 *  - 프런트엔드가 config.ts 의 기본값을 입력창 초기값으로 채우는 데 사용.
 */
app.get('/api/defaults', (_req: Request, res: Response) => {
  res.json({
    viewFormUrl: DEFAULT_VIEW_FORM_URL,
    formResponseUrl: DEFAULT_FORM_RESPONSE_URL,
    payloadTemplate: DEFAULT_PAYLOAD_TEMPLATE,
    targetHhmmss: DEFAULT_TARGET_HHMMSS,
    latencyOffsetMs: DEFAULT_LATENCY_OFFSET_MS,
    cookie: DEFAULT_COOKIE,
  });
});

/**
 * 왕복 지연(latency) 측정.
 *  - 프런트엔드가 주기적으로 호출하여 실시간 지연시간을 표시한다.
 */
app.post('/api/ping', async (req: Request, res: Response) => {
  const {url, cookie} = req.body as {url?: string; cookie?: string};
  if (!url) {
    res.status(400).json({error: 'url 이 필요합니다.'});
    return;
  }
  try {
    const result = await measureLatency(url, undefined, {cookie});
    res.json(result);
  } catch (err) {
    res.status(502).json({error: toMessage(err)});
  }
});

/**
 * viewform 에서 fbzx 토큰과 entry 필드 ID 를 추출 (사전 점검용).
 */
app.post('/api/inspect', async (req: Request, res: Response) => {
  const {viewFormUrl, cookie} = req.body as {
    viewFormUrl?: string;
    cookie?: string;
  };
  if (!viewFormUrl) {
    res.status(400).json({error: 'viewFormUrl 이 필요합니다.'});
    return;
  }
  try {
    const result = await inspectForm(viewFormUrl, {cookie});
    res.json(result);
  } catch (err) {
    res.status(502).json({error: toMessage(err)});
  }
});

/**
 * 즉시 제출 (수동 발사).
 *  - viewFormUrl 이 함께 오면 최신 fbzx 를 받아서 결합 후 제출한다.
 *  - 클라이언트는 응답의 html 을 새 창으로 띄운다.
 */
app.post('/api/submit-now', async (req: Request, res: Response) => {
  const {viewFormUrl, formResponseUrl, payloadTemplate, fbzx, cookie} =
    req.body as {
      viewFormUrl?: string;
      formResponseUrl?: string;
      payloadTemplate?: ScheduleConfig['payloadTemplate'];
      fbzx?: string | null;
      cookie?: string;
    };

  if (!formResponseUrl || !payloadTemplate) {
    res.status(400).json({error: 'formResponseUrl 과 payloadTemplate 이 필요합니다.'});
    return;
  }

  try {
    // fbzx 가 직접 주어지지 않았고 viewFormUrl 이 있으면 실시간 수급
    let token = fbzx ?? null;
    if (!token && viewFormUrl) {
      token = (await inspectForm(viewFormUrl, {cookie})).fbzx;
    }

    const body = buildPayload(payloadTemplate, token);
    const result = await submitForm(formResponseUrl, body, {
      cookie,
      referer: viewFormUrl,
      origin: originOf(formResponseUrl),
    });

    res.json({
      status: result.status,
      finalUrl: result.finalUrl,
      firedAt: result.firedAt,
      fbzx: token,
      // 새 창 표시를 위해 base64 로 인코딩 (대용량/특수문자 안전)
      htmlBase64: Buffer.from(result.html, 'utf8').toString('base64'),
    });
  } catch (err) {
    res.status(502).json({error: toMessage(err)});
  }
});

/**
 * 예약 발사 (정밀 자동 제출).
 *  - 진행상황을 NDJSON(줄 단위 JSON) 스트림으로 실시간 전송한다.
 *  - 흐름:
 *      목표-2.5s → fbzx 수급 → 페이로드 조립 → (목표-offset) busy-wait → POST → 응답 전송
 */
app.post('/api/schedule', async (req: Request, res: Response) => {
  const cfg = req.body as Partial<ScheduleConfig>;

  // 필수값 검증
  if (
    !cfg.viewFormUrl ||
    !cfg.formResponseUrl ||
    !cfg.targetTime ||
    !cfg.payloadTemplate
  ) {
    res.status(400).json({
      error: 'viewFormUrl, formResponseUrl, targetTime, payloadTemplate 이 필요합니다.',
    });
    return;
  }

  const latencyOffsetMs = cfg.latencyOffsetMs ?? DEFAULT_LATENCY_OFFSET_MS;

  // NDJSON 스트리밍 헤더 설정
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  /** 한 줄짜리 이벤트를 즉시 flush 하여 전송. */
  const emit = (event: ScheduleEvent): void => {
    res.write(JSON.stringify(event) + '\n');
  };
  const log = (message: string): void =>
    emit({type: 'log', message, at: Date.now()});

  try {
    const targetTime = cfg.targetTime;
    const fireTime = targetTime - latencyOffsetMs;
    const prefetchTime = targetTime - TOKEN_PREFETCH_LEAD_MS;

    log(
      `예약 접수: 목표=${fmt(targetTime)} / 발사예정=${fmt(fireTime)} ` +
        `(offset ${latencyOffsetMs}ms) / 토큰수급=${fmt(prefetchTime)}`,
    );

    // (1) 토큰 수급 시점까지 대기
    if (Date.now() < prefetchTime) {
      log(`토큰 수급 시점까지 대기 중... (${prefetchTime - Date.now()}ms)`);
      await preciseWaitUntil(prefetchTime);
    } else {
      log('⚠️ 이미 토큰 수급 시점을 지났습니다. 즉시 수급을 시도합니다.');
    }

    // (2) fbzx 실시간 수급
    log('viewform 으로 GET → fbzx 토큰 추출 중...');
    const inspect = await inspectForm(cfg.viewFormUrl, {cookie: cfg.cookie});
    emit({type: 'token', fbzx: inspect.fbzx, at: Date.now()});
    if (!inspect.fbzx) {
      log('⚠️ fbzx 토큰을 찾지 못했습니다. 토큰 없이 진행합니다(실패 가능).');
    } else {
      log(`fbzx 수급 완료 (${inspect.source}): ${inspect.fbzx}`);
    }

    // (3) 페이로드 조립
    const body = buildPayload(cfg.payloadTemplate, inspect.fbzx);
    emit({type: 'payload', preview: body, at: Date.now()});
    log('페이로드 조립 완료. 정밀 발사 대기 시작.');

    // (4) 정밀 대기 후 발사
    await preciseWaitUntil(fireTime);
    const firedAt = Date.now();
    emit({type: 'fired', at: firedAt});
    log(`🚀 발사! 실제 발사 시각=${fmt(firedAt)} (목표와 오차 ${firedAt - targetTime}ms)`);

    // (5) 제출 및 응답 반환
    const result = await submitForm(cfg.formResponseUrl, body, {
      cookie: cfg.cookie,
      referer: cfg.viewFormUrl,
      origin: originOf(cfg.formResponseUrl),
    });
    log(`응답 수신: HTTP ${result.status} / finalUrl=${result.finalUrl}`);
    emit({
      type: 'response',
      status: result.status,
      finalUrl: result.finalUrl,
      htmlBase64: Buffer.from(result.html, 'utf8').toString('base64'),
    });
    emit({type: 'done'});
  } catch (err) {
    emit({type: 'error', message: toMessage(err)});
  } finally {
    res.end();
  }
});

app.listen(SERVER_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Formlympic 서버 실행 중 → http://localhost:${SERVER_PORT}`);
});

/** URL 에서 origin(scheme+host) 만 추출. 실패 시 undefined. */
function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** 에러 객체를 사람이 읽을 수 있는 메시지로 변환. */
function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/** epoch ms 를 HH:mm:ss.SSS 로 포맷. */
function fmt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, len = 2) => String(n).padStart(len, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(
    d.getMilliseconds(),
    3,
  )}`;
}
