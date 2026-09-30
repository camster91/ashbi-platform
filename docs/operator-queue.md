# Daily operator queue

Issue [#461](https://github.com/camster91/ashbi-platform/issues/461). One
list that tells an agency owner or project manager what needs attention across
client delivery, who owns it, and what happens next. The queue is a read-only
projection over existing records: it stores nothing, and every change happens
in the source record's own workflow and approval boundary.

- API: `GET /api/work-queue` (`src/routes/work-queue.routes.js`, service
  `src/services/work-queue.service.js`), registered with the client-delivery
  work-management routes.
- Web: `/queue` (`web/src/pages/WorkQueue.jsx`), linked as **Daily Queue**
  under Dashboard in the sidebar and in the mobile **More** menu.

## Request

| Parameter | Values | Default |
| --- | --- | --- |
| `view` | `needs_action`, `awaiting_approval`, `waiting_on_client`, `at_risk` | all views |
| `owner` | `me`, `everyone` | `everyone` (the page shows this filter to admins only; see [Owner filter](#owner-filter)) |
| `clientId` | client id | all clients |
| `projectId` | project id | all projects |

Unknown parameters are rejected with `400`.

## Response

```json
{
  "view": null,
  "rows": [{
    "type": "task", "id": "…", "title": "…", "sourceUrl": "/task/…",
    "client": { "id": "…", "name": "…" }, "project": { "id": "…", "name": "…" },
    "owner": { "id": "…", "name": "…", "role": null },
    "state": "OVERDUE", "nextAction": "…", "dueAt": "…", "dueKind": "date", "ageDays": 3, "view": "at_risk"
  }],
  "counts": { "needs_action": 0, "awaiting_approval": 0, "waiting_on_client": 0, "at_risk": 0 },
  "total": 0,
  "sources": ["tasks", "reviews"],
  "partial": false,
  "failedSources": [],
  "truncatedSources": [],
  "generatedAt": "…"
}
```

- `counts` always covers every view, even when `view` narrows `rows`.
- `owner` is a person (`role: null`) or, for approvals, the role that decides
  (`{ "id": null, "name": "Admins", "role": "ADMIN" }`).
- `ageDays` counts whole days since the record started waiting (see the table).
- `dueKind` says how to read `dueAt`: `date` for calendar dates stored as
  midnight UTC (task and invoice due dates; the page shows them without a
  time, in UTC), `timestamp` for moments (approval expiry, proposal valid-until;
  shown with a time), `null` when there is no due date.
- Overdue means `dueAt < now`, the same rule as the dashboard, the invoice list
  and the weekly digest. A date-only due date therefore counts as overdue from
  00:00 UTC on that day, not at the end of it; the queue keeps that rule so it
  never disagrees with those screens.
- Rows are sorted by due date (undated last), then by age, oldest first.

## Source-to-view mapping

> Proposed mapping. The product owner confirms it before broader rollout
> (#461 dependencies); adjust `classify*`/`map*Row` in the service and the
> unit tests together.

| Source | Included records | View | Next action | Link | Age from |
| --- | --- | --- | --- | --- | --- |
| Task | `PENDING`/`IN_PROGRESS`/`BLOCKED`, not trashed, project not cancelled or trashed, and assigned, blocked or overdue; non-admins only their own (see below) | `BLOCKED` or past due → **at risk**; category `WAITING_CLIENT` → **waiting on client**; otherwise **needs action** | Resolve blocker / complete or reschedule / follow up / start or finish | `/task/:id` | created |
| Approval (admin only) | `PENDING`, on a project that is not trashed | **awaiting approval** (also when past `expiresAt`: it stays pending until an admin decides) | Approve or reject | `/approvals` | created |
| Review session (`ADMIN`, `TEAM`) | Current version (no newer version), status `open` or `changes_requested`, project not cancelled or trashed | `changes_requested` → **needs action**; `open` and shared with the client → **waiting on client**; `open` and internal → **awaiting approval** | Address changes / waiting on the client decision or feedback / record a decision or share | `/review/:id` | last update |
| Proposal (admin only) | `SENT`, `VIEWED` | Past `validUntil` → **at risk**; otherwise **waiting on client** | Follow up or revise / waiting on accept or decline | `/proposal/:id` | sent |
| Contract (admin only) | `SENT` | **waiting on client** | Waiting on signature | `/contracts` | created |
| Invoice (admin only) | `SENT`, `OVERDUE` | Status `OVERDUE` or past due → **at risk** (state `OVERDUE`); otherwise **waiting on client** | Chase payment / waiting on payment | `/invoices/:id` | sent |

For proposals, contracts and invoices, an email delivery status of `FAILED`,
`BOUNCED` or `COMPLAINED` moves the row to **needs action** ("check the
address and resend") ahead of the rules above.

Not included (candidates for the owner review): draft proposals and invoices,
project health (`AT_RISK`/`NEEDS_ATTENTION`), inbox threads, estimates, and
unassigned, undated, unblocked tasks (treated as backlog).

## Owner filter

Tasks follow `GET /api/tasks`: admins see every task, every other role sees
only the tasks assigned to them, whatever `owner` says.

For admins, `owner=me` keeps tasks assigned to them, the review sessions and
documents they created, and the pending approvals (the admin role owns that
decision); `owner=everyone` returns every row. For other roles `owner` only
narrows review sessions to the ones they created, so the page hides the Owner
filter from them and always asks for `everyone`: their own tasks plus the open
reviews they can open.

## Access and tenancy

- Guard: `fastify.authenticate`, then roles `ADMIN`, `TEAM` or `STAFF`; other
  principals (bots) get `403`. Client-portal sessions are refused by the
  tenancy middleware before the route runs.
- Every read uses `request.prisma`, the organization-scoped client, so rows,
  names and counts come only from the caller's organization; a client or
  project id from another organization matches nothing.
- Review sessions are read only for the roles the review routes admit
  (`REVIEW_STAFF_ROLES` in `src/services/media-review.service.js`: `ADMIN`,
  `TEAM`), so `STAFF` gets no review rows.
- Approvals and finance sources (proposals, contracts, invoices) are read only
  for `ADMIN`, matching the admin-only approval decision
  (`PATCH /api/approvals/:id`) and the admin-only approval queue and finance
  totals in the web app. Other roles never query them, so their rows and counts
  cannot leak.

## Limits and partial results

- Each source returns at most 100 rows (`WORK_QUEUE_SOURCE_LIMIT`). It reads
  one extra row to tell a full page from a truncated one: only a source with
  more than 100 matching rows is listed in `truncatedSources`, and the page
  says so.
- The page loads up to 200 clients for the Client filter (the clients route's
  maximum); a client id from a link that is not among them stays selected.
- Sources load independently. A source that throws is logged, listed in
  `failedSources`, and the response is `partial: true` with the remaining rows
  and counts. The page labels the queue as incomplete and offers a retry.

## Tests

- `src/tests/unit/work-queue.service.test.js`: row mapping, view assignment,
  sorting, counts, role source selection, partial and truncated results, query
  validation.
- `src/tests/integration/work-queue.database.test.js`: two organizations on real
  PostgreSQL; tenant isolation, admin versus team rows and counts, views,
  owner/client/project filters, bot refusal.
- `web/src/tests/WorkQueue.test.jsx`: tabs with counts and keyboard navigation,
  filters, source links, empty, partial, error and loading states, navigation.
