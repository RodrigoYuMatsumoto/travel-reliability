import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { parseDocument } from 'yaml';
import { AppError } from '../api/src/errors.js';
import { DocumentWorkspace } from './document-workspace.js';
import { TravelConnectorRegistry } from './connectors.js';
import { createGmailReadAdapter } from './gmail-adapter.js';
import { createLocalEmailNormalizer } from './email-normalizer.js';
import type { TravelServerOptions } from './mcp.js';

const MAX_PROFILE_BYTES = 65536;
const tripKey = { type: 'string', pattern: '^[A-Za-z0-9_-]{1,40}$' };
const recordKey = { type: 'string', pattern: '^[A-Z][A-Z0-9_-]{1,39}$' };
export const operatorProfileSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['version'],
  properties: {
    version: { const: 1 },
    workspaceRoot: { type: 'string', minLength: 1, maxLength: 2048 },
    exposeWorkspaceNames: { type: 'boolean' },
    gmail: {
      type: 'object',
      additionalProperties: false,
      required: ['approvedScopes', 'bindings'],
      properties: {
        maxReads: { type: 'integer', minimum: 0, maximum: 100 },
        timeoutMs: { type: 'integer', minimum: 1, maximum: 30000 },
        approvedScopes: {
          type: 'array',
          minItems: 1,
          maxItems: 80,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['tripKey', 'recordKeys'],
            properties: {
              tripKey,
              recordKeys: {
                type: 'array',
                minItems: 1,
                maxItems: 20,
                uniqueItems: true,
                items: recordKey,
              },
            },
          },
        },
        bindings: {
          type: 'array',
          minItems: 1,
          maxItems: 80,
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['tripKey', 'recordKey', 'messageId', 'sourceRef', 'providerKey'],
            properties: {
              tripKey,
              recordKey,
              messageId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
              sourceRef: { type: 'string', pattern: '^SRC[0-9]{2,6}$' },
              providerKey: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,39}$' },
            },
          },
        },
      },
    },
  },
} as const;

export interface OperatorProfile {
  version: 1;
  workspaceRoot?: string;
  exposeWorkspaceNames?: boolean;
  gmail?: {
    maxReads?: number;
    timeoutMs?: number;
    approvedScopes: Array<{ tripKey: string; recordKeys: string[] }>;
    bindings: Array<{
      tripKey: string;
      recordKey: string;
      messageId: string;
      sourceRef: string;
      providerKey: string;
    }>;
  };
}

const validate = new Ajv2020({ strict: true, allErrors: false, ownProperties: true }).compile(
  operatorProfileSchema,
);
function reject(code: string): never {
  throw new AppError(code, 422);
}

function assertJson(input: unknown): void {
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 3000 || depth > 8) reject('OPERATOR_PROFILE_LIMIT');
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      if (value.length > 2048) reject('OPERATOR_PROFILE_LIMIT');
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) reject('OPERATOR_PROFILE_INVALID');
      continue;
    }
    if (!value || typeof value !== 'object') reject('OPERATOR_PROFILE_INVALID');
    const prototype = Object.getPrototypeOf(value);
    if (
      Array.isArray(value)
        ? prototype !== Array.prototype
        : prototype !== Object.prototype && prototype !== null
    )
      reject('OPERATOR_PROFILE_INVALID');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 100) reject('OPERATOR_PROFILE_LIMIT');
    if (Array.isArray(value) && keys.length !== value.length + 1)
      reject('OPERATOR_PROFILE_INVALID');
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key))
        reject('OPERATOR_PROFILE_INVALID');
      const descriptor = descriptors[key]!;
      if (!('value' in descriptor) || !descriptor.enumerable) reject('OPERATOR_PROFILE_INVALID');
      stack.push({ value: descriptor.value, depth: depth + 1 });
    }
  }
}

