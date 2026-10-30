import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
const contexts: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(contexts.splice(0).map((c) => c.app.close()));
});
async function fixture() {
  const issuer = 'https://oidc.example.invalid',
    pair = await generateKeyPair('RS256'),
    jwk = { ...(await exportJWK(pair.publicKey)), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
  let nonce = '',
    badNonce = false,
    discoveryFailures = 0;
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url.includes('.well-known')) {
      if (discoveryFailures-- > 0) return new Response('', { status: 503 });
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
    }
    if (url.endsWith('/jwks')) return Response.json({ keys: [jwk] });
    if (url.endsWith('/token')) {
      const token = await new SignJWT({ nonce: badNonce ? 'synthetic-invalid-nonce' : nonce })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(issuer)
        .setAudience('synthetic-client')
        .setSubject('synthetic-subject')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(pair.privateKey);
      return Response.json({
        access_token: 'synthetic-access-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: token,
      });
    }
    throw new Error('Unexpected test endpoint');
  });
  vi.stubGlobal('fetch', fetch);
  const context = await buildApp(
    loadConfig({
      APP_MODE: 'demo',
      PUBLIC_URL: 'https://app.example.invalid',
      OIDC_ISSUER: issuer,
      OIDC_CLIENT_ID: 'synthetic-client',
      OIDC_CLIENT_SECRET: 'synthetic-client-secret',
    }),
  );
  contexts.push(context);
  await context.app.ready();
  const login = async () => {
    const response = await context.app.inject('/auth/login');
    expect(response.statusCode).toBe(302);
    const target = new URL(response.headers.location!);
    nonce = target.searchParams.get('nonce')!;
    return {
      response,
      target,
      headers: {
        cookie:
          '__Host-tr_oidc=' + response.cookies.find((c) => c.name === '__Host-tr_oidc')!.value,
      },
      callback: '/auth/callback?code=synthetic-code&state=' + target.searchParams.get('state'),
    };
  };
  return {
    context,
    login,
    fetch,
    setBadNonce: () => {
      badNonce = true;
    },
    failDiscoveryOnce: () => {
      discoveryFailures = 1;
    },
  };
}
describe('OIDC protocol with synthetic HTTPS provider responses', () => {
  it('uses PKCE, binds state/nonce, issues a secure session and prevents replay', async () => {
    const f = await fixture(),
      start = await f.login();
    expect(start.target.searchParams.get('code_challenge_method')).toBe('S256');
    const result = await f.context.app.inject({ url: start.callback, headers: start.headers });
    expect(result.statusCode).toBe(302);
    const sid = result.cookies.find((c) => c.name === '__Host-tr_session')!;
    expect(sid.secure).toBe(true);
    expect(sid.httpOnly).toBe(true);
    expect(
      (
        await f.context.app.inject({
          url: '/auth/session',
          headers: { cookie: '__Host-tr_session=' + sid.value },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await f.context.app.inject({ url: start.callback, headers: start.headers })).statusCode,
    ).toBe(401);
  });
  it('rejects a mismatched state and nonce without creating a session', async () => {
    const f = await fixture(),
      start = await f.login();
    expect(
      (
        await f.context.app.inject({
          url: '/auth/callback?state=synthetic-wrong&code=x',
          headers: start.headers,
        })
      ).statusCode,
    ).toBe(401);
    f.setBadNonce();
    const result = await f.context.app.inject({ url: start.callback, headers: start.headers });
    expect(result.statusCode).toBe(401);
    expect(result.cookies.some((c) => c.name === '__Host-tr_session')).toBe(false);
  });
  it('can recover discovery after an unavailable provider', async () => {
    const f = await fixture();
    f.failDiscoveryOnce();
    expect((await f.context.app.inject('/auth/login')).statusCode).toBe(503);
    await f.login();
    expect(f.fetch).toHaveBeenCalledTimes(2);
  });
});
