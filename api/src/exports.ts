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
export interface EvidenceBundle {
  format: 'travel-reliability-bundle/1.0.0';
  dossier: Dossier;
  files: Array<{ id: string; sha256: string; base64: string }>;
}
export async function encryptBundle(bundle: EvidenceBundle, passphrase: string): Promise<Buffer> {
  requireCondition(passphrase.length >= 12 && passphrase.length <= 256, 'PASSPHRASE_LENGTH', 422);
  const salt = randomBytes(16),
    nonce = randomBytes(12),
    key = await new Promise<Buffer>((resolve, reject) =>
      scrypt(passphrase, salt, 32, { N: 32768, maxmem: 64 * 1024 * 1024 }, (error, derived) =>
        error ? reject(error) : resolve(derived),
      ),
    );
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('TRB1'));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(bundle), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('TRB1'), salt, nonce, cipher.getAuthTag(), encrypted]);
}
export function decryptBundle(data: Buffer, passphrase: string): EvidenceBundle {
  requireCondition(
    data.length >= 48 && data.subarray(0, 4).toString() === 'TRB1',
    'INVALID_BUNDLE',
    422,
  );
  const key = scryptSync(passphrase, data.subarray(4, 20), 32, {
    N: 32768,
    maxmem: 64 * 1024 * 1024,
  });
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(20, 32), {
    authTagLength: 16,
  });
  decipher.setAAD(Buffer.from('TRB1'));
  decipher.setAuthTag(data.subarray(32, 48));
  const bundle = JSON.parse(
    Buffer.concat([decipher.update(data.subarray(48)), decipher.final()]).toString('utf8'),
  ) as EvidenceBundle;
  requireCondition(
    bundle.format === 'travel-reliability-bundle/1.0.0' && Array.isArray(bundle.files),
    'INVALID_BUNDLE',
    422,
  );
  for (const file of bundle.files)
    requireCondition(
      sha256(Buffer.from(file.base64, 'base64')) === file.sha256,
      'BUNDLE_HASH_MISMATCH',
      409,
    );
  return bundle;
}
