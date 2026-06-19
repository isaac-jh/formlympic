/**
 * ============================================================================
 *  Formlympic 프런트엔드 로직
 * ----------------------------------------------------------------------------
 *  - 폼 주소/토큰 점검, 즉시 제출, 지연시간 주기 측정, 예약 발사(스트리밍)
 *  - formResponse 응답 HTML 은 새 창으로 표시
 * ============================================================================
 */

'use strict';

/** DOM 헬퍼 */
const $ = (id) => document.getElementById(id);

/** 입력된 로그인 쿠키(트림). 비어있으면 undefined. */
function getCookie() {
  const v = el.cookie.value.trim();
  return v || undefined;
}

const el = {
  viewFormUrl: $('viewFormUrl'),
  formResponseUrl: $('formResponseUrl'),
  cookie: $('cookie'),
  btnInspect: $('btnInspect'),
  btnSubmitNow: $('btnSubmitNow'),
  inspectResult: $('inspectResult'),
  btnPingToggle: $('btnPingToggle'),
  latMin: $('latMin'),
  latAvg: $('latAvg'),
  latOneWay: $('latOneWay'),
  btnApplyOffset: $('btnApplyOffset'),
  payloadTemplate: $('payloadTemplate'),
  payloadError: $('payloadError'),
  targetDateTime: $('targetDateTime'),
  targetMs: $('targetMs'),
  latencyOffset: $('latencyOffset'),
  countdown: $('countdown'),
  btnSchedule: $('btnSchedule'),
  btnQuick: $('btnQuick'),
  log: $('log'),
};

/** 측정된 최소 편도 지연(추정) 보관 */
let lastEstimatedOneWay = null;
/** 주기 ping 인터벌 핸들 */
let pingTimer = null;
/** 카운트다운 인터벌 핸들 */
let countdownTimer = null;

// --------------------------------------------------------------------------
// 로그 출력
// --------------------------------------------------------------------------

/** 로그 한 줄을 콘솔 영역에 추가한다. level: 'info'|'ok'|'warn'|'err' */
function logLine(message, level = 'info') {
  const ts = new Date().toLocaleTimeString('ko-KR', {hour12: false});
  const span = document.createElement('span');
  span.className = level === 'info' ? '' : level;
  span.textContent = message;
  const line = document.createElement('div');
  line.innerHTML = `<span class="ts">[${ts}]</span> `;
  line.appendChild(span);
  el.log.appendChild(line);
  el.log.scrollTop = el.log.scrollHeight;
}

// --------------------------------------------------------------------------
// 초기화: 서버 기본값 로드
// --------------------------------------------------------------------------

async function loadDefaults() {
  try {
    const res = await fetch('/api/defaults');
    const d = await res.json();
    el.viewFormUrl.value = d.viewFormUrl;
    el.formResponseUrl.value = d.formResponseUrl;
    el.payloadTemplate.value = JSON.stringify(d.payloadTemplate, null, 2);
    el.latencyOffset.value = d.latencyOffsetMs;
    if (d.cookie) el.cookie.value = d.cookie;
    // 목표 시간 기본값: 오늘 + 기본 HH:mm:ss
    presetTargetTime(d.targetHhmmss);
    logLine('기본 설정을 불러왔습니다. (config.ts)', 'ok');
  } catch (err) {
    logLine('기본 설정 로드 실패: ' + err.message, 'err');
  }
}

/** datetime-local 입력값을 "오늘 + HH:mm:ss" 로 세팅한다. */
function presetTargetTime(hhmmss) {
  const [h, m, s] = (hhmmss || '08:00:00').split(':').map(Number);
  const now = new Date();
  now.setHours(h, m, s, 0);
  el.targetDateTime.value = toDatetimeLocal(now);
  el.targetMs.value = 0;
}

/** Date → datetime-local(value) 문자열 (로컬 타임존, 초 단위 포함) */
function toDatetimeLocal(date) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

/** 입력된 목표 시간(날짜+초+ms)을 epoch ms 로 계산한다. */
function getTargetEpoch() {
  if (!el.targetDateTime.value) return null;
  const base = new Date(el.targetDateTime.value).getTime();
  const ms = Number(el.targetMs.value) || 0;
  return base + ms;
}

/** 템플릿 textarea 를 파싱하여 객체로 반환. 오류 시 null. */
function parsePayloadTemplate() {
  el.payloadError.textContent = '';
  try {
    const obj = JSON.parse(el.payloadTemplate.value);
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      throw new Error('최상위는 객체여야 합니다.');
    }
    return obj;
  } catch (err) {
    el.payloadError.textContent = 'JSON 파싱 오류: ' + err.message;
    return null;
  }
}

