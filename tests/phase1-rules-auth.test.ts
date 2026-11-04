import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
import { demoTrip } from '../api/src/demo.js';
import { AppError } from '../api/src/errors.js';
import { EFFECTIVE_DATE_AMBIGUOUS, brazilCivilDates, rightsFor } from '../api/src/rules.js';
import type { DisruptionEvent } from '../schema/src/domain.js';

function event(occurredAt: string): DisruptionEvent {
  return {
    id: 'synthetic-event',
    tripId: 'synthetic-trip',
    serviceId: 'flight-a',
    kind: 'delay',
    occurredAt,
    waitingMinutes: 121,
    overnight: false,
    specialAssistance: false,
    providerResponsibility: 'unknown',
    description: 'Synthetic report',
    documentIds: [],
    amountMinor: null,
    currency: null,
    source: 'user',
    phase: 'departure',
    refundChoice: 'continue',
    residentAtOrigin: false,
    exceptionalConditions: 'none',
  };
}
const now = new Date('2026-10-29T18:00:00Z');
function trip() {
  const value = demoTrip();
  value.services.find((s) => s.id === 'flight-a')!.regulatoryScope = 'br_air_transport';
  return value;
}
const advice = (occurredAt: string) => rightsFor(trip(), event(occurredAt), now);
const ids = (occurredAt: string) => advice(occurredAt).map((r) => r.ruleId);

describe('A3-01: effective date does not depend on the written offset', () => {
  it('gives one civil date when every Brazilian zone agrees', () => {
    expect(brazilCivilDates('2026-10-26T12:00:00Z')).toEqual(['2026-10-26']);
    expect(brazilCivilDates('2026-10-26T09:00:00-03:00')).toEqual(['2026-10-26']);
  });
  it('treats -03:00 and Z spellings of one instant alike at the 2026-10-26 cut', () => {
    // Before the fix the Z spelling was dated 2026-10-26 and the -03:00 one 2026-10-25.
    for (const [local, utc] of [
      ['2026-10-25T22:00:00-03:00', '2026-10-26T01:00:00Z'],
      ['2026-10-26T09:00:00-03:00', '2026-10-26T12:00:00Z'],
    ] as const)
      expect(advice(local)).toEqual(advice(utc));
    expect(ids('2026-10-26T01:00:00Z')).toContain('BR-AIR-COMMUNICATION-LEGACY');
    expect(ids('2026-10-26T01:00:00Z')).not.toContain('BR-AIR-FOOD-2026');
    expect(ids('2026-10-26T12:00:00Z')).toContain('BR-AIR-FOOD-2026');
    expect(ids('2026-10-26T12:00:00Z')).not.toContain('BR-AIR-COMMUNICATION-LEGACY');
  });
  it('treats -03:00 and Z spellings of one instant alike at the 2026-11-25 cut', () => {
    for (const [local, utc] of [
      ['2026-11-24T22:00:00-03:00', '2026-11-25T01:00:00Z'],
      ['2026-11-25T09:00:00-03:00', '2026-11-25T12:00:00Z'],
    ] as const)
      expect(advice(local)).toEqual(advice(utc));
    expect(ids('2026-11-25T01:00:00Z')).toContain('BR-AIR-INFORMATION-LEGACY');
    expect(ids('2026-11-25T01:00:00Z')).not.toContain('BR-AIR-INFORMATION-20261125');
    expect(ids('2026-11-25T12:00:00Z')).toContain('BR-AIR-INFORMATION-20261125');
    expect(ids('2026-11-25T12:00:00Z')).not.toContain('BR-AIR-INFORMATION-LEGACY');
  });
  it('switches at local midnight of the first and last Brazilian zones', () => {
    // 02:00Z is midnight in Noronha (UTC-2); 05:00Z is midnight in Rio Branco (UTC-5).
    expect(brazilCivilDates('2026-10-26T01:59:59Z')).toEqual(['2026-10-25']);
    expect(brazilCivilDates('2026-10-26T02:00:00Z')).toEqual(['2026-10-25', '2026-10-26']);
    expect(brazilCivilDates('2026-10-26T04:59:59Z')).toEqual(['2026-10-25', '2026-10-26']);
    expect(brazilCivilDates('2026-10-26T05:00:00Z')).toEqual(['2026-10-26']);
  });
});

