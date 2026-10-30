import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const demo = process.argv.includes('--demo');
const apiEnvironment = demo
  ? {
      ...process.env,
      APP_MODE: 'demo',
      HOST: '127.0.0.1',
      PORT: '4310',
      PUBLIC_URL: 'http://127.0.0.1:4310',
      LLM_ENABLED: 'false',
      INGEST_URL: '',
      ALLOW_DEMO_EXTERNAL_STORES: 'false',
    }
  : { ...process.env, APP_MODE: process.env.APP_MODE ?? 'demo' };
const processes = [
  spawn(process.execPath, [resolve('node_modules/tsx/dist/cli.mjs'), 'api/src/server.ts'], {
    stdio: 'inherit',
    env: apiEnvironment,
  }),
  spawn(
    process.execPath,
    [resolve('node_modules/vite/bin/vite.js'), '--config', 'web/vite.config.ts'],
    { stdio: 'inherit' },
  ),
];
function stop() {
  for (const child of processes) child.kill();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    stop();
    process.exit(0);
  });
for (const child of processes)
  child.once('exit', (code) => {
    stop();
    process.exit(code ?? 1);
  });
