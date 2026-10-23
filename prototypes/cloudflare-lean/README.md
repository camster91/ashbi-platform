# Local Workers/D1 foundation proof

Issue [#689](https://github.com/camster91/ashbi-platform/issues/689), parent [#565](https://github.com/camster91/ashbi-platform/issues/565). This is an isolated API prototype, not the replacement user interface or a production authentication service. Only synthetic records are used. No live account, database, Stripe, email or R2 resource is connected.

## Run

From `prototypes/cloudflare-lean`:

```sh
npm ci
npm test
npm run build
```

Tests run actual local workerd and D1 through Miniflare, create random single-use fixture codes, and dispose of their temporary database directory after the suite. The only test output besides test names is numeric workload evidence. `npm run build` is a Wrangler dry-run and exits without uploading. `npm run dev` binds to 127.0.0.1, but deliberately has no seeded identities: the self-contained integration test is the current supported demo, not an interactive UI.

The Worker requires both a loopback URL and `LOCAL_PROTOTYPE=true`. Wrangler has no hosted routes, workers.dev/preview URLs are disabled, and its D1 UUID is an all-zero local placeholder. There is no deploy script. Do not edit these settings to publish the fixture identity mechanism. This is an accidental-exposure guard, not an authentication boundary to reuse in a public app.

Wrangler is pinned to 4.152.0; the test explicitly pins stable Miniflare 4.20260730.0 rather than depending on Wrangler's transitive beta API. Both configs use compatibility date 2026-07-30. The first test attempt exposed a Miniflare 5 option-shape mismatch; the direct stable dependency fixes reproducibility without changing the application. D1 fixture schema setup uses one prepared statement per complete SQL command in a batch: passing multiline CREATE TABLE text to `exec()` failed as incomplete SQL and was corrected. These were harness failures, not evidence of application readiness.

## Verified on 23 October 2026

`npm test`: **12 passed, zero failed/skipped** (one parent and eleven subtests). Coverage includes missing local opt-in, nonlocal URL rejection, anonymous access, expired/replayed fixture codes, opaque hashed sessions, staff writes, internal/foreign-client/foreign-organization denials, caller-supplied organization rejection, stale concurrent edits, failed-batch rollback, bounded/cross-origin inputs, logout/expiry, runtime restart and a small workload.

Two staff identities, two separate clients and a foreign-organization actor are fixtures. A hundred serial authorized reads averaged **4.21 ms local wall time** in the recorded run; this is not network latency or billed CPU. After adding 250 other-client notes, the indexed own-client list query reported **two rows read**. The Worker dry-run bundle was **6.43 KiB, 2.25 KiB gzip**. Syntax checks passed. Independent review passed the first eleven-test suite; its identified missing-opt-in coverage was then added and all twelve passed.

The session is an opaque 256-bit token stored only as SHA-256; expiry and actor lookup are read on each request. The fixture code is atomically consumed before session insertion. An insertion failure deliberately fails closed and requires a newly generated fixture code; this is not a production login recovery design. No password hashing, mailbox ownership, MFA, rate limiting or account recovery is claimed. #416 must choose and validate the actual identity flow before public use.

### Decision

**Continue with the targeted D1 architecture; do not deploy or migrate the complete app yet.** Parameterized persistence, indexed client predicates, atomic revision updates and batch rollback work in the local Worker runtime. This does not establish that all PostgreSQL transactions or production financial invariants are portable.

## Compatibility work remaining

| Existing dependency | Evidence in current repository | Lean direction and verification gate |
| --- | --- | --- |
| PostgreSQL/Prisma interactive transactions and raw SQL | `src/utils/invoice.js` uses raw sequence queries and an interactive transaction; existing migrations include PostgreSQL-specific constraints/triggers | Design small D1 schemas and explicit batch/CAS operations per retained workflow. Prove numbering, billing claims, refunds, document signing and concurrent updates individually; do not replay PostgreSQL migrations. |
| pgvector | `ClientEmbedding` contains `Unsupported("vector(768)")` | Semantic search is outside the lean milestone. Preserve exposure-remediation obligations and existing source data; do not drop a production index/table in this proof. |
| bcrypt, session/MFA/recovery | Current auth routes rely on the established Node identity stack | This proof intentionally uses generated fixture codes. #416 validates the real Worker-compatible identity and recovery path; no weakened password conversion. |
| Redis/BullMQ and always-running worker | `src/jobs/worker.js` constructs BullMQ workers; many scheduled tasks consume its queues | Identify retained jobs. Use bounded requests, scheduled triggers or Queues only after proving idempotency, retries and recovery. Keep current production worker until replacement acceptance. |
| Socket.IO/Redis adapters | `src/realtime/adapter.js` and `src/realtime/emitter.js` | Ordinary refresh and conflict-aware saves initially; do not require an always-running realtime server. |
| Local file storage | Production Compose mounts uploads/config volumes | #417 implements private R2 originals and authorized download/upload. #282 must prove export/restore, not rely on database backups alone. |
| Stripe Checkout and PostgreSQL settlement | Existing Stripe service creates Checkout sessions and transactional settlement | #693/#694 add native invoice drafts and signed-event projection. Use test mode, exact minor units and idempotency; never infer payment from a redirect. |
| PDF/browser automation and integrations | Existing deployment has Node-only rendering/provider paths | Inventory retained contract/PDF delivery before removing packages. Stripe can host new invoice PDFs; other document formats still need a separate proven implementation. |

No root package, runtime, schema, workflow, deployment setting or existing feature was changed by this prototype. The required main CI does **not** automatically run this separately packaged suite; its local evidence must not be called hosted CI acceptance. Add a narrowly scoped non-deploying check when the prototype is adopted into the supported build.

## Cost worksheet: assumptions, not measured billing

Example monthly workload: two staff × 200 API requests × 22 workdays = 8,800 requests; ten client users × 50 = 500; one hourly scheduled check × 30 days = 720. Total **10,020 dynamic requests/month**, before retries/other traffic. Static assets are separate. At a conservative 100 D1 rows read per request this is about **1,002,000 rows/month**; 10% mutating requests at four written rows is about **4,008 rows/month**. This is a planning envelope, not extrapolation from two rows in one query. Assume database ≤1 GB and originals ≤2 GB pending actual source inventory.

Official pricing checked 23 October 2026: Workers Free has a daily request allowance; Workers Paid starts at US$5 per account/month with shared included request/CPU usage. D1 Free includes 5 million read rows and 100,000 write rows per day and 5 GB total storage; paid allowances differ. R2 Standard includes 10 GB-month and operation allowances. This example is comfortably small on request/row/storage counts alone. **Billed CPU, other apps' account usage, file operations, retained history, retry volume, email and Stripe fees are not measured by this local test.** Existing paid-account allowances could cover it with no incremental base charge, but free hosting is not guaranteed. Do not compare 4.21 ms wall time to the CPU limit.

Before any hosted pilot: inspect actual account-wide usage, measure deployed CPU with synthetic traffic, define alerts and per-invocation CPU limits, confirm backup retention/storage and price provider usage. No spending or Cloudflare account change is authorized here.

## Sources

- [Local D1 development](https://developers.cloudflare.com/d1/best-practices/local-development/)
- [D1 prepared statements, batches and rollback](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Miniflare D1 test API](https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [R2 pricing](https://developers.cloudflare.com/r2/pricing/)

Next: production identity contract under #416, private R2 path under #417, then the bounded client-directory slice #690. #689 remains in progress because hosted CPU, private storage/provider paths and financial migration contracts are not proven.