describe('A3-01: ambiguous effective date', () => {
  it('marks only window-sensitive rules as needs_review with a stable reason', () => {
    expect(advice('2026-10-25T12:00:00Z').find((r) => r.ruleId === 'BR-AIR-FOOD-LEGACY')).toEqual(
      expect.objectContaining({ status: 'applicable' }),
    );
    const ambiguous = advice('2026-10-26T02:30:00Z');
    for (const ruleId of [
      'BR-AIR-COMMUNICATION-LEGACY',
      'BR-AIR-FOOD-LEGACY',
      'BR-AIR-FOOD-2026',
    ]) {
      const rule = ambiguous.find((r) => r.ruleId === ruleId);
      expect(rule?.status).toBe('needs_review');
      expect(rule?.reviewReasons).toEqual([EFFECTIVE_DATE_AMBIGUOUS]);
    }
    const information = ambiguous.find((r) => r.ruleId === 'BR-AIR-INFORMATION-LEGACY');
    expect(information?.status).toBe('applicable');
    expect(information?.reviewReasons).toBeUndefined();
  });
  it('does not let the written offset pick a side of the cut', () => {
    // Same ambiguous instant spelled with offsets that would date it either way by text.
    const reference = advice('2026-10-26T02:30:00Z');
    for (const spelling of ['2026-10-25T23:30:00-03:00', '2026-10-26T07:30:00+05:00'])
      expect(advice(spelling)).toEqual(reference);
  });
  it('rejects an instant without offset instead of guessing a date', () => {
    for (const occurredAt of ['2026-10-26T02:30:00', '2026-10-26', 'not-a-date']) {
      let error: unknown;
      try {
        advice(occurredAt);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AppError);
      expect([(error as AppError).code, (error as AppError).status]).toEqual([
        'INVALID_EVENT_TIME',
        422,
      ]);
    }
  });
});

/** Splits each Set-Cookie line into its name/value and lower-cased attribute names. */
function setCookies(header: string | string[] | number | undefined) {
  const lines = header === undefined ? [] : Array.isArray(header) ? header : [String(header)];
  return lines.map((line) => {
    const [pair, ...attributes] = line.split(';').map((part) => part.trim());
    const [name, ...value] = pair!.split('=');
    const map = new Map<string, string>();
    for (const attribute of attributes) {
      const [key, ...rest] = attribute.split('=');
      map.set(key!.toLowerCase(), rest.join('='));
    }
    return { name: name!, value: value.join('='), attributes: map };
  });
}
function expectRemoval(
  header: string | string[] | number | undefined,
  name: string,
  secure: boolean,
) {
  const cookie = setCookies(header).find((c) => c.name === name);
  expect(cookie, 'removal of ' + name).toBeDefined();
  expect(cookie!.value).toBe('');
  expect(cookie!.attributes.get('max-age')).toBe('0');
  expect(cookie!.attributes.get('path')).toBe('/');
  expect(cookie!.attributes.has('httponly')).toBe(true);
  expect(cookie!.attributes.get('samesite')).toBe('Lax');
  expect(cookie!.attributes.has('secure')).toBe(secure);
  expect(cookie!.attributes.has('domain')).toBe(false);
  expect(Date.parse(cookie!.attributes.get('expires')!)).toBe(0);
  return cookie!;
}