function absoluteLocal(value: string): string {
  if (
    !path.isAbsolute(value) ||
    /^[\\/]{2}/.test(value) ||
    /[\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/u.test(value) ||
    (process.platform === 'win32' &&
      (!/^[A-Za-z]:[\\/]/.test(value) || value.slice(2).includes(':')))
  )
    reject('OPERATOR_PROFILE_PATH_REJECTED');
  return path.resolve(value);
}

/** Pure validation: this object grants no permission unless loaded by operator code. */
export function validateOperatorProfile(input: unknown): OperatorProfile {
  assertJson(input);
  if (!validate(input)) reject('OPERATOR_PROFILE_INVALID');
  const profile = structuredClone(input) as OperatorProfile;
  if (profile.workspaceRoot) absoluteLocal(profile.workspaceRoot);
  if (profile.exposeWorkspaceNames && !profile.workspaceRoot)
    reject('OPERATOR_WORKSPACE_DISCLOSURE_REQUIRES_WORKSPACE');
  if (profile.gmail) {
    const gmail = profile.gmail;
    const scopes = new Map<string, Set<string>>();
    for (const scope of gmail.approvedScopes) {
      if (scopes.has(scope.tripKey)) reject('OPERATOR_PROFILE_SCOPE_MISMATCH');
      scopes.set(scope.tripKey, new Set(scope.recordKeys));
    }
    if (
      new Set(gmail.bindings.map((row) => row.sourceRef)).size !== gmail.bindings.length ||
      new Set(gmail.bindings.map((row) => row.messageId)).size !== gmail.bindings.length
    )
      reject('OPERATOR_PROFILE_DUPLICATE_BINDING');
    const bound = new Map<string, Set<string>>();
    const counts = new Map<string, number>();
    for (const binding of gmail.bindings) {
      if (!scopes.get(binding.tripKey)?.has(binding.recordKey))
        reject('OPERATOR_PROFILE_SCOPE_MISMATCH');
      counts.set(binding.tripKey, (counts.get(binding.tripKey) ?? 0) + 1);
      if (counts.get(binding.tripKey)! > 20) reject('OPERATOR_PROFILE_LIMIT');
      if (!bound.has(binding.tripKey)) bound.set(binding.tripKey, new Set());
      bound.get(binding.tripKey)!.add(binding.recordKey);
    }
    for (const [trip, keys] of scopes) {
      if (!bound.has(trip) || [...keys].some((key) => !bound.get(trip)!.has(key)))
        reject('OPERATOR_PROFILE_SCOPE_MISMATCH');
    }
  }
  return profile;
}

/** Explicit operator file only; never call with a path taken from imported evidence. */
export async function readOperatorProfileFile(configPath: string): Promise<OperatorProfile> {
  const resolved = absoluteLocal(configPath);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    let ancestor = path.dirname(resolved);
    for (;;) {
      const directory = await lstat(ancestor);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        reject('OPERATOR_PROFILE_FILE_REJECTED');
      const parent = path.dirname(ancestor);
      if (parent === ancestor) break;
      ancestor = parent;
    }
    const before = await lstat(resolved);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
      reject('OPERATOR_PROFILE_FILE_REJECTED');
    if (before.size < 1 || before.size > MAX_PROFILE_BYTES) reject('OPERATOR_PROFILE_LIMIT');
    const canonical = await realpath(resolved);
    if (path.relative(resolved, canonical) !== '') reject('OPERATOR_PROFILE_FILE_REJECTED');
    handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.nlink !== 1 ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size !== before.size
    )
      reject('OPERATOR_PROFILE_FILE_REJECTED');
    const data = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < data.length) {
      const chunk = await handle.read(data, size, data.length - size, size);
      if (!chunk.bytesRead) break;
      size += chunk.bytesRead;
    }
    const after = await handle.stat();
    const current = await lstat(resolved);
    if (
      size !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.nlink !== 1 ||
      !current.isFile() ||
      current.nlink !== 1 ||
      current.size !== before.size ||
      current.mtimeMs !== before.mtimeMs ||
      current.dev !== before.dev ||
      current.ino !== before.ino ||
      current.isSymbolicLink() ||
      path.relative(canonical, await realpath(resolved)) !== ''
    )
      reject('OPERATOR_PROFILE_FILE_REJECTED');
    let text: string;
    let parsed: unknown;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, size));
    } catch {
      reject('OPERATOR_PROFILE_ENCODING_REJECTED');
    }
    try {
      parsed = JSON.parse(text);
    } catch {
      reject('OPERATOR_PROFILE_JSON_REJECTED');
    }
    assertJson(parsed);
    // JSON.parse is the syntax gate; the JSON-mode parser additionally rejects duplicate keys.
    if (parseDocument(text, { schema: 'json', uniqueKeys: true }).errors.length)
      reject('OPERATOR_PROFILE_JSON_REJECTED');
    const profile = validateOperatorProfile(parsed);
    if (profile.workspaceRoot) {
      const within = path.relative(absoluteLocal(profile.workspaceRoot), canonical);
      if (
        within === '' ||
        (!within.startsWith('..' + path.sep) && within !== '..' && !path.isAbsolute(within))
      )
        reject('OPERATOR_PROFILE_IN_WORKSPACE');
    }
    return profile;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('OPERATOR_PROFILE_UNAVAILABLE', 422);
  } finally {
    await handle?.close();
  }
}

