import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
import { MemoryBlobStore, MemoryCache, MemoryRecordStore } from '../api/src/storage.js';
import { Vault } from '../api/src/crypto.js';
import { demoTrip } from '../api/src/demo.js';
import { validateTrip } from '../api/src/validation.js';
import type { EvidenceDocument } from '../schema/src/domain.js';

type Context = Awaited<ReturnType<typeof buildApp>>;
const contexts: Context[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.app.close()));
});
async function setup(blobs?: MemoryBlobStore) {
  const context = await buildApp(loadConfig({ APP_MODE: 'demo' }), blobs ? { blobs } : {});
  contexts.push(context);
  await context.app.ready();
  return context;
}
async function login(context: Context) {
  const response = await context.app.inject({
    method: 'POST',
    url: '/auth/demo',
    headers: { origin: 'http://127.0.0.1:4310' },
  });
  expect(response.statusCode).toBe(200);
  const session = response.json() as { csrf: string; workspaceId: string; userId: string };
  return {
    session,
    headers: {
      cookie:
        'tr_session=' + response.cookies.find((cookie) => cookie.name === 'tr_session')!.value,
      origin: 'http://127.0.0.1:4310',
      'x-csrf-token': session.csrf,
    },
  };
}
async function trip(context: Context, identity: Awaited<ReturnType<typeof login>>) {
  return (
    await context.app.inject({ method: 'POST', url: '/v1/trips/demo', headers: identity.headers })
  ).json();
}
async function upload(
  context: Context,
  identity: Awaited<ReturnType<typeof login>>,
  tripId: string,
  text = 'Cancellation: synthetic terms.',
) {
  const boundary = 'synthetic-boundary';
  const response = await context.app.inject({
    method: 'POST',
    url: `/v1/trips/${tripId}/documents`,
    headers: { ...identity.headers, 'content-type': `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.txt"\r\nContent-Type: text/plain\r\n\r\n${text}\r\n--${boundary}--\r\n`,
    ),
  });
  expect([200, 202]).toContain(response.statusCode);
  await context.ingestion.wait();
  return response.json().document as EvidenceDocument;
}
describe('review regressions', () => {
  it('protects decoded owner routes with CSRF and origin checks', async () => {
    const context = await setup(),
      identity = await login(context);
    const result = await context.app.inject({
      method: 'POST',
      url: '/%761/workspace/members',
      headers: { cookie: identity.headers.cookie },
      payload: { userId: 'synthetic-collaborator', role: 'editor' },
    });
    expect([401, 403, 404]).toContain(result.statusCode);
    expect(
      await context.records.get(identity.session.workspaceId, 'member', 'synthetic-collaborator'),
    ).toBeNull();
  });
  it('does not assign a document ownership of equal user-entered values', async () => {
    const context = await setup(),
      identity = await login(context),
      made = await trip(context, identity);
    made.data.services[0].cancellation.summary = 'Cancellation: synthetic terms.';
    made.data.services[0].cancellation.deadline = '2030-01-01T00:00:00Z';
    const updated = await context.app.inject({
      method: 'PUT',
      url: `/v1/trips/${made.id}`,
      headers: { ...identity.headers, 'if-match': '1' },
      payload: made.data,
    });
    expect(updated.statusCode).toBe(200);
    const doc = await upload(context, identity, made.id);
    const applied = await context.app.inject({
      method: 'POST',
      url: `/v1/documents/${doc.id}/apply`,
      headers: identity.headers,
      payload: { serviceId: 'flight-a', fieldIndexes: [0], expectedVersion: 2 },
    });
    expect(applied.statusCode).toBe(200);
    expect(
      (
        await context.app.inject({
          method: 'DELETE',
          url: `/v1/documents/${doc.id}`,
          headers: identity.headers,
        })
      ).statusCode,
    ).toBe(200);
    const current = (
      await context.app.inject({ url: `/v1/trips/${made.id}`, headers: identity.headers })
    ).json();
    expect(current.data.services[0].cancellation.summary).toBe('Cancellation: synthetic terms.');
    expect(current.data.services[0].cancellation.deadline).toBe('2030-01-01T00:00:00Z');
  });
  it('erases derived values on expiry before any private read and keeps unrelated revisions', async () => {
    const context = await setup(),
      identity = await login(context),
      made = await trip(context, identity),
      doc = await upload(context, identity, made.id);
    await context.records.put(
      identity.session.workspaceId,
      'revision',
      'synthetic-unrelated',
      { tripId: made.id, previous: made.data, changedAt: new Date().toISOString() },
      null,
    );
    const applied = await context.app.inject({
      method: 'POST',
      url: `/v1/documents/${doc.id}/apply`,
      headers: identity.headers,
      payload: { serviceId: 'flight-a', fieldIndexes: [0], expectedVersion: 1 },
    });
    expect(applied.statusCode).toBe(200);
    const expiry = await context.app.inject({
      method: 'PUT',
      url: `/v1/documents/${doc.id}/retention`,
      headers: identity.headers,
      payload: { expiresAt: '2000-01-01T00:00:00Z' },
    });
    expect(expiry.statusCode).toBe(200);
    const current = (
      await context.app.inject({ url: `/v1/trips/${made.id}`, headers: identity.headers })
    ).json();
    expect(current.data.services[0].cancellation.summary).toBeNull();
    expect(await context.records.get(identity.session.workspaceId, 'document', doc.id)).toBeNull();
    expect(
      await context.records.get(identity.session.workspaceId, 'revision', 'synthetic-unrelated'),
    ).not.toBeNull();
    await expect(context.blobs.get(identity.session.workspaceId, doc.id)).rejects.toThrow(
      'DOCUMENT_NOT_FOUND',
    );
  });
  it('rejects unlinked field provenance even when the supplied ID is valid', () => {
    const contract = demoTrip();
    contract.services[0]!.fieldSources = { baggage: '00000000-0000-4000-8000-000000000001' };
    expect(() => validateTrip(contract)).toThrow('FIELD_SOURCE_NOT_LINKED');
  });
  it('retains a durable cleanup receipt after storage failure and retries it', async () => {
    class FailingBlobs extends MemoryBlobStore {
      fail = true;
      override async remove(w: string, id: string) {
        if (this.fail) throw new Error('synthetic storage outage');
        return super.remove(w, id);
      }
    }
    const blobs = new FailingBlobs(),
      context = await setup(blobs),
      identity = await login(context),
      made = await trip(context, identity),
      doc = await upload(context, identity, made.id);
    const result = await context.app.inject({
      method: 'DELETE',
      url: `/v1/documents/${doc.id}`,
      headers: identity.headers,
    });
    expect(result.json().storageCleanup).toBe('pending');
    expect(await context.records.get(identity.session.workspaceId, 'document', doc.id)).toBeNull();
    expect(await context.records.pendingDeletions()).toHaveLength(1);
    blobs.fail = false;
    await context.maintenance();
    expect(await context.records.pendingDeletions()).toHaveLength(0);
    await expect(blobs.get(identity.session.workspaceId, doc.id)).rejects.toThrow();
  });
  it('consumes one-time state atomically', async () => {
    const cache = new MemoryCache();
    await cache.set('synthetic-state', 'synthetic-value', 10);
    expect(
      (await Promise.all([cache.take('synthetic-state'), cache.take('synthetic-state')])).filter(
        Boolean,
      ),
    ).toHaveLength(1);
  });
  it('rolls back record changes and preserves writes in other workspaces', async () => {
    const records = new MemoryRecordStore(new Vault(Buffer.alloc(32, 7)));
    await records.put('a', 'item', 'one', { value: 1 }, null);
    await expect(
      records.withWorkspace('a', async () => {
        await records.put('a', 'item', 'one', { value: 2 }, 1);
        await records.put('b', 'item', 'other', { value: 9 }, null);
        throw new Error('synthetic rollback');
      }),
    ).rejects.toThrow();
    expect((await records.get<{ value: number }>('a', 'item', 'one'))!.data.value).toBe(1);
    expect((await records.get<{ value: number }>('b', 'item', 'other'))!.data.value).toBe(9);
  });
  it('revokes a collaborator without allowing the owner to revoke itself', async () => {
    const context = await setup(),
      owner = await login(context),
      collaborator = await login(context);
    await context.app.inject({
      method: 'POST',
      url: '/v1/workspace/members',
      headers: owner.headers,
      payload: { userId: collaborator.session.userId, role: 'viewer' },
    });
    const scoped = { ...collaborator.headers, 'x-workspace-id': owner.session.workspaceId };
    expect((await context.app.inject({ url: '/v1/trips', headers: scoped })).statusCode).toBe(200);
    expect(
      (
        await context.app.inject({
          method: 'DELETE',
          url: `/v1/workspace/members/${collaborator.session.userId}`,
          headers: owner.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect((await context.app.inject({ url: '/v1/trips', headers: scoped })).statusCode).toBe(403);
    expect(
      (
        await context.app.inject({
          method: 'DELETE',
          url: `/v1/workspace/members/${owner.session.userId}`,
          headers: owner.headers,
        })
      ).statusCode,
    ).toBe(422);
  });
  it('scopes webhook credentials and preserves replay receipts after event deletion', async () => {
    const context = await setup(),
      a = await login(context),
      b = await login(context),
      ta = await trip(context, a),
      tb = await trip(context, b);
    const keyA = (
      await context.app.inject({
        method: 'POST',
        url: '/v1/workspace/integrations/webhook',
        headers: a.headers,
      })
    ).json().key as string;
    await context.app.inject({
      method: 'POST',
      url: '/v1/workspace/integrations/webhook',
      headers: b.headers,
    });
    const payload = {
      serviceId: 'flight-a',
      kind: 'delay',
      occurredAt: '2026-10-29T12:00:00Z',
      waitingMinutes: 121,
      overnight: false,
      specialAssistance: false,
      providerResponsibility: 'unknown',
      description: 'Synthetic event',
      documentIds: [],
      amountMinor: null,
      currency: null,
      phase: 'departure',
      refundChoice: 'unknown',
      residentAtOrigin: null,
      exceptionalConditions: 'unknown',
    };
    const stamp = String(Date.now()),
      id = 'synthetic-event';
    const send = (w: string, tripId: string) =>
      context.app.inject({
        method: 'POST',
        url: `/hooks/${w}/${tripId}`,
        headers: {
          'x-tr-timestamp': stamp,
          'x-tr-event-id': id,
          'x-tr-signature': createHmac('sha256', keyA)
            .update(`${stamp}.${w}.${tripId}.${id}.${JSON.stringify(payload)}`)
            .digest('hex'),
        },
        payload,
      });
    expect((await send(b.session.workspaceId, tb.id)).statusCode).toBe(401);
    const first = await send(a.session.workspaceId, ta.id);
    expect(first.statusCode).toBe(201);
    await context.records.remove(a.session.workspaceId, 'event', first.json().event.id);
    expect((await send(a.session.workspaceId, ta.id)).json().duplicate).toBe(true);
    expect(await context.records.count(a.session.workspaceId, 'event')).toBe(0);
  });
});
