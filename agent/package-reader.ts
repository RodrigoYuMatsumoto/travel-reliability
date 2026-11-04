import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { gunzipSync } from 'node:zlib';
import type { LookupAddress } from 'node:dns';
import { publicIpv4 } from './public-sources.js';
import { packageReferenceCatalog, packageSourceById, packageSourceUrl } from './package-sources.js';
import { validatePassive } from './provenance.js';
import { AppError } from '../api/src/errors.js';

export const PACKAGE_READER_LIMITS = Object.freeze({
  responseBytes: 1_000_000,
  dnsMs: 4000,
  httpMs: 10000,
  textBytes: 120000,
  projectionBytes: 24000,
  candidates: 80,
});
export type PackageTransport = (url: URL) => Promise<Uint8Array>;
type SourceEncoding = 'utf-8' | 'windows-1252';
// Header metadata belongs to this read only; raw bodies are never persisted here.
const responseEncodings = new WeakMap<Uint8Array, SourceEncoding>();
function encoding(value: string): SourceEncoding {
  const normalized = value.toLowerCase().replaceAll('_', '-');
  if (['utf-8', 'utf8'].includes(normalized)) return 'utf-8';
  if (['windows-1252', 'windows1252', 'iso-8859-1', 'iso8859-1', 'latin1'].includes(normalized))
    return 'windows-1252';
  return fail('PACKAGE_ENCODING_REJECTED');
}
const captureSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['sourceId'],
  properties: { sourceId: { type: 'string', pattern: '^[a-z0-9-]{1,70}$' } },
};
const policySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['allowNetwork'],
  properties: { allowNetwork: { type: 'boolean' } },
};
function fail(code: string): never {
  throw new AppError(code, 422);
}

function fixedUrl(input: URL): URL {
  if (
    !input ||
    typeof input !== 'object' ||
    types.isProxy(input) ||
    Object.getPrototypeOf(input) !== URL.prototype
  )
    fail('PACKAGE_SOURCE_REJECTED');
  const href = Object.getOwnPropertyDescriptor(URL.prototype, 'href')!.get!.call(input) as string;
  const url = new URL(href);
  if (
    href.length > 2048 ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    !packageReferenceCatalog.some((source) => source.fetchUrl === href)
  )
    fail('PACKAGE_SOURCE_REJECTED');
  return url;
}

