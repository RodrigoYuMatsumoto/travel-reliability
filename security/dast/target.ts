import { buildApp } from '../../api/src/app.js';
import { loadConfig } from '../../api/src/config.js';
const { app } = await buildApp(
  loadConfig({
    APP_MODE: 'demo',
    HOST: '127.0.0.1',
    PORT: '4399',
    PUBLIC_URL: 'http://127.0.0.1:4399',
    LLM_ENABLED: 'false',
    ALLOW_DEMO_EXTERNAL_STORES: 'false',
  }),
);
// Instrumentation exists only in this disposable target, never in the product API.
const auditStats = { totalRequests: 0, activeRequests: 0, statuses: {} as Record<string, number> };
app.addHook('onRequest', async (request) => {
  if (request.url === '/__audit_stats') return;
  auditStats.totalRequests++;
  const scanId = request.headers['x-zap-scan-id'];
  if (typeof scanId === 'string' && /^\d{1,10}$/.test(scanId)) auditStats.activeRequests++;
});
app.addHook('onResponse', async (request, reply) => {
  if (request.url === '/__audit_stats') return;
  const status = String(reply.statusCode);
  auditStats.statuses[status] = (auditStats.statuses[status] ?? 0) + 1;
});
app.get('/__audit_stats', async () => auditStats);
await app.listen({ host: '127.0.0.1', port: 4399 });
console.log('Isolated synthetic DAST target ready on loopback:4399');
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.once(event, async () => {
    await app.close();
    process.exit(0);
  });
