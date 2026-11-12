import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { types } from 'node:util';
import { gunzipSync } from 'node:zlib';
import type { LookupAddress } from 'node:dns';
import { publicIpv4 } from './public-sources.js';
import { packageReferenceCatalog } from './package-sources.js';
import { AppError } from '../api/src/errors.js';

export const PACKAGE_READER_LIMITS = Object.freeze({
  responseBytes: 1_000_000,
  dnsMs: 4000,
  httpMs: 10000,
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
