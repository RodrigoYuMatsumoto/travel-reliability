# Dynamic security checks

`run.ts` starts a fresh loopback-only, in-memory demo on port 4399 and exercises authenticated HTTP/browser boundaries with synthetic data. It does not attach to the user's demonstration on ports 5173/4310. It closes its own target when finished.

`zap.yaml` is a separate **unauthenticated public-surface active scan**, run in a disposable Linux CI container. Its only target context is `http://127.0.0.1:4399`; the audit-statistics endpoint is excluded. The spider is limited to one minute/depth three, and the active scanner to four minutes, two threads and a 500 ms request delay. It is not an exhaustive assessment of private authenticated functionality; the authenticated matrix complements it.

The container image is pinned by digest, has explicit resource limits, does not receive source files, user credentials or production configuration, and mounts only its disposable report directory. Scanner rule/add-on behavior is still third-party code; this is not a claim of an independent penetration test or a complete deployment audit.

The CI-only target counts numeric `X-ZAP-Scan-ID` headers and response statuses. The report gate requires actual active-scan traffic, a valid in-scope report and a successful/warning-only tool exit. Missing reports, timeouts, recognized unknown-parameter/configuration warnings and zero observed active requests are incomplete coverage. Every medium/high alert blocks the gate, with no blanket allowlist. Low/informational alerts remain visible in the summary for review.

Only aggregate counters and alert metadata are uploaded. Raw reports, request/response instances, headers, cookies, payloads and logs stay in the disposable ignored directory. A successful gate does not validate deployed HTTPS, a live identity provider, production storage or external provider adapters.

The job parameters follow the official ZAP [environment](https://www.zaproxy.org/docs/desktop/addons/automation-framework/environment/), [activeScan](https://www.zaproxy.org/docs/desktop/addons/automation-framework/job-ascan/) and [report](https://www.zaproxy.org/docs/desktop/addons/report-generation/automation/) contracts. Configure and run active scans only against targets you own or are authorized to test.
