# Unified Ashbi launch readiness

This gate answers one narrow question: does retained evidence prove the complete Ashbi company and operating-platform objective, rather than only proving that individual features exist in code?

It is read-only. It does not deploy either application, import data, contact a prospect, create a Stripe object, cancel Bonsai, or authorize a financial action.

## Required evidence

Keep one owner-controlled evidence directory containing the manifest and these checksum-bound JSON artifacts:

1. `strategy-approval`: strategy version, approved company charter, ownership charter, service catalogue, messaging matrix, and dated approvals from Bianca and Cameron.
2. `ashbi-ca-deployment`: exact `https://ashbi.ca` revision, matching strategy version, smoke result, verified rollback revision, and verification time.
3. `hub-deployment`: the equivalent evidence for `https://hub.ashbi.ca`.
4. `controlled-journey`: one synthetic sandbox journey bound to those two revisions, with durable lead, client, opportunity, proposal, contract, project, completed task, invoice, payment, and post-delivery client-report identities; CAD or USD preserved; Stripe test mode and sandbox email; zero duplicate writes; zero manual database corrections; and a passing reconciliation.
5. `growth-cadence`: a source-coverage-reviewed, currency-separated 30-day baseline that visibly discloses missing attribution, plus at least four consecutive Monday-starting weekly reviews with one completed Hub growth task and owner per week.
6. `notion-confirmed-import` and `notion-idempotent-rerun`: version 3 Notion reports for the same tenant, project, and source fingerprint. The confirmed report must be complete and the rerun must plan no new notes, conflicts, or skips.
7. `bonsai-cutover-manifest`: the actual nested manifest and its contained evidence package. The unified command reruns the Bonsai evaluator; a copied `ready: true` value is not accepted.
8. `final-launch-approval`: Cameron's dated `UNIFIED_PLATFORM_PUBLIC_LAUNCH` approval recorded after the evidence completion time.

Every artifact path must remain beneath the manifest directory. The command verifies every SHA-256 checksum before interpreting the artifact.

## Evidence formats

The strategy artifact uses `format: "ashbi-strategy-approval"`, `version: 1`, `complete: true`, a non-empty `strategyVersion`, four `APPROVED` decisions (`companyCharter`, `ownershipCharter`, `serviceCatalogue`, `messagingMatrix`), and dated `APPROVED` records for `Cameron` and `Bianca`.

Each deployment uses `format: "ashbi-deployment-evidence"`, `version: 1`, `complete: true`, the exact application and URL, a 7–40 character Git revision, a different rollback revision, the approved strategy version, `smokePassed: true`, `rollbackVerified: true`, and `verifiedAt`.

The manifest names one Ashbi organization. The controlled journey uses `format: "ashbi-controlled-journey-evidence"`, `version: 2`, `complete: true`, that exact `organizationId`, `environmentKind: "sandbox"`, the exact public and Hub revisions, an explicit `CAD` or `USD` currency, `stripeMode: "test"`, `emailMode: "sandbox"`, `reconciliationPassed: true`, `duplicateWrites: 0`, `manualDatabaseCorrections: 0`, and the ten required `recordIds`. The task must be completed under the contract-owned project, and the non-empty client report must be generated after both task completion and Stripe settlement reconciliation. It also preserves passing sandbox-readiness checks, signed Stripe test-mode and verified-settlement evidence, sandbox email acceptance, and the bounded human no-manual-correction attestation. The growth, Notion, and nested Bonsai evidence must bind the same organization.

Run the sanitized preflight before changing the sandbox and again after the full synthetic journey:

```text
npm run check:controlled-journey-readiness -- --organization-id <id> --lead-id <synthetic-lead-id> --public-revision <git-sha> --hub-revision <git-sha> --attested-by <name> --attestation-reference <reference>
```

The first run may omit the lead and final attestation inputs; those checks will remain visibly pending while the command still inspects migrations and bounded synthetic identities when the target is unambiguously non-production. The final run must return `ready: true`. Reports contain check IDs, safe messages, and missing migration names only; they never print URLs, database credentials, provider secrets, emails, or supplied record identifiers. The command has no confirmation mode and no write path.

After the controlled sandbox flow and provider reconciliation are complete, export the artifact directly from the Hub records:

```text
npm run export:controlled-journey-evidence -- --organization-id <id> --lead-id <synthetic-lead-id> --public-revision <git-sha> --hub-revision <git-sha> --attested-by <name> --attestation-reference <reference> --output <owner-evidence-directory>/evidence/controlled-journey.json --attest-no-manual-db-corrections --confirm
```

The command is read-only and refuses production-like configuration. It requires the full existing sandbox-readiness gate, one converted inquiry, one linked client and opportunity, one approved proposal, one signed contract, one contract-owned project, one completed project task, one paid project invoice, one signed Stripe test-mode payment with verified settlement, one accepted sandbox email, one post-delivery client report, and exactly one source write at each replay-sensitive boundary. The contract-project and Stripe-mode migrations must be applied to the named sandbox first. The attestation flag records a human statement; it does not infer or retroactively repair database history.

The cadence artifact uses `format: "ashbi-growth-cadence-evidence"`, `version: 1`, and `complete: true`. Its `baseline` records `startedAt`, `endedAt`, `sourceCoverageReviewed`, `currenciesSeparated`, and `missingAttributionDisclosed`. Every `weeklyReviews` entry records `weekStart`, `actionTaskId`, `ownerId`, `dueDate`, and `completedAt`.

After four consecutive Monday-starting reviews are actually completed in the Hub, export their evidence directly instead of authoring this artifact:

```text
npm run export:growth-cadence-evidence -- --organization-id <id> --first-week <YYYY-MM-DD Monday> --output <owner-evidence-directory>/evidence/growth-cadence.json --confirm
```

The exporter is read-only against the Hub. It requires four consecutive completed tasks, due and completed within their own weeks, with the recorded source-coverage, currency-separation, missing-attribution, and external-action attestations. Older tasks without that evidence cannot be upgraded by inference.

The final approval uses `format: "ashbi-unified-launch-approval"`, `version: 1`, `decision: "APPROVED"`, `scope: "UNIFIED_PLATFORM_PUBLIC_LAUNCH"`, `approver: "Cameron"`, `approvedAt`, and a non-empty evidence reference.

## Run the gate

Store the nine artifacts at the conventional paths shown in [unified-launch-manifest.example.json](unified-launch-manifest.example.json). Do not paste checksums by hand. After the evidence is complete, create a new owner-controlled manifest:

```text
npm run prepare:unified-launch-manifest -- --evidence-dir <owner-evidence-directory> --organization-id <id> --evidence-completed-at <ISO> --output <owner-evidence-directory>/unified-launch-manifest.json
```

The preparation command reads but does not alter the evidence artifacts. It refuses missing files, paths or symlinks outside the evidence directory, duplicate files, future completion timestamps, outputs outside the evidence directory, and existing output files. It calculates every SHA-256 checksum and creates the manifest with owner-only permissions.

Then run the verifier:

```text
npm run check:unified-launch -- --manifest <owner-evidence-directory>/unified-launch-manifest.json
```

`ready: true` is necessary evidence for the full objective, but it still performs no release or cancellation. Production/DNS, public publishing, provider credentials, Stripe live mode, financial automation, and Bonsai cancellation remain exact action-time approvals.
