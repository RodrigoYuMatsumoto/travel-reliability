import { Pool } from 'pg';
import { Redis } from 'ioredis';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { Vault } from './crypto.js';
import { AppError } from './errors.js';
import type { Envelope } from '../../schema/src/domain.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PoolClient } from 'pg';

export interface RecordQuery {
  tripId?: string;
  sha256?: string;
  expiresBefore?: string;
}
type CommitTask = () => void | Promise<void>;
interface MemoryTransaction {
  workspace: string;
  afterCommit: CommitTask[];
}
interface PostgresTransaction extends MemoryTransaction {
  client: PoolClient;
}
function indexes(vault: Vault, workspace: string, data: unknown) {
  const value = data as { tripId?: unknown; sha256?: unknown; expiresAt?: unknown };
  return {
    tripKey:
      typeof value?.tripId === 'string'
        ? vault.opaque(`trip-index:${workspace}:${value.tripId}`)
        : null,
    contentKey:
      typeof value?.sha256 === 'string'
        ? vault.opaque(`content-index:${workspace}:${value.sha256}`)
        : null,
    expiresAt: typeof value?.expiresAt === 'string' ? value.expiresAt : null,
    taskState:
      typeof (value as { status?: unknown })?.status === 'string'
        ? (value as { status: string }).status
        : null,
  };
}

