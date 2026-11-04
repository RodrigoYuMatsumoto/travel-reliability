import { describe, it, expect } from 'vitest';
import { createCipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import type { EvidenceDocument } from '../schema/src/domain.js';
import { demoTrip } from '../api/src/demo.js';
import { assess } from '../api/src/assessment.js';
import { sha256 } from '../api/src/crypto.js';
import { AppError } from '../api/src/errors.js';
import {
  BUNDLE_SCRYPT_PARAMETERS,
  TRB2_HEADER_BYTES,
  decryptBundle,
  dossier,
  encryptBundle,
  verifyBundleContents,
  type EvidenceBundle,
} from '../api/src/exports.js';
import { OfflineBundleError, openOfflineBundle, verifyOfflineBundle } from '../web/src/offline.js';

const PASSPHRASE = 'synthetic-only-passphrase';

function sampleBundle(): EvidenceBundle {
  const contents = [
    Buffer.from('Booking reference: SYNTHETIC-ONLY\nCancellation: synthetic terms.\n'),
    Buffer.from('%PDF-1.7 synthetic placeholder bytes'),
  ];
  const trip = demoTrip();
  const files = contents.map((data) => ({
    id: randomUUID(),
    sha256: sha256(data),
    base64: data.toString('base64'),
  }));
  const documents: EvidenceDocument[] = files.map((file, index) => ({
    id: file.id,
    tripId: trip.id,
    mediaType: 'text/plain',
    label: `synthetic-${index}`,
    bytes: contents[index]!.length,
    sha256: file.sha256,
    createdAt: '2026-11-04T00:00:00.000Z',
    expiresAt: null,
    fields: [],
    warnings: [],
    status: 'needs_review',
    parserVersion: '1.0.0',
    derivedFrom: null,
  }));
  return {
    format: 'travel-reliability-bundle/1.0.0',
    dossier: dossier(trip, assess(trip), documents, [], 'Synthetic request'),
    files,
  };
}

/** Independent TRB2 writer built from the documented layout; it skips the content checks. */
function sealTrb2(
  plaintext: Buffer,
  passphrase: string,
  options: { authenticateHeader?: boolean } = {},
): Buffer {
  const salt = randomBytes(16),
    nonce = randomBytes(12);
  const header = Buffer.concat([
    Buffer.from('TRB2', 'ascii'),
    Buffer.from([0x01, 17, 8, 1, 0x01, 16, 12, 16]),
    salt,
    nonce,
  ]);
  const key = scryptSync(passphrase.normalize('NFC'), salt, 32, {
    N: 2 ** 17,
    r: 8,
    p: 1,
    maxmem: 256 * 1024 * 1024,
  });
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  if (options.authenticateHeader !== false) cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([header, ciphertext, cipher.getAuthTag()]);
}

/** The pre-TRB2 writer, kept only to produce legacy fixtures. */
function sealTrb1(plaintext: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16),
    nonce = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32, { N: 2 ** 15, maxmem: 64 * 1024 * 1024 });
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('TRB1'));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([Buffer.from('TRB1'), salt, nonce, cipher.getAuthTag(), ciphertext]);
}

function flip(data: Buffer, offset: number): Buffer {
  const copy = Buffer.from(data);
  copy[offset] = copy[offset]! ^ 0x01;
  return copy;
}

function codeOf(work: () => unknown): string {
  try {
    work();
  } catch (error) {
    // decryptBundle must never surface a raw Error.
    expect(error).toBeInstanceOf(AppError);
    return (error as AppError).code;
  }
  throw new Error('expected a failure');
}

async function webCodeOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    expect(error).toBeInstanceOf(OfflineBundleError);
    return (error as OfflineBundleError).code;
  }
  throw new Error('expected a failure');
}

// Encrypted once and reused: each scrypt derivation at N=2^17 costs a fraction of a second.
const bundle = sampleBundle();
const sealed = await encryptBundle(bundle, PASSPHRASE);

