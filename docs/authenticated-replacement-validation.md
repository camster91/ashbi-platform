# Authenticated replacement validation runbook

This runbook produces the target-environment evidence required before Ashbi is
described as replacing any daily-use agency system. It is intentionally not a
deployment guide, credential store, or production activation approval.

## Rules of the run

- Use a disposable sandbox tenant and provider accounts wherever a provider
  allows it. Never use customer data, live payment methods, or production
  credentials in a captured artifact.
- Record the deployed immutable revision, target URL, environment, tester role,
  browser/device, and sanitized timestamps for every run. Redact tokens,
  emails, payment identifiers, client content, and signed URLs.
- Capture a result for each listed **success**, **denial**, and **recovery**
  case. A passing happy path does not clear a capability alone.
- A run stops on an unexpected write, cross-tenant visibility, a leaked secret,
  an uncertain provider outcome, or a data-loss/recovery failure. Preserve
  evidence, disable the affected write capability when safe, and open or link
  an issue before retrying.
- "Not run", "blocked", and "failed" are valid results. They must remain
  visible rather than being converted into a pass because code or unit tests
  exist.

## Evidence record

Create one record per journey using this shape and attach it to the linked
issue or controlled internal release record:

| Field | Required value |
| --- | --- |
| Run | unique, non-secret identifier |
| Revision and target | immutable Git revision and exact sandbox/production URL |
| Scope | Ashbi organization, project, provider workspace/calendar, and role, all sanitized |
| Preconditions | migration state, approved test account, and feature configuration |
| Cases | case ID, expected result, observed result, and pass/fail/blocked |
| Artifacts | sanitized screenshots, request/correlation IDs, provider event IDs, and reconciliation reports |
| Recovery | retries performed, final durable state, and any cleanup |
| Sign-off | tester, reviewer, date, unresolved risks, and linked issue |

## 1. Core agency dogfood: ClickUp and daily docs

Run as an administrator, staff member, and restricted client where the route
permits it.

| Case | Required proof |
| --- | --- |
| Project and task lifecycle | Create, edit, assign, comment, complete, reopen, and verify role-appropriate visibility and audit history. |
| Time and status | Record time/status changes, refresh in a new session, and verify counts and permissions. |
| Failure handling | Exercise offline/network failure, expired session, 403, validation, conflict, and 5xx presentation from the [workflow state contract](workflow-state-matrix.md); entered data must not be silently lost or duplicated. |
| Docs/notes | Create, edit, organize, search, and recover a project note; verify client visibility boundaries. |
| Accessibility and responsive use | Capture keyboard/focus, screen-reader spot checks, 200% zoom, 400% reflow, and a 375px mobile journey. |

Pass condition: two representative agency projects complete their normal daily
workflow with no unexplained duplicate write or permission breach.

## 2. Notion migration pilot

Follow the controlled procedure in [notion-markdown-migration.md](notion-markdown-migration.md), then add the following evidence:

1. Export a representative but sanitized Notion project with nested pages and
   at least one unsupported asset.
2. Retain the approved pre-import backup manifest/checksum.
3. Run the importer dry run and retain its unique reconciliation report.
4. Resolve every hierarchy, changed-source, missing-destination, title, and
   unsupported-file finding; do not override it manually in the importer.
5. Run the confirmed import once, rerun the dry run, and show stable source
   keys, note counts, hierarchy, and no duplicate notes.
6. Perform authenticated editing, search, permission, export, and recovery
   checks on the imported notes before retiring the original workspace.

Pass condition: the reconciliation has no unreviewed findings, the confirmed
rerun is idempotent, and a reviewer accepts content/hierarchy fidelity.

## 3. Slack workspace and ChatGPT/Codex actions

Use a disposable Slack workspace with two Ashbi organizations and at least two
mapped project channels. Configure secrets only through the approved runtime
secret path.

