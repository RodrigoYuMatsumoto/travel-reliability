import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { S3Client } from '@aws-sdk/client-s3';
import { Auth } from './auth.js';
import { Vault, constantEqual, sha256 } from './crypto.js';
import type { Config } from './config.js';
import { loadConfig } from './config.js';
import {
  MemoryRecordStore,
  PostgresRecordStore,
  MemoryBlobStore,
  S3BlobStore,
  MemoryCache,
  RedisCache,
} from './storage.js';
import type { RecordStore, BlobStore, Cache } from './storage.js';
import type {
  EvidenceDocument,
  DisruptionEvent,
  Review,
  RouteVersion,
  Job,
  Role,
} from '../../schema/src/domain.js';
import type { TripContract } from '../../schema/src/trip-contract.js';
import { validateTrip, boundedText } from './validation.js';
import { input } from './input-schemas.js';
import { AppError, requireCondition } from './errors.js';
import { assess, checklist } from './assessment.js';
import { Ingestion } from './ingestion.js';
import { demoTrip } from './demo.js';
import { rightsFor, ruleCatalog } from './rules.js';
import { dossier, pdf, calendar, encryptBundle } from './exports.js';
import tripSchema from '../../schema/trip-contract.schema.json' with { type: 'json' };
import { redactDocument } from './document-erasure.js';
import { LLMExtractor, policySnippets } from './llm.js';
import { plan } from './planning.js';
import { planningSchemas } from '../../schema/src/planning.js';

