# Cloudflare workspace release slices

Owner instruction, 23 October 2026: finish the remaining work and deploy to Cloudflare. This authorizes an isolated Cloudflare release; keep Coolify unchanged and #684 open. Source-data migration, real invoices/charges, invitations and source cancellations remain separate.

First deployable increment: dedicated `ashbi-workspace` Worker and D1, Cloudflare Access verified JWT and explicitly provisioned actors, client/project/task/note persistence, client visibility, basic staff time tracking, responsive browser UI. No local fixture login endpoint in this application. Default-deny all application routes without a verified Access token and active actor. Separate from the earlier local-only prototype.

Use a staff-only pilot on a new workers.dev hostname, without changing hub.ashbi.ca or existing apps. Record limitations honestly: Access email OTP is paired with independent MFA in the new app policy; no client activation or sensitive source import until actual enrolment/recovery acceptance. UI must show pilot status and unavailable finance/files/signature features clearly. Deployment is not full replacement acceptance.

Next increments: private original files and recovery (#417/#282); Stripe test-mode invoice drafts and signed reconciliation (#693/#694); contract evidence (#380); migration reconciliation (#414) and daily-use acceptance (#398). R2 is disabled in the owning Cloudflare account and requires dashboard activation; do not substitute public files or silently upgrade billing.

Test-first: real D1/R2 local storage, signed JWT fixtures and forged/expired/wrong-audience/unknown/deactivated denials; foreign-client and organization denials, optimistic edit conflicts, one timer per actor, durable reload; keyboard/forms and 390/768/1440 px browser verification. Preserve all original application tests and source history.

Rollback: new service can be disabled independently without touching the current application. Preserve D1 records; no destructive rollback SQL. Export and restore before real customer data acceptance. No production import in this increment.
