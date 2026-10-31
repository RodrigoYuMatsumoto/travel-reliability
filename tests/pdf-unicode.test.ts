import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdtemp, open, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assess } from '../api/src/assessment.js';
import { buildApp } from '../api/src/app.js';
import { loadConfig } from '../api/src/config.js';
import { demoTrip } from '../api/src/demo.js';
import { calendar, dossier, pdf, type Dossier } from '../api/src/exports.js';
import { preparePdfFont, validatePdfFontOptions } from '../api/src/pdf-font.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const python = join(
  project,
  'ingest',
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const systemFont =
  process.platform === 'win32'
    ? 'C:/Windows/Fonts/arial.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';
const faceName = process.platform === 'win32' ? 'ArialMT' : 'DejaVuSans';
const unsupported = String.fromCodePoint(0x10ffff);
let temporary: string;

beforeAll(async () => {
  if (!existsSync(systemFont)) throw new Error('PDF_TEST_REQUIRES_LOCAL_ARIAL_OR_DEJAVU_SANS');
  if (!existsSync(python)) throw new Error('PDF_TEST_REQUIRES_PREPARED_INGEST_VENV');
  temporary = await mkdtemp(join(tmpdir(), 'travel-pdf-unicode-'));
});
afterAll(async () => {
  if (!temporary) return;
  const remainder = relative(resolve(tmpdir()), resolve(temporary));
  if (remainder.startsWith('travel-pdf-unicode-') && !remainder.includes('..'))
    await rm(temporary, { recursive: true, force: true });
});

function reportFixture(): Dossier {
  const trip = demoTrip();
  const report = dossier(trip, assess(trip), [], [], 'Synthetic request');
  report.timeline.push({
    id: 'synthetic-event',
    tripId: trip.id,
    serviceId: trip.services[0]!.id,
    kind: 'delay',
    occurredAt: '2026-01-01T12:00:00Z',
    waitingMinutes: 60,
    overnight: false,
    specialAssistance: false,
    providerResponsibility: 'unknown',
    description: 'Synthetic traveler report',
    documentIds: [],
    amountMinor: null,
    currency: null,
    source: 'user',
    phase: 'departure',
    refundChoice: 'unknown',
    residentAtOrigin: null,
    exceptionalConditions: 'unknown',
    classification: 'traveler_report',
  });
  report.evidence.push({
    id: 'synthetic-evidence',
    label: 'Synthetic voucher',
    mediaType: 'application/pdf',
    bytes: 123,
    sha256: 'a'.repeat(64),
    capturedByApplicationAt: '2026-01-01T12:00:00Z',
    status: 'ready',
  });
  return report;
}

