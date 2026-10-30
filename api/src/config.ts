import { randomBytes } from 'node:crypto';
export interface Config {
  mode: 'demo' | 'production';
  host: string;
  port: number;
  publicUrl: string;
  key: Buffer;
  retentionDays: number;
  databaseUrl?: string;
  redisUrl?: string;
  s3Endpoint?: string;
  s3Region: string;
  s3Bucket?: string;
  s3AccessKey?: string;
  s3SecretKey?: string;
  oidcIssuer?: string;
  oidcClientId?: string;
  oidcClientSecret?: string;
  ingestUrl?: string;
  llmEnabled: boolean;
  llmBaseUrl?: string;
  llmModel?: string;
  llmApiKey?: string;
}
export function loadConfig(env = process.env): Config {
  if (env.APP_MODE && !['demo', 'production'].includes(env.APP_MODE))
    throw new Error('Unknown APP_MODE');
  const mode = env.APP_MODE === 'production' ? 'production' : 'demo';
  const externalStores = mode === 'production' || env.ALLOW_DEMO_EXTERNAL_STORES === 'true';
  const config: Config = {
    mode,
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 4310),
    publicUrl: env.PUBLIC_URL ?? 'http://127.0.0.1:4310',
    key: env.ENCRYPTION_KEY_BASE64
      ? Buffer.from(env.ENCRYPTION_KEY_BASE64, 'base64')
      : randomBytes(32),
    retentionDays: Number(env.EVIDENCE_RETENTION_DAYS || 90),
    databaseUrl: externalStores ? env.DATABASE_URL || undefined : undefined,
    redisUrl: externalStores ? env.REDIS_URL || undefined : undefined,
    s3Endpoint: externalStores ? env.S3_ENDPOINT || undefined : undefined,
    s3Region: env.S3_REGION || 'us-east-1',
    s3Bucket: externalStores ? env.S3_BUCKET || undefined : undefined,
    s3AccessKey: externalStores ? env.S3_ACCESS_KEY_ID || undefined : undefined,
    s3SecretKey: externalStores ? env.S3_SECRET_ACCESS_KEY || undefined : undefined,
    oidcIssuer: env.OIDC_ISSUER || undefined,
    oidcClientId: env.OIDC_CLIENT_ID || undefined,
    oidcClientSecret: env.OIDC_CLIENT_SECRET || undefined,
    ingestUrl: env.INGEST_URL || undefined,
    llmEnabled: env.LLM_ENABLED === 'true',
    llmBaseUrl: env.LLM_BASE_URL,
    llmModel: env.LLM_MODEL,
    llmApiKey: env.LLM_API_KEY,
  };
  if (
    !Number.isInteger(config.port) ||
    config.port < 1 ||
    config.port > 65535 ||
    config.key.length !== 32
  )
    throw new Error('Invalid application configuration');
  if (
    !Number.isInteger(config.retentionDays) ||
    config.retentionDays < 1 ||
    config.retentionDays > 3650
  )
    throw new Error('Invalid evidence retention policy');
  const publicOrigin = new URL(config.publicUrl);
  if (
    publicOrigin.username ||
    publicOrigin.password ||
    publicOrigin.search ||
    publicOrigin.hash ||
    publicOrigin.pathname !== '/'
  )
    throw new Error('PUBLIC_URL must be an origin without credentials, path, query or fragment');
  config.publicUrl = publicOrigin.origin;
  if (
    mode === 'demo' &&
    !['127.0.0.1', 'localhost', '::1'].includes(config.host) &&
    env.ALLOW_PUBLIC_DEMO !== 'true'
  )
    throw new Error('Public demo requires explicit ALLOW_PUBLIC_DEMO=true');
  if (mode === 'production') {
    const required = [
      'DATABASE_URL',
      'REDIS_URL',
      'S3_BUCKET',
      'ENCRYPTION_KEY_BASE64',
      'OIDC_ISSUER',
      'OIDC_CLIENT_ID',
      'OIDC_CLIENT_SECRET',
      'INGEST_URL',
    ];
    if (required.some((key) => !env[key]) || publicOrigin.protocol !== 'https:')
      throw new Error(
        'Production requires HTTPS, durable stores, encryption, isolated ingest and OIDC',
      );
  }
  if (
    config.llmEnabled &&
    (!config.llmBaseUrl?.startsWith('https://') || !config.llmModel || !config.llmApiKey)
  )
    throw new Error('LLM requires explicit HTTPS endpoint, model and credentials');
  return config;
}
