import { describe, it, expect } from 'vitest';
import { canonicalLocale, messageLanguage } from '../schema/src/locale.js';
import { prepareBrief } from '../agent/brief.js';
import { prepareWorkflow } from '../agent/workflow.js';
import { demoTrip } from '../api/src/demo.js';
import { validateTrip } from '../api/src/validation.js';
import { assess, checklist } from '../api/src/assessment.js';

describe('international locale and non-Brazil contracts', () => {
  it('does not turn an absent or unknown country-pack registration into not-applicable', () => {
    const trip = structuredClone(demoTrip());
    trip.services[0]!.country = 'BR';
    delete trip.services[0]!.provider.cadastur;
    validateTrip(trip);
    expect(
      checklist(trip, 'pre_booking').find(
        (item) => item.serviceId === trip.services[0]!.id && item.code === 'CADASTUR_CHECK',
      )?.status,
    ).toBe('pending');
    trip.services[0]!.provider.cadastur = {
      applicability: 'unknown',
      status: 'active',
      checkedAt: '2026-10-31T00:00:00Z',
      sourceUrl: 'https://example.invalid/registry',
    };
    expect(
      checklist(trip, 'pre_booking').find(
        (item) => item.serviceId === trip.services[0]!.id && item.code === 'CADASTUR_CHECK',
      )?.status,
    ).toBe('pending');
    trip.services[0]!.provider.cadastur.applicability = 'not_applicable';
    expect(
      checklist(trip, 'pre_booking').find(
        (item) => item.serviceId === trip.services[0]!.id && item.code === 'CADASTUR_CHECK',
      )?.status,
    ).toBe('not_applicable');
  });
  it.each(['es-ES', 'ja-JP', 'ar-EG', 'de-CH', 'pt-PT', 'en-GB'])(
    'keeps %s without pretending all messages are translated',
    (language) => {
      const brief = prepareBrief({ tripKey: 'demo-global', request: 'plan', language });
      expect(brief.requestedLocale).toBe(language);
      expect(brief.brief.language).toBe(language);
      expect(brief.messageLocale).toBe(language.startsWith('pt') ? 'pt-BR' : 'en');
      const workflow = prepareWorkflow({
        tripKey: 'demo-global',
        workflowId: 'compare-lodging',
        language,
      });
      expect(workflow.requestedLocale).toBe(language);
      expect(workflow.messageLocale).toBe(brief.messageLocale);
    },
  );
  it.each(['en_US', 'en--US', 'a', 'en-INVALID-!!!', 'x'.repeat(100)])(
    'rejects invalid locale %s',
    (language) => {
      expect(() => prepareBrief({ tripKey: 'demo-global', request: 'plan', language })).toThrow();
      expect(() =>
        prepareWorkflow({ tripKey: 'demo-global', workflowId: 'compare-lodging', language }),
      ).toThrow();
    },
  );
  it('uses the same canonicalization and declared message fallback', () => {
    expect(canonicalLocale('pt-pt')).toBe('pt-PT');
    expect(messageLanguage('pt-PT')).toBe('pt-BR');
    expect(messageLanguage('ja-JP')).toBe('en');
  });
  it.each(['rail', 'ferry', 'cruise', 'hostel', 'camping', 'homestay', 'coworking'] as const)(
    'validates %s abroad without a Brazilian registry object',
    (kind) => {
      const trip = structuredClone(demoTrip());
      trip.locale = 'ja-JP';
      trip.services[0]!.kind = kind;
      trip.services[0]!.country = 'JP';
      delete trip.services[0]!.provider.cadastur;
      expect(validateTrip(trip).locale).toBe('ja-JP');
      expect(() => assess(trip)).not.toThrow();
      const items = checklist(trip, 'pre_booking');
      expect(items.find((item) => item.code === 'CADASTUR_CHECK')?.status).toBe('not_applicable');
    },
  );
});
