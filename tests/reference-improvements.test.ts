import { describe, expect, it } from 'vitest';
import { cnpjCheckDigits, validCnpj } from '../api/src/cnpj.js';
import { calendar } from '../api/src/exports.js';
import { demoTrip } from '../api/src/demo.js';
import { assess } from '../api/src/assessment.js';
import { policyPrivacyReview } from '../api/src/llm.js';
import { sensitiveTextReasons } from '../api/src/privacy.js';
import { formatMinor } from '../web/src/format-money.js';
import { summarizeComparisons } from '../api/src/review-comparison.js';
import { extractText } from '../api/src/ingestion.js';
import type { EvidenceDocument } from '../schema/src/domain.js';

describe('reference-informed privacy and validation', () => {
  it('normalizes explicit literals without guessing dates, zones, currencies or price components', () => {
    const text = [
      'Supplier: Synthetic Provider',
      'Date: 2030-03-01',
      'Departure: 2030-03-01T08:30',
      'Arrival: 2030-03-01T10:00-03:00',
      'Total: BRL 1.234,56',
      'Amount: USD 12.34',
      'Total: JPY 0',
      'Total: KWD 1.234',
      'Date: 2030-02-30',
      'Date: 03/04/2030',
      'Total: USD 1,234',
      'Total: XXX 5.00',
      'Total: BRL 1.234',
    ].join('\n');
    const result = extractText(Buffer.from(text));
    expect(result.facts?.map((fact) => fact.value)).toEqual([
      'Synthetic Provider',
      { iso: '2030-03-01', precision: 'date' },
      { iso: '2030-03-01T08:30', precision: 'local_datetime_zone_unknown' },
      { iso: '2030-03-01T10:00-03:00', precision: 'offset_datetime' },
      { currency: 'BRL', minorUnits: 123456 },
      { currency: 'USD', minorUnits: 1234 },
      { currency: 'JPY', minorUnits: 0 },
      { currency: 'KWD', minorUnits: 1234 },
    ]);
    expect(
      result.facts?.every(
        (fact) =>
          fact.state === 'extracted' &&
          text.split('\n')[fact.source.line! - 1] === fact.source.quote,
      ),
    ).toBe(true);
    expect(
      extractText(Buffer.from(Array(40).fill('Total: USD 1.00').join('\n'))).facts,
    ).toHaveLength(30);
  });
  it('keeps advertised-versus-observed comparisons factual and unknowns explicit', () => {
    const result = summarizeComparisons([
      { attribute: 'beds', advertised: ' 2 beds ', observed: '2 BEDS' },
      { attribute: 'internet', advertised: '100 Mbps', observed: '5 Mbps' },
      { attribute: 'accessibility', advertised: 'step-free', observed: null },
    ]);
    expect(result).toEqual({
      compared: 2,
      differentText: 1,
      incomplete: 1,
      verification: 'traveler_report_only',
    });
  });
  it('escapes lone carriage returns in explicitly private calendar text', () => {
    const trip = demoTrip();
    trip.services[0]!.title = 'Synthetic title\rATTACH:https://example.invalid/asset';
    const output = calendar(trip, { includePrivate: true }).replace(/\r\n /g, '');
    expect(output).toContain('SUMMARY:Synthetic title\\nATTACH:');
    expect(output).not.toMatch(/\rATTACH:/);
    expect(output).not.toMatch(/\r\nATTACH:/);
  });
  it('displays the last cent of a safe integer without float rounding', () => {
    expect(formatMinor(Number.MAX_SAFE_INTEGER, 'BRL', 'pt-BR')).toContain(',91');
    expect(formatMinor(-5, 'BRL', 'pt-BR')).toContain('0,05');
    expect(formatMinor(-5, 'BRL', 'pt-BR')).toContain('-');
    expect(formatMinor(1234, 'JPY', 'en')).toContain('1,234');
  });
  it('supports the official fictional alphanumeric CNPJ example and rejects corrupt IDs', () => {
    expect(cnpjCheckDigits('12ABC34501DE')).toBe('35');
    expect(validCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(validCnpj('12ABC34501DE00')).toBe(false);
    expect(validCnpj('0'.repeat(14))).toBe(false);
    expect(validCnpj('12ABC34501DE35!')).toBe(false);
  });
  it('supports numeric CNPJ check digits without implying an active registration', () => {
    const base = '9'.repeat(12),
      check = cnpjCheckDigits(base);
    expect(validCnpj(base + check)).toBe(true);
    const trip = demoTrip();
    trip.services[0]!.provider.registration.scheme = 'CNPJ';
    trip.services[0]!.provider.registration.value = 'INVALID';
    expect(assess(trip).findings.some((f) => f.code === 'REGISTRATION_FORMAT_INVALID')).toBe(true);
  });
  it('keeps booking codes, addresses and all free text out of the default calendar', () => {
    const trip = demoTrip();
    trip.services.forEach((service) => {
      service.title = 'SYNTHETIC_PRIVATE_TITLE';
      service.location = 'SYNTHETIC_PRIVATE_ADDRESS';
      service.provider.name = 'SYNTHETIC_PRIVATE_PROVIDER';
      service.reservation.reference = 'SYNTHETIC_PRIVATE_REFERENCE';
      service.cancellation.summary = 'SYNTHETIC_PRIVATE_POLICY';
    });
    expect(calendar(trip)).not.toContain('SYNTHETIC_PRIVATE');
    expect(calendar(trip)).not.toContain(trip.id);
    expect(calendar(trip, { includePrivate: true })).toContain('SYNTHETIC_PRIVATE_REFERENCE');
    expect(calendar(trip)).toContain('DTSTART:20261029T120000Z');
  });
  it('excludes identifiers and quarantined instructions from outbound policy snippets', () => {
    const doc = {
      fields: [{ path: 'reservation.reference', value: 'SYNTHETIC-CODE' }],
      warnings: [],
      preview: [
        { line: 1, text: 'Cancellation: literal non-refundable terms.' },
        { line: 2, text: 'Cancellation: Booking reference: SYNTHETIC-CODE' },
        { line: 3, text: 'Refund contact: traveler@example.invalid' },
        { line: 4, text: 'Baggage receipt: ' + '0'.repeat(11) },
      ],
    } as unknown as EvidenceDocument;
    const review = policyPrivacyReview(doc);
    expect(review.snippets.map((s) => s.line)).toEqual([1]);
    expect(review.screenedOut).toBe(3);
    doc.warnings.push('UNTRUSTED_INSTRUCTION_DETECTED');
    expect(policyPrivacyReview(doc).snippets).toEqual([]);
    expect(sensitiveTextReasons('Cancellation: Nome: SYNTHETIC PERSON')).toContain(
      'PERSONAL_OR_SECRET_LABEL',
    );
  });
});
