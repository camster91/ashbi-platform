# Recurring task schedules

The task page now provides recurrence settings: daily, weekly or monthly frequency, an interval from 1 to 365, a first calendar due date and an IANA timezone. The source task acts as the template. Each occurrence is a new top-level task in the same project with copied title, content, properties, labels, priority and active assignee. An inactive assignee becomes unassigned. New tasks start in PENDING with no stage, dependency, parent, completion time, comments or time records. Previous work stays intact. Generated occurrences link back to the source and cannot start another schedule.

Recurrence is calendar-based, independent of task completion. Monthly schedules always use the original anchor day: January 31 leads to the last day of February, then March 31. The worker compares dates in the selected timezone, so midnight boundaries and daylight-saving changes do not move the intended due day. Due dates are stored as calendar dates at midnight UTC and rendered with the existing date-only formatter.

## Generation and recovery

The existing BullMQ scheduled worker runs a stable `recurring-tasks-hourly` scheduler. It creates due occurrences on the first successful hourly sweep after the day begins in the configured timezone. This does not promise an exact minute. Paused/cancelled projects and deleted tasks/projects do not generate work. Resuming after an outage or hold creates one catch-up task with its original overdue date, then advances to the first anchored date after today; it does not replay every missed period.

Claim, copy and advance occur in one serializable transaction. A unique source/date key is the database backstop against duplicates. The source also retains its last generated date, so editing/stopping/re-enabling a schedule cannot replay a deleted occurrence. A source's settings revision guards edits and generation against concurrent changes. Conflicts require reload. Failed sources/organizations are reported while other sources continue; worker retries do not recreate successfully committed occurrences.

Stopping recurrence clears the next date and rule while preserving the source, last date and all prior occurrences. New or existing tasks do not repeat until explicitly configured. Enabling a schedule whose start date is past selects the first anchored date on or after today.

## API / MCP

- `PUT /api/tasks/:id/recurrence`, authenticated ADMIN/TEAM, takes `{revision, rule}`. A rule is `{frequency: "DAILY" | "WEEKLY" | "MONTHLY", interval, startDate: "YYYY-MM-DD", timeZone}`. Use `rule: null` to stop repeats.
- Invalid dates/timezones/intervals are rejected. Missing or foreign tasks return 404; stale revision returns 409. Generated occurrences direct the caller to the source schedule.
- Task/page reads return the rule, next date, revision and occurrence identity. Workspace HTTP/MCP `list_tasks` also returns schedule and lineage fields. Existing read-only ChatGPT access remains read-only; schedule-specific confirmed MCP writes are a follow-up.

## Release and acceptance

Apply `20261013160000_recurring_tasks`, regenerate Prisma and restart the worker with this release. Scheduler registration remains worker-owned; API replicas do not add timers. The additive migration enables no existing task schedule. No provider calls, client messages, billing, or paid AI are used by this feature.

Tests cover calendar anchors, leap years, daylight-saving boundaries, validation, revision conflicts, stopping/re-enabling, catch-up/retry behavior, editor persistence/error recovery and scheduler ownership. A disposable-database test exercises persisted generation, concurrent workers, tenant isolation, deleted-occurrence protection and stopping. Authenticated target acceptance and live worker-generation evidence remain pending until deployment and QA.

Completion-triggered repeats, business-day rules, explicit end dates/counts, recurring subtasks/checklists and per-occurrence stage templates are follow-up features.
