import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { S3Client, CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';
import { PostgresRecordStore, RedisCache, S3BlobStore } from '../api/src/storage.js';
import { Vault } from '../api/src/crypto.js';

describe.skipIf(!process.env.TEST_DATABASE_URL)('isolated PostgreSQL integration', () => {
  it('persists ciphertext, indexes queries, serializes CAS and rolls back', async () => {
    const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 }),
      vault = new Vault(Buffer.alloc(32, 4)),
      store = new PostgresRecordStore(pool, vault),
      workspace = 'test-' + randomUUID();
    await store.initialize();
    try {
      await store.withWorkspace(workspace, async () => {
        await store.put(
          workspace,
          'document',
          'doc-a',
          {
            tripId: 'trip-a',
            sha256: 'a'.repeat(64),
            expiresAt: '2000-01-01T00:00:00Z',
            secret: 'SYNTHETIC-PLAINTEXT',
          },
          null,
        );
      });
      const row = await pool.query('SELECT body FROM tr_records WHERE workspace=$1', [workspace]);
      expect(row.rows[0].body.toString()).not.toContain('SYNTHETIC-PLAINTEXT');
      expect(
        await store.list(workspace, 'document', { tripId: 'trip-a', sha256: 'a'.repeat(64) }),
      ).toHaveLength(1);
      expect(await store.list(workspace, 'document', { tripId: 'other' })).toHaveLength(0);
      const writes = await Promise.allSettled([
        store.withWorkspace(workspace, () =>
          store.put(workspace, 'document', 'doc-a', { changed: 1 }, 1),
        ),
        store.withWorkspace(workspace, () =>
          store.put(workspace, 'document', 'doc-a', { changed: 2 }, 1),
        ),
      ]);
      expect(writes.filter((w) => w.status === 'fulfilled')).toHaveLength(1);
      await expect(
        store.withWorkspace(workspace, async () => {
          await store.put(workspace, 'item', 'rollback', { value: 1 }, null);
          throw new Error('synthetic rollback');
        }),
      ).rejects.toThrow();
      expect(await store.get(workspace, 'item', 'rollback')).toBeNull();
      const restarted = new PostgresRecordStore(pool, vault);
      expect((await restarted.get(workspace, 'document', 'doc-a'))!.version).toBe(2);
    } finally {
      await store.removeWorkspace(workspace);
      await store.close();
    }
  });
});
describe.skipIf(!process.env.TEST_REDIS_URL)('isolated Redis integration', () => {
  it('consumes one-time state once', async () => {
    const cache = new RedisCache(new Redis(process.env.TEST_REDIS_URL!)),
      key = 'test-' + randomUUID();
    try {
      await cache.set(key, 'synthetic-state', 10);
      expect((await Promise.all([cache.take(key), cache.take(key)])).filter(Boolean)).toHaveLength(
        1,
      );
    } finally {
      await cache.remove(key);
      await cache.close();
    }
  });
});
describe.skipIf(!process.env.TEST_S3_ENDPOINT)('isolated S3-compatible integration', () => {
  it('roundtrips only authenticated ciphertext and deletes it', async () => {
    const client = new S3Client({
        endpoint: process.env.TEST_S3_ENDPOINT,
        region: 'us-east-1',
        forcePathStyle: true,
        credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret-only' },
      }),
      bucket = 'test-' + randomUUID(),
      workspace = 'test-' + randomUUID(),
      vault = new Vault(Buffer.alloc(32, 5));
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
    const blobs = new S3BlobStore(client, bucket);
    try {
      await blobs.put(
        workspace,
        'doc-a',
        vault.seal(`${workspace}/document/doc-a`, Buffer.from('synthetic original')),
      );
      const ciphertext = await blobs.get(workspace, 'doc-a');
      expect(ciphertext.toString()).not.toContain('synthetic original');
      expect(vault.open(`${workspace}/document/doc-a`, ciphertext).toString()).toBe(
        'synthetic original',
      );
    } finally {
      await blobs.remove(workspace, 'doc-a');
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      client.destroy();
    }
  });
});
