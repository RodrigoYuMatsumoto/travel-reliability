import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import '@fastify/cookie';
import * as oidc from 'openid-client';
import type { Config } from './config.js';
import type { Cache, RecordStore } from './storage.js';
import type { Session, Role } from '../../schema/src/domain.js';
import { Vault, constantEqual } from './crypto.js';
import { AppError, requireCondition } from './errors.js';
declare module 'fastify' {
  interface FastifyRequest {
    principal?: Session;
    workspaceRole?: Role;
  }
}

export class Auth {
  private discovery?: Promise<oidc.Configuration>;
  constructor(
    private config: Config,
    private cache: Cache,
    private records: RecordStore,
    private vault: Vault,
  ) {}
  private async save(key: string, data: unknown, seconds: number) {
    await this.cache.set(
      key,
      this.vault.seal(key, Buffer.from(JSON.stringify(data))).toString('base64'),
      seconds,
    );
  }
  private async read<T>(key: string, take = false): Promise<T | null> {
    const value = await (take ? this.cache.take(key) : this.cache.get(key));
    return value
      ? (JSON.parse(this.vault.open(key, Buffer.from(value, 'base64')).toString()) as T)
      : null;
  }
  private cookieName(name: string) {
    return this.config.publicUrl.startsWith('https:') ? '__Host-' + name : name;
  }
  private cookie(reply: FastifyReply, name: string, value: string, maxAge: number) {
    reply.setCookie(this.cookieName(name), value, {
      path: '/',
      httpOnly: true,
      secure: this.config.publicUrl.startsWith('https:'),
      sameSite: 'lax',
      maxAge,
    });
  }
  async login(reply: FastifyReply, userId: string, demo: boolean): Promise<Session> {
    const workspaceId = demo ? randomUUID() : this.vault.opaque('workspace:' + userId);
    await this.records.withWorkspace(workspaceId, async () => {
      const membership = await this.records.get(workspaceId, 'member', userId);
      if (!membership)
        await this.records.put(workspaceId, 'member', userId, { userId, role: 'owner' }, null);
    });
    const revokedAt = Number((await this.cache.get('revoked:' + workspaceId)) ?? 0);
    const session: Session = {
      userId,
      workspaceId,
      demo,
      csrf: randomBytes(32).toString('base64url'),
      issuedAt: Math.max(Date.now(), revokedAt + 1),
      expiresAt: Date.now() + 3600000,
    };
    const sid = randomBytes(32).toString('base64url');
    await this.save('session:' + sid, session, 3600);
    this.cookie(reply, 'tr_session', sid, 3600);
    return session;
  }
  async logout(request: FastifyRequest, reply: FastifyReply) {
    const name = this.cookieName('tr_session');
    if (request.cookies[name]) await this.cache.remove('session:' + request.cookies[name]);
    reply.clearCookie(name, { path: '/' });
  }
  async revokeWorkspace(workspace: string) {
    await this.cache.set('revoked:' + workspace, String(Date.now()), 3600);
  }
  async authorize(request: FastifyRequest, minimum: Role = 'viewer'): Promise<Session> {
    const sid = request.cookies[this.cookieName('tr_session')];
    if (!sid || !/^[A-Za-z0-9_-]{40,60}$/.test(sid)) throw new AppError('AUTH_REQUIRED', 401);
    const session = await this.read<Session>('session:' + sid);
    if (!session || session.expiresAt < Date.now()) throw new AppError('AUTH_REQUIRED', 401);
    const requested = request.headers['x-workspace-id'];
    if (
      requested !== undefined &&
      (typeof requested !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requested))
    )
      throw new AppError('INVALID_WORKSPACE', 400);
    const workspaceId = requested ?? session.workspaceId;
    const revokedAt = Number((await this.cache.get('revoked:' + workspaceId)) ?? 0);
    requireCondition(session.issuedAt > revokedAt, 'SESSION_REVOKED', 401);
    const membership = await this.records.get<{ role: Role }>(
      workspaceId,
      'member',
      session.userId,
    );
    const rank: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };
    requireCondition(
      membership && rank[membership.data.role] >= rank[minimum],
      'ACCESS_DENIED',
      403,
    );
    request.principal = { ...session, workspaceId };
    request.workspaceRole = membership.data.role;
    return request.principal;
  }
  checkOrigin(request: FastifyRequest) {
    const origin = request.headers.origin;
    const allowed = [new URL(this.config.publicUrl).origin];
    if (this.config.mode === 'demo') allowed.push('http://127.0.0.1:5173', 'http://localhost:5173');
    requireCondition(
      typeof origin === 'string' && allowed.includes(origin),
      'ORIGIN_REJECTED',
      403,
    );
  }
  checkCsrf(request: FastifyRequest) {
    this.checkOrigin(request);
    requireCondition(
      request.principal &&
        typeof request.headers['x-csrf-token'] === 'string' &&
        constantEqual(request.headers['x-csrf-token'], request.principal.csrf),
      'CSRF_REJECTED',
      403,
    );
  }
  private discover() {
    if (!this.config.oidcIssuer || !this.config.oidcClientId)
      throw new AppError('OIDC_NOT_CONFIGURED', 503);
    return (this.discovery ??= oidc
      .discovery(
        new URL(this.config.oidcIssuer),
        this.config.oidcClientId,
        this.config.oidcClientSecret,
      )
      .catch(() => {
        this.discovery = undefined;
        throw new AppError('OIDC_PROVIDER_UNAVAILABLE', 503);
      }));
  }
  async register(app: FastifyInstance) {
    app.post(
      '/auth/demo',
      { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (request, reply) => {
        requireCondition(this.config.mode === 'demo', 'DEMO_DISABLED', 404);
        this.checkOrigin(request);
        await this.logout(request, reply);
        const session = await this.login(reply, randomUUID(), true);
        return { ...session, role: 'owner', mode: 'demo' };
      },
    );
    app.get('/auth/session', async (request) => {
      const session = await this.authorize(request);
      return { ...session, role: request.workspaceRole, mode: this.config.mode };
    });
    app.post('/auth/logout', async (request, reply) => {
      await this.authorize(request);
      this.checkCsrf(request);
      await this.logout(request, reply);
      return { ok: true };
    });
    app.get('/auth/login', async (_request, reply) => {
      const client = await this.discover(),
        verifier = oidc.randomPKCECodeVerifier(),
        state = oidc.randomState(),
        nonce = oidc.randomNonce();
      await this.save('oidc:' + state, { verifier, nonce }, 600);
      this.cookie(reply, 'tr_oidc', state, 600);
      return reply.redirect(
        oidc.buildAuthorizationUrl(client, {
          redirect_uri: this.config.publicUrl + '/auth/callback',
          scope: 'openid',
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state,
          nonce,
        }).href,
      );
    });
    app.get('/auth/callback', async (request, reply) => {
      const url = new URL(request.url, this.config.publicUrl),
        state = url.searchParams.get('state');
      const stateCookie = request.cookies[this.cookieName('tr_oidc')];
      requireCondition(
        state && stateCookie && constantEqual(state, stateCookie),
        'OIDC_STATE_REJECTED',
        401,
      );
      const expected = await this.read<{ verifier: string; nonce: string }>('oidc:' + state, true);
      requireCondition(expected, 'OIDC_STATE_EXPIRED', 401);
      const client = await this.discover();
      const tokens = await oidc
        .authorizationCodeGrant(client, url, {
          pkceCodeVerifier: expected.verifier,
          expectedState: state,
          expectedNonce: expected.nonce,
        })
        .catch(() => {
          throw new AppError('OIDC_TOKEN_REJECTED', 401);
        });
      const claims = tokens.claims();
      requireCondition(claims?.sub, 'OIDC_SUBJECT_REQUIRED', 401);
      await this.logout(request, reply);
      await this.login(reply, this.vault.opaque(this.config.oidcIssuer + ':' + claims.sub), false);
      reply.clearCookie(this.cookieName('tr_oidc'), { path: '/' });
      return reply.redirect('/');
    });
  }
}
