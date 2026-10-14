# Task contributors and accountable ownership

Tasks retain one assignee as the accountable owner and can have up to 30 explicit staff contributors. The owner or an administrator manages membership with a separate revision; other staff can read authorized rosters. Client principals cannot use these endpoints. Adding contributors does not change assignment, project, client or billing identity.

Task list/my-task reads include explicit participation while preserving project, tenant, search and typed-field predicates. MCP task reads expose contributor identity/name/activity metadata, and `list_my_tasks` includes contributions. Membership changes preserve retained join dates; existing inactive members can be retained or removed, and new members must be active staff in the same organization. No invitations or email delivery are sent by this workflow.

Tenant constraints are enforced in the service, request-scoped model policy and database triggers. Parent locks and reverse transfer guards protect task/project/user organization changes from creating cross-tenant membership. Membership revisions and serializable writes reject stale updates without clearing draft selections.

Calendar recurrence copies active staff contributors from the source into each new occurrence atomically with its one accountable owner. Inactive retained members stay on the source but are excluded from future occurrences; retries do not duplicate membership.

The additive migration, database isolation and recurrence tests, and authenticated persisted/mobile/accessibility journey require CI acceptance before readiness. Workload reporting, completion-triggered recurrence and multiple boards remain follow-up delivery work. Production remains held.
