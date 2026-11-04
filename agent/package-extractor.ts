import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { AppError } from '../api/src/errors.js';
import {
  packageObservationSchema,
  packageSites,
  type PackageObservation,
} from '../schema/src/package-observation.js';

/**
 * Bridge from Node.js to the isolated Python package extractor
 * (ingest/travel_ingest/packages). The page travels only over a pipe, the
 * interpreter runs with -I and a minimal environment, there is no network
 * access and the result is validated against the shared contract before use.
 */
export const PACKAGE_EXTRACTOR_LIMITS = {
  htmlBytes: 200 * 1024,
  outputBytes: 128 * 1024,
  listingItems: 60,
} as const;

export interface PackageListingItem {
  url: string;
  title: string | null;
  departureDate: string | null;
  priceFromMinor: number | null;
}

export interface PackageExtractionRequest {
  html: string;
  url: string;
  observedAt: string;
  retrieval: 'fixture' | 'static_html' | 'rendered_dom';
  site?: (typeof packageSites)[number];
  mode: 'detail' | 'listing';
}

const ajv = new Ajv2020({
  allErrors: false,
  strict: true,
  coerceTypes: false,
  ownProperties: true,
});
(addFormats as unknown as (a: Ajv2020) => void)(ajv);
const validateObservation = ajv.compile<PackageObservation>(packageObservationSchema);
const listingItemSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['url', 'title', 'departureDate', 'priceFromMinor'],
  properties: {
    url: { type: 'string', pattern: '^https://', maxLength: 2048 },
    title: { anyOf: [{ type: 'string', minLength: 1, maxLength: 300 }, { type: 'null' }] },
    departureDate: {
      anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }],
    },
    priceFromMinor: {
      anyOf: [{ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER }, { type: 'null' }],
    },
  },
};
const validateListing = ajv.compile<PackageListingItem[]>({
  type: 'array',
  maxItems: PACKAGE_EXTRACTOR_LIMITS.listingItems,
  items: listingItemSchema,
});

const BOOTSTRAP = (directory: string) =>
  [
    'import sys, json',
    `sys.path.insert(0, ${JSON.stringify(directory)})`,
    'from travel_ingest.packages import parse_package, parse_listing',
    // -I ignores PYTHONIOENCODING, so bytes are decoded and encoded explicitly as UTF-8.
    "request = json.loads(sys.stdin.buffer.read().decode('utf-8'))",
    'try:',
    "    action = parse_listing if request['mode'] == 'listing' else parse_package",
    "    value = action(request['html'], url=request['url'], observed_at=request['observedAt'], retrieval=request['retrieval'], site=request.get('site'))",
    "    sys.stdout.buffer.write(json.dumps({'result': value}, sort_keys=True, ensure_ascii=False).encode('utf-8'))",
    'except Exception as error:',
    "    code = getattr(error, 'code', None) or (error.args[0] if error.args and isinstance(error.args[0], str) else None)",
    "    sys.stdout.buffer.write(json.dumps({'error': code if isinstance(code, str) else None}).encode('utf-8'))",
  ].join('\n');