function extract(bytes: Buffer): string {
  const script =
    'from pypdf import PdfReader\nimport io,sys\nr=PdfReader(io.BytesIO(sys.stdin.buffer.read()))\nsys.stdout.buffer.write("\\n".join(p.extract_text() or "" for p in r.pages).encode("utf-8"))';
  const result = spawnSync(python, ['-I', '-B', '-c', script], {
    cwd: project,
    input: bytes,
    timeout: 15000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error('PDF_TEST_EXTRACTION_FAILED');
  return result.stdout.toString('utf8');
}

describe('PDF coverage and Unicode exports', () => {
  it('keeps the standard Latin export readable without operator font configuration', async () => {
    const report = reportFixture();
    report.trip.title = 'Dossiê sintético — conexão, ação e serviços';
    const bytes = await pdf(report);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    const text = extract(bytes);
    expect(text).toContain(report.trip.title);
    expect(text).toContain('Synthetic traveler report');
    expect(text).toContain('Evidence manifest / Manifesto de evidências');
  });

  it('embeds the configured local font and preserves Cyrillic during independent extraction', async () => {
    const report = reportFixture();
    report.trip.title = 'Синтетический маршрут Москва';
    report.trip.services[0]!.title = 'Пример маршрута';
    report.trip.services[0]!.provider.name = 'Пример перевозчика';
    report.request = 'Проверить бронирование';
    const bytes = await pdf(report, { fontPath: systemFont, fontFamily: faceName });
    const text = extract(bytes);
    expect(text).toContain(report.trip.title);
    expect(text).toContain(report.trip.services[0]!.title);
    expect(text).toContain(report.trip.services[0]!.provider.name);
    expect(text).toContain(report.request);
    expect(text).toContain('Dossiê factual de viagem');
  });

  it.each(['中文行程', 'رحلة تجريبية', 'Синтетическая поездка'])(
    'rejects unsupported default-font text: %s',
    async (title) => {
      const report = reportFixture();
      report.trip.title = title;
      await expect(pdf(report)).rejects.toMatchObject({
        code: 'PDF_FONT_MISSING_GLYPH',
        status: 422,
      });
    },
  );

  it('refuses CJK when the configured system font does not cover those characters', async () => {
    const report = reportFixture();
    report.trip.title = '中文行程';
    await expect(pdf(report, { fontPath: systemFont })).rejects.toMatchObject({
      code: 'PDF_FONT_MISSING_GLYPH',
    });
  });

  const renderedFields: Array<[string, (report: Dossier) => void]> = [
    [
      'trip title',
      (r) => {
        r.trip.title += unsupported;
      },
    ],
    [
      'trip dates',
      (r) => {
        r.trip.startDate += unsupported;
      },
    ],
    [
      'trip country',
      (r) => {
        r.trip.country += unsupported;
      },
    ],
    [
      'service title',
      (r) => {
        r.trip.services[0]!.title += unsupported;
      },
    ],
    [
      'service time',
      (r) => {
        r.trip.services[0]!.start.local += unsupported;
      },
    ],
    [
      'service zone',
      (r) => {
        r.trip.services[0]!.end.timeZone += unsupported;
      },
    ],
    [
      'provider',
      (r) => {
        r.trip.services[0]!.provider.name += unsupported;
      },
    ],
    [
      'reference',
      (r) => {
        r.trip.services[0]!.reservation.reference += unsupported;
      },
    ],
    [
      'terms',
      (r) => {
        r.trip.services[0]!.cancellation.summary = unsupported;
      },
    ],
    [
      'event time',
      (r) => {
        r.timeline[0]!.occurredAt += unsupported;
      },
    ],
    [
      'event service',
      (r) => {
        r.timeline[0]!.serviceId += unsupported;
      },
    ],
    [
      'event description',
      (r) => {
        r.timeline[0]!.description += unsupported;
      },
    ],
    [
      'request',
      (r) => {
        r.request += unsupported;
      },
    ],
    [
      'evidence id',
      (r) => {
        r.evidence[0]!.id += unsupported;
      },
    ],
    [
      'evidence label',
      (r) => {
        r.evidence[0]!.label += unsupported;
      },
    ],
    [
      'evidence hash',
      (r) => {
        r.evidence[0]!.sha256 += unsupported;
      },
    ],
    [
      'limitations',
      (r) => {
        r.limitations.push(unsupported);
      },
    ],
  ];
  it.each(renderedFields)(
    'checks every rendered field before export: %s',
    async (_label, change) => {
      const report = reportFixture();
      change(report);
      await expect(pdf(report, { fontPath: systemFont })).rejects.toMatchObject({
        code: 'PDF_FONT_MISSING_GLYPH',
      });
    },
  );

  it('keeps error details static for unsupported text and private-looking missing paths', async () => {
    const report = reportFixture();
    report.trip.title = 'SYNTHETIC_PRIVATE_MARKER ' + unsupported;
    await expect(pdf(report, { fontPath: systemFont })).rejects.toMatchObject({
      message: 'PDF_FONT_MISSING_GLYPH',
      details: undefined,
    });
    await expect(
      pdf(report, { fontPath: join(temporary, 'SYNTHETIC_PRIVATE_FONT.ttf') }),
    ).rejects.toMatchObject({ message: 'PDF_FONT_UNAVAILABLE', details: undefined });
  });

  it('rejects unavailable, oversized, malformed and incorrectly selected fonts', async () => {
    const oversized = join(temporary, 'oversized.ttf');
    const file = await open(oversized, 'wx');
    await file.truncate(32 * 1024 * 1024 + 1);
    await file.close();
    await expect(preparePdfFont(['Synthetic'], { fontPath: oversized })).rejects.toMatchObject({
      code: 'PDF_FONT_UNAVAILABLE',
    });
    const invalid = join(temporary, 'invalid.ttf');
    await writeFile(invalid, 'Synthetic malformed font', { flag: 'wx' });
    await expect(preparePdfFont(['Synthetic'], { fontPath: invalid })).rejects.toMatchObject({
      code: 'PDF_FONT_INVALID_OR_FACE_NOT_FOUND',
    });
    await expect(
      preparePdfFont(['Synthetic'], { fontPath: systemFont, fontFamily: 'SyntheticMissingFace' }),
    ).rejects.toMatchObject({ code: 'PDF_FONT_INVALID_OR_FACE_NOT_FOUND' });
    await expect(preparePdfFont(['Synthetic'], { fontPath: temporary })).rejects.toMatchObject({
      code: 'PDF_FONT_UNAVAILABLE',
    });
  });

  it('rejects remote, relative and Windows alternate-data-stream font locations', () => {
    for (const fontPath of [
      'font.ttf',
      'https://example.invalid/font.ttf',
      '\\\\server\\font.ttf',
      `${systemFont}:stream`,
    ])
      expect(() => validatePdfFontOptions({ fontPath })).toThrow('PDF_FONT_CONFIGURATION_INVALID');
    expect(() => validatePdfFontOptions({ fontFamily: 'SyntheticFace' })).toThrow(
      'PDF_FONT_CONFIGURATION_INVALID',
    );
  });

  it('rejects a font reached through a symbolic directory link or Windows junction', async () => {
    const link = join(temporary, 'linked-system-fonts');
    await symlink(dirname(systemFont), link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(
      preparePdfFont(['Synthetic'], { fontPath: join(link, basename(systemFont)) }),
    ).rejects.toMatchObject({ code: 'PDF_FONT_UNAVAILABLE' });
  });

  it('keeps font configuration solely in trusted fixed environment fields', () => {
    expect(
      loadConfig({ APP_MODE: 'demo', PDF_FONT_PATH: systemFont, PDF_FONT_FAMILY: faceName }),
    ).toMatchObject({ pdfFontPath: systemFont, pdfFontFamily: faceName });
    expect(
      loadConfig({ APP_MODE: 'demo', PDF_FONT_PATH: '', PDF_FONT_FAMILY: '' }).pdfFontPath,
    ).toBeUndefined();
    expect(() => loadConfig({ APP_MODE: 'demo', PDF_FONT_PATH: 'relative.ttf' })).toThrow(
      'PDF_FONT_CONFIGURATION_INVALID',
    );
  });

  it('uses only operator-selected fonts in both HTTP PDF routes and reports coverage failure', async () => {
    for (const configured of [false, true]) {
      const context = await buildApp(
        loadConfig({
          APP_MODE: 'demo',
          PDF_FONT_PATH: configured ? systemFont : undefined,
        }),
      );
      try {
        const login = await context.app.inject({
          method: 'POST',
          url: '/auth/demo',
          headers: { origin: 'http://127.0.0.1:4310' },
        });
        expect(login.statusCode).toBe(200);
        const headers = {
          origin: 'http://127.0.0.1:4310',
          cookie: `tr_session=${login.cookies.find((cookie) => cookie.name === 'tr_session')!.value}`,
          'x-csrf-token': (login.json() as { csrf: string }).csrf,
        };
        const trip = demoTrip();
        trip.title = 'Синтетический маршрут';
        const created = await context.app.inject({
          method: 'POST',
          url: '/v1/trips',
          headers,
          payload: trip,
        });
        expect(created.statusCode).toBe(201);
        for (const request of [
          { method: 'GET' as const, url: `/v1/trips/${trip.id}/export?format=pdf` },
          {
            method: 'POST' as const,
            url: `/v1/trips/${trip.id}/dossier/pdf`,
            payload: { request: 'Synthetic request' },
          },
        ]) {
          const response = await context.app.inject({ ...request, headers });
          if (configured) {
            expect(response.statusCode).toBe(200);
            expect(extract(response.rawPayload)).toContain(trip.title);
          } else {
            expect(response.statusCode).toBe(422);
            expect(response.json()).toMatchObject({ error: { code: 'PDF_FONT_MISSING_GLYPH' } });
            expect(response.payload).not.toContain(trip.title);
          }
        }
        const forbiddenOption = await context.app.inject({
          method: 'POST',
          url: `/v1/trips/${trip.id}/dossier/pdf`,
          headers,
          payload: { request: 'Synthetic request', fontPath: systemFont },
        });
        expect(forbiddenOption.statusCode).toBe(422);
      } finally {
        await context.app.close();
      }
    }
  });

  it('bounds rendered text without truncating it', async () => {
    await expect(preparePdfFont(['x'.repeat(2_000_001)])).rejects.toMatchObject({
      code: 'PDF_TEXT_LIMIT',
    });
  });

  it('preserves CJK, Arabic and Cyrillic in JSON and private iCalendar independently of PDF fonts', () => {
    const report = reportFixture();
    const text = '中文 رحلة Пример';
    report.trip.title = text;
    report.trip.services[0]!.title = text;
    report.trip.services[0]!.provider.name = text;
    expect(JSON.parse(JSON.stringify(report)).trip.title).toBe(text);
    const ics = calendar(report.trip, { includePrivate: true }).replace(/\r\n /g, '');
    expect(Buffer.from(ics, 'utf8').toString('utf8')).toContain(`SUMMARY:${text}`);
    expect(ics).toContain(text);
  });
});
