import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const options = new Set(process.argv.slice(2));
const allowed = new Set(['--check', '--install-only', '--no-browser', '--no-pause']);
const url = 'http://127.0.0.1:5173';
const children = new Set();
let stopping = false;
const exists = async (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const fail = (code) => {
  throw new Error(code);
};

async function state() {
  if ([...options].some((option) => !allowed.has(option))) fail('UNKNOWN_OPTION');
  if (Number(process.versions.node.split('.')[0]) !== 24) fail('NODE_24_REQUIRED');
  const packageFile = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (packageFile.name !== 'travel-reliability') fail('PROJECT_FILES_MISSING');
  for (const file of ['api/src/server.ts', 'web/vite.config.ts'])
    if (!(await exists(join(root, file)))) fail('PROJECT_FILES_MISSING');
  const lock = await readFile(join(root, 'package-lock.json'));
  const fingerprint = createHash('sha256')
    .update(lock)
    .update(JSON.stringify(packageFile.dependencies))
    .update(JSON.stringify(packageFile.devDependencies))
    .update(process.platform)
    .update(process.arch)
    .digest('hex');
  let marker;
  try {
    marker = JSON.parse(await readFile(join(root, '.local/demo-install.json'), 'utf8'));
  } catch {
    /* First install or a missing marker. */
  }
  const ready =
    marker?.fingerprint === fingerprint &&
    (await exists(join(root, 'node_modules/tsx/dist/cli.mjs'))) &&
    (await exists(join(root, 'node_modules/vite/bin/vite.js')));
  return { fingerprint, ready };
}

async function runNpmCi() {
  const spawnOptions = { cwd: root, stdio: 'inherit', shell: false };
  let child;
  if (process.platform === 'win32') {
    const npm = join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
    if (!(await exists(npm))) fail('NPM_NOT_FOUND_WITH_NODE_INSTALLATION');
    child = spawn(process.execPath, [npm, 'ci'], spawnOptions);
  } else child = spawn('npm', ['ci'], spawnOptions);
  return new Promise((resolve, reject) => {
    child.once('error', () => reject(new Error('PROCESS_START_FAILED')));
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('DEPENDENCY_INSTALL_FAILED')),
    );
  });
}

async function install(fingerprint) {
  console.log(
    'Installing locked demo dependencies in the project directory. First use needs internet.',
  );
  await runNpmCi();
  await mkdir(join(root, '.local'), { recursive: true });
  await writeFile(
    join(root, '.local/demo-install.json'),
    JSON.stringify({ fingerprint, nodeMajor: 24 }) + '\n',
  );
}

function available(port) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`PORT_UNAVAILABLE_${port}`)));
    probe.listen({ host: '127.0.0.1', port, exclusive: true }, () => probe.close(resolve));
  });
}

function demoEnvironment() {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (
      /^(?:S3_|OIDC_|LLM_)/.test(name) ||
      ['DATABASE_URL', 'REDIS_URL', 'ENCRYPTION_KEY_BASE64', 'INGEST_URL'].includes(name)
    )
      delete env[name];
  return {
    ...env,
    APP_MODE: 'demo',
    HOST: '127.0.0.1',
    PORT: '4310',
    PUBLIC_URL: 'http://127.0.0.1:4310',
    LLM_ENABLED: 'false',
    INGEST_URL: '',
    ALLOW_DEMO_EXTERNAL_STORES: 'false',
  };
}

function start(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit', shell: false });
  children.add(child);
  child.once('error', () => {
    console.error('DEMO_PROCESS_START_FAILED');
    stop(1);
  });
  child.once('exit', (code) => {
    children.delete(child);
    if (!stopping) stop(code ?? 1);
  });
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}

async function boundedText(address, limit) {
  const response = await fetch(address, { redirect: 'error', signal: AbortSignal.timeout(2000) });
  if (response.status !== 200 || !response.body) fail('DEMO_NOT_READY');
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(parts).toString('utf8');
      size += value.byteLength;
      if (size > limit) fail('DEMO_RESPONSE_LIMIT');
      parts.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (stopping) return false;
    try {
      const health = JSON.parse(await boundedText('http://127.0.0.1:4310/health', 8192));
      const html = await boundedText(url, 131072);
      if (
        health.status === 'ok' &&
        health.mode === 'demo' &&
        health.persistence === 'ephemeral' &&
        health.llmEnabled === false &&
        html.includes('<title>Travel Reliability</title>')
      )
        return true;
    } catch {
      /* Services may still be starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

function openBrowser() {
  let program = 'xdg-open',
    args = [url];
  if (process.platform === 'win32') {
    program = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/rundll32.exe');
    args = ['url.dll,FileProtocolHandler', url];
  } else if (process.platform === 'darwin') program = 'open';
  const opener = spawn(program, args, { stdio: 'ignore', shell: false, windowsHide: true });
  opener.once('error', () => console.log(`Open the browser manually: ${url}`));
  opener.unref();
}

try {
  const dependencyState = await state();
  if (options.has('--check'))
    console.log(
      JSON.stringify({
        project: 'travel-reliability',
        nodeMajor: 24,
        dependencies: dependencyState.ready ? 'ready' : 'install_required',
        interface: url,
        storage: 'temporary_demo',
        modelCalls: 0,
      }),
    );
  else {
    // Never rewrite dependencies while another local server may be using them.
    if (!options.has('--install-only') || !dependencyState.ready)
      await Promise.all([available(4310), available(5173)]);
    if (!dependencyState.ready) await install(dependencyState.fingerprint);
    if (options.has('--install-only')) console.log('Demo dependencies are ready.');
    else {
      await Promise.all([available(4310), available(5173)]);
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => stop(0));
      const env = demoEnvironment();
      start(['--import', 'tsx', join(root, 'api/src/server.ts')], env);
      start(
        [
          join(root, 'node_modules/vite/bin/vite.js'),
          '--config',
          join(root, 'web/vite.config.ts'),
          '--host',
          '127.0.0.1',
        ],
        env,
      );
      if (!(await ready())) {
        if (!stopping) console.error('DEMO_START_TIMEOUT');
        stop(1);
      } else if (!stopping) {
        console.log(
          `READY: ${url}\nSynthetic, temporary demo. Keep this window open; Ctrl+C stops both services.`,
        );
        if (!options.has('--no-browser')) openBrowser();
      }
    }
  }
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
      ? error.message
      : 'BOOTSTRAP_FAILED';
  console.error(
    `${code}\nSee docs/INSTALLATION.md. Node.js 24: https://nodejs.org/download/release/latest-v24.x/`,
  );
  stop(1);
}
