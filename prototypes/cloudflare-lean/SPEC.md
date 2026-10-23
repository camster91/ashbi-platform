# Foundation prototype — #689

Approved direction: #565 and tasks/plan.md; owner said to continue after reviewing the published plan. Isolated synthetic local work only.

Objective: prove a Worker can sign in a synthetic staff/client principal, persist a project note in D1, enforce own-client reads and staff-only writes, reject stale concurrent updates and roll back a failed statement batch. No external provider, live identity, real customer data or production binding.

This prototype tests opaque session issuance/revocation and authorization. Generated single-use fixture codes stand in for a verified identity provider. This is not production login/password/MFA acceptance under #416. No public signup, email or remote deployment.

Commands from this directory: npm ci; npm test; npm run build. Tests run real local workerd/D1 through Miniflare, not an in-memory database mock. The build is Wrangler dry-run only. No deploy script or hosted route is configured.

Structure: worker.mjs API; migrations/0001.sql synthetic schema; test.mjs integration and workload checks; wrangler.jsonc local bindings; README.md evidence/compatibility report. Keep plain ESM, parameterized statements and explicit predicates. No root runtime/schema/CI changes.

Acceptance: valid generated code yields a bounded opaque session; raw code/token is not stored; anonymous, revoked, expired and foreign-client access is denied; staff write and own-client read survive independent requests and a runtime restart; one concurrent revision update wins; a failed batch is atomic. Measure local request latency and D1 rows with counts only; do not equate wall latency to billed CPU or free-tier eligibility.

Always: synthetic fixtures, no-store/private responses, bounded JSON, generic errors and no contact/content logging. Ask before production identities, bindings, billing or migration. Never: push to main, auto-merge, deploy, alter release settings or retire source data.
