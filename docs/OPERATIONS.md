# Operations

## Local demonstration

Node 24, `npm ci`, then `npm run demo`. The dev UI uses port 5173 and proxies the
API on 4310. Built mode uses only 4310. Demo sessions are explicitly initiated;
storage and encryption keys are ephemeral. Restart discards them. The demo binds
to loopback unless an operator explicitly opts into public exposure.
Ambient database/cache/bucket variables are ignored in demo mode unless the
operator explicitly sets `ALLOW_DEMO_EXTERNAL_STORES=true` for isolated testing.

## Durable production

Use `.env.example` as a variable inventory; never commit populated environment
files. Supply secrets through an operator-managed secret store. Generate a fresh
32-byte encryption key outside source control and preserve a protected backup.
Losing the key loses access to encrypted records and originals.

Required production variables: `APP_MODE=production`, `PUBLIC_URL` (HTTPS),
`DATABASE_URL`, `REDIS_URL`, `S3_BUCKET`, `ENCRYPTION_KEY_BASE64`, `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `INGEST_URL`. Optional private S3 endpoint,
region and scoped service credentials are listed in the example. Cloud IAM roles
can supply S3 credentials without a static key.

`npm run dev` and `npm start` load an optional root `.env` using Node's native
environment-file support; explicit environment variables take precedence. The
synthetic `npm run demo` does not load that file and disables external stores,
ingestion and model calls. Never prefix secrets with `VITE_`.

For local document parsing, run `npm run ingest` in another terminal, set
`INGEST_URL=http://127.0.0.1:8081` in your private environment and use `npm run dev`.
The loopback worker is a development convenience; production requires the
isolated deployment described below.

Register OIDC redirect URI **PUBLIC_URL/auth/callback**, using the exact origin.
Discovery, PKCE, state and nonce are handled by the client library. The session
uses opaque subject-derived internal IDs; email/profile scopes are not requested.
OIDC requires an actual compatible provider; no production login bypass exists.

The API currently initializes its encrypted record table/indexes on startup. Use
a dedicated database/schema owner, restrict network access, then review migration
privileges before deployment. Test persistence and recovery on an isolated stack.
Redis stores encrypted session/state values with TTL; protect it with TLS/auth
and configure an eviction policy appropriate to session reliability.

The S3 bucket must preexist, be private, deny public ACLs, use least-privilege IAM
and have version/backup retention configured. App-level ciphertext is independent
of provider-side encryption. Do not enable long-lived object versioning without an
erasure plan. API export/deletion does not erase backups or copies already sent
to another person.

## Containers

`Dockerfile` and `ingest/Dockerfile` provide non-root images. `compose.yaml` is an
operator template: PostgreSQL/Redis are private, the parser is on a separate
internal network without storage credentials or a published port, and the API
binds its host port to loopback. Put an HTTPS reverse proxy in front of it.

```sh
docker compose config --quiet
docker compose build
docker compose up -d
```

Populate the required variables first. The template does not create an OIDC
provider, S3 bucket, production certificates, backups or public ingress. Do not
treat a successful build as a tested production deployment.

Keep worker egress blocked; it accepts only document bytes and MIME type. Its
child receives no API/storage/model credentials. The supplied limits are one
parser process per worker, two admitted worker requests, 20 MiB input, 50 pages,
25 million rendered pixels and a 120-second outer timeout. OCR requires `por+eng`
Tesseract data. Updating native parsing libraries is an operational security task.

## Retention, erasure and observability

Documents default to a 90-day retention deadline (`EVIDENCE_RETENTION_DAYS`, an
operator policy, not a statutory period); an authorized user may set a new deadline
or explicit indefinite retention. Expired derivatives are removed before private
reads and by maintenance. Object deletion uses a durable retry outbox; a receipt
can say `storageCleanup: pending`. Investigate pending cleanup without logging
document content. Do not claim erasure complete while the object store is failing.

API logging intentionally excludes payloads, URLs with secrets, cookies, model
text, documents and traveler identifiers. Events such as job/maintenance failure
are metadata only. Add metrics for queue depth, cleanup age, request outcomes,
parser latency, model calls and correction rate using opaque aggregation, never
raw evidence or PNR labels.

`trustProxy` is false. Behind a reverse proxy the current rate limit may aggregate
clients under the proxy address. Configure a reviewed explicit proxy-hop policy
before relying on per-client production rate limits; never trust arbitrary
forwarded headers. Fleet-wide admission/quotas and automated key rotation are not
implemented.

## Restore and release

Back up encrypted PostgreSQL records, private ciphertext objects and the protected
key under distinct access controls. Test a restore into an isolated environment,
confirm hashes and workspace isolation, and apply expired-record/deletion
maintenance before opening restored data to users. Define recovery objectives
and backup expiry for the deployment rather than claiming universal values.

Run `npm run check`, `npm run build`, browser tests and configured durable-store
integration tests. Generate SBOMs and a source archive, scan staged content and
history, then publish a tagged release. Pin deployment images by digest after
review. Current templates pin major image lines for readability and therefore
require an operator-controlled digest policy for reproducible production supply
chains.

## CI object storage

The integration job uses a disposable SeaweedFS 4.51 S3 endpoint pinned by image digest and bound to runner loopback. Readiness is checked with an authenticated ListBuckets request; tests then create, store, read and delete actual ciphertext objects. This is a real object-store integration, not a substituted SDK mock. The former Docker Hub MinIO image was removed upstream and is not used.
