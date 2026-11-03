import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const prefix = 'travel-test-isolation-';
const ownership = new WeakMap();

/** Inspect marker metadata only; never read an ancestor repository's contents. */
export function inspectTemporaryRoot(candidate) {
  if (typeof candidate !== 'string' || !isAbsolute(candidate) || /^[\\/]{2}/.test(candidate))
    throw new Error('TEST_TEMP_ROOT_INVALID');
  const normalized = resolve(candidate);
  if (normalized === parse(normalized).root) throw new Error('TEST_TEMP_ROOT_INVALID');
  let current = normalized;
  let existing;
  for (;;) {
    try {
      const status = lstatSync(current);
      if (!status.isDirectory() || status.isSymbolicLink()) throw new Error('TEST_TEMP_ROOT_LINK');
      existing ??= current;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    try {
      lstatSync(join(current, '.git'));
      throw new Error('TEST_TEMP_ROOT_IN_GIT');
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (!existing) throw new Error('TEST_TEMP_ROOT_UNAVAILABLE');
  // Canonicalize existing ancestors as well, so a drive/path alias cannot hide Git.
  const physical = realpathSync(existing);
  if (physical.toLowerCase() !== resolve(existing).toLowerCase()) inspectTemporaryRoot(physical);
  return normalized;
}

/** TEMP changes belong only to the child test process and its descendants. */
export function createTestIsolation(options = {}) {
  const environment = options.environment ?? process.env;
  const override = environment.TRAVEL_TEST_TEMP_ROOT;
  const defaultRoot = options.defaultRoot ?? tmpdir();
  const fallbackRoot =
    options.fallbackRoot ?? join(parse(projectRoot).root, 'TravelReliability-SyntheticTests');
  const candidates = override
    ? [{ root: override, source: 'operator' }]
    : [
        { root: defaultRoot, source: 'os-temp' },
        { root: fallbackRoot, source: 'project-volume' },
      ];
  let base;
  let source;
  for (const candidate of candidates) {
    try {
      const checked = inspectTemporaryRoot(candidate.root);
      mkdirSync(checked, { recursive: true, mode: 0o700 });
      base = realpathSync(checked);
      inspectTemporaryRoot(base);
      source = candidate.source;
      break;
    } catch {
      if (override) throw new Error('TRAVEL_TEST_TEMP_ROOT_UNSAFE');
    }
  }
  if (!base) throw new Error('TEST_TEMP_UNAVAILABLE_SET_TRAVEL_TEST_TEMP_ROOT_OUTSIDE_GIT');
  const root = realpathSync(mkdtempSync(join(base, prefix)));
  const marker = randomUUID();
  const status = lstatSync(root);
  writeFileSync(join(root, '.travel-test-owner'), marker, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  const isolation = Object.freeze({
    root,
    source,
    environment: Object.freeze({ ...environment, TEMP: root, TMP: root, TMPDIR: root }),
  });
  ownership.set(isolation, { root, base, marker, device: status.dev, inode: status.ino });
  return isolation;
}

/** Remove only a newly allocated directory whose identity and marker still match. */
export function cleanupTestIsolation(isolation) {
  const owned = ownership.get(isolation);
  if (!owned) throw new Error('TEST_TEMP_CLEANUP_NOT_OWNED');
  const status = lstatSync(owned.root);
  const markerPath = join(owned.root, '.travel-test-owner');
  const markerStatus = lstatSync(markerPath);
  if (
    status.isSymbolicLink() ||
    !status.isDirectory() ||
    status.dev !== owned.device ||
    status.ino !== owned.inode ||
    realpathSync(owned.root) !== owned.root ||
    dirname(owned.root) !== owned.base ||
    !basename(owned.root).startsWith(prefix) ||
    markerStatus.isSymbolicLink() ||
    !markerStatus.isFile() ||
    markerStatus.nlink !== 1 ||
    markerStatus.size !== Buffer.byteLength(owned.marker) ||
    readFileSync(markerPath, 'utf8') !== owned.marker
  )
    throw new Error('TEST_TEMP_CLEANUP_SCOPE_REJECTED');
  rmSync(owned.root, { recursive: true, force: false, maxRetries: 3, retryDelay: 100 });
  ownership.delete(isolation);
}

export async function runTests(args = [], options = {}) {
  const isolation = createTestIsolation(options);
  const timeoutMs = Number(
    options.environment?.TRAVEL_TEST_TIMEOUT_MS ?? process.env.TRAVEL_TEST_TIMEOUT_MS ?? 1_200_000,
  );
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3_600_000) {
    cleanupTestIsolation(isolation);
    throw new Error('INVALID_TEST_RUN_TIMEOUT');
  }
  const entry = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url));
  let child;
  let interrupted = false;
  const terminate = () => {
    interrupted = true;
    if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
      if (!systemRoot) throw new Error('TEST_PROCESS_TERMINATION_UNAVAILABLE');
      spawnSync(
        join(systemRoot, 'System32', 'taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        {
          windowsHide: true,
          shell: false,
          stdio: 'ignore',
          timeout: 10000,
        },
      );
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (error) {
        if (error?.code !== 'ESRCH') throw error;
      }
    }
  };
  process.once('SIGINT', terminate);
  process.once('SIGTERM', terminate);
  const timer = setTimeout(terminate, timeoutMs);
  timer.unref();
  try {
    return await new Promise((fulfill, reject) => {
      const boundedArgs = args.some(
        (arg) => arg === '--maxWorkers' || arg.startsWith('--maxWorkers='),
      )
        ? args
        : ['--maxWorkers=2', ...args];
      child = spawn(process.execPath, [entry, 'run', ...boundedArgs], {
        cwd: projectRoot,
        env: isolation.environment,
        stdio: 'inherit',
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32',
      });
      child.once('error', () => reject(new Error('TEST_PROCESS_START_FAILED')));
      child.once('exit', (code) => fulfill(interrupted ? 130 : (code ?? 1)));
    });
  } finally {
    clearTimeout(timer);
    process.removeListener('SIGINT', terminate);
    process.removeListener('SIGTERM', terminate);
    cleanupTestIsolation(isolation);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    process.exitCode = await runTests(process.argv.slice(2));
  } catch (error) {
    const code = /^[A-Z0-9_]+$/.test(error?.message ?? '')
      ? error.message
      : 'TEST_ISOLATION_FAILED';
    console.error(JSON.stringify({ status: 'FAIL', error: code }));
    process.exitCode = 1;
  }
}
