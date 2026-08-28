# Deployment readiness report: Ashbi unified platform candidate

**Date:** 2026-08-28  
**Candidate branch:** `codex/unified-company-strategy`  
**Inspected candidate SHA:** `f2f722326960da29df7e85e1b10f62f5fae65874`  
**Base:** `origin/main` at `6522707b0865ec66291471561cebab84e5c31762`  
**Scope:** Ashbi Hub custom Node/Fastify, React/Vite, PostgreSQL/pgvector, Redis, worker, Stripe/email integrations, and migration controls  
**Deploy controller:** reviewed manual direct-VPS script; GitHub Actions does not deploy

## Decision

**DO NOT LAUNCH.** The source candidate is locally validated, but no hosted Required release-gates result, isolated staging deployment, full target migration-chain result, authenticated target QA, provider journey, parallel reconciliation, or post-evidence financial cutover approval exists.

## Summary

| Category | Result | Evidence boundary |
| --- | --- | --- |
| Security | Warning | Backend and frontend production audits report zero known vulnerabilities; one unpatched development-only Lighthouse dependency advisory remains documented. Target secrets, headers, access, and provider configuration are not revalidated by source tests. |
| Responsive and cross-browser | Warning | Local automated coverage and production-build Lighthouse pass; candidate target browsers and physical Safari/iOS remain unverified. |
| Accessibility | Warning | Automated gates exist; human assistive-technology and forced-colour evidence remain pending. |
| Performance | Warning | Local frontend budgets and three mobile plus three desktop Lighthouse runs pass; the candidate is not deployed for target performance evidence. |
| SEO/public acquisition | Warning | Public acquisition contracts and local routes exist; Ashbi.ca-to-Hub target configuration and a controlled real target inquiry remain pending. |
| Core functionality | Fail | Local unit, integration, frontend, build, and migration-review checks pass, but the target commercial and delivery journey has not run. |
| Infrastructure and recovery | Fail | The complete local PostgreSQL 16/pgvector chain now applies with zero drift, but no named isolated staging target, target backup/restore rehearsal, immutable candidate deployment, or target rollback proof exists. |
| Analytics and growth | Fail | Attribution and weekly-review workflows are code-present; the required 30-day baseline and four consecutive completed reviews do not exist. |
| Migration and cutover | Fail | Notion and Bonsai evidence remains pending, unimported, and unresolved; no parallel run or cutover approval exists. |

## Verified repository controls

- The private repository default branch is `main`.
- `main` requires the exact three Required release-gates checks, strict up-to-date branches, administrator enforcement, conversation resolution, and disallows force-push and deletion.
- `production` and `staging` GitHub environments accept protected branches only.
- Neither environment currently requires a reviewer, and no workflow uses either environment.
- The candidate has no pull request and no GitHub Actions run.
- The inspected branch is 106 commits, 353 changed files, and 22 Prisma migration files ahead of `origin/main`.
- GitHub Actions has read-only default token permissions, cannot approve pull-request reviews, permits all actions, and does not require immutable action SHA pinning.

## Local candidate proof

- Root and frontend production dependency audits: zero known vulnerabilities.
- Prisma schema validation and client generation: pass with the patched dependency graph.
- Recursive Deepmerge trigger: handled without stack exhaustion.
- Raw HTML and multipart email parsing regression tests: pass.
- Backend unit suite at the current candidate: 949 passed.
- Current attached backend unit/integration run: 962 passed, four dedicated-database cases skipped because `TENANT_INTEGRATION_DATABASE_URL` is not configured, zero failures. The earlier isolated PostgreSQL/pgvector candidate proof remains 964 passed with zero skipped; the current exact SHA still requires the isolated-database rerun.
- Frontend suite: 531 passed.
- Backend/frontend lint and backend type check: pass.
- Production build and frontend performance budgets: pass.
- Lighthouse: three mobile and three desktop runs pass configured thresholds.
- Release-gate contract: pass locally, including exact Prisma migration deploy, schema-drift rejection, and both production lockfile audits.
- Complete local migration execution: all 39 committed migrations, including the 22 candidate migrations, applied on PostgreSQL 16.14 with pgvector 0.8.3; zero unsuccessful rows and no migration-to-schema drift. See [the migration rehearsal](unified-platform-migration-rehearsal-2026-08-28.md).

Local proof does not establish hosted CI, target deployment, target migration, provider delivery, production payment, accessibility, or reconciliation success.

## Must complete before staging promotion

1. Obtain Cameron's approval to run private GitHub Actions and dispatch `Required release gates` for the exact candidate SHA.
2. Open a candidate pull request to `main`; retain the exact passing check URLs and review resolution.
3. Provision the named isolated Hub target with its own pgvector database, Redis, storage, secrets, synthetic organization, and non-production providers.
4. Take a verified target backup, apply the complete 22-file migration chain with `prisma migrate deploy`, reject drift, deploy the immutable revision, and prove rollback in isolation.
5. Complete authenticated staff/client QA and one synthetic inquiry-to-delivery journey with Stripe test mode and sandbox email evidence.
6. Import only approved checksum-bound migration-review bundles, run confirmed Notion/Bonsai sandbox migrations, reconcile without unresolved findings, and preserve rollback evidence.
7. Complete the parallel operating period, four weekly growth reviews, revenue and task reconciliation, and backup/restore evidence.

## Production and retirement gates

Production deployment, provider credentials, DNS, Stripe live mode, source imports, and Bonsai retirement remain separate action-time approvals. Bonsai cannot be retired until the successful sandbox and parallel run, zero-unresolved reconciliation, recoverable backups, and Cameron's explicit post-evidence financial cutover approval are all attached to the exact release.