// --------------------------------------------------------------------------
// (1) 토큰/필드 추출
// --------------------------------------------------------------------------

el.btnInspect.addEventListener('click', async () => {
  const viewFormUrl = el.viewFormUrl.value.trim();
  if (!viewFormUrl) return;
  el.btnInspect.disabled = true;
  el.inspectResult.textContent = '추출 중...';
  try {
    const res = await fetch('/api/inspect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({viewFormUrl, cookie: getCookie()}),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '실패');
    el.inspectResult.innerHTML =
      `<b>fbzx</b>: ${data.fbzx ?? '(없음)'} <span class="muted">(${data.source})</span>\n` +
      `<b>감지된 entry 필드</b> (${data.detectedEntryIds.length}개):\n  ` +
      (data.detectedEntryIds.join('\n  ') || '(없음)');
    logLine(`토큰 추출 완료: fbzx=${data.fbzx ?? '없음'}`, data.fbzx ? 'ok' : 'warn');
  } catch (err) {
    el.inspectResult.textContent = '오류: ' + err.message;
    logLine('토큰 추출 오류: ' + err.message, 'err');
  } finally {
    el.btnInspect.disabled = false;
  }
});

// --------------------------------------------------------------------------
// (2) 즉시 제출 (수동 발사)
// --------------------------------------------------------------------------

el.btnSubmitNow.addEventListener('click', async () => {
  const formResponseUrl = el.formResponseUrl.value.trim();
  const viewFormUrl = el.viewFormUrl.value.trim();
  const payloadTemplate = parsePayloadTemplate();
  if (!formResponseUrl || !payloadTemplate) return;

  el.btnSubmitNow.disabled = true;
  logLine('즉시 제출 요청 전송 중...');
  try {
    const res = await fetch('/api/submit-now', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        viewFormUrl,
        formResponseUrl,
        payloadTemplate,
        cookie: getCookie(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '실패');
    logLine(`제출 완료: HTTP ${data.status} / fbzx=${data.fbzx ?? '없음'}`, 'ok');
    openResponseWindow(data.htmlBase64, data.finalUrl);
  } catch (err) {
    logLine('즉시 제출 오류: ' + err.message, 'err');
  } finally {
    el.btnSubmitNow.disabled = false;
  }
});

// --------------------------------------------------------------------------
// (3) 지연시간 주기 측정
// --------------------------------------------------------------------------

el.btnPingToggle.addEventListener('click', () => {
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
    el.btnPingToggle.textContent = '주기적 측정 시작';
    logLine('지연시간 측정 중지');
    return;
  }
  const url = el.viewFormUrl.value.trim();
  if (!url) {
    logLine('viewForm URL 을 먼저 입력하세요.', 'warn');
    return;
  }
  el.btnPingToggle.textContent = '측정 중지';
  logLine('지연시간 주기 측정 시작 (1초 간격)');
  const tick = () => measureOnce(url);
  tick();
  pingTimer = setInterval(tick, 1000);
});

/** 1회 지연시간 측정 후 화면 갱신. */
async function measureOnce(url) {
  try {
    const res = await fetch('/api/ping', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url, cookie: getCookie()}),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || '실패');
    el.latMin.textContent = d.minRttMs + ' ms';
    el.latAvg.textContent = d.avgRttMs + ' ms';
    el.latOneWay.textContent = d.estimatedOneWayMs + ' ms';
    lastEstimatedOneWay = d.estimatedOneWayMs;
  } catch (err) {
    logLine('지연 측정 오류: ' + err.message, 'err');
  }
}

el.btnApplyOffset.addEventListener('click', () => {
  if (lastEstimatedOneWay == null) {
    logLine('먼저 지연시간을 측정하세요.', 'warn');
    return;
  }
  el.latencyOffset.value = Math.round(lastEstimatedOneWay);
  logLine(`발사 offset 을 추정 편도값 ${el.latencyOffset.value}ms 로 적용`, 'ok');
});

// --------------------------------------------------------------------------
// (4) 예약 발사 (NDJSON 스트리밍 수신)
// --------------------------------------------------------------------------

el.btnQuick.addEventListener('click', () => {
  const t = new Date(Date.now() + 10_000);
  el.targetDateTime.value = toDatetimeLocal(t);
  el.targetMs.value = t.getMilliseconds();
  logLine('목표 시간을 현재+10초로 설정');
});

