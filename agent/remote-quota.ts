import Redis from 'ioredis';

// Increment both counters atomically so independent service instances share one ceiling.
const consume = `
local total = tonumber(redis.call('HGET', KEYS[1], 'total') or '0')
local personal = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
if total >= 240 or personal >= 30 then return 0 end
redis.call('HINCRBY', KEYS[1], 'total', 1)
redis.call('HINCRBY', KEYS[1], ARGV[1], 1)
redis.call('EXPIRE', KEYS[1], 120)
return 1
`;

export function sharedRemoteQuota(connection: string, namespace: string) {
  const url = new URL(connection);
  if (!['rediss:', 'redis:'].includes(url.protocol) || !/^[a-z0-9-]{1,32}$/.test(namespace))
    throw new Error('REMOTE_QUOTA_CONFIGURATION_REQUIRED');
  const client = new Redis(url.href, {
    lazyConnect: true,
    connectTimeout: 2000,
    commandTimeout: 2000,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => Math.min(1000 * attempt, 10_000),
  });
  // Connection failures must not be reflected in logs with endpoint credentials.
  client.on('error', () => {});
  return {
    start: () => client.connect(),
    consume: async (principal: string) => {
      const key = 'travel-mcp:quota:' + namespace + ':' + Math.floor(Date.now() / 60_000);
      return (await client.eval(consume, 1, key, principal)) === 1;
    },
    close: () => client.disconnect(),
  };
}
