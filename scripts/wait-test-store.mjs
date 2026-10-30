import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
// Disposable CI service only: never uses ambient cloud credentials.
const client = new S3Client({
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1',
  forcePathStyle: true,
  maxAttempts: 1,
  credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret-only' },
});
let ready = false;
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await client.send(new ListBucketsCommand({}), { abortSignal: AbortSignal.timeout(2000) });
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
} finally {
  client.destroy();
}
if (!ready) throw new Error('TEST_OBJECT_STORE_UNAVAILABLE');
console.log('Authenticated S3-compatible test service ready');