function referenceKey(env: NodeJS.ProcessEnv): Uint8Array {
  const value = env.TRAVEL_REFERENCE_KEY_BASE64;
  if (
    !value ||
    value.length > 172 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    reject('OPERATOR_REFERENCE_KEY_UNAVAILABLE');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.byteLength < 32 || bytes.byteLength > 128 || bytes.toString('base64') !== value)
    reject('OPERATOR_REFERENCE_KEY_UNAVAILABLE');
  return bytes;
}

/** Trusted process environment only. No credential, interpreter or module is accepted in JSON. */
export async function createOperatorServerOptions(
  input: unknown,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TravelServerOptions> {
  const profile = validateOperatorProfile(input);
  let connectors: TravelConnectorRegistry | undefined;
  if (profile.gmail) {
    const token = env.TRAVEL_GMAIL_ACCESS_TOKEN;
    if (!token || !/^[A-Za-z0-9._~+\/-]{10,4096}={0,4}$/.test(token))
      reject('OPERATOR_GMAIL_TOKEN_UNAVAILABLE');
    const key = referenceKey(env);
    const normalizers = new Map<string, ReturnType<typeof createLocalEmailNormalizer>>();
    const sourceBindings = new Map(
      profile.gmail.bindings.map((binding) => [binding.sourceRef, binding]),
    );
    try {
      for (const binding of profile.gmail.bindings) {
        if (!normalizers.has(binding.providerKey))
          normalizers.set(
            binding.providerKey,
            createLocalEmailNormalizer({
              providerKey: binding.providerKey,
              referenceSecret: key,
              timeoutMs: profile.gmail.timeoutMs,
            }),
          );
      }
    } finally {
      key.fill(0);
    }
    const adapter = createGmailReadAdapter({
      bindings: profile.gmail.bindings,
      accessToken: async () => token,
      normalizeRawEmail: async (bytes, context) => {
        const binding = sourceBindings.get(context.sourceRef);
        if (!binding || binding.recordKey !== context.recordKey)
          reject('OPERATOR_PROFILE_SCOPE_MISMATCH');
        return normalizers.get(binding.providerKey)!(bytes, context);
      },
    });
    connectors = new TravelConnectorRegistry([adapter], {
      approvedScopes: profile.gmail.approvedScopes.map((scope) => ({
        ...scope,
        sourceId: 'gmail',
      })),
      maxReads: profile.gmail.maxReads,
      timeoutMs: profile.gmail.timeoutMs,
    });
  }
  const workspace = profile.workspaceRoot
    ? await DocumentWorkspace.open(profile.workspaceRoot)
    : undefined;
  return {
    ...(connectors ? { connectors } : {}),
    ...(workspace ? { workspace } : {}),
    exposeWorkspaceNames: profile.exposeWorkspaceNames === true,
  };
}

export async function loadOperatorProfile(
  configPath: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TravelServerOptions> {
  return createOperatorServerOptions(await readOperatorProfileFile(configPath), env);
}