describe('A3-02: session cookie removal mirrors its creation', () => {
  const running: Awaited<ReturnType<typeof buildApp>>[] = [];
  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(running.splice(0).map((context) => context.app.close()));
  });
  async function setup(publicUrl?: string) {
    const context = await buildApp(
      loadConfig({ APP_MODE: 'demo', ...(publicUrl ? { PUBLIC_URL: publicUrl } : {}) }),
    );
    running.push(context);
    await context.app.ready();
    return context;
  }
  async function login(context: Awaited<ReturnType<typeof setup>>, origin: string, name: string) {
    const response = await context.app.inject({
      method: 'POST',
      url: '/auth/demo',
      headers: { origin },
    });
    expect(response.statusCode).toBe(200);
    const created = setCookies(response.headers['set-cookie']).find((c) => c.name === name)!;
    return {
      created,
      headers: {
        cookie: name + '=' + created.value,
        origin,
        'x-csrf-token': (response.json() as { csrf: string }).csrf,
      },
    };
  }
  const httpsOrigin = 'https://app.example.invalid';
  it('removes the __Host- session on logout with Secure and the creation attributes', async () => {
    const context = await setup(httpsOrigin),
      identity = await login(context, httpsOrigin, '__Host-tr_session');
    for (const attribute of ['path', 'httponly', 'secure', 'samesite'])
      expect(identity.created.attributes.has(attribute)).toBe(true);
    const response = await context.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: identity.headers,
    });
    expect(response.statusCode).toBe(200);
    const removal = expectRemoval(response.headers['set-cookie'], '__Host-tr_session', true);
    for (const attribute of ['path', 'samesite'])
      expect(removal.attributes.get(attribute)).toBe(identity.created.attributes.get(attribute));
    expect(
      (await context.app.inject({ url: '/auth/session', headers: identity.headers })).statusCode,
    ).toBe(401);
  });
  it('removes the __Host- session when the workspace is deleted', async () => {
    const context = await setup(httpsOrigin),
      identity = await login(context, httpsOrigin, '__Host-tr_session');
    const response = await context.app.inject({
      method: 'DELETE',
      url: '/v1/workspace',
      headers: identity.headers,
    });
    expect(response.statusCode).toBe(200);
    expectRemoval(response.headers['set-cookie'], '__Host-tr_session', true);
  });
  it('omits Secure only for the plain-HTTP cookie name', async () => {
    const context = await setup(),
      identity = await login(context, 'http://127.0.0.1:4310', 'tr_session');
    expect(identity.created.attributes.has('secure')).toBe(false);
    const response = await context.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: identity.headers,
    });
    expectRemoval(response.headers['set-cookie'], 'tr_session', false);
  });
  it('replaces rather than removes the session when logging in again', async () => {
    const context = await setup(httpsOrigin),
      identity = await login(context, httpsOrigin, '__Host-tr_session');
    const again = await context.app.inject({
      method: 'POST',
      url: '/auth/demo',
      headers: identity.headers,
    });
    const sessions = setCookies(again.headers['set-cookie']).filter(
      (c) => c.name === '__Host-tr_session',
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]!.value).not.toBe('');
    expect(sessions[0]!.attributes.get('max-age')).toBe('3600');
  });
  it('emits no removal for a cross-origin logout and keeps the session', async () => {
    const context = await setup(httpsOrigin),
      identity = await login(context, httpsOrigin, '__Host-tr_session');
    const forged = await context.app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { ...identity.headers, origin: 'https://attacker.example.invalid' },
    });
    expect(forged.statusCode).toBe(403);
    expect(setCookies(forged.headers['set-cookie'])).toEqual([]);
    expect(
      (await context.app.inject({ url: '/auth/session', headers: identity.headers })).statusCode,
    ).toBe(200);
  });
  it('removes the __Host- OIDC state cookie with Secure after the callback', async () => {
    const issuer = 'https://oidc.example.invalid',
      pair = await generateKeyPair('RS256'),
      jwk = { ...(await exportJWK(pair.publicKey)), kid: 'synthetic-key', alg: 'RS256' };
    let nonce = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = input instanceof Request ? input.url : String(input);
        if (url.includes('.well-known'))
          return Response.json({
            issuer,
            authorization_endpoint: issuer + '/authorize',
            token_endpoint: issuer + '/token',
            jwks_uri: issuer + '/jwks',
            response_types_supported: ['code'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['RS256'],
            token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
          });
        if (url.endsWith('/jwks')) return Response.json({ keys: [jwk] });
        if (url.endsWith('/token'))
          return Response.json({
            access_token: 'synthetic-access-token',
            token_type: 'Bearer',
            expires_in: 300,
            id_token: await new SignJWT({ nonce })
              .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
              .setIssuer(issuer)
              .setAudience('synthetic-client')
              .setSubject('synthetic-subject')
              .setIssuedAt()
              .setExpirationTime('5m')
              .sign(pair.privateKey),
          });
        throw new Error('Unexpected test endpoint');
      }),
    );
    const context = await buildApp(
      loadConfig({
        APP_MODE: 'demo',
        PUBLIC_URL: httpsOrigin,
        OIDC_ISSUER: issuer,
        OIDC_CLIENT_ID: 'synthetic-client',
        OIDC_CLIENT_SECRET: 'synthetic-client-secret',
      }),
    );
    running.push(context);
    await context.app.ready();
    const start = await context.app.inject('/auth/login');
    const target = new URL(start.headers.location!);
    nonce = target.searchParams.get('nonce')!;
    const state = setCookies(start.headers['set-cookie']).find((c) => c.name === '__Host-tr_oidc')!;
    const callback = await context.app.inject({
      url: '/auth/callback?code=synthetic-code&state=' + target.searchParams.get('state'),
      headers: { cookie: '__Host-tr_oidc=' + state.value },
    });
    expect(callback.statusCode).toBe(302);
    expectRemoval(callback.headers['set-cookie'], '__Host-tr_oidc', true);
    const session = setCookies(callback.headers['set-cookie']).find(
      (c) => c.name === '__Host-tr_session',
    );
    expect(session?.value).not.toBe('');
  });
});
