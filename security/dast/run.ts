/** Active tests against a new loopback-only, synthetic in-memory application. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from 'node:net';
import { chromium } from '@playwright/test';
import { buildApp } from '../../api/src/app.js';
import { loadConfig } from '../../api/src/config.js';
import type { TripContract } from '../../schema/src/trip-contract.js';

const origin = 'http://127.0.0.1:4399';
const context = await buildApp(
  loadConfig({
    APP_MODE: 'demo',
    HOST: '127.0.0.1',
    PORT: '4399',
    PUBLIC_URL: origin,
    LLM_ENABLED: 'false',
    ALLOW_DEMO_EXTERNAL_STORES: 'false',
  }),
);
await context.app.listen({ host: '127.0.0.1', port: 4399 });
const cases: Array<{ name: string; status: 'PASS' | 'FAIL'; observed?: number }> = [];
let requests = 0;
async function http(path: string, init: RequestInit = {}) {
  requests++;
  if (
    init.body === undefined &&
    ['POST', 'PUT', 'PATCH'].includes(init.method ?? '') &&
    new Headers(init.headers).get('content-type') === 'application/json'
  )
    init = { ...init, body: '{}' };
  return fetch(origin + path, { ...init, redirect: 'manual', signal: AbortSignal.timeout(8000) });
}
async function probe(
  name: string,
  path: string,
  expected: number | number[],
  init: RequestInit = {},
) {
  const response = await http(path, init);
  const ok = (Array.isArray(expected) ? expected : [expected]).includes(response.status);
  cases.push({ name, status: ok ? 'PASS' : 'FAIL', observed: response.status });
  return response;
}
async function login() {
  const response = await http('/auth/demo', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: '{}',
  });
  if (response.status !== 200) throw new Error('DAST_LOGIN_FAILED');
  const data = (await response.json()) as { csrf: string; userId: string; workspaceId: string };
  const cookie = response.headers
    .getSetCookie()
    .filter((value) => value.startsWith('tr_session='))
    .at(-1)
    ?.split(';')[0];
  if (!cookie) throw new Error('DAST_COOKIE_MISSING');
  return {
    ...data,
    cookie,
    headers: { origin, cookie, 'x-csrf-token': data.csrf, 'content-type': 'application/json' },
  };
}
function raw(request: string): Promise<string> {
  return new Promise((done, reject) => {
    const socket = connect(4399, '127.0.0.1');
    let data = '';
    socket.setTimeout(5000, () => socket.destroy(new Error('DAST_RAW_TIMEOUT')));
    socket.on('connect', () => socket.end(request));
    socket.on('data', (chunk) => {
      data += String(chunk);
      if (data.length > 65536) socket.destroy(new Error('DAST_OUTPUT_LIMIT'));
    });
    socket.on('error', reject);
    socket.on('close', () => done(data));
  });
}
try {
  for (const route of context.apiRoutes.filter(
    (r) => r.method === 'GET' && r.url.startsWith('/v1/'),
  )) {
    await probe(
      'anonymous read ' + route.url,
      route.url.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000'),
      401,
    );
  }
  for (const hostile of [
    'https://attacker.example.invalid',
    'null',
    'http://127.0.0.1.attacker.example.invalid:4399',
  ]) {
    await probe('login Origin rejection', '/auth/demo', 403, {
      method: 'POST',
      headers: { origin: hostile, 'content-type': 'application/json' },
      body: '{}',
    });
  }
  const a = await login(),
    b = await login();
  const created = await probe('create synthetic trip', '/v1/trips/demo', 201, {
    method: 'POST',
    headers: a.headers,
  });
  const trip = (await created.json()) as {
    id: string;
    version: number;
    data: TripContract;
  };
  await probe('cross-tenant trip read', '/v1/trips/' + trip.id, 404, { headers: b.headers });
  await probe('workspace header forgery', '/v1/trips', 403, {
    headers: { ...b.headers, 'x-workspace-id': a.workspaceId },
  });
  await probe('missing CSRF', '/v1/trips/demo', 403, {
    method: 'POST',
    headers: { cookie: a.cookie, origin },
  });
  await probe('wrong CSRF', '/v1/trips/demo', 403, {
    method: 'POST',
    headers: { ...a.headers, 'x-csrf-token': 'SYNTHETIC-WRONG' },
  });
  await probe('absent Origin', '/v1/trips/demo', 403, {
    method: 'POST',
    headers: { cookie: a.cookie, 'x-csrf-token': a.csrf },
  });
  await probe('malformed JSON', '/v1/trips', 400, {
    method: 'POST',
    headers: a.headers,
    body: '{',
  });
  await probe('prototype pollution body', '/v1/trips', 400, {
    method: 'POST',
    headers: a.headers,
    body: '{"__proto__":{"dastPolluted":true}}',
  });
  cases.push({
    name: 'prototype stays clean',
    status: ({} as Record<string, unknown>).dastPolluted === undefined ? 'PASS' : 'FAIL',
  });
  await probe('unsupported content type', '/v1/trips', 415, {
    method: 'POST',
    headers: { ...a.headers, 'content-type': 'application/xml' },
    body: '<synthetic/>',
  });
  await probe('body size limit', '/v1/trips', 413, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ oversized: 'x'.repeat(2 * 1024 * 1024) }),
  });
  const amplified = await probe('bounded schema diagnostics', '/v1/trips', 422, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({
      ...trip.data,
      ...Object.fromEntries(Array.from({ length: 12000 }, (_, i) => ['synthetic' + i, 'invalid'])),
    }),
  });
  cases.push({
    name: 'schema response under 4KiB',
    status: (await amplified.text()).length < 4096 ? 'PASS' : 'FAIL',
  });
  for (const path of ['/v1/tools/__proto__', '/v1/tools/constructor', '/v1/tools/toString'])
    await probe('unknown planning tool', path, [400, 404], {
      method: 'POST',
      headers: a.headers,
      body: '{}',
    });
  const markup = 'SYNTHETIC-XSS<img src=x onerror="globalThis.dastXss=true">';
  const changed = await probe('store untrusted title as data', '/v1/trips/' + trip.id, 200, {
    method: 'PUT',
    headers: { ...a.headers, 'if-match': String(trip.version) },
    body: JSON.stringify({ ...trip.data, title: markup }),
  });
  const changedTrip = (await changed.json()) as { version: number };
  await probe('stale edit rejection', '/v1/trips/' + trip.id, 409, {
    method: 'PUT',
    headers: { ...a.headers, 'if-match': String(trip.version) },
    body: JSON.stringify(trip.data),
  });
  const pageResponse = await http('/');
  for (const [header, expected] of [
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'no-referrer'],
    ['cache-control', 'no-store'],
  ])
    cases.push({
      name: 'header ' + header,
      status: pageResponse.headers.get(header!)?.includes(expected!) ? 'PASS' : 'FAIL',
    });
  cases.push({
    name: 'restrictive CSP',
    status:
      pageResponse.headers.get('content-security-policy')?.includes("object-src 'none'") &&
      pageResponse.headers
        .get('content-security-policy')
        ?.split(';')
        .some((directive) => directive.trim() === "font-src 'self'")
        ? 'PASS'
        : 'FAIL',
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const browserContext = await browser.newContext();
    const [cookieName, ...cookieValue] = a.cookie.split('=');
    await browserContext.addCookies([
      {
        name: cookieName!,
        value: cookieValue.join('='),
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
    const page = await browserContext.newPage();
    await page.goto(origin);
    const option = page.locator('#trip option').filter({ hasText: markup });
    await option.waitFor({ state: 'attached' });
    cases.push({
      name: 'stored markup rendered as text',
      status:
        (await option.textContent()) === markup &&
        (await page.locator('img[src="x"]').count()) === 0 &&
        !(await page.evaluate(() => (globalThis as unknown as Record<string, unknown>).dastXss))
          ? 'PASS'
          : 'FAIL',
    });
    await browserContext.close();
  } finally {
    await browser.close();
  }
  const calendarPayload = {
    ...trip.data,
    services: trip.data.services.map((service, index) =>
      index === 0
        ? { ...service, title: 'Synthetic\rATTACH:https://example.invalid/asset' }
        : service,
    ),
  };
  await probe('store calendar delimiter as data', '/v1/trips/' + trip.id, 200, {
    method: 'PUT',
    headers: { ...a.headers, 'if-match': String(changedTrip.version) },
    body: JSON.stringify(calendarPayload),
  });
  const calendar = await probe(
    'private calendar export',
    '/v1/trips/' + trip.id + '/export?format=ics&privacy=private',
    200,
    { headers: a.headers },
  );
  cases.push({
    name: 'no injected calendar property',
    status: /(?:^|\r\n)ATTACH:/.test(await calendar.text()) ? 'FAIL' : 'PASS',
  });
  await probe('grant viewer', '/v1/workspace/members', 200, {
    method: 'POST',
    headers: a.headers,
    body: JSON.stringify({ userId: b.userId, role: 'viewer' }),
  });
  const viewer = { ...b.headers, 'x-workspace-id': a.workspaceId };
  await probe('viewer reads authorized trip', '/v1/trips/' + trip.id, 200, { headers: viewer });
  await probe('viewer write denied', '/v1/trips/demo', 403, { method: 'POST', headers: viewer });
  await probe('viewer privilege escalation denied', '/v1/workspace/members', 403, {
    method: 'POST',
    headers: viewer,
    body: JSON.stringify({ userId: b.userId, role: 'owner' }),
  });
  const smuggle = await raw(
    'POST /health HTTP/1.1\r\nHost: 127.0.0.1:4399\r\nContent-Length: 1\r\nContent-Length: 7\r\nConnection: close\r\n\r\nx',
  );
  cases.push({
    name: 'conflicting content lengths rejected',
    status: /^HTTP\/1\.1 400/.test(smuggle) ? 'PASS' : 'FAIL',
  });
  const traversal = await raw(
    'GET /%2e%2e/package.json HTTP/1.1\r\nHost: 127.0.0.1:4399\r\nConnection: close\r\n\r\n',
  );
  cases.push({
    name: 'static traversal does not expose package source',
    status:
      !traversal.includes('"dependencies"') && /HTTP\/1\.1 (400|403|404)/.test(traversal)
        ? 'PASS'
        : 'FAIL',
  });
  await probe('logout', '/auth/logout', 200, { method: 'POST', headers: a.headers });
  await probe('session revoked', '/v1/trips', 401, { headers: a.headers });
  await probe('health after hostile traffic', '/health', 200);
} finally {
  await context.app.close();
}
const report = {
  target: 'isolated-loopback-memory-demo',
  requests,
  passed: cases.filter((c) => c.status === 'PASS').length,
  failed: cases.filter((c) => c.status === 'FAIL'),
  cases,
  limits: [
    'no external provider, deployment TLS or live identity-provider assessment',
    'no real personal data',
    'bounded tests, not an exhaustive penetration test',
  ],
};
await mkdir(resolve('.local/security-audit/dast'), { recursive: true });
await writeFile(
  resolve('.local/security-audit/dast/authenticated.json'),
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify({ target: report.target, requests, passed: report.passed, failed: report.failed }),
);
if (report.failed.length) process.exitCode = 1;
