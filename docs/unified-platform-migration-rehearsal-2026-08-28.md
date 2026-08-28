# Unified platform migration rehearsal

**Date:** 2026-08-28

**Scope:** Complete committed Prisma chain on an empty, isolated PostgreSQL 16 database with pgvector, followed by the release drift gate and backend integration suite.

**Result:** Pass after repairing migration-chain defects found by the rehearsal.

## Evidence boundary

This was a disposable localhost rehearsal, not staging or production. It did not use, copy, restore, or mutate Ashbi, Bonsai, Notion, Stripe, provider, client, or production data. It does not prove target backup/restore, target configuration, provider journeys, data migration, parallel operation, or launch readiness.

## Isolated runtime

- PostgreSQL: 16.14
- pgvector: 0.8.3
- Bind address: localhost only
- Database: newly created empty rehearsal database
- Package source: checksum-verified micromamba executable and conda-forge packages
- System services: the disabled Windows PostgreSQL service remained stopped and unchanged

The database was recreated from empty for each authoritative run. The baseline migration, rather than manual preparation, enabled pgvector.

## Initial failures found

The first empty-database run failed deterministically in `20260827007000_stripe_refund_reconciliation` with PostgreSQL error `42703`: the migration constrained `invoice_refund_events.signedStatus` without creating that column. Investigation showed the column had been placed on `invoice_refunds`, while the Prisma model, event writer, and evidence exporter all require it on the append-only event table.

After the column placement was repaired, the full chain applied but the required drift gate reported:

- the optional external-chat author foreign key still used restrictive deletion rather than `SET NULL`;
- delivery-provider and milestone soft-delete indexes existed only in SQL, not the Prisma schema;
- the report idempotency migration created `request_id` while Prisma uses `requestId`;
- five database index identifiers exceeded PostgreSQL's 63-byte limit and were truncated differently from Prisma's expected names.

Each defect received a focused failing regression test before its minimal repair. The soft-delete database suite also exposed a test-harness gap: `milestone` was classified but never seeded. The fixture now covers and cleans up the missing active/deleted pair.

## Final authoritative run

Window: `2026-08-28T17:03:01.2197301Z` to `2026-08-28T17:03:21.9666176Z`

Commands:

```text
npx prisma migrate deploy
npx prisma migrate diff --exit-code --from-config-datasource --to-schema prisma/schema.prisma
npx prisma migrate status
```

Results:

- 39 of 39 committed migrations applied from `20260808040000_baseline` through `20260828123000_active_project_outcome_review_kind`.
- All 22 candidate migrations beyond `origin/main` were included.
- `_prisma_migrations`: 39 applied, zero unfinished or rolled-back rows.
- pgvector extension: 0.8.3, created through the baseline.
- Prisma migration status: database schema up to date.
- Migration-to-schema diff: no difference detected.

## Regression and build validation

```text
Focused migration/refund contracts    18 passed, 0 failed
Backend unit and integration suite    964 passed, 0 failed, 0 skipped
TypeScript type check                  PASS
Backend lint                           PASS
Prisma validate and generate          PASS
Release-gate workflow contract        PASS
Frontend production build             PASS
Frontend performance budgets          PASS
```

The first full integration run found the missing milestone fixture and failed 963/964. After the fixture repair, the complete suite was rerun and passed 964/964.

## Remaining release gates

This local proof removes the source-chain execution blocker. It does not replace:

1. the hosted Required release-gates result for the exact pull-request SHA;
2. a named isolated staging deployment using target PostgreSQL/pgvector, Redis, storage, and secrets;
3. target backup, migration, drift, immutable deployment, rollback, and authenticated QA evidence;
4. Stripe test-mode, transactional email, e-signature, and controlled commercial-journey evidence;
5. confirmed Notion/Bonsai sandbox imports, zero-unresolved reconciliation, parallel operation, and Cameron's explicit post-evidence financial cutover approval.

The release decision remains **DO NOT LAUNCH** until those external and target gates pass.
