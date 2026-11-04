import { useState } from 'react';
import { scryptAsync } from '@noble/hashes/scrypt.js';
export interface OfflineBundle {
  format: string;
  dossier: {
    trip: { title: string };
    request: string;
    timeline: unknown[];
    evidence: Array<{ id: string; sha256: string }>;
  };
  files: Array<{ id: string; sha256: string; base64: string }>;
}

/*
 * Browser reader for the offline bundle. It mirrors api/src/exports.ts: the TRB2 layout (40-byte
 * header used as AES-GCM additional data, then ciphertext and 16-byte tag), the scrypt floor and
 * ceiling, legacy TRB1 support and the stable error codes. tests/phase1-bundle-crypto.test.ts
 * runs both readers against the same bundles.
 */
const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const TRB2_HEADER_BYTES = 40,
  TAG_BYTES = 16;
const SCRYPT_LIMITS = {
  minLog2N: 17,
  maxLog2N: 20,
  minR: 8,
  maxR: 16,
  minP: 1,
  maxP: 4,
  maxMemoryBytes: 2 ** 30,
};
const LEGACY_TRB1_SCRYPT = { N: 2 ** 15, r: 8, p: 1 };
const SHA256_HEX = /^[a-f0-9]{64}$/,
  EVIDENCE_ID = /^[a-f0-9-]{36}$/i;

export class OfflineBundleError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = 'OfflineBundleError';
  }
}
function fail(code: string): never {
  throw new OfflineBundleError(code);
}

interface Container {
  params: { N: number; r: number; p: number };
  salt: Uint8Array<ArrayBuffer>;
  nonce: Uint8Array<ArrayBuffer>;
  aad: Uint8Array<ArrayBuffer>;
  /** Ciphertext followed by the GCM tag, the layout WebCrypto expects. */
  sealed: Uint8Array<ArrayBuffer>;
  normalizePassphrase: boolean;
}

function parseContainer(bytes: Uint8Array): Container {
  if (bytes.length < 4) fail('INVALID_BUNDLE');
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  if (magic === 'TRB1') {
    if (bytes.length < 48) fail('INVALID_BUNDLE');
    // TRB1 stores the tag before the ciphertext; WebCrypto wants it appended.
    const sealed = new Uint8Array(bytes.length - 32);
    sealed.set(bytes.subarray(48));
    sealed.set(bytes.subarray(32, 48), bytes.length - 48);
    return {
      params: LEGACY_TRB1_SCRYPT,
      salt: bytes.slice(4, 20),
      nonce: bytes.slice(20, 32),
      aad: new TextEncoder().encode('TRB1'),
      sealed,
      normalizePassphrase: false,
    };
  }
  if (
    magic !== 'TRB2' ||
    bytes.length < TRB2_HEADER_BYTES + TAG_BYTES ||
    bytes[4] !== 0x01 ||
    bytes[8] !== 0x01 ||
    bytes[9] !== 16 ||
    bytes[10] !== 12 ||
    bytes[11] !== TAG_BYTES
  )
    fail('INVALID_BUNDLE');
  const log2N = bytes[5]!,
    r = bytes[6]!,
    p = bytes[7]!;
  if (
    log2N < SCRYPT_LIMITS.minLog2N ||
    log2N > SCRYPT_LIMITS.maxLog2N ||
    r < SCRYPT_LIMITS.minR ||
    r > SCRYPT_LIMITS.maxR ||
    p < SCRYPT_LIMITS.minP ||
    p > SCRYPT_LIMITS.maxP ||
    128 * r * 2 ** log2N > SCRYPT_LIMITS.maxMemoryBytes
  )
    fail('BUNDLE_KDF_PARAMETERS_REJECTED');
  return {
    params: { N: 2 ** log2N, r, p },
    salt: bytes.slice(12, 28),
    nonce: bytes.slice(28, TRB2_HEADER_BYTES),
    aad: bytes.slice(0, TRB2_HEADER_BYTES),
    sealed: bytes.slice(TRB2_HEADER_BYTES),
    normalizePassphrase: true,
  };
}

async function decryptPayload(container: Container, passphrase: string): Promise<ArrayBuffer> {
  const { N, r, p } = container.params;
  let key: Uint8Array;
  try {
    key = await scryptAsync(
      new TextEncoder().encode(
        container.normalizePassphrase ? passphrase.normalize('NFC') : passphrase,
      ),
      container.salt,
      // Same memory budget formula as the server (OpenSSL working set plus 1 MiB).
      { N, r, p, dkLen: 32, maxmem: 128 * r * (N + p + 2) + 1024 * 1024 },
    );
  } catch {
    return fail('BUNDLE_KDF_FAILED');
  }
  const raw = new Uint8Array(key);
  try {
    const imported = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    return await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: container.nonce, additionalData: container.aad, tagLength: 128 },
      imported,
      container.sealed,
    );
  } catch {
    // Wrong passphrase, altered header, ciphertext or tag: indistinguishable by design.
    return fail('BUNDLE_AUTHENTICATION_FAILED');
  } finally {
    key.fill(0);
    raw.fill(0);
  }
}

function parseJson(plain: ArrayBuffer): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  } catch {
    return fail('INVALID_BUNDLE');
  }
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
  } catch {
    return fail('INVALID_BUNDLE');
  }
}

