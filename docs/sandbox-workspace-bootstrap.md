# Controlled sandbox workspace bootstrap

## Purpose

Prepare the smallest reproducible Hub workspace needed for the controlled commercial sandbox journey. The command is dry-run-first, idempotent, and limited to a named non-production database. It does not authorize provider validation, production deployment, real-client data, migration, or Bonsai cutover.

## Required configuration

Complete every `ASHBI_SANDBOX_*` value in the target environment and use the same exact sandbox identifier for `ASHBI_SANDBOX_ENVIRONMENT_ID` and `ASHBI_SANDBOX_ORGANIZATION_SLUG`. The application URL and database name must visibly identify a sandbox, staging, test, or localhost target. Staff and client addresses must be reserved synthetic identities. Keep the synthetic staff password in the environment secret store; the report never prints it.

Workspace preparation uses the target-isolation portion of `check:sandbox-readiness`: the explicit sandbox flag and identifier, non-production URL and database, and reserved synthetic identities. Stripe and Mailgun credentials are not required to prepare the workspace; they remain mandatory before the corresponding provider tests. A live, production, ambiguous, or conflicting target stops the bootstrap.

## Dry run

Run this first in the exact target environment:

```text
npm run bootstrap:sandbox-workspace
```

The command reads the named sandbox database and reports `CREATE` or `REUSE` for the organization, synthetic staff identity, synthetic client, primary contact, and one synthetic project. It does not hash a password or write during the dry run. Existing records are reused only when their bounded identity matches exactly; otherwise the report fails with a generic conflict and requires manual review.

## Confirmed preparation

After reviewing the dry run, record a verified backup reference and Cameron's exact action-time approval, then reconfirm the exact database and identities before running:

```text
npm run bootstrap:sandbox-workspace -- --confirm
```

The confirmed command creates only the five planned operating records inside one database transaction. Replaying it reuses the same exact records and produces no duplicate writes. It does not create a proposal, contract, invoice, payment link, payment, email, or provider call.

## Evidence to retain

- Deployed Git revision and exact sandbox environment identifier.
- Redacted readiness and dry-run reports.
- Backup reference and Cameron approval reference.
- Confirmed bootstrap report and resulting record IDs from an authenticated staff view.
- A replay report showing five `REUSE` actions and no duplicate records.

This proves only that the synthetic workspace exists. The proposal, contract, invoice email, Stripe checkout/webhook, reconciliation, export, restore, parallel-run, and financial cutover gates remain separate.

## Controlled journey preflight

After the dry-run workspace exists, use the read-only controlled-journey preflight documented in [unified-launch-readiness.md](unified-launch-readiness.md). It can inspect the named sandbox migrations, organization, owner, and synthetic client before a lead exists. After the journey, rerun it with the synthetic lead, exact deployed revisions, human attester, and final attestation reference. Do not run the evidence exporter until every preflight check passes.
