# Unified platform deployment candidate

## Candidate boundary

This candidate is the complete unified-company branch, not a narrow migration-review patch.

- Remote base: `origin/main` at `6522707b0865ec66291471561cebab84e5c31762`
- Candidate: `codex/unified-company-strategy` at `eb397a449ce65b7e5b2948496c3792d1eb0a7a12`
- Difference: 103 commits, 346 changed files, and 22 Prisma migrations
- First candidate migration: `20260826173000_public_client_acquisition_intake`
- Latest candidate migration: `20260828123000_active_project_outcome_review_kind`

The public frontend observed on 2026-08-28 UTC served `/assets/index-LKjUf49E.js` and did not contain the local `MigrationReviews` or `LaunchReadiness` chunks. Unauthenticated API responses are not route evidence because the organization-context guard responds before both known and intentionally unknown protected paths.

## Required staging sequence

1. Create a named isolated Hub target with its own PostgreSQL/pgvector database, Redis data, hostnames, secrets, storage, and synthetic organization. It must pass `check:migration-sandbox-infrastructure` and `check:migration-sandbox-target` before any import.
2. Take and verify a recoverable database and persistent-file backup of the target before applying migrations.
3. Apply the complete migration chain with `prisma migrate deploy`. Record the target, start and end migration, revision, timestamps, and command result. Do not use a schema push.
4. Deploy the exact candidate revision and verify listener health, public HTTPS, root assets, unauthenticated auth behavior, and the candidate frontend chunks.
5. Run authenticated staff QA against the synthetic organization. Verify tenant isolation, admin-only Launch Readiness and Migration Reviews, responsive behavior, keyboard flow, console errors, and no unexpected provider calls.
6. Import the checksum-bound review bundles into the isolated target in dependency order:
   - project identities;
   - task dispositions;
   - project dispositions;
   - financial exceptions;
   - active-project outcomes.
7. Confirm that blocked recommendations cannot be approved, superseded evidence generations are read-only, replayed request IDs do not duplicate records, and exported decisions preserve every no-mutation safeguard.
8. Run the Notion and Bonsai migration paths as dry runs first. Confirm exact source counts, destination inventory, duplicate prevention, unresolved findings, and rollback references before any confirmed sandbox import.
9. Complete one controlled synthetic inquiry-to-delivery journey, including proposal, contract, Stripe test-mode invoice/payment evidence, one completed delivery task, one client report, and accepted sandbox email evidence.
10. Run a parallel reconciliation period and produce checksummed operating, task, revenue, Notion, Bonsai, growth-cadence, backup, and rollback evidence.

## Production gate

Production remains blocked until the isolated target passes every step above and Cameron reviews the exact deployment revision, migration list, rollback, remaining findings, and financial reconciliation evidence. Production deployment, DNS, provider credentials, Stripe live mode, confirmed source imports, and Bonsai retirement each require their own action-time approval.

## Rollback evidence

Before production approval, the release handoff must include:

- pre-deployment database and persistent-file backup identifiers;
- verified restore evidence in isolation;
- prior production revision and image/reference;
- exact candidate revision;
- migration status before and after deployment;
- rollback commands for application and database-compatible recovery;
- public HTTPS and authenticated smoke checks after rollback.

No document, test pass, bundle import, or sandbox success by itself authorizes production or financial cutover.