/**
 * Requires a one-to-one match between dossier.evidence (id and SHA-256) and files[], then checks
 * every file against its hash. Throws OfflineBundleError with BUNDLE_MANIFEST_MISMATCH or
 * BUNDLE_HASH_MISMATCH, like the server verifier.
 */
export async function verifyOfflineBundle(value: unknown): Promise<OfflineBundle> {
  const result = value as Partial<OfflineBundle> | null;
  if (
    !result ||
    typeof result !== 'object' ||
    result.format !== 'travel-reliability-bundle/1.0.0' ||
    !Array.isArray(result.files) ||
    typeof result.dossier?.trip?.title !== 'string' ||
    !Array.isArray(result.dossier.evidence)
  )
    fail('INVALID_BUNDLE');
  const bundle = result as OfflineBundle;
  const declared = new Map<string, string>();
  for (const evidence of bundle.dossier.evidence as unknown[]) {
    const item = evidence as { id?: unknown; sha256?: unknown } | null;
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      typeof item.sha256 !== 'string' ||
      !SHA256_HEX.test(item.sha256)
    )
      fail('INVALID_BUNDLE');
    if (declared.has(item.id)) fail('BUNDLE_MANIFEST_MISMATCH');
    declared.set(item.id, item.sha256);
  }
  const present = new Set<string>();
  for (const file of bundle.files as unknown[]) {
    const item = file as { id?: unknown; sha256?: unknown; base64?: unknown } | null;
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.id !== 'string' ||
      !EVIDENCE_ID.test(item.id) ||
      typeof item.sha256 !== 'string' ||
      typeof item.base64 !== 'string'
    )
      fail('INVALID_BUNDLE');
    // A file must be declared once, with the same hash the dossier states.
    if (present.has(item.id) || declared.get(item.id) !== item.sha256)
      fail('BUNDLE_MANIFEST_MISMATCH');
    present.add(item.id);
  }
  // Every declared piece of evidence must be present.
  if (present.size !== declared.size) fail('BUNDLE_MANIFEST_MISMATCH');
  for (const file of bundle.files) {
    const digest = await crypto.subtle.digest('SHA-256', decodeBase64(file.base64));
    const hash = [...new Uint8Array(digest)]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== file.sha256) fail('BUNDLE_HASH_MISMATCH');
  }
  return bundle;
}

/** Opens a TRB2 (or legacy TRB1) bundle locally and verifies its manifest and files. */
export async function openOfflineBundle(
  bytes: Uint8Array,
  passphrase: string,
): Promise<OfflineBundle> {
  if (bytes.length > MAX_BUNDLE_BYTES) fail('BUNDLE_SIZE_LIMIT');
  const container = parseContainer(bytes);
  return verifyOfflineBundle(parseJson(await decryptPayload(container, passphrase)));
}

export function OfflineViewer() {
  const [file, setFile] = useState<File | null>(null),
    [passphrase, setPassphrase] = useState(''),
    [bundle, setBundle] = useState<OfflineBundle | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const unlock = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    setBundle(null);
    try {
      // Checked before reading so an oversized file is never loaded into memory.
      if (file.size > MAX_BUNDLE_BYTES) fail('BUNDLE_SIZE_LIMIT');
      const result = await openOfflineBundle(new Uint8Array(await file.arrayBuffer()), passphrase);
      setBundle(result);
      setPassphrase('');
    } catch (caught) {
      const code = caught instanceof OfflineBundleError ? caught.code : 'INVALID_BUNDLE';
      setError(
        `Senha incorreta, pacote inválido ou integridade comprometida. / Wrong passphrase, invalid bundle or compromised integrity. (${code})`,
      );
    } finally {
      setBusy(false);
    }
  };
  const download = (value: string, name: string) => {
    const blob = new Blob([value], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  return (
    <main className="welcome">
      <a className="brand" href="/">
        <img src="/icon.svg" alt="" />
        <strong>Travel Reliability</strong>
      </a>
      <section className="panel">
        <h1>Offline evidence</h1>
        <p>
          Verificação local. Nenhum pacote ou senha é enviado ao servidor.
          <br />
          Local verification. No bundle or passphrase is sent to a server.
        </p>
        <label className="field">
          <span>Pacote / Bundle (.trb)</span>
          <input
            type="file"
            accept=".trb"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setBundle(null);
            }}
          />
        </label>
        <label className="field">
          <span>Senha / Passphrase</span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button
          className="primary"
          disabled={!file || !passphrase || busy}
          onClick={() => void unlock()}
        >
          {busy ? 'Verificando / Verifying…' : 'Abrir e verificar / Open and verify'}
        </button>
        {error && <p role="alert">{error}</p>}
        {bundle && (
          <div role="status">
            <h2>{bundle.dossier.trip.title}</h2>
            <p>{bundle.files.length} arquivo(s) verificado(s) / verified file(s)</p>
            <p>
              Hashes não provam autenticidade ou data externa. / Hashes do not prove authenticity or
              trusted time.
            </p>
            <button
              className="secondary"
              onClick={() => download(JSON.stringify(bundle.dossier, null, 2), 'dossier.json')}
            >
              Dossiê JSON / JSON dossier
            </button>
            <pre className="json-preview">{JSON.stringify(bundle.dossier, null, 2)}</pre>
            <button
              className="danger"
              onClick={() => {
                setBundle(null);
                setPassphrase('');
                setFile(null);
              }}
            >
              Bloquear / Lock
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
