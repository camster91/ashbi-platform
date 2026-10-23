# Cloudflare workspace release slices

Owner instruction, 23 October 2026: finish the remaining work and deploy to Cloudflare. This authorizes an isolated Cloudflare release; keep Coolify unchanged and #684 open. Source-data migration, real invoices/charges, invitations and source cancellations remain separate.

First deployable increment: dedicated `ashbi-workspace` Worker and D1, Cloudflare Access verified JWT and explicitly provisioned actors, client/project/task/note persistence, client visibility, basic staff time tracking, responsive browser UI. No local fixture login endpoint in this application. Default-deny all application routes without a verified Access token and active actor. Separate from the earlier local-only prototype.

Use a staff-only pilot on a new workers.dev hostname, without changing hub.ashbi.ca or existing apps. Record limitations honestly: Access email OTP is paired with independent MFA in the new app policy; no client activation or sensitive source import until actual enrolment/recovery acceptance. UI must show pilot status and unavailable finance/files/signature features clearly. Deployment is not full replacement acceptance.

Next increments: private original files and recovery (#417/#282); Stripe test-mode invoice drafts and signed reconciliation (#693/#694); contract evidence (#380); migration reconciliation (#414) and daily-use acceptance (#398). R2 is disabled in the owning Cloudflare account and requires dashboard activation; do not substitute public files or silently upgrade billing.

Test-first: real D1/R2 local storage, signed JWT fixtures and forged/expired/wrong-audience/unknown/deactivated denials; foreign-client and organization denials, optimistic edit conflicts, one timer per actor, durable reload; keyboard/forms and 390/768/1440 px browser verification. Preserve all original application tests and source history.

Rollback: new service can be disabled independently without touching the current application. Preserve D1 records; no destructive rollback SQL. Export and restore before real customer data acceptance. No production import in this increment.

## Private file increment (#417, stacked after #702)

Staff upload an original (1 byte–5 MiB) to an existing own-organization project, internal by default in the UI. Clients can list/download only own explicitly shared files while the parent project is also shared. All downloads pass the application's JWT/actor and scope checks; no public R2 URLs or client-supplied object keys. Deliver as `application/octet-stream`, attachment, no-store, nosniff, sandbox. Reject path/control characters in filenames; retain Unicode names. Hash and check original SHA-256, including before returning bytes.

Staff may change sharing or soft-remove/restore metadata using optimistic revisions. No route physically deletes R2 objects. Removed originals remain stored and billed until a separately reviewed retention decision. Lists page at 50 with continuation; staff list can include removed records. Clients cannot upload, restore or change sharing in this slice.

Reserve D1 metadata as pending, write a new random immutable R2 key with SHA-256 validation, then mark ready. Pending records never appear in lists/downloads. There is no distributed transaction between D1 and R2: a crash can leave pending metadata/originals, requiring administrator reconciliation, and a lost success response followed by manual retry may create another file. Do not auto-delete pending originals. This increment does not claim idempotent uploads, antivirus scanning, a complete backup/restore drill, or migration readiness.

Without a FILES binding, file endpoints return 503 and the UI explains activation is pending. No hosted binding or migration0003 activation is part of the local implementation PR while account R2 activation is blocked. Existing deployed core remains usable independently. Test actual local R2/D1, exact bytes, corruption/missing originals, foreign ownership, parent visibility, invalid/oversized streamed bodies, storage failure, stale edits and browser upload/download/remove/restore/reload. Use only synthetic bytes.

References: [R2 Workers binding and local storage](https://developers.cloudflare.com/r2/api/workers/workers-api-usage/), [R2 Workers API, integrity checks and objects](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/).
