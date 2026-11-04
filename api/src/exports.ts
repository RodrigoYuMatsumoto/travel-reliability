import PDFDocument from 'pdfkit';
import { randomBytes, scrypt, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import type { TripContract } from '../../schema/src/trip-contract.js';
import type { Assessment, EvidenceDocument, DisruptionEvent } from '../../schema/src/domain.js';
import { instant } from './validation.js';
import { sha256 } from './crypto.js';
import { addMinor } from './money.js';
import { AppError, requireCondition } from './errors.js';
import { preparePdfFont, type PdfFontOptions } from './pdf-font.js';

const escapeIcal = (text: string) =>
  text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
function fold(line: string): string {
  const lines: string[] = [];
  let part = '';
  for (const char of line) {
    if (Buffer.byteLength(part + char) > 73) {
      lines.push(part);
      part = ' ';
    }
    part += char;
  }
  lines.push(part);
  return lines.join('\r\n');
}
export function calendar(trip: TripContract, options: { includePrivate?: boolean } = {}): string {
  const stamp = (ms: number) =>
    new Date(ms)
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Travel Reliability//Trip Contract 1.0//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const s of trip.services.filter((s) => s.reservation.state !== 'cancelled')) {
    const start = instant(s.start),
      end = instant(s.end);
    requireCondition(start !== null && end !== null, 'CALENDAR_NEEDS_TIMEZONE', 422);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${sha256(trip.id + '/' + s.id)}@travel-reliability.invalid`,
      'DTSTAMP:' + stamp(Date.now()),
      'DTSTART:' + stamp(start),
      'DTEND:' + stamp(end),
      'SUMMARY:' + escapeIcal(options.includePrivate ? s.title : `Travel / ${s.kind}`),
      'LOCATION:' + escapeIcal(options.includePrivate ? (s.location ?? '') : ''),
      'DESCRIPTION:' +
        escapeIcal(
          options.includePrivate
            ? `${s.provider.name}\n${s.reservation.reference ?? 'Reference unknown'}\n${s.cancellation.summary ?? 'Cancellation terms unknown'}`
            : 'Minimal calendar. Booking references, addresses and private notes omitted.',
        ),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
export function dossier(
  trip: TripContract,
  assessment: Assessment,
  documents: EvidenceDocument[],
  events: DisruptionEvent[],
  requestText = '',
) {
  const timeline = events
    .map((event) => ({ ...event, classification: 'traveler_report' }))
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt));
  const amounts: Record<string, { requestedMinor: number; receivedMinor: number }> = {};
  for (const event of events)
    if (
      event.currency &&
      event.amountMinor !== null &&
      ['refund_requested', 'refund_received'].includes(event.kind)
    ) {
      const item = (amounts[event.currency] ??= { requestedMinor: 0, receivedMinor: 0 });
      if (event.kind === 'refund_requested')
        item.requestedMinor = addMinor(item.requestedMinor, event.amountMinor);
      else item.receivedMinor = addMinor(item.receivedMinor, event.amountMinor);
    }
  return {
    format: 'travel-reliability-dossier/1.0.0',
    generatedAt: new Date().toISOString(),
    trip,
    assessment,
    timeline,
    refundLedger: amounts,
    request: requestText,
    evidence: documents.map(({ id, label, mediaType, bytes, sha256: hash, createdAt, status }) => ({
      id,
      label,
      mediaType,
      bytes,
      sha256: hash,
      capturedByApplicationAt: createdAt,
      status,
    })),
    limitations: [
      'Events are traveler reports, not adjudicated facts.',
      'Application timestamps are not trusted timestamps.',
      'Hashes demonstrate byte consistency, not authenticity.',
      'No legal liability or compensation is determined.',
      'Refund totals sum entered events; they are not a deduplicated claim balance.',
    ],
  };
}
export type Dossier = ReturnType<typeof dossier>;
interface PdfLine {
  text: string;
  size: number;
  gap?: number;
}

function pdfLines(report: Dossier): PdfLine[] {
  const lines: PdfLine[] = [
    { text: 'Travel Reliability', size: 22 },
    { text: 'Factual travel dossier / Dossiê factual de viagem', size: 11 },
    { text: report.trip.title, size: 16, gap: 1 },
    {
      text: `${report.trip.startDate} — ${report.trip.endDate} | ${report.trip.country}`,
      size: 10,
    },
    { text: 'Services / Serviços', size: 12, gap: 1 },
  ];
  for (const service of report.trip.services)
    lines.push(
      { text: `${service.kind}: ${service.title}`, size: 10, gap: 0.5 },
      {
        text: `${service.start.local} [${service.start.timeZone ?? 'unknown'}] -> ${service.end.local} [${service.end.timeZone ?? 'unknown'}]`,
        size: 10,
      },
      { text: `Provider: ${service.provider.name}`, size: 10 },
      {
        text: `Reference: ${service.reservation.reference ?? 'unknown'}; confirmation: ${service.reservation.confirmation}`,
        size: 10,
      },
      { text: `Terms: ${service.cancellation.summary ?? 'unknown'}`, size: 10 },
    );
  lines.push({ text: 'Chronology — traveler reports / Cronologia — relatos', size: 12, gap: 1 });
  for (const event of report.timeline)
    lines.push(
      { text: `${event.occurredAt} | ${event.kind} | ${event.serviceId}`, size: 10, gap: 0.4 },
      { text: event.description, size: 10 },
    );
  lines.push(
    { text: 'Request / Pedido', size: 12, gap: 1 },
    { text: report.request || 'Not specified / Não especificado', size: 10 },
    { text: 'Evidence manifest / Manifesto de evidências', size: 12, gap: 1 },
  );
  for (const evidence of report.evidence)
    lines.push(
      { text: `${evidence.id} | ${evidence.label} | ${evidence.bytes} bytes`, size: 9, gap: 0.4 },
      { text: `SHA-256 ${evidence.sha256}`, size: 9 },
    );
  lines.push({ text: report.limitations.join('\n'), size: 9, gap: 1 });
  return lines;
}

export async function pdf(report: Dossier, options: PdfFontOptions = {}): Promise<Buffer> {
  const lines = pdfLines(report);
  const font = await preparePdfFont(
    lines.map((line) => line.text),
    options,
  );
  // Coverage is complete before a document or response body is generated.
  const doc = new PDFDocument({
    size: 'A4',
    margin: 44,
    info: { Title: 'Travel Reliability — factual dossier', Author: 'Travel Reliability' },
  });
  const buffers: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (data) => buffers.push(data));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', () => reject(new AppError('PDF_RENDER_FAILED', 500)));
  });
  try {
    if (font.source === 'Helvetica') doc.font('Helvetica');
    else {
      doc.registerFont('TravelDossier', font.source, font.family);
      doc.font('TravelDossier');
    }
    for (const line of lines) {
      if (line.gap !== undefined) doc.moveDown(line.gap);
      doc.fontSize(line.size).text(line.text);
    }
    doc.end();
  } catch {
    doc.destroy(new AppError('PDF_RENDER_FAILED', 500));
  }
  return result;
}
export const BUNDLE_FORMAT = 'travel-reliability-bundle/1.0.0' as const;
export interface EvidenceBundle {
  format: typeof BUNDLE_FORMAT;
  dossier: Dossier;
  files: Array<{ id: string; sha256: string; base64: string }>;
}

/*
 * Offline bundle container.
 *
 * TRB2 is the only container written. Layout (offsets in bytes):
 *    0  4  magic "TRB2" (ASCII)
 *    4  1  KDF identifier, 0x01 = scrypt
 *    5  1  log2(N)
 *    6  1  r
 *    7  1  p
 *    8  1  AEAD identifier, 0x01 = AES-256-GCM
 *    9  1  salt length, always 16
 *   10  1  nonce length, always 12
 *   11  1  tag length, always 16
 *   12 16  salt
 *   28 12  nonce
 *   40  n  ciphertext of the UTF-8 JSON bundle
 * 40+n 16  GCM tag
 * The whole 40-byte header is the GCM additional authenticated data, so the KDF parameters
 * cannot be altered without failing authentication. The passphrase is NFC-normalized and
 * UTF-8 encoded before scrypt, so the same typed text opens the bundle on every platform.
 *
 * TRB1 is legacy and read-only: "TRB1" | salt(16) | nonce(12) | tag(16) | ciphertext, AAD "TRB1",
 * scrypt N=2^15, r=8, p=1 fixed outside the header, raw UTF-8 passphrase.
 *
 * web/src/offline.tsx implements the same reader; tests/phase1-bundle-crypto.test.ts checks both.
 */
export interface ScryptParameters {
  N: number;
  r: number;
  p: number;
}
const KDF_SCRYPT = 0x01,
  AEAD_AES_256_GCM = 0x01,
  SALT_BYTES = 16,
  NONCE_BYTES = 12,
  TAG_BYTES = 16,
  KEY_BYTES = 32;
export const TRB2_HEADER_BYTES = 40;
/** OWASP minimum for scrypt. Every TRB2 bundle is written with these parameters. */
export const BUNDLE_SCRYPT_PARAMETERS: Readonly<ScryptParameters> = Object.freeze({
  N: 2 ** 17,
  r: 8,
  p: 1,
});
/**
 * Reader bounds for TRB2 headers. The floor is the OWASP minimum; the ceiling guards against
 * denial of service from a hostile header. 1 GiB matches the default memory cap of the
 * browser scrypt implementation (@noble/hashes).
 */
export const BUNDLE_SCRYPT_LIMITS = Object.freeze({
  minLog2N: 17,
  maxLog2N: 20,
  minR: 8,
  maxR: 16,
  minP: 1,
  maxP: 4,
  maxMemoryBytes: 2 ** 30,
});
const LEGACY_TRB1_SCRYPT: Readonly<ScryptParameters> = Object.freeze({ N: 2 ** 15, r: 8, p: 1 });

/** Working memory that OpenSSL requires, 128 * r * (N + p + 2) bytes, plus 1 MiB of headroom. */
export function scryptMaxmem({ N, r, p }: ScryptParameters): number {
  return 128 * r * (N + p + 2) + 1024 * 1024;
}

/** Validates header-declared scrypt parameters against the reader floor and ceiling. */
export function checkedScryptParameters(log2N: number, r: number, p: number): ScryptParameters {
  const limits = BUNDLE_SCRYPT_LIMITS;
  requireCondition(
    Number.isInteger(log2N) &&
      Number.isInteger(r) &&
      Number.isInteger(p) &&
      log2N >= limits.minLog2N &&
      log2N <= limits.maxLog2N &&
      r >= limits.minR &&
      r <= limits.maxR &&
      p >= limits.minP &&
      p <= limits.maxP &&
      128 * r * 2 ** log2N <= limits.maxMemoryBytes,
    'BUNDLE_KDF_PARAMETERS_REJECTED',
    422,
  );
  return { N: 2 ** log2N, r, p };
}

function trb2Header(params: ScryptParameters, salt: Buffer, nonce: Buffer): Buffer {
  const header = Buffer.alloc(TRB2_HEADER_BYTES);
  header.write('TRB2', 0, 'ascii');
  header[4] = KDF_SCRYPT;
  header[5] = Math.log2(params.N);
  header[6] = params.r;
  header[7] = params.p;
  header[8] = AEAD_AES_256_GCM;
  header[9] = SALT_BYTES;
  header[10] = NONCE_BYTES;
  header[11] = TAG_BYTES;
  salt.copy(header, 12);
  nonce.copy(header, 28);
  return header;
}

interface BundleContainer {
  params: ScryptParameters;
  salt: Buffer;
  nonce: Buffer;
  aad: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
  normalizePassphrase: boolean;
}

function parseContainer(data: Buffer): BundleContainer {
  requireCondition(Buffer.isBuffer(data) && data.length >= 4, 'INVALID_BUNDLE', 422);
  const magic = data.subarray(0, 4).toString('latin1');
  if (magic === 'TRB1') {
    requireCondition(data.length >= 48, 'INVALID_BUNDLE', 422);
    return {
      params: LEGACY_TRB1_SCRYPT,
      salt: data.subarray(4, 20),
      nonce: data.subarray(20, 32),
      tag: data.subarray(32, 48),
      ciphertext: data.subarray(48),
      aad: Buffer.from('TRB1', 'ascii'),
      normalizePassphrase: false,
    };
  }
  requireCondition(
    magic === 'TRB2' &&
      data.length >= TRB2_HEADER_BYTES + TAG_BYTES &&
      data[4] === KDF_SCRYPT &&
      data[8] === AEAD_AES_256_GCM &&
      data[9] === SALT_BYTES &&
      data[10] === NONCE_BYTES &&
      data[11] === TAG_BYTES,
    'INVALID_BUNDLE',
    422,
  );
  return {
    params: checkedScryptParameters(data[5]!, data[6]!, data[7]!),
    salt: data.subarray(12, 28),
    nonce: data.subarray(28, TRB2_HEADER_BYTES),
    aad: data.subarray(0, TRB2_HEADER_BYTES),
    ciphertext: data.subarray(TRB2_HEADER_BYTES, data.length - TAG_BYTES),
    tag: data.subarray(data.length - TAG_BYTES),
    normalizePassphrase: true,
  };
}

const SHA256_HEX = /^[a-f0-9]{64}$/;
/**
 * Requires a one-to-one match between the dossier evidence manifest (id and SHA-256) and the
 * embedded files, then checks every file against its hash. Runs before sealing and after opening.
 */
export function verifyBundleContents(value: unknown): asserts value is EvidenceBundle {
  const bundle = value as { format?: unknown; dossier?: unknown; files?: unknown } | null;
  requireCondition(
    bundle !== null &&
      typeof bundle === 'object' &&
      bundle.format === BUNDLE_FORMAT &&
      Array.isArray(bundle.files) &&
      bundle.dossier !== null &&
      typeof bundle.dossier === 'object' &&
      Array.isArray((bundle.dossier as { evidence?: unknown }).evidence),
    'INVALID_BUNDLE',
    422,
  );
  const evidence = (bundle.dossier as { evidence: unknown[] }).evidence,
    files = bundle.files as unknown[];
  const declared = new Map<string, string>();
  for (const entry of evidence) {
    const item = entry as { id?: unknown; sha256?: unknown } | null;
    requireCondition(
      item !== null &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.sha256 === 'string' &&
        SHA256_HEX.test(item.sha256),
      'INVALID_BUNDLE',
      422,
    );
    const id = item.id as string;
    requireCondition(!declared.has(id), 'BUNDLE_MANIFEST_MISMATCH', 409);
    declared.set(id, item.sha256 as string);
  }
  const present = new Set<string>();
  for (const entry of files) {
    const item = entry as { id?: unknown; sha256?: unknown; base64?: unknown } | null;
    requireCondition(
      item !== null &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.sha256 === 'string' &&
        typeof item.base64 === 'string',
      'INVALID_BUNDLE',
      422,
    );
    const id = item.id as string;
    // A file must be declared once, with the same hash the dossier states.
    requireCondition(
      !present.has(id) && declared.get(id) === item.sha256,
      'BUNDLE_MANIFEST_MISMATCH',
      409,
    );
    present.add(id);
  }
  // Every declared piece of evidence must be present.
  requireCondition(present.size === declared.size, 'BUNDLE_MANIFEST_MISMATCH', 409);
  for (const entry of files as Array<{ sha256: string; base64: string }>)
    requireCondition(
      sha256(Buffer.from(entry.base64, 'base64')) === entry.sha256,
      'BUNDLE_HASH_MISMATCH',
      409,
    );
}

export async function encryptBundle(bundle: EvidenceBundle, passphrase: string): Promise<Buffer> {
  requireCondition(passphrase.length >= 12 && passphrase.length <= 256, 'PASSPHRASE_LENGTH', 422);
  // Never emit a bundle that its own verifier would reject.
  verifyBundleContents(bundle);
  const params = BUNDLE_SCRYPT_PARAMETERS,
    salt = randomBytes(SALT_BYTES),
    nonce = randomBytes(NONCE_BYTES),
    header = trb2Header(params, salt, nonce);
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      passphrase.normalize('NFC'),
      salt,
      KEY_BYTES,
      { ...params, maxmem: scryptMaxmem(params) },
      (error, derived) =>
        error ? reject(new AppError('BUNDLE_KDF_FAILED', 500)) : resolve(derived),
    ),
  );
  try {
    const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES });
    cipher.setAAD(header);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(bundle), 'utf8'),
      cipher.final(),
    ]);
    return Buffer.concat([header, encrypted, cipher.getAuthTag()]);
  } finally {
    key.fill(0);
  }
}

/**
 * Opens a TRB2 bundle (or a legacy TRB1 bundle) and verifies its contents. Every failure is an
 * AppError with a stable code: INVALID_BUNDLE, BUNDLE_KDF_PARAMETERS_REJECTED,
 * BUNDLE_KDF_FAILED, BUNDLE_AUTHENTICATION_FAILED, BUNDLE_MANIFEST_MISMATCH or
 * BUNDLE_HASH_MISMATCH.
 */
export function decryptBundle(data: Buffer, passphrase: string): EvidenceBundle {
  try {
    const container = parseContainer(data);
    let key: Buffer;
    try {
      key = scryptSync(
        container.normalizePassphrase ? passphrase.normalize('NFC') : passphrase,
        container.salt,
        KEY_BYTES,
        { ...container.params, maxmem: scryptMaxmem(container.params) },
      );
    } catch {
      throw new AppError('BUNDLE_KDF_FAILED', 500);
    }
    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, container.nonce, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(container.aad);
      decipher.setAuthTag(container.tag);
      plaintext = Buffer.concat([decipher.update(container.ciphertext), decipher.final()]);
    } catch {
      // Wrong passphrase, altered header, ciphertext or tag: indistinguishable by design.
      throw new AppError('BUNDLE_AUTHENTICATION_FAILED', 422);
    } finally {
      key.fill(0);
    }
    let bundle: unknown;
    try {
      bundle = JSON.parse(plaintext.toString('utf8'));
    } catch {
      throw new AppError('INVALID_BUNDLE', 422);
    }
    verifyBundleContents(bundle);
    return bundle;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('INVALID_BUNDLE', 422);
  }
}
