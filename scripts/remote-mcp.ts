import { createRemoteHttpServer, remoteConfig } from '../agent/remote-mcp.js';
import { sharedRemoteQuota } from '../agent/remote-quota.js';

async function start(): Promise<void> {
  const config = remoteConfig(process.env);
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  const cloud = Boolean(process.env.K_SERVICE);
  const connection = process.env.TRAVEL_MCP_QUOTA_REDIS;
  if (cloud && (!connection || !process.env.TRAVEL_MCP_QUOTA_NAMESPACE))
    throw new Error('REMOTE_SHARED_QUOTA_REQUIRED');
  const quota = connection
    ? sharedRemoteQuota(connection, process.env.TRAVEL_MCP_QUOTA_NAMESPACE ?? 'local')
    : undefined;
  await quota?.start();
  const server = createRemoteHttpServer(config, { quota: quota?.consume });
  const stop = () => {
    server.close();
    quota?.close();
  };
  server.listen(port, '0.0.0.0');
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

try {
  await start();
} catch {
  process.stderr.write('REMOTE_MCP_START_FAILED\n');
  process.exit(1);
}
