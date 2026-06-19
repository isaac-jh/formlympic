/**
 * 핵심 순수 함수 단위 테스트 (node:test).
 *  - 네트워크가 필요한 함수(inspectForm/submitForm/measureLatency)는 제외하고,
 *    파싱/조립/타이머 로직을 검증한다.
 */

import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {
  buildPayload,
  extractTokens,
  preciseWaitUntil,
} from '../src/googleForm.js';

test('extractTokens: hidden input 에서 fbzx 와 entry 추출', () => {
  const html = `
    <form action="/formResponse">
      <input type="hidden" name="fbzx" value="-1234567890123456789">
      <input type="text" name="entry.111">
      <input type="text" name="entry.222">
      <input type="text" name="entry.222">
    </form>`;
  const r = extractTokens(html);
  assert.equal(r.fbzx, '-1234567890123456789');
  assert.equal(r.source, 'cheerio');
  assert.deepEqual(r.detectedEntryIds, ['entry.111', 'entry.222']);
});

test('extractTokens: 정규식 폴백 (JS 데이터 내 fbzx)', () => {
  // hidden input 이 없고 스크립트 데이터에만 존재하는 경우
  const html = `<script>var x = {"foo":1,"fbzx":"987654321"};</script>
                <div data-id="entry.999"></div>`;
  const r = extractTokens(html);
  assert.equal(r.fbzx, '987654321');
  assert.equal(r.source, 'regex');
  assert.ok(r.detectedEntryIds.includes('entry.999'));
});

test('extractTokens: 토큰이 없으면 null + source none', () => {
  const r = extractTokens('<html><body>no token</body></html>');
  assert.equal(r.fbzx, null);
  assert.equal(r.source, 'none');
});

test('buildPayload: 시스템 필드 자동 주입', () => {
  const body = buildPayload({'entry.111': '홍길동'}, '42');
  const params = new URLSearchParams(body);
  assert.equal(params.get('entry.111'), '홍길동');
  assert.equal(params.get('fbzx'), '42');
  assert.equal(params.get('fvv'), '1');
  assert.equal(params.get('pageHistory'), '0');
  assert.ok(Number(params.get('submissionTimestamp')) > 0);
  assert.ok(Number(params.get('dlut')) > 0);
  // partialResponse 의 마지막 원소에 fbzx 가 포함되어야 한다.
  assert.deepEqual(JSON.parse(params.get('partialResponse') ?? ''), [
    null,
    null,
    '42',
  ]);
});

test('buildPayload: 배열 값은 복수 append (체크박스)', () => {
  const body = buildPayload({'entry.7': ['A', 'B', 'C']}, null);
  const params = new URLSearchParams(body);
  assert.deepEqual(params.getAll('entry.7'), ['A', 'B', 'C']);
  // fbzx 가 null 이면 미포함
  assert.equal(params.get('fbzx'), null);
});

test('preciseWaitUntil: 목표 시각 근처에서 깨어남 (오차 작음)', async () => {
  const target = Date.now() + 200;
  await preciseWaitUntil(target);
  const drift = Date.now() - target;
  // busy-wait 특성상 약간 늦게 깨어나는 정도는 허용 (0 ~ +15ms)
  assert.ok(drift >= 0, `drift 가 음수: ${drift}`);
  assert.ok(drift < 20, `오차가 너무 큼: ${drift}ms`);
});
