import { buildApp } from './app.js';
import { loadConfig } from './config.js';
const config = loadConfig();
const { app } = await buildApp(config);
await app.listen({ port: config.port, host: config.host });
console.log(
  JSON.stringify({
    event: 'server.started',
    mode: config.mode,
    port: config.port,
    version: '0.1.0',
  }),
);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, async () => {
    await app.close();
    process.exit(0);
  });