el.btnSchedule.addEventListener('click', async () => {
  const viewFormUrl = el.viewFormUrl.value.trim();
  const formResponseUrl = el.formResponseUrl.value.trim();
  const payloadTemplate = parsePayloadTemplate();
  const targetTime = getTargetEpoch();
  const latencyOffsetMs = Number(el.latencyOffset.value) || 0;

  if (!viewFormUrl || !formResponseUrl || !payloadTemplate || !targetTime) {
    logLine('필수 입력값(폼 주소/템플릿/목표시간)을 확인하세요.', 'warn');
    return;
  }
  if (targetTime <= Date.now()) {
    logLine('목표 시간이 이미 지났습니다.', 'warn');
    return;
  }

  el.btnSchedule.disabled = true;
  startCountdown(targetTime);
  logLine('예약 발사 시작 → 서버 스트림 연결', 'ok');

  try {
    const res = await fetch('/api/schedule', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        viewFormUrl,
        formResponseUrl,
        targetTime,
        latencyOffsetMs,
        payloadTemplate,
        cookie: getCookie(),
      }),
    });
    await consumeNdjson(res, handleScheduleEvent);
  } catch (err) {
    logLine('예약 발사 오류: ' + err.message, 'err');
  } finally {
    el.btnSchedule.disabled = false;
    stopCountdown();
  }
});

/** 스트림 이벤트 1건 처리. */
function handleScheduleEvent(evt) {
  switch (evt.type) {
    case 'log':
      logLine(evt.message);
      break;
    case 'token':
      logLine(`토큰 이벤트: fbzx=${evt.fbzx ?? '없음'}`, evt.fbzx ? 'ok' : 'warn');
      break;
    case 'payload':
      logLine('페이로드: ' + evt.preview);
      break;
    case 'fired':
      logLine('🚀 발사 시각 기록됨', 'ok');
      break;
    case 'response':
      logLine(`응답 수신: HTTP ${evt.status}`, 'ok');
      openResponseWindow(evt.htmlBase64, evt.finalUrl);
      break;
    case 'error':
      logLine('서버 오류: ' + evt.message, 'err');
      break;
    case 'done':
      logLine('예약 발사 완료.', 'ok');
      break;
    default:
      break;
  }
}

/** fetch 응답 본문을 NDJSON(줄 단위 JSON)으로 읽어 콜백 호출. */
async function consumeNdjson(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line) {
        try {
          onEvent(JSON.parse(line));
        } catch {
          /* 부분 라인 무시 */
        }
      }
    }
  }
}

// --------------------------------------------------------------------------
// 카운트다운
// --------------------------------------------------------------------------

function startCountdown(targetTime) {
  stopCountdown();
  const update = () => {
    const remain = targetTime - Date.now();
    if (remain <= 0) {
      el.countdown.textContent = 'T-0';
      return;
    }
    el.countdown.textContent = 'T-' + (remain / 1000).toFixed(2) + 's';
  };
  update();
  countdownTimer = setInterval(update, 50);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

// --------------------------------------------------------------------------
// 응답 HTML 새 창 표시
// --------------------------------------------------------------------------

/**
 * base64 로 받은 응답 HTML 을 새 창으로 띄운다.
 *  - 상대 경로 리소스(css/img)가 깨지지 않도록 <base href> 를 주입한다.
 */
function openResponseWindow(htmlBase64, finalUrl) {
  try {
    // base64 → UTF-8 디코딩
    const bytes = Uint8Array.from(atob(htmlBase64), (c) => c.charCodeAt(0));
    let html = new TextDecoder('utf-8').decode(bytes);

    // <base href> 주입 (finalUrl 의 origin 기준)
    const origin = safeOrigin(finalUrl);
    if (origin && !/<base\s/i.test(html)) {
      const baseTag = `<base href="${origin}/">`;
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => m + baseTag)
        : baseTag + html;
    }

    const blob = new Blob([html], {type: 'text/html'});
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (!win) {
      logLine('팝업이 차단되었습니다. 새 창 허용이 필요합니다.', 'warn');
    }
    // 메모리 정리는 약간의 지연 후 (창 로딩 보장)
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    logLine('응답 표시 오류: ' + err.message, 'err');
  }
}

/** URL 에서 origin 만 안전하게 추출. */
function safeOrigin(u) {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
}

// 부팅
loadDefaults();
