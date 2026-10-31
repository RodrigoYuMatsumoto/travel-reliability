import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { AppError } from '../api/src/errors.js';
import { validateBookingObservations, type BookingObservation } from './connectors.js';

/** Local reviewed Python parser. Raw mail and HMAC key travel only over a pipe. */
export function createLocalEmailNormalizer(options: {
  providerKey: string;
  referenceSecret: Uint8Array;
  timeoutMs?: number;
  /** Trusted operator configuration only. Never a document or MCP argument. */
  interpreterPath?: string;
}) {
  if (
    !/^[a-z][a-z0-9-]{1,39}$/.test(options.providerKey) ||
    options.referenceSecret.byteLength < 32 ||
    options.referenceSecret.byteLength > 128
  )
    throw new AppError('INVALID_EMAIL_NORMALIZER_CONFIG', 422);
  const providerKey = options.providerKey,
    secret = Buffer.from(options.referenceSecret);
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
    throw new AppError('INVALID_EMAIL_NORMALIZER_CONFIG', 422);
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
  let interpreter: string;
  try {
    if (
      !isAbsolute(configuredInterpreter) ||
      /^[\\/]{2}/.test(configuredInterpreter) ||
      (process.platform === 'win32' && !/^[A-Za-z]:[\\/]/.test(configuredInterpreter))
    )
      throw new Error('UNTRUSTED_INTERPRETER');
    const resolved = realpathSync(configuredInterpreter);
    if (!statSync(resolved).isFile()) throw new Error('UNTRUSTED_INTERPRETER');
    // Preserve the absolute venv entrypoint: resolving its symlink for execution
    // would lose pyvenv.cfg/site-packages on POSIX. No cwd/PATH lookup occurs.
    interpreter = configuredInterpreter;
  } catch {
    throw new AppError('EMAIL_RUNTIME_NOT_PREPARED', 503);
  }
  // Python -I removes cwd/PYTHONPATH; only this reviewed package directory is added.
  const bootstrap = `import sys,runpy; sys.path.insert(0, ${JSON.stringify(directory)}); runpy.run_module('travel_ingest.email_import',run_name='__main__')`;
  return async (
    raw: Uint8Array,
    context: { recordKey: string; sourceRef: string; signal?: AbortSignal },
  ): Promise<BookingObservation[]> => {
    if (
      !raw.byteLength ||
      raw.byteLength > 524288 ||
      !/^[A-Z][A-Z0-9_-]{1,39}$/.test(context.recordKey) ||
      !/^SRC[0-9]{2,6}$/.test(context.sourceRef)
    )
      throw new AppError('EMAIL_INPUT_REJECTED', 422);
    if (context.signal?.aborted) throw new AppError('EMAIL_NORMALIZER_CANCELLED', 422);
    const input = JSON.stringify({
      rawBase64: Buffer.from(raw).toString('base64'),
      recordKey: context.recordKey,
      sourceRef: context.sourceRef,
      providerKey,
      referenceSecretBase64: secret.toString('base64'),
      observedAt: new Date().toISOString(),
    });
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {
        PYTHONIOENCODING: 'utf-8',
        PYTHONDONTWRITEBYTECODE: '1',
      };
      for (const [key, value] of Object.entries(process.env))
        if (/^(?:systemroot|windir|temp|tmp|tmpdir)$/i.test(key)) env[key] = value;
      const child = spawn(interpreter, ['-I', '-B', '-c', bootstrap], {
        cwd: directory,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        shell: false,
      });
      let output = '',
        outputBytes = 0,
        finished = false;
      const finish = (value?: BookingObservation[]) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        context.signal?.removeEventListener('abort', cancel);
        if (value) resolve(value);
        else {
          child.kill();
          reject(new AppError('EMAIL_NORMALIZATION_REJECTED', 422));
        }
      };
      const cancel = () => {
        child.kill();
        finish();
      };
      const timer = setTimeout(cancel, timeoutMs);
      context.signal?.addEventListener('abort', cancel, { once: true });
      child.stderr.on('data', () => {}); // Never echo dependency or parser diagnostics into the LLM.
      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > 32768) {
          cancel();
          return;
        }
        output += chunk.toString('utf8');
      });
      child.on('error', () => finish());
      child.stdin.on('error', () => finish());
      child.on('close', (code) => {
        if (code !== 0) {
          finish();
          return;
        }
        try {
          const packet = JSON.parse(output) as {
            observation?: BookingObservation;
            rawContentReturned?: boolean;
          };
          if (
            !packet.observation ||
            packet.rawContentReturned !== false ||
            packet.observation.recordKey !== context.recordKey ||
            packet.observation.sourceRef !== context.sourceRef ||
            packet.observation.origin !== 'email_claim'
          ) {
            finish();
            return;
          }
          finish(validateBookingObservations([packet.observation]));
        } catch {
          finish();
        }
      });
      child.stdin.end(input);
    });
  };
}