export interface Dependencies {
  records?: RecordStore;
  blobs?: BlobStore;
  cache?: Cache;
}
export async function buildApp(config = loadConfig(), dependencies: Dependencies = {}) {
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 130000,
    trustProxy: false,
  });
  const apiRoutes: Array<{ method: string; url: string }> = [];
  const vault = new Vault(config.key);
  let records = dependencies.records;
  if (!records && config.databaseUrl) {
    const pg = new PostgresRecordStore(
      new Pool({ connectionString: config.databaseUrl, max: 10 }),
      vault,
    );
    await pg.initialize();
    records = pg;
  }
  records ??= new MemoryRecordStore(vault);
  const blobs =
    dependencies.blobs ??
    (config.s3Bucket
      ? new S3BlobStore(
          new S3Client({
            region: config.s3Region,
            endpoint: config.s3Endpoint,
            forcePathStyle: !!config.s3Endpoint,
            credentials:
              config.s3AccessKey && config.s3SecretKey
                ? { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey }
                : undefined,
          }),
          config.s3Bucket,
        )
      : new MemoryBlobStore());
  const cache =
    dependencies.cache ??
    (config.redisUrl
      ? new RedisCache(new Redis(config.redisUrl, { maxRetriesPerRequest: 2 }))
      : new MemoryCache());
  const auth = new Auth(config, cache, records, vault),
    ingestion = new Ingestion(config, records, blobs, vault);
  const llm = new LLMExtractor(config, records, vault);
  let purgeExpiredWorkspace: (workspace: string) => Promise<void> = async () => {};
  app.addHook('onRoute', (route) => {
    for (const method of Array.isArray(route.method) ? route.method : [route.method])
      if (/^\/(v1|auth|schema|rules|hooks|public)(\/|$)|^\/health$/.test(route.url))
        apiRoutes.push({ method, url: route.url });
    if (!route.url.startsWith('/v1/') || ['GET', 'HEAD'].includes(String(route.method))) return;
    // Multipart admission and its transaction happen after streaming, never while holding a DB lock.
    if (route.url === '/v1/trips/:id/documents' || route.url === '/v1/documents/:id/suggest')
      return;
    const handler = route.handler;
    route.handler = async function (request, reply) {
      const session = await auth.authorize(request, 'editor');
      auth.checkCsrf(request);
      return records.withWorkspace(session.workspaceId, async () => {
        await auth.authorize(request, 'editor');
        auth.checkCsrf(request);
        return handler.call(this, request, reply);
      });
    };
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
    },
  });
  await app.register(rateLimit, {
    max: config.mode === 'demo' ? 300 : 120,
    timeWindow: '1 minute',
  });
  await app.register(multipart, {
    limits: { files: 1, fields: 1, fileSize: 20 * 1024 * 1024, parts: 2 },
  });
  app.setErrorHandler((error, _request, reply) => {
    const known = error instanceof AppError;
    const multipartError = (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE';
    const status = known
      ? error.status
      : multipartError
        ? 413
        : (error as { statusCode?: number }).statusCode === 429
          ? 429
          : 500;
    reply.code(status).send({
      error: {
        code: known
          ? error.code
          : status === 413
            ? 'SIZE_LIMIT'
            : status === 429
              ? 'RATE_LIMITED'
              : 'INTERNAL_ERROR',
        ...(known && error.details ? { details: error.details } : {}),
        requestId: _request.id,
      },
    });
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });
  await auth.register(app);
  app.addHook('preHandler', async (request) => {
    if (request.routeOptions.url?.startsWith('/v1/')) {
      const session = await auth.authorize(
        request,
        ['GET', 'HEAD'].includes(request.method) ? 'viewer' : 'editor',
      );
      if (!['GET', 'HEAD'].includes(request.method)) auth.checkCsrf(request);
      await purgeExpiredWorkspace(session.workspaceId);
    }
  });
  const workspace = (request: { principal?: { workspaceId: string } }) =>
    request.principal!.workspaceId;
  const audit = async (w: string, action: string, target: string, userId: string) => {
    await records.put(
      w,
      'audit',
      randomUUID(),
      { action, target, userId, occurredAt: new Date().toISOString() },
      null,
    );
  };
  const tripFor = async (w: string, id: string) => {
    const value = await records.get<TripContract>(w, 'trip', id);
    requireCondition(value, 'TRIP_NOT_FOUND', 404);
    return value;
  };
  const activeDocument = (doc: EvidenceDocument) =>
    !doc.expiresAt || Date.parse(doc.expiresAt) > Date.now();
  const documentsFor = async (w: string, id: string) =>
    (await records.list<EvidenceDocument>(w, 'document', { tripId: id })).filter((d) =>
      activeDocument(d.data),
    );
  const eventsFor = async (w: string, id: string) =>
    (await records.list<DisruptionEvent>(w, 'event', { tripId: id })).map((e) => e.data);
  const evidenceExists = async (w: string, tripId: string, ids: string[]) => {
    for (const id of ids) {
      const doc = await records.get<EvidenceDocument>(w, 'document', id);
      requireCondition(
        doc?.data.tripId === tripId && activeDocument(doc.data),
        'DOCUMENT_NOT_FOUND',
        422,
      );
    }
  };
  const validateReferences = async (w: string, trip: TripContract) => {
    for (const s of trip.services) await evidenceExists(w, trip.id, s.documentIds);
  };
  const reportFor = async (w: string, id: string, requestText = '') => {
    const trip = await tripFor(w, id),
      events = await eventsFor(w, id);
    return dossier(
      trip.data,
      assess(trip.data, events),
      (await documentsFor(w, id)).map((d) => d.data),
      events,
      requestText,
    );
  };
  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    mode: config.mode,
    persistence: config.databaseUrl ? 'postgresql' : 'ephemeral',
    llmEnabled: config.llmEnabled,
  }));
  app.get('/schema/trip-contract.json', async () => tripSchema);
  app.get('/rules/br', async () => ruleCatalog());
  app.get('/schema/planning.json', async () => ({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: planningSchemas,
  }));
  app.post<{ Params: { tool: string } }>('/v1/tools/:tool', async (request) =>
    plan(request.params.tool, request.body),
  );
  app.get('/v1/trips', async (request) => records.list<TripContract>(workspace(request), 'trip'));
  app.post('/v1/trips/demo', async (request, reply) => {
    requireCondition(config.mode === 'demo', 'DEMO_DISABLED', 404);
    const trip = validateTrip(demoTrip());
    const result = await records.put(workspace(request), 'trip', trip.id, trip, null);
    reply.code(201);
    return result;
  });
  app.post('/v1/trips', async (request, reply) => {
    const trip = validateTrip(request.body);
    await validateReferences(workspace(request), trip);
    const result = await records.put(workspace(request), 'trip', trip.id, trip, null);
    await audit(workspace(request), 'trip.created', trip.id, request.principal!.userId);
    reply.code(201);
    return result;
  });
  app.get<{ Params: { id: string } }>('/v1/trips/:id', async (request, reply) => {
    const trip = await tripFor(workspace(request), request.params.id);
    reply.header('ETag', `"${trip.version}"`);
    return trip;
  });
  app.put<{ Params: { id: string } }>('/v1/trips/:id', async (request, reply) => {
    const trip = validateTrip(request.body);
    requireCondition(trip.id === request.params.id, 'ID_MISMATCH', 422);
    const version = Number(String(request.headers['if-match'] ?? '').replaceAll('"', ''));
    requireCondition(Number.isInteger(version) && version >= 1, 'IF_MATCH_REQUIRED', 428);
    const old = await tripFor(workspace(request), trip.id);
    await validateReferences(workspace(request), trip);
    requireCondition(old.version === version, 'VERSION_CONFLICT', 409);
    const result = await records.put(workspace(request), 'trip', trip.id, trip, version);
    await records.put(
      workspace(request),
      'revision',
      `${trip.id}-${result.version}`,
      { tripId: trip.id, previous: old.data, changedAt: result.updatedAt },
      null,
    );
    await audit(workspace(request), 'trip.updated', trip.id, request.principal!.userId);
    reply.header('ETag', `"${result.version}"`);
    return result;
  });
  app.get<{ Params: { id: string } }>('/v1/trips/:id/assessment', async (request) => {
    const trip = await tripFor(workspace(request), request.params.id);
    return assess(trip.data, await eventsFor(workspace(request), trip.id));
  });
  app.get<{ Params: { id: string }; Querystring: { phase?: string } }>(
    '/v1/trips/:id/checklists',
    async (request) => {
      const trip = await tripFor(workspace(request), request.params.id);
      const phase = request.query.phase ?? 'pre_departure';
      requireCondition(['pre_booking', 'pre_departure'].includes(phase), 'INVALID_PHASE', 422);
      return checklist(trip.data, phase as 'pre_booking' | 'pre_departure');
    },
  );
  app.get<{ Params: { id: string } }>('/v1/trips/:id/documents', async (request) => {
    await tripFor(workspace(request), request.params.id);
    return (await documentsFor(workspace(request), request.params.id)).map((d) => d.data);
  });
  let activeUploads = 0;
  app.post<{ Params: { id: string } }>('/v1/trips/:id/documents', async (request, reply) => {
    requireCondition(activeUploads < 2, 'UPLOAD_CAPACITY', 503);
    activeUploads++;
    try {
      await tripFor(workspace(request), request.params.id);
      const file = await request.file();
      requireCondition(file, 'FILE_REQUIRED', 422);
      const buffer = await file.toBuffer();
      const result = await ingestion.add(
        workspace(request),
        request.params.id,
        buffer,
        file.mimetype,
        'Imported document',
        async () => {
          await auth.authorize(request, 'editor');
          auth.checkCsrf(request);
        },
      );
      reply.code(result.duplicate ? 200 : 202);
      return result;
    } finally {
      activeUploads--;
    }
  });
  app.get<{ Params: { id: string } }>('/v1/documents/:id', async (request) => {
    const doc = await records.get<EvidenceDocument>(
      workspace(request),
      'document',
      request.params.id,
    );
    requireCondition(doc && activeDocument(doc.data), 'DOCUMENT_NOT_FOUND', 404);
    return doc.data;
  });
  app.get<{ Params: { id: string } }>('/v1/documents/:id/original', async (request, reply) => {
    const doc = await records.get<EvidenceDocument>(
      workspace(request),
      'document',
      request.params.id,
    );
    requireCondition(doc && activeDocument(doc.data), 'DOCUMENT_NOT_FOUND', 404);
    reply
      .type('application/octet-stream')
      .header('Content-Disposition', `attachment; filename="${doc.id}.bin"`);
    return ingestion.original(workspace(request), doc.data);
  });
  app.get<{ Params: { id: string } }>('/v1/documents/:id/suggest-preview', async (request) => {
    const doc = await records.get<EvidenceDocument>(
      workspace(request),
      'document',
      request.params.id,
    );
    requireCondition(doc && activeDocument(doc.data), 'DOCUMENT_NOT_FOUND', 404);
    return {
      enabled: config.llmEnabled,
      snippets: policySnippets(doc.data),
      model: config.llmModel ?? null,
      destination:
        config.llmEnabled && config.llmBaseUrl ? new URL(config.llmBaseUrl).origin : null,
    };
  });
  app.post<{ Params: { id: string } }>(
    '/v1/documents/:id/suggest',
    { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (request) => {
      input('consent', request.body);
      const doc = await records.get<EvidenceDocument>(
        workspace(request),
        'document',
        request.params.id,
      );
      requireCondition(doc && activeDocument(doc.data), 'DOCUMENT_NOT_FOUND', 404);
      return llm.suggest(workspace(request), doc.data);
    },
  );
  app.post<{ Params: { id: string } }>('/v1/documents/:id/apply', async (request) => {
    const body = input<{ serviceId: string; fieldIndexes: number[]; expectedVersion: number }>(
      'apply',
      request.body,
    );
    const w = workspace(request),
      document = await records.get<EvidenceDocument>(w, 'document', request.params.id);
    requireCondition(document && activeDocument(document.data), 'DOCUMENT_NOT_FOUND', 404);
    const trip = await tripFor(w, document.data.tripId);
    requireCondition(trip.version === body.expectedVersion, 'VERSION_CONFLICT', 409);
    const next = structuredClone(trip.data),
      service = next.services.find((s) => s.id === body.serviceId);
    requireCondition(service, 'SERVICE_NOT_FOUND', 422);
    for (const index of body.fieldIndexes) {
      const field = document.data.fields[index];
      requireCondition(field && typeof field.value === 'string', 'INVALID_FIELD_INDEX', 422);
      let old: string | null;
      switch (field.path) {
        case 'reservation.reference':
          old = service.reservation.reference;
          requireCondition(!old || old === field.value, 'FIELD_CONFLICT', 409);
          service.reservation.reference = field.value;
          break;
        case 'cancellation.summary':
          old = service.cancellation.summary;
          requireCondition(!old || old === field.value, 'FIELD_CONFLICT', 409);
          service.cancellation.summary = field.value;
          if (!old) service.cancellation.documentId = document.id;
          break;
        case 'baggage':
          old = service.baggage;
          requireCondition(!old || old === field.value, 'FIELD_CONFLICT', 409);
          service.baggage = field.value;
          break;
        default:
          throw new AppError('FIELD_NOT_ALLOWED', 422);
      }
      if (!old) {
        service.fieldSources ??= {};
        service.fieldSources[field.path as keyof NonNullable<typeof service.fieldSources>] =
          document.id;
      }
    }
    if (!service.documentIds.includes(document.id)) service.documentIds.push(document.id);
    const saved = await records.put(w, 'trip', trip.id, validateTrip(next), trip.version);
    await audit(w, 'document.fields_applied', document.id, request.principal!.userId);
    return saved;
  });
  app.put<{ Params: { id: string } }>('/v1/documents/:id/retention', async (request) => {
    const body = input<{ expiresAt: string | null }>('retention', request.body);
    const doc = await records.get<EvidenceDocument>(
      workspace(request),
      'document',
      request.params.id,
    );
    requireCondition(doc, 'DOCUMENT_NOT_FOUND', 404);
    return records.put(
      workspace(request),
      'document',
      doc.id,
      { ...doc.data, expiresAt: body.expiresAt },
      doc.version,
    );
  });
  const flushBlobDeletion = async (w: string, id: string) => {
    await blobs.remove(w, id);
    await records.remove(w, 'blob_delete', id);
  };
  const removeDocument = async (w: string, id: string) =>
    records.withWorkspace(w, async () => {
      const doc = await records.get<EvidenceDocument>(w, 'document', id);
      requireCondition(doc, 'DOCUMENT_NOT_FOUND', 404);
      const trip = await records.get<TripContract>(w, 'trip', doc.data.tripId);
      if (trip) {
        const redacted = redactDocument(trip.data, id);
        if (redacted.changed) await records.put(w, 'trip', trip.id, redacted.trip, trip.version);
        for (const revision of await records.list<{
          tripId: string;
          previous: TripContract;
          changedAt: string;
        }>(w, 'revision', { tripId: trip.id })) {
          const historical = redactDocument(revision.data.previous, id);
          if (historical.changed)
            await records.put(
              w,
              'revision',
              revision.id,
              { ...revision.data, previous: historical.trip },
              revision.version,
            );
        }
      }
      for (const review of await records.list<Review>(w, 'review'))
        if (review.data.evidenceDocumentId === id) await records.remove(w, 'review', review.id);
      for (const event of await records.list<DisruptionEvent>(w, 'event', {
        tripId: doc.data.tripId,
      }))
        if (event.data.documentIds.includes(id))
          await records.put(
            w,
            'event',
            event.id,
            { ...event.data, documentIds: event.data.documentIds.filter((d) => d !== id) },
            event.version,
          );
      for (const job of await records.list<Job>(w, 'job'))
        if (job.data.documentId === id) await records.remove(w, 'job', job.id);
      for (const run of await records.list<{ documentId: string }>(w, 'llm_run', {
        tripId: doc.data.tripId,
      }))
        if (run.data.documentId === id) await records.remove(w, 'llm_run', run.id);
      const deletion = await records.get(w, 'blob_delete', id);
      if (!deletion) await records.put(w, 'blob_delete', id, { documentId: id }, null);
      await records.remove(w, 'document', id);
      const receipt = { deleted: true, storageCleanup: 'pending' };
      records.afterCommit(async () => {
        try {
          await flushBlobDeletion(w, id);
          receipt.storageCleanup = 'complete';
        } catch {
          /* Durable outbox is retried by maintenance. */
        }
      });
      return receipt;
    });
  app.delete<{ Params: { id: string } }>('/v1/documents/:id', async (request) =>
    removeDocument(workspace(request), request.params.id),
  );
  purgeExpiredWorkspace = async (w) => {
    const expired = await records.list<EvidenceDocument>(w, 'document', {
      expiresBefore: new Date().toISOString(),
    });
    if (expired.length)
      await records.withWorkspace(w, async () => {
        for (const candidate of expired) {
          const current = await records.get<EvidenceDocument>(w, 'document', candidate.id);
          if (current && !activeDocument(current.data)) await removeDocument(w, current.id);
        }
      });
  };
  app.get<{ Params: { id: string } }>('/v1/jobs/:id', async (request) => {
    const job = await records.get<Job>(workspace(request), 'job', request.params.id);
    requireCondition(job, 'JOB_NOT_FOUND', 404);
    return job.data;
  });
  const addEvent = async (
    w: string,
    tripId: string,
    data: unknown,
    source: DisruptionEvent['source'],
    id: string = randomUUID(),
  ) => {
    const body = input<Omit<DisruptionEvent, 'id' | 'tripId' | 'source'>>('event', data),
      trip = await tripFor(w, tripId);
    requireCondition(
      trip.data.services.some((s) => s.id === body.serviceId),
      'SERVICE_NOT_FOUND',
      422,
    );
    requireCondition(
      (body.amountMinor === null) === (body.currency === null),
      'CURRENCY_REQUIRED_WITH_AMOUNT',
      422,
    );
    await evidenceExists(w, tripId, body.documentIds);
    const event: DisruptionEvent = { ...body, id, tripId, source };
    await records.put(w, 'event', id, event, null);
    return { event, advice: rightsFor(trip.data, event) };
  };
  app.post<{ Params: { id: string } }>('/v1/trips/:id/events', async (request, reply) => {
    const result = await addEvent(workspace(request), request.params.id, request.body, 'user');
    reply.code(201);
    return result;
  });
  app.get<{ Params: { id: string } }>('/v1/trips/:id/events', async (request) => {
    const trip = await tripFor(workspace(request), request.params.id);
    return (await eventsFor(workspace(request), trip.id)).map((event) => ({
      event,
      advice: rightsFor(trip.data, event),
    }));
  });
  app.post('/v1/workspace/integrations/webhook', async (request) => {
    await auth.authorize(request, 'owner');
    const key = randomBytes(32).toString('base64url'),
      old = await records.get(workspace(request), 'integration', 'webhook');
    await records.put(
      workspace(request),
      'integration',
      'webhook',
      { key, createdAt: new Date().toISOString() },
      old?.version ?? null,
    );
    await audit(workspace(request), 'webhook.rotated', 'webhook', request.principal!.userId);
    return { key, algorithm: 'HMAC-SHA256', scope: 'workspace' };
  });
  app.delete('/v1/workspace/integrations/webhook', async (request) => {
    await auth.authorize(request, 'owner');
    await records.remove(workspace(request), 'integration', 'webhook');
    return { revoked: true };
  });
  app.post<{ Params: { workspaceId: string; tripId: string } }>(
    '/hooks/:workspaceId/:tripId',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      requireCondition(
        /^[a-zA-Z0-9_-]{1,128}$/.test(request.params.workspaceId) &&
          /^[a-f0-9-]{36}$/i.test(request.params.tripId),
        'WEBHOOK_REJECTED',
        401,
      );
      const integration = await records.get<{ key: string }>(
        request.params.workspaceId,
        'integration',
        'webhook',
      );
      requireCondition(integration, 'WEBHOOK_DISABLED', 404);
      const stamp = request.headers['x-tr-timestamp'],
        id = request.headers['x-tr-event-id'],
        signature = request.headers['x-tr-signature'];
      requireCondition(
        typeof stamp === 'string' &&
          typeof id === 'string' &&
          /^[a-zA-Z0-9-]{1,80}$/.test(id) &&
          typeof signature === 'string' &&
          Math.abs(Date.now() - Number(stamp)) <= 300000,
        'WEBHOOK_REJECTED',
        401,
      );
      const canonical = `${stamp}.${request.params.workspaceId}.${request.params.tripId}.${id}.${JSON.stringify(request.body)}`;
      requireCondition(
        constantEqual(
          createHmac('sha256', integration.data.key).update(canonical).digest('hex'),
          signature,
        ),
        'WEBHOOK_REJECTED',
        401,
      );
      return records.withWorkspace(request.params.workspaceId, async () => {
        const current = await records.get<{ key: string }>(
          request.params.workspaceId,
          'integration',
          'webhook',
        );
        requireCondition(
          current && constantEqual(current.data.key, integration.data.key),
          'WEBHOOK_REJECTED',
          401,
        );
        const opaqueId = vault.opaque(`hook:${request.params.workspaceId}:${id}`),
          digest = sha256(JSON.stringify(request.body));
        const old = await records.get<{ digest: string }>(
          request.params.workspaceId,
          'hook_receipt',
          opaqueId,
        );
        if (old) {
          requireCondition(old.data.digest === digest, 'IDEMPOTENCY_CONFLICT', 409);
          return { duplicate: true };
        }
        const result = await addEvent(
          request.params.workspaceId,
          request.params.tripId,
          request.body,
          'webhook',
          opaqueId,
        );
        await records.put(
          request.params.workspaceId,
          'hook_receipt',
          opaqueId,
          { digest, createdAt: new Date().toISOString() },
          null,
        );
        reply.code(201);
        return result;
      });
    },
  );
  app.post<{ Params: { id: string } }>('/v1/trips/:id/dossier', async (request) => {
    const body = input<{ request: string }>('dossier', request.body);
    return reportFor(workspace(request), request.params.id, body.request);
  });
  app.post<{ Params: { id: string } }>('/v1/trips/:id/dossier/pdf', async (request, reply) => {
    const body = input<{ request: string }>('dossier', request.body);
    const report = await reportFor(workspace(request), request.params.id, body.request);
    reply
      .type('application/pdf')
      .header('Content-Disposition', 'attachment; filename="travel-dossier.pdf"');
    return pdf(report);
  });
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/v1/trips/:id/export',
    async (request, reply) => {
      const report = await reportFor(workspace(request), request.params.id);
      const format = request.query.format ?? 'json';
      if (format === 'json') {
        reply
          .type('application/json')
          .header('Content-Disposition', 'attachment; filename="trip-contract.json"');
        return report.trip;
      }
      if (format === 'pdf') {
        reply
          .type('application/pdf')
          .header('Content-Disposition', 'attachment; filename="travel-dossier.pdf"');
        return pdf(report);
      }
      if (format === 'ics') {
        reply
          .type('text/calendar; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="trip.ics"');
        return calendar(report.trip);
      }
      throw new AppError('EXPORT_FORMAT_UNSUPPORTED', 422);
    },
  );
  let activeBundles = 0;
  app.post<{ Params: { id: string } }>(
    '/v1/trips/:id/bundle',
    { config: { rateLimit: { max: 4, timeWindow: '1 minute' } } },
    async (request, reply) => {
      requireCondition(activeBundles < 1, 'BUNDLE_CAPACITY', 503);
      activeBundles++;
      try {
        const body = input<{ passphrase: string; request: string }>('bundle', request.body),
          report = await reportFor(workspace(request), request.params.id, body.request);
        const files = [];
        let bytes = 0;
        for (const doc of await documentsFor(workspace(request), request.params.id)) {
          bytes += doc.data.bytes;
          requireCondition(bytes <= 40 * 1024 * 1024, 'BUNDLE_SIZE_LIMIT', 413);
          files.push({
            id: doc.id,
            sha256: doc.data.sha256,
            base64: (await ingestion.original(workspace(request), doc.data)).toString('base64'),
          });
        }
        reply
          .type('application/octet-stream')
          .header('Content-Disposition', 'attachment; filename="evidence.trb"');
        return await encryptBundle(
          { format: 'travel-reliability-bundle/1.0.0', dossier: report, files },
          body.passphrase,
        );
      } finally {
        activeBundles--;
      }
    },
  );
  app.get('/v1/reviews', async (request) => records.list<Review>(workspace(request), 'review'));
  app.post('/v1/reviews', async (request, reply) => {
    const body = input<Omit<Review, 'id' | 'status' | 'evidenceLevel' | 'createdAt'>>(
      'review',
      request.body,
    );
    const trip = await tripFor(workspace(request), body.tripId);
    const service = trip.data.services.find((s) => s.id === body.serviceId);
    requireCondition(
      service?.documentIds.includes(body.evidenceDocumentId),
      'REVIEW_NEEDS_LINKED_EVIDENCE',
      422,
    );
    await evidenceExists(workspace(request), body.tripId, [body.evidenceDocumentId]);
    const review: Review = {
      ...body,
      id: randomUUID(),
      status: 'private',
      evidenceLevel: 'document_attached',
      createdAt: new Date().toISOString(),
    };
    reply.code(201);
    return records.put(workspace(request), 'review', review.id, review, null);
  });
  app.post<{ Params: { id: string } }>('/v1/reviews/:id/moderate', async (request) => {
    await auth.authorize(request, 'owner');
    const body = input<{ status: Review['status']; confirmNoPersonalData: true }>(
      'moderation',
      request.body,
    );
    const review = await records.get<Review>(workspace(request), 'review', request.params.id);
    requireCondition(review, 'REVIEW_NOT_FOUND', 404);
    return records.put(
      workspace(request),
      'review',
      review.id,
      { ...review.data, status: body.status },
      review.version,
    );
  });
  app.get<{ Params: { workspaceId: string } }>('/public/:workspaceId/reviews', async (request) => {
    requireCondition(
      /^[a-zA-Z0-9_-]{1,128}$/.test(request.params.workspaceId),
      'INVALID_WORKSPACE',
      422,
    );
    await purgeExpiredWorkspace(request.params.workspaceId);
    return (await records.list<Review>(request.params.workspaceId, 'review'))
      .filter((r) => r.data.status === 'approved')
      .map((r) => ({
        ratings: r.data.ratings,
        text: r.data.text,
        evidenceLevel: r.data.evidenceLevel,
      }));
  });
  app.get('/v1/routes', async (request) => records.list<RouteVersion>(workspace(request), 'route'));
  app.post('/v1/routes', async (request, reply) => {
    const body = input<Omit<RouteVersion, 'id' | 'version' | 'createdAt'>>('route', request.body);
    const route: RouteVersion = {
      ...body,
      id: randomUUID(),
      version: 1,
      createdAt: new Date().toISOString(),
    };
    reply.code(201);
    return records.put(workspace(request), 'route', route.id, route, null);
  });
  app.put<{ Params: { id: string } }>('/v1/routes/:id', async (request) => {
    const body = input<Omit<RouteVersion, 'id' | 'version' | 'createdAt'>>('route', request.body);
    const old = await records.get<RouteVersion>(workspace(request), 'route', request.params.id);
    requireCondition(old, 'ROUTE_NOT_FOUND', 404);
    const expected = Number(String(request.headers['if-match'] ?? '').replaceAll('"', ''));
    requireCondition(expected === old.version, 'VERSION_CONFLICT', 409);
    const route = {
      ...body,
      id: old.id,
      version: old.version + 1,
      createdAt: new Date().toISOString(),
    };
    await records.put(
      workspace(request),
      'route_revision',
      `${old.id}-${old.version}`,
      old.data,
      null,
    );
    return records.put(workspace(request), 'route', old.id, route, old.version);
  });
  app.get('/v1/workspace/members', async (request) => {
    await auth.authorize(request, 'owner');
    return records.list(workspace(request), 'member');
  });
  app.post('/v1/workspace/members', async (request) => {
    await auth.authorize(request, 'owner');
    const body = input<{ userId: string; role: Role }>('member', request.body);
    requireCondition(body.userId !== request.principal!.userId, 'OWNER_ROLE_IMMUTABLE', 422);
    const old = await records.get(workspace(request), 'member', body.userId);
    return records.put(workspace(request), 'member', body.userId, body, old?.version ?? null);
  });
  app.delete<{ Params: { userId: string } }>('/v1/workspace/members/:userId', async (request) => {
    await auth.authorize(request, 'owner');
    requireCondition(
      request.params.userId !== request.principal!.userId,
      'OWNER_ROLE_IMMUTABLE',
      422,
    );
    await records.remove(workspace(request), 'member', request.params.userId);
    return { revoked: true };
  });
  app.get('/v1/workspace/export', async (request) => {
    await auth.authorize(request, 'owner');
    const output: Record<string, unknown> = {};
    for (const kind of [
      'trip',
      'document',
      'event',
      'review',
      'route',
      'revision',
      'route_revision',
      'llm_run',
    ])
      output[kind] = await records.list(workspace(request), kind);
    return output;
  });
  app.delete('/v1/workspace', async (request, reply) => {
    await auth.authorize(request, 'owner');
    const w = workspace(request);
    const ids = new Set([
      ...(await records.list<EvidenceDocument>(w, 'document')).map((doc) => doc.id),
      ...(await records.list(w, 'blob_delete')).map((doc) => doc.id),
    ]);
    ingestion.cancelWorkspace(w);
    await auth.revokeWorkspace(w);
    await records.removeWorkspace(w);
    for (const id of ids) await records.put(w, 'blob_delete', id, { documentId: id }, null);
    const receipt = { deleted: true, storageCleanup: 'pending' };
    records.afterCommit(async () => {
      let pending = false;
      for (const id of ids)
        try {
          await flushBlobDeletion(w, id);
        } catch {
          pending = true;
        }
      receipt.storageCleanup = pending ? 'pending' : 'complete';
    });
    await auth.logout(request, reply);
    return receipt;
  });
  app.get('/v1/audit', async (request) => {
    await auth.authorize(request, 'owner');
    return records.list(workspace(request), 'audit');
  });
  app.delete<{ Params: { id: string } }>('/v1/trips/:id', async (request) => {
    const w = workspace(request);
    await tripFor(w, request.params.id);
    for (const doc of await records.list<EvidenceDocument>(w, 'document', {
      tripId: request.params.id,
    }))
      await removeDocument(w, doc.id);
    for (const kind of ['event', 'review', 'job', 'revision'])
      for (const record of await records.list<{ tripId: string }>(w, kind, {
        tripId: request.params.id,
      }))
        await records.remove(w, kind, record.id);
    await records.remove(w, 'trip', request.params.id);
    return { deleted: true };
  });
  const webRoot = resolve('dist/web');
  if (existsSync(webRoot)) await app.register(staticFiles, { root: webRoot, wildcard: false });
  const maintenance = async () => {
    for (const w of await records.expiredWorkspaces(new Date())) await purgeExpiredWorkspace(w);
    for (const ref of await records.pendingDeletions())
      try {
        await flushBlobDeletion(ref.workspace, ref.id);
      } catch {
        /* Retry after transient object-storage failures. */
      }
  };
  const maintenanceTimer = setInterval(() => {
    void maintenance().catch(() => console.warn(JSON.stringify({ event: 'maintenance.failed' })));
  }, 60000);
  maintenanceTimer.unref();
  app.addHook('onClose', async () => {
    clearInterval(maintenanceTimer);
    await ingestion.close();
    await records.close();
    await cache.close();
  });
  return {
    app,
    records,
    blobs,
    cache,
    vault,
    auth,
    ingestion,
    removeDocument,
    maintenance,
    apiRoutes,
  };
}