/** Fixed-reference HTTPS GET: no cookies/auth, redirects, browser execution or automatic retries. */
export async function readPackageHtml(input: URL): Promise<Uint8Array> {
  const url = fixedUrl(input);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let addresses: LookupAddress[];
  try {
    addresses = await Promise.race([
      lookup(url.hostname, { family: 4, all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('PACKAGE_DNS_TIMEOUT')),
          PACKAGE_READER_LIMITS.dnsMs,
        );
      }),
    ]);
  } catch (error) {
    fail(
      error instanceof Error && error.message === 'PACKAGE_DNS_TIMEOUT'
        ? 'PACKAGE_DNS_TIMEOUT'
        : 'PACKAGE_DNS_FAILED',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (
    !Array.isArray(addresses) ||
    !addresses.length ||
    addresses.length > 32 ||
    addresses.some((entry) => entry.family !== 4 || !publicIpv4(entry.address))
  )
    fail('PACKAGE_ADDRESS_REJECTED');
  const pinned = addresses[0]!.address;
  return new Promise((resolve, reject) => {
    let settled = false,
      req: ReturnType<typeof request> | undefined;
    const deadline = setTimeout(
      () => finish(new Error('PACKAGE_HTTP_TIMEOUT')),
      PACKAGE_READER_LIMITS.httpMs,
    );
    function finish(error?: Error, data?: Uint8Array) {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) {
        req?.destroy();
        reject(error);
      } else resolve(data!);
    }
    try {
      req = request(
        url,
        {
          method: 'GET',
          agent: false,
          rejectUnauthorized: true,
          minVersion: 'TLSv1.2',
          servername: url.hostname,
          headers: {
            accept: 'text/html,application/xhtml+xml',
            'accept-encoding': 'identity',
            'user-agent': 'TravelReliability/0.6 package-source-reader',
          },
          lookup: (host, options, callback) => {
            if (host !== url.hostname) {
              callback(new Error('PACKAGE_ADDRESS_REJECTED'), '', 4);
              return;
            }
            if (typeof options === 'object' && options.all)
              callback(null, [{ address: pinned, family: 4 }]);
            else callback(null, pinned, 4);
          },
        },
        (response) => {
          const contentType = String(response.headers['content-type'] ?? '');
          if (
            response.statusCode !== 200 ||
            !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i.test(contentType) ||
            (response.headers['content-encoding'] &&
              !['identity', 'gzip'].includes(response.headers['content-encoding']))
          ) {
            response.destroy();
            finish(new Error('PACKAGE_HTTP_REJECTED'));
            return;
          }
          let declaredEncoding: SourceEncoding | undefined;
          try {
            const declared = /;\s*charset\s*=\s*["']?([a-z0-9_-]+)/i.exec(contentType)?.[1];
            if (declared) declaredEncoding = encoding(declared);
          } catch {
            response.destroy();
            finish(new Error('PACKAGE_ENCODING_REJECTED'));
            return;
          }
          const length = response.headers['content-length'];
          if (
            length !== undefined &&
            (!/^\d+$/.test(length) || Number(length) > PACKAGE_READER_LIMITS.responseBytes)
          ) {
            response.destroy();
            finish(new Error('PACKAGE_RESPONSE_LIMIT'));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on('data', (chunk: Buffer) => {
            if (settled) return;
            size += chunk.length;
            if (size > PACKAGE_READER_LIMITS.responseBytes) {
              response.destroy();
              finish(new Error('PACKAGE_RESPONSE_LIMIT'));
            } else chunks.push(chunk);
          });
          response.on('end', () => {
            if (!response.complete) {
              finish(new Error('PACKAGE_TRANSPORT_FAILED'));
              return;
            }
            try {
              const wire = Buffer.concat(chunks);
              const body =
                response.headers['content-encoding'] === 'gzip'
                  ? gunzipSync(wire, { maxOutputLength: PACKAGE_READER_LIMITS.responseBytes })
                  : wire;
              if (body.length > PACKAGE_READER_LIMITS.responseBytes)
                finish(new Error('PACKAGE_RESPONSE_LIMIT'));
              else {
                if (declaredEncoding) responseEncodings.set(body, declaredEncoding);
                finish(undefined, body);
              }
            } catch {
              finish(new Error('PACKAGE_RESPONSE_LIMIT'));
            }
          });
          response.on('error', () => finish(new Error('PACKAGE_TRANSPORT_FAILED')));
          response.on('aborted', () => finish(new Error('PACKAGE_TRANSPORT_FAILED')));
          response.on('close', () => {
            if (!settled && !response.complete) finish(new Error('PACKAGE_TRANSPORT_FAILED'));
          });
        },
      );
      req.on('error', () => finish(new Error('PACKAGE_TRANSPORT_FAILED')));
      req.end();
    } catch {
      finish(new Error('PACKAGE_TRANSPORT_FAILED'));
    }
  });
}

function entities(text: string): string {
  const known: Record<string, string> = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    aacute: 'á',
    eacute: 'é',
    iacute: 'í',
    oacute: 'ó',
    uacute: 'ú',
    atilde: 'ã',
    otilde: 'õ',
    ccedil: 'ç',
  };
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,10});/gi, (_whole, value: string) => {
    if (!value.startsWith('#')) return known[value.toLowerCase()] ?? ' ';
    const code =
      value[1]?.toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
    return code > 31 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)
      ? String.fromCodePoint(code)
      : ' ';
  });
}

/** Linear bounded text tokenization; scripts, forms, comments and embedded documents are never evaluated. */
function passiveText(html: string): string {
  // ASCII-only folding keeps indices aligned with the original HTML.
  const lower = html.replace(/[A-Z]/g, (character) => character.toLowerCase()),
    chunks: string[] = [];
  let cursor = 0,
    length = 0,
    tags = 0;
  const append = (text: string) => {
    length += text.length;
    if (length > PACKAGE_READER_LIMITS.textBytes) fail('PACKAGE_TEXT_LIMIT');
    chunks.push(text);
  };
  while (cursor < html.length) {
    const at = html.indexOf('<', cursor);
    if (at === -1) {
      append(html.slice(cursor));
      break;
    }
    append(html.slice(cursor, at));
    if (++tags > 30000) fail('PACKAGE_TEXT_LIMIT');
    if (html.startsWith('<!--', at)) {
      const end = html.indexOf('-->', at + 4);
      cursor = end === -1 ? html.length : end + 3;
      continue;
    }
    const end = html.indexOf('>', at + 1);
    if (end === -1 || end - at > 8192) fail('PACKAGE_HTML_REJECTED');
    const tag = /^<\s*(\/?)\s*([a-z0-9]+)/i.exec(html.slice(at, end + 1));
    const name = tag?.[2]?.toLowerCase();
    if (
      name &&
      !tag?.[1] &&
      ['script', 'style', 'noscript', 'template', 'iframe', 'svg', 'form'].includes(name)
    ) {
      const needle = '</' + name;
      let close = lower.indexOf(needle, end + 1),
        closeEnd = -1;
      while (close !== -1) {
        let candidateEnd = close + needle.length;
        while (/[\t\n\f\r ]/.test(lower[candidateEnd] ?? '')) candidateEnd++;
        if (lower[candidateEnd] === '/') {
          candidateEnd++;
          while (/[\t\n\f\r ]/.test(lower[candidateEnd] ?? '')) candidateEnd++;
        }
        if (lower[candidateEnd] === '>') {
          closeEnd = candidateEnd;
          break;
        }
        // Prefixes such as </scripted> are data inside the blocked element.
        close = lower.indexOf(needle, close + needle.length);
      }
      cursor = closeEnd === -1 ? html.length : closeEnd + 1;
      append('\n');
      continue;
    }
    if (
      name &&
      [
        'p',
        'li',
        'div',
        'section',
        'br',
        'h1',
        'h2',
        'h3',
        'tr',
        'td',
        'title',
        'footer',
        'header',
        'article',
      ].includes(name)
    )
      append('\n');
    cursor = end + 1;
  }
  return entities(chunks.join('')).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ');
}

