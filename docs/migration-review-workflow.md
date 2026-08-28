# Hub migration review workflow

The Hub migration review page records bounded human decisions about project identities, source dispositions, active-project outcomes, and evidence-preserving financial-exception recommendations. It does not apply project links, create or move tasks, repair a source, assign owners, change lifecycle status, close or archive a project, edit financial records, bill or collect, attest to a contract, contact clients, authorize migration, or authorize Bonsai cutover.

## Prepare a verified import bundle

Use the exact checksum-bound artifacts that produced the project-link review brief:

```powershell
npm run prepare:migration-review-bundle -- --review <native-project-review.json> --mapping-decision <mapping-decision.json> --supplemental-evidence <live-evidence.json> --review-brief <project-link-review-brief.json> --output <new-hub-review-bundle.json>
```

For the checksum-bound all-source task-disposition brief:

```powershell
npm run prepare:task-disposition-migration-review-bundle -- --review <task-review.json> --task-link-decision <task-link-decision.json> --mapping-decision <mapping-decision.json> --task-disposition-decision <pending-task-disposition.json> --review-brief <task-disposition-review-brief.json> --output <new-task-disposition-review-bundle.json>
```

For the checksum-bound all-source project-disposition brief:

```powershell
npm run prepare:project-disposition-migration-review-bundle -- --review <native-project-review.json> --project-link-decision <project-link-decision.json> --project-disposition-decision <pending-project-disposition.json> --supplemental-evidence <duplicate-project-evidence.json> --review-brief <project-disposition-review-brief.json> --output <new-project-disposition-review-bundle.json>
```

For the checksum-bound financial-exception brief:

```powershell
npm run prepare:financial-exception-migration-review-bundle -- --financial-review <financial-review.json> --invoice-snapshot <invoice-index.json> --time-entry-snapshot <time-entry-index.json> --financial-exception-decision <pending-financial-decision.json> --review-brief <financial-review-brief.json> --output <new-financial-review-bundle.json>
```

For the checksum-bound active-project outcome brief:

```powershell
npm run prepare:active-project-outcome-migration-review-bundle -- --active-project-triage <triage.json> --financial-review <financial-review.json> --native-project-review <native-project-review.json> --project-link-decision <project-link.json> --project-disposition-decision <project-disposition.json> --active-project-disposition-decision <pending-active-project.json> --review-brief <active-project-review-brief.json> --output <new-active-project-review-bundle.json>
```

The command refuses invalid evidence and refuses to overwrite an existing output. The resulting bundle includes a unique import request ID so retrying the same upload cannot create a duplicate packet.

## Review in the Hub

1. Sign in as an Ashbi administrator and open **Migration Reviews**.
2. Import the verified project-link, project-disposition, task-disposition, active-project-outcome, or financial-exception bundle.
3. Compare the exact source identities, recommendation, prerequisites, and evidence for each candidate.
4. Approve or reject the bounded recommendation. Project-identity packets may batch-record only visible low- or medium-risk approval-ready identities after an explicit confirmation. High-risk project suggestions and every task-disposition, project-disposition, active-project-outcome, and financial-exception decision remain one-by-one reviews. Every decision has a unique request ID; a failed request can be retried without creating a second action.
5. Export the decision record. It remains incomplete until every candidate has a current decision.

The database retains immutable decision events. A later decision supersedes the earlier candidate state without deleting its audit history. The exported record is generated from the latest event for each candidate and preserves all no-mutation safeguards required by the migration planner. For task, project, and financial dispositions, an approval records the exact recommended disposition; a rejection remains pending in the export until it receives a new evidence-backed disposition. Financial approvals only preserve a non-paid invoice's source status or a linked time entry's unbilled state for a later confirmed import. Projectless time stays manual-review, and contract gaps stay blocked until source capture or Cameron's explicit attestation exists.

Each imported packet is uniquely identified by its review kind plus a fingerprint of the source review, dependency decision, and optional supplemental evidence. Regenerating a project-disposition brief after project-link decisions therefore creates a new evidence generation alongside the prior pending generation. It never overwrites or silently reinterprets the earlier review history.

The Hub orders generations by their evidence preparation time. Earlier generations remain available for inspection and export, but both the interface and API refuse new approvals or rejections after a newer generation exists for the same review kind and source snapshot.

Active-project outcomes stay blocked until their project-link and source-project disposition dependencies are decided. A regenerated packet may then recommend only the compatible migrate-active, retain-active, or evidence-backed exclusion outcome. The workflow never recommends closure; financial clearance and closure remain separate evidence gates.

## Separate gates

Importing evidence, approving a logical identity or task disposition, applying those decisions in an isolated sandbox, confirming a migration, running in parallel, reconciling operating and financial records, and retiring Bonsai are separate gates. Only evidence import and decision recording occur in this workflow.