describe('TRB2 container (A2-01)', () => {
  it('writes the documented header with the OWASP scrypt parameters', () => {
    expect(BUNDLE_SCRYPT_PARAMETERS).toEqual({ N: 2 ** 17, r: 8, p: 1 });
    expect(sealed.subarray(0, 4).toString('ascii')).toBe('TRB2');
    expect([...sealed.subarray(4, 12)]).toEqual([0x01, 17, 8, 1, 0x01, 16, 12, 16]);
    expect(sealed.length).toBe(TRB2_HEADER_BYTES + Buffer.byteLength(JSON.stringify(bundle)) + 16);
    const opened = decryptBundle(sealed, PASSPHRASE);
    expect(opened.files).toHaveLength(2);
    expect(opened.dossier.request).toBe('Synthetic request');
  });

  it('normalizes the passphrase to NFC so composed and decomposed input agree', async () => {
    const composed = 'senha-sintética-ção',
      decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    const accented = await encryptBundle(bundle, decomposed);
    expect(decryptBundle(accented, composed).files).toHaveLength(2);
  });

  it('still opens legacy TRB1 bundles read-only', () => {
    const legacy = sealTrb1(Buffer.from(JSON.stringify(bundle)), PASSPHRASE);
    expect(decryptBundle(legacy, PASSPHRASE).files.map((file) => file.id)).toEqual(
      bundle.files.map((file) => file.id),
    );
    expect(codeOf(() => decryptBundle(legacy, 'different-passphrase'))).toBe(
      'BUNDLE_AUTHENTICATION_FAILED',
    );
  });

  it.each([
    ['N below 2^17', 5, 16],
    ['N above 2^20', 5, 21],
    ['r below 8', 6, 7],
    ['r above 16', 6, 17],
    ['p below 1', 7, 0],
    ['p above 4', 7, 5],
  ])('rejects %s before deriving any key', (_label, offset, value) => {
    const altered = Buffer.from(sealed);
    altered[offset] = value;
    expect(codeOf(() => decryptBundle(altered, PASSPHRASE))).toBe('BUNDLE_KDF_PARAMETERS_REJECTED');
  });

  it('rejects a header whose combined memory cost exceeds 1 GiB', () => {
    const altered = Buffer.from(sealed);
    altered[5] = 20;
    altered[6] = 16;
    expect(codeOf(() => decryptBundle(altered, PASSPHRASE))).toBe('BUNDLE_KDF_PARAMETERS_REJECTED');
  });

  it.each([
    ['an unknown magic', 0, 0x58],
    ['an unknown KDF identifier', 4, 0x02],
    ['an unknown AEAD identifier', 8, 0x02],
    ['a different salt length', 9, 32],
    ['a different nonce length', 10, 16],
    ['a different tag length', 11, 12],
  ])('rejects %s as an invalid bundle', (_label, offset, value) => {
    const altered = Buffer.from(sealed);
    altered[offset] = value;
    expect(codeOf(() => decryptBundle(altered, PASSPHRASE))).toBe('INVALID_BUNDLE');
  });

  it('rejects truncated and empty input with a stable code', () => {
    expect(codeOf(() => decryptBundle(sealed.subarray(0, 55), PASSPHRASE))).toBe('INVALID_BUNDLE');
    expect(codeOf(() => decryptBundle(Buffer.alloc(0), PASSPHRASE))).toBe('INVALID_BUNDLE');
  });
});

describe('real tampering of a bundle with files (A2-06)', () => {
  it('maps a wrong passphrase to an AppError instead of a raw Error', () => {
    expect(codeOf(() => decryptBundle(sealed, 'different-passphrase'))).toBe(
      'BUNDLE_AUTHENTICATION_FAILED',
    );
  });

  it('rejects one flipped ciphertext byte', () => {
    expect(bundle.files.length).toBeGreaterThan(0);
    expect(codeOf(() => decryptBundle(flip(sealed, TRB2_HEADER_BYTES + 3), PASSPHRASE))).toBe(
      'BUNDLE_AUTHENTICATION_FAILED',
    );
  });

  it('rejects one flipped byte inside an embedded file', () => {
    // GCM is a stream mode: plaintext offset k sits at ciphertext offset 40 + k.
    const offset = JSON.stringify(bundle).indexOf(bundle.files[1]!.base64);
    expect(offset).toBeGreaterThan(0);
    expect(
      codeOf(() => decryptBundle(flip(sealed, TRB2_HEADER_BYTES + offset + 2), PASSPHRASE)),
    ).toBe('BUNDLE_AUTHENTICATION_FAILED');
  });

  it('rejects one flipped tag byte', () => {
    expect(codeOf(() => decryptBundle(flip(sealed, sealed.length - 1), PASSPHRASE))).toBe(
      'BUNDLE_AUTHENTICATION_FAILED',
    );
  });

  it('rejects one flipped header byte in the salt and in a KDF parameter still in range', () => {
    expect(codeOf(() => decryptBundle(flip(sealed, 12), PASSPHRASE))).toBe(
      'BUNDLE_AUTHENTICATION_FAILED',
    );
    const r9 = Buffer.from(sealed);
    r9[6] = 9;
    expect(codeOf(() => decryptBundle(r9, PASSPHRASE))).toBe('BUNDLE_AUTHENTICATION_FAILED');
  });

  it('requires the header to be authenticated as additional data', () => {
    const unbound = sealTrb2(Buffer.from(JSON.stringify(bundle)), PASSPHRASE, {
      authenticateHeader: false,
    });
    expect(codeOf(() => decryptBundle(unbound, PASSPHRASE))).toBe('BUNDLE_AUTHENTICATION_FAILED');
  });

  it('reaches BUNDLE_HASH_MISMATCH when an embedded file changes under a valid seal', () => {
    const tampered = structuredClone(bundle);
    const data = Buffer.from(tampered.files[0]!.base64, 'base64');
    data[0] = data[0]! ^ 0x01;
    tampered.files[0]!.base64 = data.toString('base64');
    const resealed = sealTrb2(Buffer.from(JSON.stringify(tampered)), PASSPHRASE);
    expect(codeOf(() => decryptBundle(resealed, PASSPHRASE))).toBe('BUNDLE_HASH_MISMATCH');
  });

  it('rejects an authenticated payload that is not a bundle', () => {
    expect(
      codeOf(() => decryptBundle(sealTrb2(Buffer.from('not json'), PASSPHRASE), PASSPHRASE)),
    ).toBe('INVALID_BUNDLE');
  });
});

