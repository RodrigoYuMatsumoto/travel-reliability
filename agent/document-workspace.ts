import { constants } from 'node:fs';
import { open, lstat, realpath, readdir, mkdir, unlink, rmdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { AppError } from '../api/src/errors.js';

const MAX_FILE_BYTES = 262144;
const MAX_SOURCE_BYTES = 8388608;
const MAX_TOTAL_BYTES = 67108864;
const MAX_FILES = 100;
const MAX_ENTRIES = 400;
const MAX_DEPTH = 6;
const PLAN_TTL_MS = 900000;
const INTERNAL = '.travel-workspace';
const EXTENSIONS = new Set(['.txt', '.md', '.json', '.csv', '.eml', '.ics']);
const OPAQUE_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);
for (const extension of OPAQUE_EXTENSIONS) EXTENSIONS.add(extension);
const BLOCKED_NAMES = new Set(['.git', 'node_modules', '.venv', '.env', '.env.bak']);
const SERVICE_TYPES = [
  'flight',
  'bus',
  'rail',
  'ferry',
  'cruise',
  'car-rental',
  'transfer',
  'hotel',
  'short-stay',
  'camping',
  'activity',
  'insurance',
  'business',
  'other',
] as const;
const ID = { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,39}$' } as const;
const SHA = { type: 'string', pattern: '^[a-f0-9]{64}$' } as const;
const SOURCE = { type: 'string', pattern: '^SRC[0-9]{2,6}$' } as const;
const nullableId = { anyOf: [ID, { type: 'null' }] } as const;
const time = {
  anyOf: [{ type: 'string', format: 'date-time', maxLength: 40 }, { type: 'null' }],
} as const;
const money = {
  anyOf: [
    { type: 'null' },
    {
      type: 'object',
      additionalProperties: false,
      required: ['currency', 'amountMinor'],
      properties: {
        currency: { type: 'string', pattern: '^[A-Z]{3}$' },
        amountMinor: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
      },
    },
  ],
} as const;
const recordSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reservationKey', 'sourceRef', 'channel', 'serviceType', 'fields'],
  properties: {
    reservationKey: ID,
    sourceRef: SOURCE,
    channel: { enum: ['email', 'supplier-export', 'booking-export', 'airbnb-export', 'manual'] },
    serviceType: { enum: SERVICE_TYPES },
    fields: {
      type: 'object',
      additionalProperties: false,
      required: ['supplierId', 'status', 'startsAt', 'endsAt', 'locationCode', 'money'],
      properties: {
        supplierId: nullableId,
        status: { enum: ['pending', 'confirmed', 'cancelled', null] },
        startsAt: time,
        endsAt: time,
        locationCode: {
          anyOf: [{ type: 'string', pattern: '^[A-Z0-9:_-]{2,32}$' }, { type: 'null' }],
        },
        money,
      },
    },
  },
} as const;

export const documentReconciliationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tripKey', 'records'],
  properties: {
    tripKey: ID,
    records: { type: 'array', maxItems: 200, items: recordSchema },
  },
} as const;

export const documentWorkspaceInputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['tripKey', 'documents', 'records'],
  properties: {
    tripKey: ID,
    documents: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fileId', 'serviceType', 'serviceDate', 'recordId', 'sourceRefs', 'mode'],
        properties: {
          fileId: { type: 'string', pattern: '^F[a-f0-9]{24}$' },
          serviceType: { enum: SERVICE_TYPES },
          serviceDate: { type: 'string', format: 'date', maxLength: 10 },
          recordId: ID,
          sourceRefs: { type: 'array', minItems: 1, maxItems: 8, uniqueItems: true, items: SOURCE },
          mode: { enum: ['copy', 'move'] },
        },
      },
    },
    records: { type: 'array', maxItems: 200, items: recordSchema },
  },
} as const;

export interface ReservationSnapshot {
  reservationKey: string;
  sourceRef: string;
  channel: 'email' | 'supplier-export' | 'booking-export' | 'airbnb-export' | 'manual';
  serviceType: (typeof SERVICE_TYPES)[number];
  fields: {
    supplierId: string | null;
    status: 'pending' | 'confirmed' | 'cancelled' | null;
    startsAt: string | null;
    endsAt: string | null;
    locationCode: string | null;
    money: { currency: string; amountMinor: number } | null;
  };
}
interface WorkspaceInput {
  tripKey: string;
  documents: Array<{
    fileId: string;
    serviceType: (typeof SERVICE_TYPES)[number];
    serviceDate: string;
    recordId: string;
    sourceRefs: string[];
    mode: 'copy' | 'move';
  }>;
  records: ReservationSnapshot[];
}
export interface FileSnapshot {
  fileId: string;
  relativePath: string;
  sha256: string;
  bytes: number;
}
interface Action {
  kind: 'copy' | 'move' | 'create';
  source: FileSnapshot | null;
  target: string;
  sha256: string;
  bytes: number;
  content: string | null;
  preexisting: boolean;
}
export interface WorkspacePlan {
  version: 1;
  tripKey: string;
  workspaceBinding: string;
  createdAt: string;
  expiresAt: string;
  actions: Action[];
  digest: string;
}
export interface WorkspaceAuthorization {
  intent: 'apply' | 'rollback';
  approvedPlanDigest: string;
}
interface JournalEvent {
  sequence: number;
  event:
    | 'begin'
    | 'written'
    | 'source_removed'
    | 'complete'
    | 'failed'
    | 'rollback_begin'
    | 'source_restored'
    | 'target_removed'
    | 'rolled_back';
  index?: number;
}