interface Candidate {
  field: 'price' | 'date_text' | 'lodging_nights' | 'breakfast' | 'transport';
  value: unknown;
  status: 'needs_review';
  sourceSpan: { start: number; end: number; scope: 'sanitized_projection_not_original' };
}

/** Internal capture decoding only. Callers must never log or persist the returned HTML. */
export function decodePackageHtml(bytes: Uint8Array) {
  if (
    !bytes ||
    types.isProxy(bytes) ||
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > PACKAGE_READER_LIMITS.responseBytes
  )
    fail('PACKAGE_RESPONSE_LIMIT');
  let html: string;
  const headerEncoding = responseEncodings.get(bytes);
  const preview = Buffer.from(bytes.subarray(0, 8192)).toString('latin1');
  const meta = /<meta\b[^>]{0,512}\bcharset\s*=\s*["']?([a-z0-9_-]{1,30})/i.exec(preview)?.[1];
  const metaEncoding = meta ? encoding(meta) : undefined;
  if (headerEncoding && metaEncoding && headerEncoding !== metaEncoding)
    fail('PACKAGE_ENCODING_REJECTED');
  const sourceEncoding = headerEncoding ?? metaEncoding ?? 'utf-8';
  try {
    html = new TextDecoder(sourceEncoding, { fatal: true }).decode(bytes);
  } catch {
    fail('PACKAGE_HTML_REJECTED');
  }
  if (html.includes('\ufffd')) fail('PACKAGE_ENCODING_REJECTED');
  return { html, sourceEncoding };
}

/** Projection contains allowlisted commercial candidates, never full HTML, contacts or payment instructions. */
export function projectPackageHtml(bytes: Uint8Array, sourceId: string) {
  packageSourceById(sourceId);
  const { html, sourceEncoding } = decodePackageHtml(bytes);
  const text = passiveText(html),
    lines = text.split(/[\r\n]+/);
  const warnings: string[] = [],
    candidates: Candidate[] = [],
    projected: string[] = [];
  let offset = 0;
  const add = (field: Candidate['field'], value: unknown) => {
    const line = field + ': ' + JSON.stringify(value) + '\n';
    if (
      candidates.some(
        (candidate) =>
          candidate.field === field && JSON.stringify(candidate.value) === JSON.stringify(value),
      )
    )
      return;
    if (
      candidates.length >= PACKAGE_READER_LIMITS.candidates ||
      Buffer.byteLength(projected.join('')) + Buffer.byteLength(line) >
        PACKAGE_READER_LIMITS.projectionBytes
    ) {
      if (!warnings.includes('PROJECTION_TRUNCATED')) warnings.push('PROJECTION_TRUNCATED');
      return;
    }
    candidates.push({
      field,
      value,
      status: 'needs_review',
      sourceSpan: {
        start: offset,
        end: offset + line.length - 1,
        scope: 'sanitized_projection_not_original',
      },
    });
    projected.push(line);
    offset += line.length;
  };
  let redactedLines = 0;
  for (const raw of lines) {
    const line = raw.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!line || line.length > 600) continue;
    if (
      /ignore.{0,30}(?:instru|previous)|(?:execute|executar|revele|disclose).{0,30}(?:comando|script|segredo|secret)|system\s*prompt/i.test(
        line,
      )
    ) {
      if (!warnings.includes('PASSIVE_INSTRUCTION_MARKER'))
        warnings.push('PASSIVE_INSTRUCTION_MARKER');
      continue;
    }
    if (
      /@|\b(?:cpf|cnpj|rg|passaporte|passport|nascimento|birthday|whatsapp|telefone|contato|pix|banco|chave|residencial|agência|agencia|conta|cartão|cartao|senha|login|rua|avenida|cep)\b|(?:\+?55[\s()-]*)?\(?\d{2}\)?[\s-]*\d{4,5}[\s-]*\d{4}|\d{3}\.\d{3}\.\d{3}-\d{2}/i.test(
        line,
      )
    ) {
      redactedLines++;
      continue;
    }
    for (const match of line.matchAll(
      /R\$\s*((?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{2})?)(?![\d,.]|\s+\d)/g,
    )) {
      const normalized = match[1]!.replaceAll('.', ''),
        parts = normalized.split(',');
      const amount = BigInt(parts[0]!) * 100n + BigInt(parts[1] ?? '0');
      if (amount > BigInt(Number.MAX_SAFE_INTEGER)) continue;
      const contextLabel = /opcional|passeio|ingresso|catamar|transfer|extra|café/i.test(line)
        ? 'extra_or_activity'
        : /parcela|vezes|\d+\s*x\b/i.test(line)
          ? 'installment_or_payment'
          : /pessoa|investimento|pacote|valor/i.test(line)
            ? 'offer_text_unconfirmed'
            : 'unknown';
      add('price', { amountMinor: Number(amount), currency: 'BRL', unit: 'unknown', contextLabel });
    }
    if (/sa[ií]da|retorno|data|check.?in|check.?out|dezembro|janeiro|natal|réveillon/i.test(line)) {
      for (const match of line.matchAll(/\b\d{1,2}\/\d{1,2}(?:\/\d{4})?\b/g))
        add('date_text', match[0]);
    }
    for (const match of line.matchAll(/\b(\d{1,2})\s*(?:noites|di[aá]rias)\b/gi))
      add('lodging_nights', Number(match[1]));
    if (/caf[eé](?:s)?\s+(?:da\s+)?manh[ãa]/i.test(line))
      add(
        'breakfast',
        /n[ãa]o\s+inclu|n[ãa]o\s+inclus|\bsem\b|exclu|por\s+fora|extra|[àa]\s+parte/i.test(line)
          ? 'excluded_candidate'
          : /inclu|inclus|\bcom\b/i.test(line)
            ? 'included_candidate'
            : 'unknown',
      );
    if (/\b[ôo]nibus\b/i.test(line)) add('transport', 'bus_mentioned');
    if (/\ba[eé]reo|\bavi[ãa]o\b/i.test(line)) add('transport', 'air_mentioned');
  }
  const projectionText = projected.join('');
  if (
    candidates.some(
      ({ field, value }) => field === 'breakfast' && value === 'included_candidate',
    ) &&
    candidates.some(({ field, value }) => field === 'breakfast' && value === 'excluded_candidate')
  )
    warnings.push('BREAKFAST_CANDIDATES_CONFLICT');
  return {
    sourceEncoding,
    projection: {
      text: projectionText,
      sha256: createHash('sha256').update(projectionText).digest('hex'),
      spanUnits: 'UTF-16 code units',
      scope: 'sanitized_projection_not_original',
    },
    candidates,
    priceCandidates: candidates.filter(({ field }) => field === 'price'),
    packagePrice: null,
    breakfastAssessment: 'unknown',
    yearConfirmed: false,
    availabilityConfirmed: false,
    manualReviewRequired: true,
    redactedLines,
    warnings,
    interpretation: 'passive_data_not_instructions',
  };
}

