import { randomUUID } from 'node:crypto';
import type { EvidenceDocument, ExtractedField, Job } from '../../schema/src/domain.js';
import type { RecordStore, BlobStore } from './storage.js';
import type { Config } from './config.js';
import { Vault, sha256 } from './crypto.js';
import { AppError, requireCondition } from './errors.js';

export const MEDIA_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'message/rfc822',
  'text/html',
  'text/plain',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
export interface Extraction {
  parserVersion: string;
  fields: ExtractedField[];
  warnings: string[];
  status: 'needs_review';
  snippets?: Array<{ page?: number; line: number; text: string }>;
}
export function extractText(data: Buffer): Extraction {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    throw new AppError('INVALID_UTF8', 422);
  }
  requireCondition(text.length <= 150000, 'TEXT_LIMIT', 413);
  const warnings: string[] = [],
    fields: ExtractedField[] = [];
  if (
    /ignore\s+(all\s+)?(previous|system|instru)|system\s*prompt|execute\s+(python|shell)|exfiltrat|ignoreRobotsText/i.test(
      text,
    )
  )
    warnings.push('UNTRUSTED_INSTRUCTION_DETECTED');
  if (/[\u200b-\u200f\u2060\u{e0000}-\u{e007f}]/u.test(text))
    warnings.push('INVISIBLE_CHARACTERS_REQUIRE_REVIEW');
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const patterns = [
      [
        'reservation.reference',
        /(?:localizador|booking\s*(?:reference|code)|reservation\s*(?:reference|code)|pnr)\s*[:#]\s*([A-Z0-9-]{3,40})/i,
      ],
      ['cancellation.summary', /((?:cancelamento|cancellation|reembolso|refund).{0,500})/i],
      ['baggage', /((?:bagagem|baggage|luggage).{0,500})/i],
    ] as const;
    for (const [path, pattern] of patterns) {
      const match = pattern.exec(line);
      if (match?.[1])
        fields.push({
          path,
          value: match[1],
          state: 'extracted',
          method: 'text',
          source: { line: index + 1, quote: line.slice(0, 600) },
        });
    }
  }
  if (!fields.length) warnings.push('NO_STRUCTURED_FIELDS_FOUND');
  return {
    parserVersion: '1.0.0',
    fields: fields.slice(0, 300),
    warnings,
    status: 'needs_review',
    snippets: text
      .split(/\r?\n/)
      .map((line, index) => ({ line: index + 1, text: line.slice(0, 600) }))
      .filter((line) => line.text.trim())
      .slice(0, 50),
  };
}
function validateExtraction(input: unknown): Extraction {
  requireCondition(input && typeof input === 'object', 'INVALID_PARSER_RESPONSE', 502);
  const value = input as Extraction;
  requireCondition(
    Array.isArray(value.fields) &&
      value.fields.length <= 300 &&
      Array.isArray(value.warnings) &&
      value.warnings.length <= 30,
    'INVALID_PARSER_RESPONSE',
    502,
  );
  for (const field of value.fields) {
    requireCondition(
      ['reservation.reference', 'cancellation.summary', 'baggage'].includes(field.path) &&
        typeof field.value === 'string' &&
        field.value.length <= 4000 &&
        field.state === 'extracted' &&
        ['text', 'ocr'].includes(field.method) &&
        typeof field.source?.quote === 'string' &&
        field.source.quote.length <= 600,
      'INVALID_PARSER_FIELD',
      502,
    );
  }
  requireCondition(
    value.warnings.every((w) => typeof w === 'string' && /^[A-Z_]{1,100}$/.test(w)),
    'INVALID_PARSER_WARNING',
    502,
  );
  if (value.snippets !== undefined)
    requireCondition(
      Array.isArray(value.snippets) &&
        value.snippets.length <= 50 &&
        value.snippets.every(
          (item) =>
            typeof item.text === 'string' &&
            item.text.length <= 600 &&
            Number.isInteger(item.line) &&
            item.line >= 1 &&
            (item.page === undefined ||
              (Number.isInteger(item.page) && item.page >= 1 && item.page <= 50)),
        ),
      'INVALID_PARSER_SNIPPETS',
      502,
    );
  return { ...value, status: 'needs_review', parserVersion: '1.0.0' };
}
export class Ingestion {
  private running = new Set<Promise<void>>();
  private pending: Array<{ workspace: string; job: Job }> = [];
  private admitted = 0;
  private known = new Set<string>();
  private controllers = new Map<string, AbortController>();
  private recoveryTimer: NodeJS.Timeout;
  constructor(
    private config: Config,
    private records: RecordStore,
    private blobs: BlobStore,
    private vault: Vault,
  ) {
    this.recoveryTimer = setInterval(() => {
      void this.recover().catch(() =>
        console.warn(JSON.stringify({ event: 'ingest.recovery_failed' })),
      );
    }, 5000);
    this.recoveryTimer.unref();
  }
  private enqueue(workspace: string, job: Job, reserve = false) {
    const key = workspace + ':' + job.id;
    if (this.known.has(key) || (reserve && this.admitted >= 8)) return;
    if (reserve) this.admitted++;
    this.known.add(key);
    this.pending.push({ workspace, job });
    this.pump();
  }
  private pump() {
    while (this.running.size < 2 && this.pending.length) {
      const { workspace, job } = this.pending.shift()!;
      const task = this.process(workspace, job)
        .catch(() => console.warn(JSON.stringify({ event: 'ingest.job_failed' })))
        .finally(() => {
          this.running.delete(task);
          this.known.delete(workspace + ':' + job.id);
          this.admitted--;
          this.pump();
        });
      this.running.add(task);
    }
  }
  async recover() {
    for (const ref of await this.records.pendingJobs(new Date())) {
      const job = await this.records.get<Job>(ref.workspace, 'job', ref.id);
      if (job) this.enqueue(ref.workspace, job.data, true);
    }
  }
  async add(
    workspace: string,
    tripId: string,
    bytes: Buffer,
    mediaType: string,
    label: string,
    authorize?: () => Promise<unknown>,
  ) {
    requireCondition(
      MEDIA_TYPES.has(mediaType) && bytes.length > 0 && bytes.length <= 20 * 1024 * 1024,
      'UNSUPPORTED_OR_OVERSIZED_DOCUMENT',
      422,
    );
    requireCondition(this.admitted < 8, 'INGEST_QUEUE_FULL', 503);
    this.admitted++;
    let writtenId: string | null = null;
    try {
      const result = await this.records.withWorkspace(workspace, async () => {
        if (authorize) await authorize();
        requireCondition(await this.records.get(workspace, 'trip', tripId), 'TRIP_NOT_FOUND', 404);
        const hash = sha256(bytes);
        const existing = (
          await this.records.list<EvidenceDocument>(workspace, 'document', { tripId, sha256: hash })
        ).find((d) => !d.data.expiresAt || Date.parse(d.data.expiresAt) > Date.now());
        if (existing) return { document: existing.data, duplicate: true, job: null };
        requireCondition(
          (await this.records.count(workspace, 'document')) <
            (this.config.mode === 'demo' ? 20 : 1000),
          'DOCUMENT_CAPACITY',
          413,
        );
        const id = randomUUID(),
          document: EvidenceDocument = {
            id,
            tripId,
            mediaType,
            label,
            bytes: bytes.length,
            sha256: hash,
            createdAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + this.config.retentionDays * 86400000).toISOString(),
            fields: [],
            warnings: [],
            status: 'quarantined',
            parserVersion: '1.0.0',
            derivedFrom: null,
          };
        await this.blobs.put(workspace, id, this.vault.seal(`${workspace}/document/${id}`, bytes));
        writtenId = id;
        await this.records.put(workspace, 'document', id, document, null);
        const job: Job = {
          id: randomUUID(),
          tripId,
          documentId: id,
          status: 'queued',
          errorCode: null,
          createdAt: new Date().toISOString(),
        };
        await this.records.put(workspace, 'job', job.id, job, null);
        this.records.afterCommit(() => this.enqueue(workspace, job));
        return { document, duplicate: false, job };
      });
      if (result.duplicate) this.admitted--;
      return result;
    } catch (error) {
      this.admitted--;
      if (writtenId) await this.blobs.remove(workspace, writtenId);
      throw error;
    }
  }
  async process(workspace: string, job: Job) {
    const record = await this.records.withWorkspace(workspace, async () => {
      const jobRecord = await this.records.get<Job>(workspace, 'job', job.id),
        document = await this.records.get<EvidenceDocument>(workspace, 'document', job.documentId!);
      if (!document || !jobRecord || !['queued', 'running'].includes(jobRecord.data.status))
        return null;
      if (
        jobRecord.data.status === 'running' &&
        Date.parse(jobRecord.updatedAt) > Date.now() - 180000
      )
        return null;
      await this.records.put(
        workspace,
        'job',
        job.id,
        { ...jobRecord.data, status: 'running' },
        jobRecord.version,
      );
      return document;
    });
    if (!record) return;
    const controllerKey = workspace + ':' + record.id,
      controller = new AbortController();
    this.controllers.set(controllerKey, controller);
    try {
      const bytes = this.vault.open(
        `${workspace}/document/${record.id}`,
        await this.blobs.get(workspace, record.id),
      );
      requireCondition(sha256(bytes) === record.data.sha256, 'INTEGRITY_CHECK_FAILED', 409);
      let extracted: Extraction;
      if (['text/plain', 'application/json'].includes(record.data.mediaType))
        extracted = extractText(bytes);
      else {
        requireCondition(this.config.ingestUrl, 'INGEST_WORKER_NOT_CONFIGURED', 503);
        const response = await fetch(new URL('/extract', this.config.ingestUrl), {
          method: 'POST',
          headers: { 'content-type': record.data.mediaType },
          body: new Uint8Array(bytes),
          redirect: 'error',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(125000)]),
        });
        if (!response.ok) throw new AppError('DOCUMENT_EXTRACTION_FAILED', 422);
        extracted = validateExtraction(await response.json());
      }
      // A concurrent deletion wins. Never resurrect a deleted document or job.
      await this.records.withWorkspace(workspace, async () => {
        const current = await this.records.get<EvidenceDocument>(workspace, 'document', record.id);
        if (
          !current ||
          (current.data.expiresAt && Date.parse(current.data.expiresAt) <= Date.now())
        )
          return;
        await this.records.put(
          workspace,
          'document',
          record.id,
          {
            ...current.data,
            fields: extracted.fields,
            warnings: extracted.warnings,
            preview: extracted.snippets ?? [],
            status: 'needs_review',
          },
          current.version,
        );
        const latest = await this.records.get<Job>(workspace, 'job', job.id);
        if (latest)
          await this.records.put(
            workspace,
            'job',
            job.id,
            { ...latest.data, status: 'needs_review' },
            latest.version,
          );
      });
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'EXTRACTION_FAILED';
      await this.records.withWorkspace(workspace, async () => {
        const latest = await this.records.get<Job>(workspace, 'job', job.id);
        if (latest)
          await this.records.put(
            workspace,
            'job',
            job.id,
            { ...latest.data, status: 'failed', errorCode: code },
            latest.version,
          );
        const current = await this.records.get<EvidenceDocument>(workspace, 'document', record.id);
        if (current)
          await this.records.put(
            workspace,
            'document',
            record.id,
            { ...current.data, status: 'needs_review', warnings: [code] },
            current.version,
          );
      });
    } finally {
      this.controllers.delete(controllerKey);
    }
  }
  cancelWorkspace(workspace: string) {
    for (const entry of this.pending.filter((item) => item.workspace === workspace)) {
      this.known.delete(workspace + ':' + entry.job.id);
      this.admitted--;
    }
    this.pending = this.pending.filter((item) => item.workspace !== workspace);
    for (const [key, controller] of this.controllers)
      if (key.startsWith(workspace + ':')) controller.abort();
  }
  async wait() {
    while (this.running.size || this.pending.length) {
      this.pump();
      await Promise.allSettled(this.running);
    }
  }
  async close() {
    clearInterval(this.recoveryTimer);
    for (const controller of this.controllers.values()) controller.abort();
    await this.wait();
  }
  async original(workspace: string, doc: EvidenceDocument) {
    const plain = this.vault.open(
      `${workspace}/document/${doc.id}`,
      await this.blobs.get(workspace, doc.id),
    );
    requireCondition(sha256(plain) === doc.sha256, 'INTEGRITY_CHECK_FAILED', 409);
    return plain;
  }
}
