import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
const running: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map((context) => context.app.close()));
});
async function setup() {
  const context = await buildApp(loadConfig({ APP_MODE: 'demo' }));
  running.push(context);
  await context.app.ready();
  return context;
}
async function login(context: Awaited<ReturnType<typeof buildApp>>) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/auth/demo',
    headers: { origin: 'http://127.0.0.1:4310' },
  });
  expect(response.statusCode).toBe(200);
  return {
    cookie: response.cookies.find((c) => c.name === 'tr_session')!.value,
    session: response.json() as { csrf: string; userId: string; workspaceId: string },
  };
}
function headers(identity: Awaited<ReturnType<typeof login>>) {
  return {
    cookie: 'tr_session=' + identity.cookie,
    origin: 'http://127.0.0.1:4310',
    'x-csrf-token': identity.session.csrf,
  };
}
describe('HTTP security and trip workflow', () => {
  it('requires login, origin and CSRF before mutation', async () => {
    const context = await setup();
    expect((await context.app.inject('/v1/trips')).statusCode).toBe(401);
    expect(
      (
        await context.app.inject({
          method: 'POST',
          url: '/auth/demo',
          headers: { origin: 'https://attacker.example.invalid' },
        })
      ).statusCode,
    ).toBe(403);
    const identity = await login(context);
    expect(
      (
        await context.app.inject({
          method: 'POST',
          url: '/v1/trips/demo',
          headers: { cookie: 'tr_session=' + identity.cookie },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('isolates trips and documents and prevents stale edits', async () => {
    const context = await setup(),
      a = await login(context),
      b = await login(context);
    const made = await context.app.inject({
      method: 'POST',
      url: '/v1/trips/demo',
      headers: headers(a),
    });
    expect(made.statusCode).toBe(201);
    const trip = made.json();
    expect(
      (await context.app.inject({ url: '/v1/trips/' + trip.id, headers: headers(b) })).statusCode,
    ).toBe(404);
    expect(
      (
        await context.app.inject({
          url: '/v1/trips',
          headers: { ...headers(b), 'x-workspace-id': a.session.workspaceId },
        })
      ).statusCode,
    ).toBe(403);
    const updated = await context.app.inject({
      method: 'PUT',
      url: '/v1/trips/' + trip.id,
      headers: { ...headers(a), 'if-match': '1' },
      payload: { ...trip.data, title: 'Synthetic changed title' },
    });
    expect(updated.statusCode).toBe(200);
    expect(
      (
        await context.app.inject({
          method: 'PUT',
          url: '/v1/trips/' + trip.id,
          headers: { ...headers(a), 'if-match': '1' },
          payload: trip.data,
        })
      ).statusCode,
    ).toBe(409);
  });
  it('uses viewer membership as a read-only boundary', async () => {
    const context = await setup(),
      a = await login(context),
      b = await login(context);
    const grant = await context.app.inject({
      method: 'POST',
      url: '/v1/workspace/members',
      headers: headers(a),
      payload: { userId: b.session.userId, role: 'viewer' },
    });
    expect(grant.statusCode).toBe(200);
    const scoped = { ...headers(b), 'x-workspace-id': a.session.workspaceId };
    expect((await context.app.inject({ url: '/v1/trips', headers: scoped })).statusCode).toBe(200);
    expect(
      (await context.app.inject({ method: 'POST', url: '/v1/trips/demo', headers: scoped }))
        .statusCode,
    ).toBe(403);
  });
  it('exports a PDF and calendar, then deletes the workspace', async () => {
    const context = await setup(),
      identity = await login(context);
    const trip = (
      await context.app.inject({
        method: 'POST',
        url: '/v1/trips/demo',
        headers: headers(identity),
      })
    ).json();
    const pdf = await context.app.inject({
      url: `/v1/trips/${trip.id}/export?format=pdf`,
      headers: headers(identity),
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const ics = await context.app.inject({
      url: `/v1/trips/${trip.id}/export?format=ics`,
      headers: headers(identity),
    });
    expect(ics.payload).toContain('BEGIN:VCALENDAR');
    expect(ics.headers['x-export-privacy']).toBe('minimal');
    expect(ics.payload).not.toContain('SYNTHETIC-FLIGHT-A');
    const privateCalendar = await context.app.inject({
      url: `/v1/trips/${trip.id}/export?format=ics&privacy=private`,
      headers: headers(identity),
    });
    expect(privateCalendar.payload).toContain('SYNTHETIC-FLIGHT-A');
    expect(
      (
        await context.app.inject({
          method: 'DELETE',
          url: '/v1/workspace',
          headers: headers(identity),
        })
      ).statusCode,
    ).toBe(200);
    expect(await context.records.list(identity.session.workspaceId, 'trip')).toHaveLength(0);
    expect(
      (await context.app.inject({ url: '/v1/trips', headers: headers(identity) })).statusCode,
    ).toBe(401);
  });
});

describe('safe HTTP input failures', () => {
  it('reports malformed JSON and unsupported media types without echoing bodies', async () => {
    const context = await setup();
    const invalid = await context.app.inject({
      method: 'POST',
      url: '/v1/trips',
      headers: { 'content-type': 'application/json' },
      payload: '{SYNTHETIC-PRIVATE-BODY',
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.payload).not.toContain('SYNTHETIC-PRIVATE-BODY');
    const unsupported = await context.app.inject({
      method: 'POST',
      url: '/v1/trips',
      headers: { 'content-type': 'application/x-synthetic' },
      payload: 'SYNTHETIC-PRIVATE-BODY',
    });
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.payload).not.toContain('SYNTHETIC-PRIVATE-BODY');
  });
  it('returns 413 for the JSON body limit', async () => {
    const context = await setup();
    const response = await context.app.inject({
      method: 'POST',
      url: '/v1/trips',
      headers: { 'content-type': 'application/json' },
      payload: '"' + 'x'.repeat(2 * 1024 * 1024) + '"',
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe('SIZE_LIMIT');
  });
});