export interface RecordStore {
  get<T>(workspace: string, kind: string, id: string): Promise<Envelope<T> | null>;
  list<T>(workspace: string, kind: string, query?: RecordQuery): Promise<Envelope<T>[]>;
  count(workspace: string, kind: string, query?: RecordQuery): Promise<number>;
  expiredWorkspaces(now: Date): Promise<string[]>;
  pendingJobs(now: Date): Promise<Array<{ workspace: string; id: string }>>;
  pendingDeletions(): Promise<Array<{ workspace: string; id: string }>>;
  withWorkspace<T>(workspace: string, work: () => Promise<T>): Promise<T>;
  afterCommit(work: CommitTask): void;
  put<T>(
    workspace: string,
    kind: string,
    id: string,
    data: T,
    expectedVersion: number | null,
  ): Promise<Envelope<T>>;
  remove(workspace: string, kind: string, id: string): Promise<void>;
  removeWorkspace(workspace: string): Promise<void>;
  close(): Promise<void>;
}
export class MemoryRecordStore implements RecordStore {
  private values = new Map<
    string,
    { sealed: Buffer; version: number; updatedAt: string; index: ReturnType<typeof indexes> }
  >();
  private bytes = 0;
  private transactions = new AsyncLocalStorage<MemoryTransaction>();
  private locks = new Map<string, Promise<void>>();
  constructor(private vault: Vault) {}
  private key(w: string, k: string, id: string) {
    return `${w}/${k}/${id}`;
  }
  async get<T>(w: string, k: string, id: string): Promise<Envelope<T> | null> {
    const key = this.key(w, k, id),
      value = this.values.get(key);
    return value
      ? {
          id,
          version: value.version,
          updatedAt: value.updatedAt,
          data: JSON.parse(this.vault.open(key, value.sealed).toString('utf8')) as T,
        }
      : null;
  }
  async list<T>(w: string, k: string, query: RecordQuery = {}): Promise<Envelope<T>[]> {
    const prefix = `${w}/${k}/`,
      output: Envelope<T>[] = [];
    const wanted = indexes(this.vault, w, query);
    for (const [key, row] of this.values)
      if (
        key.startsWith(prefix) &&
        (!query.tripId || row.index.tripKey === wanted.tripKey) &&
        (!query.sha256 || row.index.contentKey === wanted.contentKey) &&
        (!query.expiresBefore ||
          (row.index.expiresAt &&
            Date.parse(row.index.expiresAt) <= Date.parse(query.expiresBefore)))
      )
        output.push((await this.get<T>(w, k, key.slice(prefix.length)))!);
    return output;
  }
  async count(w: string, k: string, query: RecordQuery = {}) {
    const prefix = `${w}/${k}/`,
      wanted = indexes(this.vault, w, query);
    let count = 0;
    for (const [key, row] of this.values)
      if (
        key.startsWith(prefix) &&
        (!query.tripId || row.index.tripKey === wanted.tripKey) &&
        (!query.sha256 || row.index.contentKey === wanted.contentKey)
      )
        count++;
    return count;
  }
  async expiredWorkspaces(now: Date) {
    const result = new Set<string>();
    for (const [key, row] of this.values)
      if (
        key.split('/')[1] === 'document' &&
        row.index.expiresAt &&
        Date.parse(row.index.expiresAt) <= now.getTime()
      )
        result.add(key.split('/')[0]!);
    return [...result];
  }
  async pendingJobs(now: Date) {
    const result: Array<{ workspace: string; id: string }> = [];
    for (const [key, row] of this.values)
      if (
        key.split('/')[1] === 'job' &&
        (row.index.taskState === 'queued' ||
          (row.index.taskState === 'running' && Date.parse(row.updatedAt) < now.getTime() - 180000))
      )
        result.push({ workspace: key.split('/')[0]!, id: key.split('/')[2]! });
    return result.slice(0, 16);
  }
  async pendingDeletions() {
    return [...this.values.keys()]
      .filter((key) => key.split('/')[1] === 'blob_delete')
      .slice(0, 100)
      .map((key) => ({ workspace: key.split('/')[0]!, id: key.split('/')[2]! }));
  }
  afterCommit(work: CommitTask) {
    const current = this.transactions.getStore();
    if (!current) throw new Error('afterCommit requires a transaction');
    current.afterCommit.push(work);
  }
  async withWorkspace<T>(workspace: string, work: () => Promise<T>): Promise<T> {
    const current = this.transactions.getStore();
    if (current) {
      if (current.workspace !== workspace) throw new Error('Cross-workspace transaction');
      return work();
    }
    const previous = this.locks.get(workspace) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.locks.set(workspace, lock);
    await previous;
    const prefix = workspace + '/',
      snapshot = new Map([...this.values].filter(([key]) => key.startsWith(prefix)));
    const transaction: MemoryTransaction = { workspace, afterCommit: [] };
    let result: T;
    try {
      result = await this.transactions.run(transaction, work);
    } catch (error) {
      for (const key of this.values.keys()) if (key.startsWith(prefix)) this.values.delete(key);
      for (const [key, value] of snapshot) this.values.set(key, value);
      this.bytes = [...this.values.values()].reduce((sum, row) => sum + row.sealed.length, 0);
      throw error;
    } finally {
      release();
      if (this.locks.get(workspace) === lock) this.locks.delete(workspace);
    }
    for (const task of transaction.afterCommit) await task();
    return result;
  }
  async put<T>(
    w: string,
    k: string,
    id: string,
    data: T,
    expected: number | null,
  ): Promise<Envelope<T>> {
    const key = this.key(w, k, id),
      old = this.values.get(key);
    if ((old?.version ?? null) !== expected) throw new AppError('VERSION_CONFLICT', 409);
    if (this.values.size >= 20000 && !old) throw new AppError('STORE_CAPACITY', 503);
    const version = (old?.version ?? 0) + 1,
      updatedAt = new Date().toISOString();
    const sealed = this.vault.seal(key, Buffer.from(JSON.stringify(data)));
    const nextBytes = this.bytes - (old?.sealed.length ?? 0) + sealed.length;
    if (nextBytes > 32 * 1024 * 1024) throw new AppError('STORE_CAPACITY', 503);
    this.bytes = nextBytes;
    this.values.set(key, { sealed, version, updatedAt, index: indexes(this.vault, w, data) });
    return { id, version, updatedAt, data: structuredClone(data) };
  }
  async remove(w: string, k: string, id: string) {
    const key = this.key(w, k, id);
    this.bytes -= this.values.get(key)?.sealed.length ?? 0;
    this.values.delete(key);
  }
  async removeWorkspace(w: string) {
    for (const key of this.values.keys())
      if (key.startsWith(w + '/')) {
        this.bytes -= this.values.get(key)!.sealed.length;
        this.values.delete(key);
      }
  }
  async close() {
    this.values.clear();
    this.bytes = 0;
  }
}
export class PostgresRecordStore implements RecordStore {
  private transactions = new AsyncLocalStorage<PostgresTransaction>();
  constructor(
    public pool: Pool,
    private vault: Vault,
  ) {}
  private query(sql: string, params: unknown[] = []) {
    return (this.transactions.getStore()?.client ?? this.pool).query(sql, params);
  }
  afterCommit(work: CommitTask) {
    const current = this.transactions.getStore();
    if (!current) throw new Error('afterCommit requires a transaction');
    current.afterCommit.push(work);
  }
  async withWorkspace<T>(workspace: string, work: () => Promise<T>): Promise<T> {
    const current = this.transactions.getStore();
    if (current) {
      if (current.workspace !== workspace) throw new Error('Cross-workspace transaction');
      return work();
    }
    const client = await this.pool.connect(),
      transaction: PostgresTransaction = { client, workspace, afterCommit: [] };
    let result: T;
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [workspace]);
      result = await this.transactions.run(transaction, work);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    for (const task of transaction.afterCommit) await task();
    return result;
  }
  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS tr_records (
      workspace text NOT NULL, kind text NOT NULL, id text NOT NULL, version integer NOT NULL,
      body bytea NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace, kind, id));
      ALTER TABLE tr_records ADD COLUMN IF NOT EXISTS trip_key text;
      ALTER TABLE tr_records ADD COLUMN IF NOT EXISTS content_key text;
      ALTER TABLE tr_records ADD COLUMN IF NOT EXISTS expires_at timestamptz;
      ALTER TABLE tr_records ADD COLUMN IF NOT EXISTS task_state text;
      CREATE INDEX IF NOT EXISTS tr_records_workspace_kind ON tr_records(workspace,kind);
      CREATE INDEX IF NOT EXISTS tr_records_trip ON tr_records(workspace,kind,trip_key);
      CREATE INDEX IF NOT EXISTS tr_records_content ON tr_records(workspace,kind,content_key);
      CREATE INDEX IF NOT EXISTS tr_records_expiry ON tr_records(kind,expires_at);
      CREATE INDEX IF NOT EXISTS tr_records_jobs ON tr_records(kind,task_state,updated_at)`);
  }
  private decode<T>(
    w: string,
    k: string,
    row: { id: string; version: number; body: Buffer; updated_at: Date },
  ): Envelope<T> {
    return {
      id: row.id,
      version: row.version,
      updatedAt: row.updated_at.toISOString(),
      data: JSON.parse(this.vault.open(`${w}/${k}/${row.id}`, row.body).toString('utf8')) as T,
    };
  }
  async get<T>(w: string, k: string, id: string): Promise<Envelope<T> | null> {
    const result = await this.query(
      'SELECT id,version,body,updated_at FROM tr_records WHERE workspace=$1 AND kind=$2 AND id=$3',
      [w, k, id],
    );
    return result.rows[0] ? this.decode<T>(w, k, result.rows[0]) : null;
  }
  private filters(w: string, k: string, query: RecordQuery) {
    const wanted = indexes(this.vault, w, query),
      params: unknown[] = [w, k];
    let where = 'workspace=$1 AND kind=$2';
    if (query.tripId) {
      params.push(wanted.tripKey);
      where += ` AND trip_key=$${params.length}`;
    }
    if (query.sha256) {
      params.push(wanted.contentKey);
      where += ` AND content_key=$${params.length}`;
    }
    if (query.expiresBefore) {
      params.push(query.expiresBefore);
      where += ` AND expires_at <= $${params.length}`;
    }
    return { where, params };
  }
  async list<T>(w: string, k: string, query: RecordQuery = {}): Promise<Envelope<T>[]> {
    const filter = this.filters(w, k, query),
      result = await this.query(
        `SELECT id,version,body,updated_at FROM tr_records WHERE ${filter.where} ORDER BY updated_at DESC`,
        filter.params,
      );
    return result.rows.map((row) => this.decode<T>(w, k, row));
  }
  async count(w: string, k: string, query: RecordQuery = {}) {
    const filter = this.filters(w, k, query);
    return Number(
      (await this.query(`SELECT count(*) FROM tr_records WHERE ${filter.where}`, filter.params))
        .rows[0].count,
    );
  }
  async expiredWorkspaces(now: Date) {
    const result = await this.query(
      "SELECT DISTINCT workspace FROM tr_records WHERE kind='document' AND expires_at <= $1",
      [now],
    );
    return result.rows.map((row) => row.workspace as string);
  }
  async pendingJobs(now: Date) {
    const result = await this.query(
      "SELECT workspace,id FROM tr_records WHERE kind='job' AND (task_state='queued' OR (task_state='running' AND updated_at < $1)) ORDER BY updated_at LIMIT 16",
      [new Date(now.getTime() - 180000)],
    );
    return result.rows.map((row) => ({ workspace: row.workspace as string, id: row.id as string }));
  }
  async pendingDeletions() {
    const result = await this.query(
      "SELECT workspace,id FROM tr_records WHERE kind='blob_delete' LIMIT 100",
    );
    return result.rows.map((row) => ({ workspace: row.workspace as string, id: row.id as string }));
  }
  async put<T>(
    w: string,
    k: string,
    id: string,
    data: T,
    expected: number | null,
  ): Promise<Envelope<T>> {
    const sealed = this.vault.seal(`${w}/${k}/${id}`, Buffer.from(JSON.stringify(data)));
    const index = indexes(this.vault, w, data);
    let result;
    if (expected === null)
      result = await this.query(
        'INSERT INTO tr_records(workspace,kind,id,version,body,trip_key,content_key,expires_at,task_state) VALUES($1,$2,$3,1,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id,version,body,updated_at',
        [w, k, id, sealed, index.tripKey, index.contentKey, index.expiresAt, index.taskState],
      );
    else
      result = await this.query(
        'UPDATE tr_records SET body=$4,version=version+1,updated_at=now(),trip_key=$6,content_key=$7,expires_at=$8,task_state=$9 WHERE workspace=$1 AND kind=$2 AND id=$3 AND version=$5 RETURNING id,version,body,updated_at',
        [
          w,
          k,
          id,
          sealed,
          expected,
          index.tripKey,
          index.contentKey,
          index.expiresAt,
          index.taskState,
        ],
      );
    if (!result.rows[0]) throw new AppError('VERSION_CONFLICT', 409);
    return this.decode<T>(w, k, result.rows[0]);
  }
  async remove(w: string, k: string, id: string) {
    await this.query('DELETE FROM tr_records WHERE workspace=$1 AND kind=$2 AND id=$3', [w, k, id]);
  }
  async removeWorkspace(w: string) {
    await this.query('DELETE FROM tr_records WHERE workspace=$1', [w]);
  }
  async close() {
    await this.pool.end();
  }
}
export interface BlobStore {
  put(w: string, id: string, data: Buffer): Promise<void>;
  get(w: string, id: string): Promise<Buffer>;
  remove(w: string, id: string): Promise<void>;
}
export class MemoryBlobStore implements BlobStore {
  private blobs = new Map<string, Buffer>();
  private bytes = 0;
  async put(w: string, id: string, data: Buffer) {
    const key = `${w}/${id}`,
      nextBytes = this.bytes - (this.blobs.get(key)?.length ?? 0) + data.length;
    if (nextBytes > 128 * 1024 * 1024) throw new AppError('STORE_CAPACITY', 503);
    this.bytes = nextBytes;
    this.blobs.set(key, Buffer.from(data));
  }
  async get(w: string, id: string) {
    const value = this.blobs.get(`${w}/${id}`);
    if (!value) throw new AppError('DOCUMENT_NOT_FOUND', 404);
    return Buffer.from(value);
  }
  async remove(w: string, id: string) {
    const key = `${w}/${id}`;
    this.bytes -= this.blobs.get(key)?.length ?? 0;
    this.blobs.delete(key);
  }
}
export class S3BlobStore implements BlobStore {
  constructor(
    private client: S3Client,
    private bucket: string,
  ) {}
  private key(w: string, id: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(w) || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
      throw new AppError('INVALID_STORAGE_KEY');
    return `${w}/${id}`;
  }
  async put(w: string, id: string, data: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(w, id),
        Body: data,
        ContentType: 'application/octet-stream',
      }),
    );
  }
  async get(w: string, id: string) {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(w, id) }),
    );
    if (!response.Body) throw new AppError('DOCUMENT_NOT_FOUND', 404);
    return Buffer.from(await response.Body.transformToByteArray());
  }
  async remove(w: string, id: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.key(w, id) }));
  }
}
export interface Cache {
  set(key: string, value: string, seconds: number): Promise<void>;
  get(key: string): Promise<string | null>;
  take(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
  close(): Promise<void>;
}
export class MemoryCache implements Cache {
  private values = new Map<string, { value: string; expires: number }>();
  async set(key: string, value: string, seconds: number) {
    for (const [k, v] of this.values) if (v.expires <= Date.now()) this.values.delete(k);
    if (this.values.size >= 10000 && !this.values.has(key))
      throw new AppError('SESSION_CAPACITY', 503);
    this.values.set(key, { value, expires: Date.now() + seconds * 1000 });
  }
  async get(key: string) {
    const entry = this.values.get(key);
    if (!entry || entry.expires <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }
  async take(key: string) {
    const entry = this.values.get(key);
    this.values.delete(key);
    return entry && entry.expires > Date.now() ? entry.value : null;
  }
  async remove(key: string) {
    this.values.delete(key);
  }
  async close() {
    this.values.clear();
  }
}
export class RedisCache implements Cache {
  constructor(public redis: Redis) {}
  async set(key: string, value: string, seconds: number) {
    await this.redis.set('tr:' + key, value, 'EX', seconds);
  }
  async get(key: string) {
    return this.redis.get('tr:' + key);
  }
  async take(key: string) {
    return this.redis.getdel('tr:' + key);
  }
  async remove(key: string) {
    await this.redis.del('tr:' + key);
  }
  async close() {
    await this.redis.quit();
  }
}