describe('manifest and files correspond one to one (A2-03)', () => {
  const variants: Array<[string, (value: EvidenceBundle) => void]> = [
    ['declared evidence without a file', (value) => void value.files.pop()],
    [
      'a file the dossier does not declare',
      (value) => {
        const data = Buffer.from('undeclared synthetic file');
        value.files.push({
          id: randomUUID(),
          sha256: sha256(data),
          base64: data.toString('base64'),
        });
      },
    ],
    [
      'a file whose hash differs from the declared one',
      (value) => {
        const data = Buffer.from('replacement synthetic file');
        value.files[0] = {
          ...value.files[0]!,
          sha256: sha256(data),
          base64: data.toString('base64'),
        };
      },
    ],
    ['a duplicated file', (value) => void value.files.push({ ...value.files[0]! })],
    [
      'duplicated evidence',
      (value) => {
        value.dossier.evidence.push({ ...value.dossier.evidence[0]! });
        value.files.push({ ...value.files[0]! });
      },
    ],
  ];

  it.each(variants)('the writer refuses %s', async (_label, mutate) => {
    const value = structuredClone(bundle);
    mutate(value);
    await expect(encryptBundle(value, PASSPHRASE)).rejects.toMatchObject({
      code: 'BUNDLE_MANIFEST_MISMATCH',
    });
    expect(codeOf(() => verifyBundleContents(value))).toBe('BUNDLE_MANIFEST_MISMATCH');
  });

  it.each(variants)('the browser verifier refuses %s', async (_label, mutate) => {
    const value = structuredClone(bundle);
    mutate(value);
    expect(await webCodeOf(verifyOfflineBundle(value))).toBe('BUNDLE_MANIFEST_MISMATCH');
  });

  it('the server reader refuses missing and undeclared files under a valid seal', () => {
    for (const [, mutate] of variants.slice(0, 2)) {
      const value = structuredClone(bundle);
      mutate(value);
      const resealed = sealTrb2(Buffer.from(JSON.stringify(value)), PASSPHRASE);
      expect(codeOf(() => decryptBundle(resealed, PASSPHRASE))).toBe('BUNDLE_MANIFEST_MISMATCH');
    }
  });

  it('the browser verifier reaches its hash check', async () => {
    const value = structuredClone(bundle);
    const data = Buffer.from(value.files[1]!.base64, 'base64');
    data[data.length - 1] = data[data.length - 1]! ^ 0x01;
    value.files[1]!.base64 = data.toString('base64');
    expect(await webCodeOf(verifyOfflineBundle(value))).toBe('BUNDLE_HASH_MISMATCH');
  });
});

describe('browser reader stays coherent with the server (web/src/offline.tsx)', () => {
  it('opens a TRB2 bundle written by the server', async () => {
    const opened = await openOfflineBundle(new Uint8Array(sealed), PASSPHRASE);
    expect(opened.files.map((file) => file.id)).toEqual(bundle.files.map((file) => file.id));
  });

  it('opens a legacy TRB1 bundle', async () => {
    const legacy = sealTrb1(Buffer.from(JSON.stringify(bundle)), PASSPHRASE);
    expect((await openOfflineBundle(new Uint8Array(legacy), PASSPHRASE)).files).toHaveLength(2);
  });

  it('rejects flipped ciphertext and header bytes with the server codes', async () => {
    const offset = JSON.stringify(bundle).indexOf(bundle.files[0]!.base64);
    expect(
      await webCodeOf(
        openOfflineBundle(new Uint8Array(flip(sealed, TRB2_HEADER_BYTES + offset)), PASSPHRASE),
      ),
    ).toBe('BUNDLE_AUTHENTICATION_FAILED');
    expect(await webCodeOf(openOfflineBundle(new Uint8Array(flip(sealed, 30)), PASSPHRASE))).toBe(
      'BUNDLE_AUTHENTICATION_FAILED',
    );
  });

  it('applies the same scrypt floor and ceiling', async () => {
    for (const [offset, value] of [
      [5, 16],
      [5, 21],
      [6, 17],
      [7, 5],
    ] as const) {
      const altered = new Uint8Array(sealed);
      altered[offset] = value;
      expect(await webCodeOf(openOfflineBundle(altered, PASSPHRASE))).toBe(
        'BUNDLE_KDF_PARAMETERS_REJECTED',
      );
    }
    const unknown = new Uint8Array(sealed);
    unknown[4] = 0x02;
    expect(await webCodeOf(openOfflineBundle(unknown, PASSPHRASE))).toBe('INVALID_BUNDLE');
  });
});