const ajv = new Ajv2020({ strict: true, allErrors: false, ownProperties: true });
(addFormats as unknown as (instance: Ajv2020) => void)(ajv);
const validateRecords = ajv.compile(documentReconciliationSchema);
const validateInput = ajv.compile(documentWorkspaceInputSchema);
const snapshotSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['fileId', 'relativePath', 'sha256', 'bytes'],
  properties: {
    fileId: { type: 'string', pattern: '^F[a-f0-9]{24}$' },
    relativePath: { type: 'string', maxLength: 512 },
    sha256: SHA,
    bytes: { type: 'integer', minimum: 0, maximum: MAX_SOURCE_BYTES },
  },
} as const;
const validatePlanShape = ajv.compile({
  type: 'object',
  additionalProperties: false,
  required: [
    'version',
    'tripKey',
    'workspaceBinding',
    'createdAt',
    'expiresAt',
    'actions',
    'digest',
  ],
  properties: {
    version: { const: 1 },
    tripKey: ID,
    workspaceBinding: SHA,
    digest: SHA,
    createdAt: { type: 'string', format: 'date-time', maxLength: 40 },
    expiresAt: { type: 'string', format: 'date-time', maxLength: 40 },
    actions: {
      type: 'array',
      minItems: 2,
      maxItems: 42,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'source', 'target', 'sha256', 'bytes', 'content', 'preexisting'],
        properties: {
          kind: { enum: ['copy', 'move', 'create'] },
          source: { anyOf: [snapshotSchema, { type: 'null' }] },
          target: { type: 'string', maxLength: 512 },
          sha256: SHA,
          bytes: { type: 'integer', minimum: 0, maximum: MAX_SOURCE_BYTES },
          content: { anyOf: [{ type: 'string', maxLength: MAX_FILE_BYTES }, { type: 'null' }] },
          preexisting: { type: 'boolean' },
        },
      },
    },
  },
});

function fail(code: string, status = 422): never {
  throw new AppError(code, status);
}
function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return (
      '{' +
      Object.keys(object)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + stable(object[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}
function assertJson(value: unknown, maximumBytes = 262144): void {
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > 12000 || item.depth > 10) fail('WORKSPACE_INPUT_LIMIT');
    if (item.value === null || typeof item.value === 'boolean') continue;
    if (typeof item.value === 'number') {
      if (!Number.isSafeInteger(item.value)) fail('INVALID_DOCUMENT_INPUT');
      continue;
    }
    if (typeof item.value === 'string') {
      if (Buffer.byteLength(item.value) > maximumBytes) fail('WORKSPACE_INPUT_LIMIT');
      continue;
    }
    if (typeof item.value !== 'object') fail('INVALID_DOCUMENT_INPUT');
    const descriptors = Object.getOwnPropertyDescriptors(item.value);
    const keys = Reflect.ownKeys(descriptors);
    if (Array.isArray(item.value)) {
      if (
        Object.getPrototypeOf(item.value) !== Array.prototype ||
        item.value.length > 200 ||
        keys.length !== item.value.length + 1
      )
        fail('INVALID_DOCUMENT_INPUT');
      for (let index = 0; index < item.value.length; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
          fail('INVALID_DOCUMENT_INPUT');
        stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    } else {
      const prototype = Object.getPrototypeOf(item.value);
      if ((prototype !== Object.prototype && prototype !== null) || keys.length > 16)
        fail('INVALID_DOCUMENT_INPUT');
      for (const key of keys) {
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
          fail('INVALID_DOCUMENT_INPUT');
        const descriptor = descriptors[key]!;
        if (!('value' in descriptor) || !descriptor.enumerable) fail('INVALID_DOCUMENT_INPUT');
        stack.push({ value: descriptor.value, depth: item.depth + 1 });
      }
    }
  }
  if (Buffer.byteLength(stable(value)) > maximumBytes) fail('WORKSPACE_INPUT_LIMIT');
}
function safeRelative(value: string): string {
  if (
    !value ||
    value.length > 512 ||
    value.includes('\\') ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value)
  )
    fail('WORKSPACE_PATH_REJECTED');
  const components = value.split('/');
  if (components.length > MAX_DEPTH + 4) fail('WORKSPACE_PATH_REJECTED');
  for (const component of components) {
    const lower = component.toLowerCase();
    if (
      !component ||
      component === '.' ||
      component === '..' ||
      component.length > 128 ||
      component.normalize('NFC') !== component ||
      BLOCKED_NAMES.has(lower) ||
      lower.startsWith('.env.') ||
      /[\x00-\x1f\x7f<>:"|?*\u202a-\u202e\u2066-\u2069]/u.test(component) ||
      /[. ]$/.test(component) ||
      /^(CON|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(
        component,
      )
    )
      fail('WORKSPACE_PATH_REJECTED');
  }
  return components.join('/');
}
function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException)?.code;
}
function dateCanonical(value: unknown): string {
  return typeof value === 'string' ? new Date(value).toISOString() : stable(value);
}