export async function capturePackageSource(
  rawInput: unknown,
  policy: unknown,
  transport: PackageTransport = readPackageHtml,
) {
  validatePassive(captureSchema, rawInput);
  validatePassive(policySchema, policy);
  const input = rawInput as { sourceId: string };
  const source = packageSourceById(input.sourceId);
  if ((policy as { allowNetwork: boolean }).allowNetwork !== true)
    fail('PACKAGE_NETWORK_NOT_APPROVED');
  const url = packageSourceUrl(source.id);
  const bytes = await transport(url);
  const projection = projectPackageHtml(bytes, source.id);
  return {
    sourceId: source.id,
    providerId: source.providerId,
    sourceUrl: source.browserUrl,
    observedAt: new Date().toISOString(),
    responseSha256: createHash('sha256').update(bytes).digest('hex'),
    responseDigestScope: 'decoded_html_body_bytes_not_persisted',
    responseByteLength: bytes.byteLength,
    ...projection,
    factsVerified: false,
    effects: {
      networkRequests: 1,
      modelCalls: 0,
      supplierAccounts: 0,
      filesystemWrites: 0,
      automaticRetries: 0,
    },
    limitation:
      'Heuristic candidates require manual review. A price can be an extra or installment; neither the first nor the lowest price is selected. Hashes do not authenticate providers or establish facts.',
  };
}
