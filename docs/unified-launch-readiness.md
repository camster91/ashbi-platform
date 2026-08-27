# Unified Ashbi launch readiness

This gate answers one narrow question: does retained evidence prove the complete Ashbi company and operating-platform objective, rather than only proving that individual features exist in code?

It is read-only. It does not deploy either application, import data, contact a prospect, create a Stripe object, cancel Bonsai, or authorize a financial action.

## Required evidence

Keep one owner-controlled evidence directory containing the manifest and these checksum-bound JSON artifacts:

1. `strategy-approval`: strategy version, approved company charter, ownership charter, service catalogue, messaging matrix, and dated approvals from Bianca and Cameron.
2. `ashbi-ca-deployment`: exact `https://ashbi.ca` revision, matching strategy version, smoke result, verified rollback revision, and verification time.
3. `hub-deployment`: the equivalent evidence for `https://hub.ashbi.ca`.
4. `controlled-journey`: one synthetic sandbox journey bound to those two revisions, with durable lead, client, opportunity, proposal, contract, project, invoice, and payment identities; CAD or USD preserved; Stripe test mode and sandbox email; zero duplicate writes; zero manual database corrections; and a passing reconciliation.
5. `growth-cadence`: a source-coverage-reviewed, currency-separated 30-day baseline that visibly discloses missing attribution, plus at least four consecutive Monday-starting weekly reviews with one completed Hub growth task and owner per week.
6. `notion-confirmed-import` and `notion-idempotent-rerun`: version 3 Notion reports for the same tenant, project, and source fingerprint. The confirmed report must be complete and the rerun must plan no new notes, conflicts, or skips.
7. `bonsai-cutover-manifest`: the actual nested manifest and its contained evidence package. The unified command reruns the Bonsai evaluator; a copied `ready: true` value is not accepted.
8. `final-launch-approval`: Cameron's dated `UNIFIED_PLATFORM_PUBLIC_LAUNCH` approval recorded after the evidence completion time.

Every artifact path must remain beneath the manifest directory. The command verifies every SHA-256 checksum before interpreting the artifact.

## Evidence formats

The strategy artifact uses `format: "ashbi-strategy-approval"`, `version: 1`, `complete: true`, a non-empty `strategyVersion`, four `APPROVED` decisions (`companyCharter`, `ownershipCharter`, `serviceCatalogue`, `messagingMatrix`), and dated `APPROVED` records for `Cameron` and `Bianca`.

Each deployment uses `format: "ashbi-deployment-evidence"`, `version: 1`, `complete: true`, the exact application and URL, a 7–40 character Git revision, a different rollback revision, the approved strategy version, `smokePassed: true`, `rollbackVerified: true`, and `verifiedAt`.

The controlled journey uses `format: "ashbi-controlled-journey-evidence"`, `version: 1`, `complete: true`, `environmentKind: "sandbox"`, the exact public and Hub revisions, an explicit `CAD` or `USD` currency, `stripeMode: "test"`, `emailMode: "sandbox"`, `reconciliationPassed: true`, `duplicateWrites: 0`, `manualDatabaseCorrections: 0`, and the eight required `recordIds`.

The cadence artifact uses `format: "ashbi-growth-cadence-evidence"`, `version: 1`, and `complete: true`. Its `baseline` records `startedAt`, `endedAt`, `sourceCoverageReviewed`, `currenciesSeparated`, and `missingAttributionDisclosed`. Every `weeklyReviews` entry records `weekStart`, `actionTaskId`, `ownerId`, `dueDate`, and `completedAt`.

The final approval uses `format: "ashbi-unified-launch-approval"`, `version: 1`, `decision: "APPROVED"`, `scope: "UNIFIED_PLATFORM_PUBLIC_LAUNCH"`, `approver: "Cameron"`, `approvedAt`, and a non-empty evidence reference.

## Run the gate

Copy [unified-launch-manifest.example.json](unified-launch-manifest.example.json) into the evidence directory, replace every placeholder with retained evidence, and run:

```text
npm run check:unified-launch -- --manifest <owner-evidence-directory>/unified-launch-manifest.json
```

`ready: true` is necessary evidence for the full objective, but it still performs no release or cancellation. Production/DNS, public publishing, provider credentials, Stripe live mode, financial automation, and Bonsai cancellation remain exact action-time approvals.
