# Hub migration review workflow

The Hub migration review page records bounded human decisions about whether one Notion project ID and one Bonsai project ID represent the same logical project. It does not apply project links, create or move tasks, assign owners, change lifecycle status, edit financial records, contact clients, authorize migration, or authorize Bonsai cutover.

## Prepare a verified import bundle

Use the exact checksum-bound artifacts that produced the project-link review brief:

```powershell
npm run prepare:migration-review-bundle -- --review <native-project-review.json> --mapping-decision <mapping-decision.json> --supplemental-evidence <live-evidence.json> --review-brief <project-link-review-brief.json> --output <new-hub-review-bundle.json>
```

The command refuses invalid evidence and refuses to overwrite an existing output. The resulting bundle includes a unique import request ID so retrying the same upload cannot create a duplicate packet.

## Review in the Hub

1. Sign in as an Ashbi administrator and open **Migration Reviews**.
2. Import the verified bundle.
3. Compare the exact Notion and Bonsai source identities and evidence for each candidate.
4. Approve or reject the logical identity. Every click has a unique request ID; a failed request can be retried without creating a second action.
5. Export the decision record. It remains incomplete until every candidate has a current decision.

The database retains immutable decision events. A later decision supersedes the earlier candidate state without deleting its audit history. The exported record is generated from the latest event for each candidate and preserves all no-mutation safeguards required by the migration planner.

## Separate gates

Importing evidence, approving a logical identity, applying source links in an isolated sandbox, confirming a migration, running in parallel, reconciling operating and financial records, and retiring Bonsai are separate gates. Only the first two occur in this workflow.
