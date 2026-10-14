# Confirmed task actions over API and MCP

Workspace action keys can prepare `set_task_collaborators` and `set_task_recurrence`. Workspace-read keys cannot prepare or confirm writes. These actions use the existing human-reviewed preview, confirmation, ten-minute expiry, idempotency and audit contract; no model or provider inference is used to determine permissions or targets.

Each input specifies taskId, projectId and an observed revision. A contributor roster specifies the exact up-to-30 userIds; only its owner or an administrator manages it. Its preview shows the existing and proposed staff identities without emails and preserves the accountable owner. Recurrence takes the same revision/rule input as the task API, including calendar/completion triggers or rule null to stop; existing copies and historical work remain intact.

Preparation writes only an action preview. Confirmation rechecks the requester as active staff and validates the task's current project, organization, ownership, staff additions and revision. The action receipt and canonical change commit in one serializable transaction. Compare-and-set revisions protect the services independently; failed or changed targets roll back without partial membership/settings. The transaction-safe service entrypoints also avoid nested transactions. Repeated confirmation of a completed receipt returns the same result; failed actions require a fresh preview.

These tools are workspace API/MCP actions, not new embedded AI tools. They create no invitations, messages, charges, provider connections or scope grants. Real ChatGPT connection/revocation and production acceptance remain pending while deployment is held.

Unit checks cover preview-only behavior, exact confirmation, idempotency, audit, read-only scopes, foreign targets/people, owner drift, inactive/demoted requesters and stale revisions. Disposable PostgreSQL tests cover persisted settings/membership, receipts/audit, stale rollback and requester deactivation. Full CI acceptance is required before readiness; local PostgreSQL integration has not run.