| Case | Required proof |
| --- | --- |
| Install and route | OAuth or documented recovery setup shows the installation owner, scopes, active status, and an explicit project/channel mapping. Unmapped and disabled mappings are rejected. |
| Inbound security | Slack URL verification and one valid event arrive once; invalid signatures, stale timestamps, and duplicate event IDs are rejected or deduplicated without duplicate chat. |
| Outbound control | An authorized user prepares then confirms a mapped post. Capture the Ashbi action ID, mapping ID, Slack channel/timestamp, and resulting chat message. A non-admin, cross-tenant project, disabled mapping, and revoked install must fail closed. |
| AI boundary | With the ChatGPT/Codex connector, verify read context is tenant-bounded and untrusted retrieved text cannot create an action. The action preview must identify the exact target; only explicit confirmation performs the write. |
| Lifecycle | Disconnect the installation, verify tokens cannot be used, and record the retained audit metadata under the approved retention policy. |

Do not mark Slack replacement-ready from this run: thread/channel parity and
outbound retry/recovery remain open product work. An ambiguous post response
is a stop condition, not a safe automatic retry.

## 4. Google Calendar outbound pilot

With two different sandbox Google identities, verify:

1. OAuth consent, encrypted token persistence, and a visible connected state.
2. Explicit user-triggered create and update to the connecting user's primary
   calendar; capture the external event ID and reconcile displayed fields and
   time zone.
3. Idempotent repeat sync without duplicate external events.
4. Rejection for an unconnected user, a different event creator, expired or
   revoked consent, and a cross-tenant event.
5. Disconnect prevents any later sync.

Calendar selection, inbound/two-way reconciliation, recurring-event conflict
policy, and deletes remain deferred even if this pilot passes.

## 5. Bonsai revenue and client portal journey

Use Stripe test mode, a dedicated Mailgun/sandbox mailbox, and a disposable
client portal identity. Do not send a real charge or contract to a customer.

| Case | Required proof |
| --- | --- |
| Proposal | Staff creates and sends a proposal; client can view, approve or decline, and cannot access another client/project. |
| Contract | Client signs once; expiry, revoke, replay, and signed-document retention/export are tested. |
| Invoice/payment | An approved invoice leads to a Stripe test payment; repeated checkout initiation returns the same provider session through the invoice-scoped idempotency key, the webhook is processed once, a duplicate delivery is idempotent, and the final invoice/ledger state matches Stripe. |
| Email and recovery | Proposal, invoice, reminder, and failure email reach the sandbox mailbox; retry/cancellation/overdue flows preserve correct state and audit history. |
| Portal quality | At 375px and with keyboard navigation, proposal, signature, and payment journeys work without horizontal scrolling or inaccessible controls. |

Pass condition: the full proposal-to-payment chain reconciles across Ashbi,
Stripe, email, and the client portal with no manual database correction.

## 6. Media and calls

For a sandbox project, capture an authorized screen recording, upload it,
play it as an authorized user, reject unauthorized access, and exercise the
selected deletion/retention path. For calls, prove a one-to-one audio/video
call and screen share on a restrictive network using managed TURN, then record
quality/observability data. These are not Loom or Slack-call replacement proof
until retention, transcription/accessibility, support, and multi-party policy
are approved.

## 7. Backup, restore, and migration exit

1. Confirm an encrypted archive exists and is within the approved RPO.
2. Run the isolated drill from [backup-and-restore.md](backup-and-restore.md)
   against a selected archive; record sanitized counts, checksum, duration,
   achieved RPO/RTO, and cleanup result.
3. Prove off-host encrypted replication and independently approved key custody
   before treating the safety net as disaster-recovery ready.
4. For each ClickUp, Notion, Slack, and Bonsai sample, retain source inventory,
   mapping/reconciliation report, export checksum, exception list, and
   reviewer acceptance. Keep the prior system read-only until the accepted
   sample and recovery checks are complete.

## Closure decision

A capability is **target-verified** only when its required cases pass and the
evidence record is reviewed. Ashbi becomes the sole system of record only when
every row in [replacement-readiness-matrix.md](replacement-readiness-matrix.md)
has its required evidence, the operational owner accepts residual risk, and
the external governance decisions remain explicitly recorded.