/** Accepts normalized, caller-associated records; it does not query or authenticate accounts. */
export function reconcileDocuments(input: unknown) {
  assertJson(input);
  if (!validateRecords(input)) fail('INVALID_DOCUMENT_RECONCILIATION');
  const data = input as { tripKey: string; records: ReservationSnapshot[] };
  const seen = new Set<string>();
  for (const record of data.records) {
    const key = record.reservationKey + ':' + record.sourceRef;
    if (seen.has(key)) fail('DUPLICATE_DOCUMENT_SOURCE');
    seen.add(key);
  }
  const keys = [...new Set(data.records.map((record) => record.reservationKey))].sort();
  const groups = keys.map((reservationKey) => {
    const records = data.records.filter((record) => record.reservationKey === reservationKey);
    const fields = [
      'serviceType',
      'supplierId',
      'status',
      'startsAt',
      'endsAt',
      'locationCode',
      'money',
    ] as const;
    const conflicts: Array<{
      field: string;
      observations: Array<{ sourceRef: string; value: unknown }>;
    }> = [];
    const unknownFields: string[] = [];
    for (const field of fields) {
      const observations = records
        .map((record) => ({
          sourceRef: record.sourceRef,
          value: field === 'serviceType' ? record.serviceType : record.fields[field],
        }))
        .filter((row) => row.value !== null);
      const comparable = observations.map((row) =>
        field === 'startsAt' || field === 'endsAt' ? dateCanonical(row.value) : stable(row.value),
      );
      if (!observations.length) unknownFields.push(field);
      if (new Set(comparable).size > 1) conflicts.push({ field, observations });
    }
    const incompleteSources = records
      .filter((record) => Object.values(record.fields).some((value) => value === null))
      .map((record) => record.sourceRef)
      .sort();
    const invalidIntervals = records
      .filter(
        (record) =>
          record.fields.startsAt !== null &&
          record.fields.endsAt !== null &&
          Date.parse(record.fields.endsAt) < Date.parse(record.fields.startsAt),
      )
      .map((record) => record.sourceRef)
      .sort();
    return {
      reservationKey,
      status:
        conflicts.length || invalidIntervals.length
          ? 'conflict'
          : unknownFields.length || incompleteSources.length || records.length < 2
            ? 'incomplete'
            : 'consistent_as_supplied',
      sourceRefs: records.map((record) => record.sourceRef).sort(),
      channels: [...new Set(records.map((record) => record.channel))].sort(),
      conflicts,
      unknownFields,
      incompleteSources,
      invalidIntervals,
      independentlyVerified: false,
    };
  });
  return {
    tripKey: data.tripKey,
    groups,
    effects: { externalCalls: 0, modelCalls: 0, persistenceWrites: 0, accountsAccessed: false },
    association: 'explicit_reservation_key_only',
    authenticity: 'not_verified',
  };
}

/** A trusted local operator supplies the root. Never expose this constructor as an unrestricted LLM tool. */
export class DocumentWorkspace {
  private constructor(
    private readonly root: string,
    private readonly binding: string,
    private readonly clock: () => number,
  ) {}

  static async open(
    root: string,
    options: { clock?: () => number } = {},
  ): Promise<DocumentWorkspace> {
    if (!path.isAbsolute(root) || /^[/\\]{2}/.test(root) || root.includes('\0'))
      fail('WORKSPACE_ROOT_REJECTED');
    const resolved = path.resolve(root);
    if (resolved === path.parse(resolved).root) fail('WORKSPACE_ROOT_REJECTED');
    let ancestor = resolved;
    for (;;) {
      const stat = await lstat(ancestor).catch(() => fail('WORKSPACE_ROOT_REJECTED'));
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail('WORKSPACE_LINK_NOT_ALLOWED');
      try {
        await lstat(path.join(ancestor, '.git'));
        fail('WORKSPACE_GIT_DIRECTORY_REJECTED');
      } catch (error) {
        if (errorCode(error) !== 'ENOENT') throw error;
      }
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const canonical = await realpath(resolved);
    if (path.relative(resolved, canonical) !== '') fail('WORKSPACE_LINK_NOT_ALLOWED');
    const stat = await lstat(canonical);
    const clock = options.clock ?? Date.now;
    const instant = clock();
    if (!Number.isSafeInteger(instant) || instant < 0 || instant > 8640000000000000 - PLAN_TTL_MS)
      fail('WORKSPACE_CLOCK_INVALID');
    return new DocumentWorkspace(
      canonical,
      hash(stable({ root: canonical, dev: stat.dev, ino: stat.ino })),
      clock,
    );
  }

  private absolute(relative: string): string {
    safeRelative(relative);
    const absolute = path.resolve(this.root, ...relative.split('/'));
    const difference = path.relative(this.root, absolute);
    if (
      !difference ||
      difference.startsWith('..' + path.sep) ||
      difference === '..' ||
      path.isAbsolute(difference)
    )
      fail('WORKSPACE_PATH_REJECTED');
    return absolute;
  }

  private async checkRoot(): Promise<void> {
    const stat = await lstat(this.root).catch(() => fail('WORKSPACE_ROOT_CHANGED', 409));
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (await realpath(this.root)) !== this.root ||
      hash(stable({ root: this.root, dev: stat.dev, ino: stat.ino })) !== this.binding
    )
      fail('WORKSPACE_ROOT_CHANGED', 409);
  }