export function createPackageExtractor(
  options: {
    timeoutMs?: number;
    /** Trusted operator configuration only. MCP retains the default 200 KiB boundary. */
    maxHtmlBytes?: number;
    /** Trusted operator configuration only. Never a page, document or MCP argument. */
    interpreterPath?: string;
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxHtmlBytes = options.maxHtmlBytes ?? PACKAGE_EXTRACTOR_LIMITS.htmlBytes;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 60000 ||
    !Number.isInteger(maxHtmlBytes) ||
    maxHtmlBytes < 1 ||
    maxHtmlBytes > 1_000_000
  )
    throw new AppError('INVALID_PACKAGE_EXTRACTOR_CONFIG', 422);
  const directory = fileURLToPath(new URL('../ingest/', import.meta.url));
  const configuredInterpreter =
    options.interpreterPath ??
    fileURLToPath(
      new URL(
        process.platform === 'win32'
          ? '../ingest/.venv/Scripts/python.exe'
          : '../ingest/.venv/bin/python',
        import.meta.url,
      ),
    );
  const interpreter = () => {
    try {
      if (
        !isAbsolute(configuredInterpreter) ||
        /^[\\/]{2}/.test(configuredInterpreter) ||
        (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(configuredInterpreter))
      )
        throw new Error('UNTRUSTED_INTERPRETER');
      if (!statSync(realpathSync(configuredInterpreter)).isFile())
        throw new Error('UNTRUSTED_INTERPRETER');
      return configuredInterpreter;
    } catch {
      throw new AppError('PACKAGE_EXTRACTOR_NOT_PREPARED', 503);
    }
  };

  return async (
    request: PackageExtractionRequest,
    signal?: AbortSignal,
  ): Promise<PackageObservation | PackageListingItem[]> => {
    if (
      typeof request.html !== 'string' ||
      !request.html.length ||
      Buffer.byteLength(request.html) > maxHtmlBytes
    )
      throw new AppError('PACKAGE_HTML_REJECTED', 422);
    if (!/^https:\/\//.test(request.url) || request.url.length > 2048)
      throw new AppError('PACKAGE_URL_REJECTED', 422);
    if (/(^|\.)instagram\.com$/i.test(new URL(request.url).hostname))
      throw new AppError('INSTAGRAM_NOT_SUPPORTED', 422);
    if (!Number.isFinite(Date.parse(request.observedAt)))
      throw new AppError('INVALID_TIMESTAMP', 422);
    if (signal?.aborted) throw new AppError('PACKAGE_EXTRACTION_CANCELLED', 422);
    const executable = interpreter();
    const input = JSON.stringify({
      html: request.html,
      url: request.url,
      observedAt: request.observedAt,
      retrieval: request.retrieval,
      site: request.site ?? null,
      mode: request.mode,
    });
    const packet = await new Promise<{ result?: unknown; error?: unknown }>((resolve, reject) => {
      const env: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
      for (const [key, value] of Object.entries(process.env))
        if (/^(?:systemroot|windir|temp|tmp|tmpdir)$/i.test(key)) env[key] = value;
      const child = spawn(executable, ['-I', '-B', '-c', BOOTSTRAP(directory)], {
        cwd: directory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
      const output: Buffer[] = [];
      let outputBytes = 0,
        finished = false;
      const finish = (value?: { result?: unknown; error?: unknown }) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
        if (value) resolve(value);
        else {
          child.kill();
          reject(new AppError('PACKAGE_EXTRACTION_REJECTED', 422));
        }
      };
      const cancel = () => {
        child.kill();
        finish();
      };
      const timer = setTimeout(cancel, timeoutMs);
      signal?.addEventListener('abort', cancel, { once: true });
      child.stderr.on('data', () => {}); // Parser diagnostics never reach the LLM.
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > PACKAGE_EXTRACTOR_LIMITS.outputBytes) {
          cancel();
          return;
        }
        output.push(chunk); // Decoded once at close so multi-byte characters never split.
      });
      child.on('error', () => finish());
      child.stdin.on('error', () => finish());
      child.on('close', (code) => {
        if (code !== 0) return finish();
        try {
          finish(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output))),
          );
        } catch {
          finish();
        }
      });
      child.stdin.end(input);
    });
    if (packet.error !== undefined) {
      const code = packet.error;
      throw new AppError(
        typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)
          ? code
          : 'PACKAGE_EXTRACTION_FAILED',
        422,
      );
    }
    if (request.mode === 'listing') {
      if (!validateListing(packet.result)) throw new AppError('PACKAGE_LISTING_INVALID', 422);
      return packet.result;
    }
    if (!validateObservation(packet.result)) throw new AppError('PACKAGE_OBSERVATION_INVALID', 422);
    if (packet.result.source.url !== request.url)
      throw new AppError('PACKAGE_OBSERVATION_INVALID', 422);
    return packet.result;
  };
}