  private async checkParents(relative: string, create = false): Promise<void> {
    const components = safeRelative(relative).split('/');
    components.pop();
    let current = this.root;
    for (const component of components) {
      current = path.join(current, component);
      if (create)
        await mkdir(current, { mode: 0o700 }).catch((error) => {
          if (errorCode(error) !== 'EEXIST') fail('WORKSPACE_DIRECTORY_FAILED', 409);
        });
      const stat = await lstat(current).catch((error) => {
        if (!create && errorCode(error) === 'ENOENT') return null;
        fail('WORKSPACE_PATH_REJECTED');
      });
      if (stat === null) return;
      if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(current)) !== current)
        fail('WORKSPACE_LINK_NOT_ALLOWED');
    }
  }

  private async readBytes(
    relative: string,
    maximum = MAX_SOURCE_BYTES,
  ): Promise<{ data: Buffer; snapshot: FileSnapshot; dev: number; ino: number }> {
    await this.checkRoot();
    await this.checkParents(relative);
    const absolute = this.absolute(relative);
    const before = await lstat(absolute).catch(() => fail('WORKSPACE_FILE_UNAVAILABLE', 409));
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
      fail('WORKSPACE_LINK_NOT_ALLOWED');
    if (before.size > maximum) fail('WORKSPACE_FILE_LIMIT');
    let handle: FileHandle | undefined;
    try {
      handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino ||
        opened.size !== before.size
      )
        fail('WORKSPACE_SOURCE_CHANGED', 409);
      const buffer = Buffer.alloc(before.size + 1);
      const read = await handle.read(buffer, 0, buffer.length, 0);
      const after = await handle.stat();
      if (
        read.bytesRead !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.nlink !== 1
      )
        fail('WORKSPACE_SOURCE_CHANGED', 409);
      const data = buffer.subarray(0, read.bytesRead);
      const sha256 = hash(data);
      return {
        data,
        snapshot: {
          fileId: 'F' + hash(relative + '\0' + sha256).slice(0, 24),
          relativePath: relative,
          sha256,
          bytes: data.length,
        },
        dev: before.dev,
        ino: before.ino,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('WORKSPACE_FILE_UNAVAILABLE', 409);
    } finally {
      await handle?.close();
    }
  }

  private async readText(relative: string) {
    const file = await this.readBytes(relative, MAX_FILE_BYTES);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(file.data);
    } catch {
      fail('WORKSPACE_TEXT_ENCODING_REJECTED');
    }
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) fail('WORKSPACE_BINARY_REJECTED');
    return file;
  }

  private async readDocument(relative: string) {
    return OPAQUE_EXTENSIONS.has(path.posix.extname(relative).toLowerCase())
      ? this.readBytes(relative)
      : this.readText(relative);
  }

  async inventory(): Promise<{
    files: FileSnapshot[];
    unsupportedFiles: number;
    textOnly: false;
    opaqueDocuments: true;
  }> {
    await this.checkRoot();
    const names: string[] = [];
    let entries = 0;
    let unsupportedFiles = 0;
    const visit = async (relative: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH) fail('WORKSPACE_DEPTH_LIMIT');
      const directory = relative ? this.absolute(relative) : this.root;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++entries > MAX_ENTRIES) fail('WORKSPACE_ENTRY_LIMIT');
        const lower = entry.name.toLowerCase();
        if (lower === INTERNAL || BLOCKED_NAMES.has(lower) || lower.startsWith('.env.')) continue;
        const name = safeRelative(relative ? relative + '/' + entry.name : entry.name);
        const stat = await lstat(this.absolute(name));
        if (stat.isSymbolicLink()) fail('WORKSPACE_LINK_NOT_ALLOWED');
        if (stat.isDirectory()) await visit(name, depth + 1);
        else if (stat.isFile() && EXTENSIONS.has(path.posix.extname(name).toLowerCase()))
          names.push(name);
        else unsupportedFiles++;
      }
    };
    await visit('', 0);
    if (names.length > MAX_FILES) fail('WORKSPACE_FILE_COUNT_LIMIT');
    const files: FileSnapshot[] = [];
    let bytes = 0;
    for (const name of names.sort()) {
      const file = await this.readDocument(name);
      bytes += file.snapshot.bytes;
      if (bytes > MAX_TOTAL_BYTES) fail('WORKSPACE_TOTAL_LIMIT');
      files.push(file.snapshot);
    }
    if (new Set(files.map((file) => file.fileId)).size !== files.length)
      fail('WORKSPACE_FILE_ID_COLLISION');
    return { files, unsupportedFiles, textOnly: false, opaqueDocuments: true };
  }

  private async targetState(
    target: string,
    expectedHash: string,
    expectedBytes: number,
  ): Promise<boolean> {
    await this.checkParents(target);
    const stat = await lstat(this.absolute(target)).catch((error) => {
      if (errorCode(error) === 'ENOENT') return null;
      fail('WORKSPACE_TARGET_COLLISION', 409);
    });
    if (stat === null) return false;
    const existing = await this.readDocument(target);
    if (existing.snapshot.sha256 !== expectedHash || existing.snapshot.bytes !== expectedBytes)
      fail('WORKSPACE_TARGET_COLLISION', 409);
    return true;
  }

  async prepare(
    input: unknown,
  ): Promise<{ plan: WorkspacePlan; reconciliation: ReturnType<typeof reconcileDocuments> }> {
    assertJson(input);
    if (!validateInput(input)) fail('INVALID_DOCUMENT_WORKSPACE_INPUT');
    const data = input as WorkspaceInput;
    const reconciliation = reconcileDocuments({ tripKey: data.tripKey, records: data.records });
    const inventory = await this.inventory();
    const fileMap = new Map(inventory.files.map((file) => [file.fileId, file]));
    const usedSources = new Set<string>();
    const targets = new Set<string>();
    const actions: Action[] = [];
    const documents = [...data.documents].sort((a, b) => a.fileId.localeCompare(b.fileId, 'en'));
    for (const document of documents) {
      const source = fileMap.get(document.fileId);
      if (!source || usedSources.has(source.fileId)) fail('WORKSPACE_SOURCE_REFERENCE_INVALID');
      usedSources.add(source.fileId);
      const extension = path.posix.extname(source.relativePath).toLowerCase();
      const target = `${INTERNAL}/trips/${data.tripKey}/documents/${document.serviceType}/${document.serviceDate}_${document.recordId}${extension}`;
      const key = target.toLowerCase();
      if (targets.has(key)) fail('WORKSPACE_TARGET_COLLISION', 409);
      targets.add(key);
      actions.push({
        kind: document.mode,
        source: { ...source },
        target,
        sha256: source.sha256,
        bytes: source.bytes,
        content: null,
        preexisting: await this.targetState(target, source.sha256, source.bytes),
      });
    }
    const record = {
      format: 'travel-reliability-private-record/1',
      tripKey: data.tripKey,
      documents: documents.map((document) => ({
        recordId: document.recordId,
        serviceType: document.serviceType,
        serviceDate: document.serviceDate,
        fileId: document.fileId,
        sourceRefs: [...document.sourceRefs].sort(),
      })),
      records: [...data.records].sort((a, b) =>
        (a.reservationKey + a.sourceRef).localeCompare(b.reservationKey + b.sourceRef, 'en'),
      ),
      reconciliation,
      authenticity: 'not_verified',
    };
    const json = JSON.stringify(record, null, 2) + '\n';
    const version = hash(json).slice(0, 16);
    const markdown =
      `# Trip ${data.tripKey}\n\nPrivate documentary record; no account or reservation authenticated.\n\n` +
      `Documents: ${documents.length}. Normalized observations: ${data.records.length}.\n\n` +
      '| Reservation | Documentary status | Sources | Conflicts | Unknown fields |\n| --- | --- | --- | --- | --- |\n' +
      reconciliation.groups
        .map(
          (group) =>
            `| ${group.reservationKey} | ${group.status} | ${group.sourceRefs.join(', ')} | ${group.conflicts.map((conflict) => conflict.field).join(', ') || '-'} | ${group.unknownFields.join(', ') || '-'} |`,
        )
        .join('\n') +
      '\n';
    for (const [extension, content] of [
      ['json', json],
      ['md', markdown],
    ]) {
      const target = `${INTERNAL}/trips/${data.tripKey}/trip-record-${version}.${extension}`;
      const bytes = Buffer.byteLength(content!);
      if (bytes > MAX_FILE_BYTES) fail('WORKSPACE_GENERATED_RECORD_LIMIT');
      const sha256 = hash(content!);
      actions.push({
        kind: 'create',
        source: null,
        target,
        sha256,
        bytes,
        content: content!,
        preexisting: await this.targetState(target, sha256, bytes),
      });
    }
    const created = this.clock();
    if (!Number.isSafeInteger(created) || created < 0 || created > 8640000000000000 - PLAN_TTL_MS)
      fail('WORKSPACE_CLOCK_INVALID');
    const body = {
      version: 1 as const,
      tripKey: data.tripKey,
      workspaceBinding: this.binding,
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + PLAN_TTL_MS).toISOString(),
      actions,
    };
    return { plan: { ...body, digest: hash(stable(body)) }, reconciliation };
  }

  private validatePlan(value: unknown): WorkspacePlan {
    assertJson(value, 786432);
    if (!validatePlanShape(value)) fail('INVALID_WORKSPACE_PLAN');
    const plan = value as WorkspacePlan;
    const { digest, ...body } = plan;
    if (digest !== hash(stable(body)) || plan.workspaceBinding !== this.binding)
      fail('WORKSPACE_PLAN_DIGEST_MISMATCH', 409);
    const created = Date.parse(plan.createdAt);
    if (Date.parse(plan.expiresAt) !== created + PLAN_TTL_MS) fail('INVALID_WORKSPACE_PLAN');
    const targets = new Set<string>();
    const sources = new Set<string>();
    let generated = 0;
    for (const action of plan.actions) {
      safeRelative(action.target);
      if (!action.target.startsWith(`${INTERNAL}/trips/${plan.tripKey}/`))
        fail('WORKSPACE_PATH_REJECTED');
      if (targets.has(action.target.toLowerCase())) fail('WORKSPACE_TARGET_COLLISION', 409);
      targets.add(action.target.toLowerCase());
      if (action.kind === 'create') {
        generated++;
        if (
          action.source !== null ||
          action.content === null ||
          action.bytes > MAX_FILE_BYTES ||
          !/\/trip-record-[a-f0-9]{16}\.(json|md)$/.test(action.target) ||
          Buffer.byteLength(action.content) !== action.bytes ||
          hash(action.content) !== action.sha256
        )
          fail('INVALID_WORKSPACE_PLAN');
      } else {
        if (
          action.source === null ||
          action.content !== null ||
          action.source.relativePath.toLowerCase().startsWith(INTERNAL + '/') ||
          !EXTENSIONS.has(path.posix.extname(action.source.relativePath).toLowerCase()) ||
          action.sha256 !== action.source.sha256 ||
          action.bytes !== action.source.bytes
        )
          fail('INVALID_WORKSPACE_PLAN');
        safeRelative(action.source.relativePath);
        if (sources.has(action.source.relativePath.toLowerCase()))
          fail('WORKSPACE_SOURCE_REFERENCE_INVALID');
        sources.add(action.source.relativePath.toLowerCase());
      }
    }
    if (generated !== 2) fail('INVALID_WORKSPACE_PLAN');
    return plan;
  }

  private authorize(
    plan: WorkspacePlan,
    authorization: WorkspaceAuthorization,
    intent: 'apply' | 'rollback',
  ): void {
    if (
      !authorization ||
      Object.keys(authorization).length !== 2 ||
      authorization.intent !== intent ||
      authorization.approvedPlanDigest !== plan.digest
    )
      fail('WORKSPACE_EXPLICIT_APPROVAL_REQUIRED', 403);
  }

  private async writeExclusive(relative: string, data: Buffer): Promise<void> {
    await this.checkParents(relative, true);
    let handle: FileHandle | undefined;
    try {
      handle = await open(this.absolute(relative), 'wx', 0o600);
      await handle.writeFile(data);
      await handle.sync();
    } catch (error) {
      if (error instanceof AppError) throw error;
      fail(
        errorCode(error) === 'EEXIST' ? 'WORKSPACE_TARGET_COLLISION' : 'WORKSPACE_WRITE_FAILED',
        409,
      );
    } finally {
      await handle?.close();
    }
  }

  private journalPath(plan: WorkspacePlan): string {
    return `${INTERNAL}/journal/${plan.digest}.jsonl`;
  }

  private async journal(plan: WorkspacePlan): Promise<JournalEvent[] | null> {
    const relative = this.journalPath(plan);
    const stat = await lstat(this.absolute(relative)).catch((error) => {
      if (errorCode(error) === 'ENOENT') return null;
      fail('WORKSPACE_JOURNAL_INVALID', 409);
    });
    if (!stat) return null;
    const text = (await this.readDocument(relative)).data.toString('utf8');
    const events: JournalEvent[] = [];
    for (const line of text.trimEnd().split('\n')) {
      let event: JournalEvent;
      try {
        event = JSON.parse(line) as JournalEvent;
      } catch {
        fail('WORKSPACE_JOURNAL_INVALID', 409);
      }
      if (
        Object.keys(event).some((key) => !['sequence', 'event', 'index'].includes(key)) ||
        event.sequence !== events.length ||
        ![
          'begin',
          'written',
          'source_removed',
          'complete',
          'failed',
          'rollback_begin',
          'source_restored',
          'target_removed',
          'rolled_back',
        ].includes(event.event) ||
        (event.index !== undefined &&
          (!Number.isSafeInteger(event.index) ||
            event.index < 0 ||
            event.index >= plan.actions.length))
      )
        fail('WORKSPACE_JOURNAL_INVALID', 409);
      const indexed = ['written', 'source_removed', 'source_restored', 'target_removed'].includes(
        event.event,
      );
      if (indexed !== (event.index !== undefined)) fail('WORKSPACE_JOURNAL_INVALID', 409);
      events.push(event);
      if (events.length > 300) fail('WORKSPACE_JOURNAL_INVALID', 409);
    }
    if (events[0]?.event !== 'begin') fail('WORKSPACE_JOURNAL_INVALID', 409);
    return events;
  }

  private async lock<T>(operation: () => Promise<T>): Promise<T> {
    await this.checkRoot();
    const relative = `${INTERNAL}/operation.lock`;
    await this.checkParents(relative, true);
    let handle: FileHandle;
    try {
      handle = await open(this.absolute(relative), 'wx', 0o600);
    } catch {
      fail('WORKSPACE_LOCKED', 409);
    }
    const identity = await handle.stat();
    try {
      return await operation();
    } finally {
      await handle.close();
      const current = await lstat(this.absolute(relative)).catch(() => null);
      if (
        current?.isFile() &&
        !current.isSymbolicLink() &&
        current.ino === identity.ino &&
        current.dev === identity.dev
      )
        await unlink(this.absolute(relative));
    }
  }

  private async append(
    plan: WorkspacePlan,
    events: JournalEvent[],
    event: Omit<JournalEvent, 'sequence'>,
  ): Promise<void> {
    const row = { sequence: events.length, ...event };
    const relative = this.journalPath(plan);
    await this.checkParents(relative, true);
    const before = await lstat(this.absolute(relative));
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
      fail('WORKSPACE_JOURNAL_INVALID', 409);
    const handle = await open(
      this.absolute(relative),
      constants.O_WRONLY | constants.O_APPEND | (constants.O_NOFOLLOW ?? 0),
    );
    try {
      const stat = await handle.stat();
      if (stat.dev !== before.dev || stat.ino !== before.ino || stat.nlink !== 1)
        fail('WORKSPACE_JOURNAL_INVALID', 409);
      await handle.writeFile(JSON.stringify(row) + '\n');
      await handle.sync();
    } finally {
      await handle.close();
    }
    events.push(row);
  }

  private receipt(plan: WorkspacePlan, events: JournalEvent[], replayed: boolean) {
    const last = events.at(-1)?.event;
    return {
      planDigest: plan.digest,
      state:
        last === 'complete'
          ? 'applied'
          : last === 'rolled_back'
            ? 'rolled_back'
            : 'needs_reconciliation',
      replayed,
      manifest: plan.actions.map((action, index) => ({
        index,
        kind: action.kind,
        target: action.target,
        sha256: action.sha256,
        bytes: action.bytes,
        originalPreserved:
          action.kind !== 'move' ||
          !events.some((event) => event.event === 'source_removed' && event.index === index) ||
          events.some((event) => event.event === 'source_restored' && event.index === index),
        preexisting: action.preexisting,
      })),
    };
  }

  private async verifyTerminal(plan: WorkspacePlan, events: JournalEvent[]): Promise<void> {
    const applied = events.at(-1)?.event === 'complete';
    const rolledBack = events.at(-1)?.event === 'rolled_back';
    if (!applied && !rolledBack) fail('WORKSPACE_RECONCILIATION_REQUIRED', 409);
    const written = new Set(
      events.filter((event) => event.event === 'written').map((event) => event.index!),
    );
    if (applied && written.size !== plan.actions.length) fail('WORKSPACE_JOURNAL_INVALID', 409);
    for (let index = 0; index < plan.actions.length; index++) {
      const action = plan.actions[index]!;
      if (applied || action.preexisting) {
        if (!(await this.targetState(action.target, action.sha256, action.bytes)))
          fail('WORKSPACE_RESULT_CHANGED', 409);
      } else {
        await this.checkParents(action.target);
        const target = await lstat(this.absolute(action.target)).catch((error) => {
          if (errorCode(error) === 'ENOENT') return null;
          fail('WORKSPACE_RESULT_CHANGED', 409);
        });
        if (target) fail('WORKSPACE_RESULT_CHANGED', 409);
      }
      if (action.kind === 'move' && written.has(index)) {
        await this.checkParents(action.source!.relativePath);
        const source = await lstat(this.absolute(action.source!.relativePath)).catch((error) => {
          if (errorCode(error) === 'ENOENT') return null;
          fail('WORKSPACE_SOURCE_CHANGED', 409);
        });
        if (applied) {
          if (source) fail('WORKSPACE_SOURCE_CHANGED', 409);
        } else {
          if (!source) fail('WORKSPACE_SOURCE_CHANGED', 409);
          const restored = await this.readDocument(action.source!.relativePath);
          if (
            restored.snapshot.sha256 !== action.sha256 ||
            restored.snapshot.bytes !== action.bytes
          )
            fail('WORKSPACE_SOURCE_CHANGED', 409);
        }
      }
    }
  }

  async apply(value: unknown, authorization: WorkspaceAuthorization) {
    const plan = this.validatePlan(value);
    this.authorize(plan, authorization, 'apply');
    return this.lock(async () => {
      let events = await this.journal(plan);
      if (events) {
        if (events.at(-1)?.event !== 'complete') fail('WORKSPACE_RECONCILIATION_REQUIRED', 409);
        await this.verifyTerminal(plan, events);
        return this.receipt(plan, events, true);
      }
      const now = this.clock();
      if (
        !Number.isSafeInteger(now) ||
        now < Date.parse(plan.createdAt) ||
        now >= Date.parse(plan.expiresAt)
      )
        fail('WORKSPACE_PLAN_EXPIRED', 409);
      // Complete preflight before any document mutation. The lock is advisory: the operator must exclude other writers.
      for (const action of plan.actions) {
        const exists = await this.targetState(action.target, action.sha256, action.bytes);
        if (exists !== action.preexisting) fail('WORKSPACE_TARGET_CHANGED', 409);
        if (action.source) {
          const current = await this.readDocument(action.source.relativePath);
          if (stable(current.snapshot) !== stable(action.source))
            fail('WORKSPACE_SOURCE_CHANGED', 409);
        }
      }
      events = [{ sequence: 0, event: 'begin' }];
      await this.writeExclusive(
        this.journalPath(plan),
        Buffer.from(JSON.stringify(events[0]) + '\n'),
      );
      try {
        for (let index = 0; index < plan.actions.length; index++) {
          const action = plan.actions[index]!;
          const data = action.source
            ? (await this.readDocument(action.source.relativePath)).data
            : Buffer.from(action.content!);
          if (hash(data) !== action.sha256 || data.length !== action.bytes)
            fail('WORKSPACE_SOURCE_CHANGED', 409);
          if (!action.preexisting) {
            await this.writeExclusive(action.target, data);
            if (!(await this.targetState(action.target, action.sha256, action.bytes)))
              fail('WORKSPACE_WRITE_FAILED', 409);
          }
          await this.append(plan, events, { event: 'written', index });
          if (action.kind === 'move') {
            const current = await this.readDocument(action.source!.relativePath);
            if (stable(current.snapshot) !== stable(action.source))
              fail('WORKSPACE_SOURCE_CHANGED', 409);
            await unlink(this.absolute(action.source!.relativePath));
            await this.append(plan, events, { event: 'source_removed', index });
          }
        }
        await this.append(plan, events, { event: 'complete' });
        await this.verifyTerminal(plan, events);
        return this.receipt(plan, events, false);
      } catch {
        await this.append(plan, events, { event: 'failed' }).catch(() => {});
        fail('WORKSPACE_APPLY_INCOMPLETE', 409);
      }
    });
  }

  async rollback(value: unknown, authorization: WorkspaceAuthorization) {
    const plan = this.validatePlan(value);
    this.authorize(plan, authorization, 'rollback');
    return this.lock(async () => {
      const events = await this.journal(plan);
      if (!events) fail('WORKSPACE_NOT_APPLIED', 409);
      if (events.at(-1)?.event === 'rolled_back') {
        await this.verifyTerminal(plan, events);
        return this.receipt(plan, events, true);
      }
      const written = [
        ...new Set(
          events.filter((event) => event.event === 'written').map((event) => event.index!),
        ),
      ].sort((a, b) => b - a);
      for (let index = 0; index < plan.actions.length; index++) {
        const action = plan.actions[index]!;
        if (action.preexisting || written.includes(index)) continue;
        await this.checkParents(action.target);
        const unjournaled = await lstat(this.absolute(action.target)).catch((error) => {
          if (errorCode(error) === 'ENOENT') return null;
          fail('WORKSPACE_RECONCILIATION_REQUIRED', 409);
        });
        if (unjournaled) fail('WORKSPACE_RECONCILIATION_REQUIRED', 409);
      }
      for (const index of written) {
        const action = plan.actions[index]!;
        const removed = events.some(
          (event) => event.event === 'target_removed' && event.index === index,
        );
        if (!removed && !(await this.targetState(action.target, action.sha256, action.bytes)))
          fail('WORKSPACE_RESULT_CHANGED', 409);
        if (action.kind === 'move') {
          const original = await lstat(this.absolute(action.source!.relativePath)).catch(
            (error) => {
              if (errorCode(error) === 'ENOENT') return null;
              fail('WORKSPACE_SOURCE_CHANGED', 409);
            },
          );
          if (original) {
            const source = await this.readDocument(action.source!.relativePath);
            if (source.snapshot.sha256 !== action.sha256 || source.snapshot.bytes !== action.bytes)
              fail('WORKSPACE_SOURCE_CHANGED', 409);
          } else if (removed) fail('WORKSPACE_RECONCILIATION_REQUIRED', 409);
        }
      }
      await this.append(plan, events, { event: 'rollback_begin' });
      for (const index of written) {
        const action = plan.actions[index]!;
        if (events.some((event) => event.event === 'target_removed' && event.index === index))
          continue;
        if (action.kind === 'move') {
          const sourceExists = await lstat(this.absolute(action.source!.relativePath)).catch(
            (error) => {
              if (errorCode(error) === 'ENOENT') return null;
              fail('WORKSPACE_SOURCE_CHANGED', 409);
            },
          );
          if (!sourceExists)
            await this.writeExclusive(
              action.source!.relativePath,
              (await this.readDocument(action.target)).data,
            );
          await this.append(plan, events, { event: 'source_restored', index });
        }
        if (!action.preexisting) {
          // Refuse to erase changed targets; leave unrelated or pre-existing content untouched.
          if (!(await this.targetState(action.target, action.sha256, action.bytes)))
            fail('WORKSPACE_RESULT_CHANGED', 409);
          await unlink(this.absolute(action.target));
          await this.append(plan, events, { event: 'target_removed', index });
        }
      }
      await this.append(plan, events, { event: 'rolled_back' });
      await this.verifyTerminal(plan, events);
      const directories = [
        ...new Set(
          plan.actions.flatMap((action) => {
            const parts = action.target.split('/');
            parts.pop();
            const result: string[] = [];
            while (parts.length > 2) {
              result.push(parts.join('/'));
              parts.pop();
            }
            return result;
          }),
        ),
      ].sort((a, b) => b.length - a.length);
      for (const directory of directories) await rmdir(this.absolute(directory)).catch(() => {});
      return this.receipt(plan, events, false);
    });
  }

  async status(value: unknown) {
    const plan = this.validatePlan(value);
    const events = await this.journal(plan);
    if (!events)
      return { planDigest: plan.digest, state: 'not_applied', replayed: false, manifest: [] };
    try {
      await this.verifyTerminal(plan, events);
      return { ...this.receipt(plan, events, false), integrity: 'verified' };
    } catch {
      return {
        ...this.receipt(plan, events, false),
        state: 'needs_reconciliation',
        integrity: 'not_verified',
      };
    }
  }

  async prepareFromFile(relative: string) {
    if (path.posix.extname(safeRelative(relative)).toLowerCase() !== '.json')
      fail('WORKSPACE_INPUT_FILE_REJECTED');
    const data = await this.readDocument(relative);
    let input: unknown;
    try {
      input = JSON.parse(data.data.toString('utf8'));
    } catch {
      fail('INVALID_DOCUMENT_WORKSPACE_INPUT');
    }
    return this.prepare(input);
  }

  async savePlan(value: unknown): Promise<string> {
    const plan = this.validatePlan(value);
    const relative = `${INTERNAL}/plans/${plan.digest}.json`;
    const content = Buffer.from(JSON.stringify(plan, null, 2) + '\n');
    if (content.length > MAX_FILE_BYTES) fail('WORKSPACE_PLAN_FILE_LIMIT');
    await this.writeExclusive(relative, content);
    return relative;
  }

  async loadPlan(digest: string): Promise<WorkspacePlan> {
    if (!/^[a-f0-9]{64}$/.test(digest)) fail('INVALID_WORKSPACE_PLAN');
    const value = await this.readDocument(`${INTERNAL}/plans/${digest}.json`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(value.data.toString('utf8'));
    } catch {
      fail('INVALID_WORKSPACE_PLAN');
    }
    const plan = this.validatePlan(parsed);
    if (plan.digest !== digest) fail('WORKSPACE_PLAN_DIGEST_MISMATCH', 409);
    return plan;
  }
}
