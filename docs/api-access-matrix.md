# API access matrix

<!-- GENERATED FILE: do not edit by hand. -->
<!-- Source: src/tests/unit/api-access-matrix.test.js. Regenerate with -->
<!-- `UPDATE_ACCESS_MATRIX=1 npm test`; `npm test` fails when this file is stale. -->

Every HTTP route the API registers, with the auth guard found in its
request lifecycle (route options plus hooks inherited from its plugin), as
asked for in #412. HEAD routes that Fastify derives from GET, and the
trailing-slash alias of each prefix root (`/api/x/` for `/api/x`), share
the listed route's lifecycle and are omitted.

The global `onRequest` hook in `src/index.js` only *reads* a JWT when one is
present; it never rejects an anonymous request. A route without a guard
below is therefore reachable without a session, and any check it performs
happens inside its handler. Tenant scoping (`tenancyMiddleware`) and role
checks inside handlers are not shown.

## Guards

| Access | Meaning |
| --- | --- |
| admin | `fastify.adminOnly`: valid, unrevoked staff session with role `ADMIN`. |
| staff | `fastify.authenticate`: valid, unrevoked JWT session (any role). |
| api-key | `fastify.authenticateWithApiKey`: hashed API key (AI bridge / ChatGPT actions). |
| client-portal | `clientAuth` in `client-portal.routes.js`: client portal session cookie. |
| bot-secret | `requireBotAuth` in `bot.routes.js`: bot bearer secret, fails closed without a bot tenant. |
| public | No auth hook. Each one is on the allowlist in the test, with the reason shown in the table. |

## Summary

| Access | Routes |
| --- | --- |
| admin | 34 |
| admin + staff | 6 |
| api-key | 4 |
| bot-secret | 41 |
| client-portal | 19 |
| public | 48 |
| staff | 341 |
| **total** | 493 |

## Routes by prefix

### (root)

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| OPTIONS | `*` | public | infrastructure: CORS preflight handled by @fastify/cors. |

### /api/ai

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/ai/ask` | staff |  |
| POST | `/api/ai/chat` | staff |  |
| POST | `/api/ai/client-health` | staff |  |
| POST | `/api/ai/draft-response` | staff |  |
| POST | `/api/ai/draft-update` | staff |  |
| POST | `/api/ai/generate-proposal` | staff |  |
| POST | `/api/ai/query` | staff |  |
| POST | `/api/ai/refine-response` | staff |  |
| POST | `/api/ai/summarize-project` | staff |  |
| POST | `/api/ai/triage-inbox` | staff |  |

### /api/ai-bridge

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/ai-bridge/capabilities` | api-key |  |
| POST | `/api/ai-bridge/v1/actions/:actionId/confirm` | api-key |  |
| POST | `/api/ai-bridge/v1/actions/prepare` | api-key |  |
| POST | `/api/ai-bridge/v1/chat/completions` | api-key |  |

### /api/ai-context

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/ai-context` | staff |  |
| POST | `/api/ai-context` | admin |  |
| DELETE | `/api/ai-context/:key` | admin |  |
| GET | `/api/ai-context/prompt` | staff |  |

### /api/ai-team

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/ai-team/agents` | staff |  |
| POST | `/api/ai-team/chat` | staff |  |
| GET | `/api/ai-team/history/:agentRole` | staff |  |

### /api/api-keys

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/api-keys` | staff |  |
| POST | `/api/api-keys` | staff |  |
| DELETE | `/api/api-keys/:id` | staff |  |

### /api/approvals

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/approvals/approvals` | staff |  |
| GET | `/api/approvals/approvals/:id` | staff |  |
| PATCH | `/api/approvals/approvals/:id` | admin + staff |  |
| GET | `/api/approvals/approvals/pending-count` | staff |  |

### /api/ash-chat

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/ash-chat/conversations` | staff |  |
| DELETE | `/api/ash-chat/conversations/:id` | staff |  |
| GET | `/api/ash-chat/conversations/:id/messages` | staff |  |
| POST | `/api/ash-chat/message` | staff |  |

### /api/asset-library

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/asset-library/assets` | staff |  |
| DELETE | `/api/asset-library/assets/:id` | staff |  |
| GET | `/api/asset-library/assets/:id` | staff |  |
| PATCH | `/api/asset-library/assets/:id` | staff |  |
| GET | `/api/asset-library/assets/client/:clientId` | staff |  |
| GET | `/api/asset-library/assets/search` | staff |  |
| GET | `/api/asset-library/guidelines` | staff |  |
| POST | `/api/asset-library/guidelines` | staff |  |

### /api/attachments

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/attachments` | staff |  |
| POST | `/api/attachments` | staff |  |
| DELETE | `/api/attachments/attachments/:id` | staff |  |
| GET | `/api/attachments/uploads/:filename` | staff |  |

### /api/audit-events

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/audit-events` | admin |  |
| GET | `/api/audit-events/catalog` | admin |  |

### /api/auth

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/auth/admin/clients/:clientId/invite` | staff |  |
| POST | `/api/auth/change-password` | staff |  |
| POST | `/api/auth/client/login` | public | credential exchange: Client portal password login. |
| POST | `/api/auth/client/signup` | public | credential exchange: Requires a client invitation token. |
| POST | `/api/auth/forgot-password` | public | credential exchange: Issues a reset email; response does not reveal whether the account exists. |
| POST | `/api/auth/login` | public | credential exchange: Staff password login. |
| POST | `/api/auth/login/mfa` | public | credential exchange: Second login step; requires the short-lived MFA challenge token. |
| POST | `/api/auth/logout` | public | credential exchange: Verifies the session cookie in the handler when present; always clears it. |
| GET | `/api/auth/me` | staff |  |
| PUT | `/api/auth/me` | staff |  |
| GET | `/api/auth/mfa` | staff |  |
| POST | `/api/auth/mfa/admin/users/:userId/reset` | staff |  |
| POST | `/api/auth/mfa/confirm` | staff |  |
| POST | `/api/auth/mfa/disable` | staff |  |
| POST | `/api/auth/mfa/enroll` | staff |  |
| POST | `/api/auth/register` | public | credential exchange: First-admin bootstrap gated by ADMIN_INVITE_TOKEN. |
| POST | `/api/auth/reset-password` | public | credential exchange: Requires the emailed single-use reset token. |

### /api/automations

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/automations/history` | admin |  |

### /api/bot

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/bot/activities` | bot-secret |  |
| POST | `/api/bot/activity` | bot-secret |  |
| GET | `/api/bot/approvals` | bot-secret |  |
| POST | `/api/bot/approvals` | bot-secret |  |
| GET | `/api/bot/approvals/:id` | bot-secret |  |
| PATCH | `/api/bot/approvals/:id` | bot-secret |  |
| POST | `/api/bot/auth` | public | credential exchange: Checks the bot bearer secret in the handler before issuing a JWT. |
| POST | `/api/bot/client` | bot-secret |  |
| GET | `/api/bot/client-email-map` | bot-secret |  |
| POST | `/api/bot/client-email-map` | bot-secret |  |
| GET | `/api/bot/clients` | bot-secret |  |
| POST | `/api/bot/communications` | bot-secret |  |
| GET | `/api/bot/communications/:projectId` | bot-secret |  |
| GET | `/api/bot/context/:projectId` | bot-secret |  |
| POST | `/api/bot/context/:projectId` | bot-secret |  |
| GET | `/api/bot/dashboard` | bot-secret |  |
| POST | `/api/bot/gmail-draft` | bot-secret |  |
| POST | `/api/bot/hitl/notify` | bot-secret |  |
| GET | `/api/bot/leads` | bot-secret |  |
| GET | `/api/bot/notifications` | bot-secret |  |
| POST | `/api/bot/onboard` | bot-secret |  |
| POST | `/api/bot/project` | bot-secret |  |
| GET | `/api/bot/project/:id` | bot-secret |  |
| PATCH | `/api/bot/project/:id` | bot-secret |  |
| POST | `/api/bot/project/:id/note` | bot-secret |  |
| GET | `/api/bot/projects` | bot-secret |  |
| GET | `/api/bot/projects/:id/hours` | bot-secret |  |
| GET | `/api/bot/projects/hours/summary` | bot-secret |  |
| POST | `/api/bot/reports/generate/:clientId` | bot-secret |  |
| GET | `/api/bot/reports/pending` | bot-secret |  |
| GET | `/api/bot/retainer-alerts` | bot-secret |  |
| GET | `/api/bot/retainer/:clientId` | bot-secret |  |
| GET | `/api/bot/sync` | bot-secret |  |
| GET | `/api/bot/system/gateway-status` | bot-secret |  |
| POST | `/api/bot/system/restart-gateway` | bot-secret |  |
| POST | `/api/bot/task` | bot-secret |  |
| PATCH | `/api/bot/task/:id` | bot-secret |  |
| POST | `/api/bot/tasks/bulk` | bot-secret |  |
| GET | `/api/bot/team` | bot-secret |  |
| POST | `/api/bot/thread` | bot-secret |  |
| POST | `/api/bot/thread/:id/note` | bot-secret |  |
| POST | `/api/bot/weekly-digest` | bot-secret |  |

### /api/brand

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/brand` | staff |  |
| PUT | `/api/brand` | admin |  |
| POST | `/api/brand/logo` | admin |  |

### /api/calendar

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/calendar/calendar` | staff |  |
| POST | `/api/calendar/calendar` | staff |  |
| DELETE | `/api/calendar/calendar/:id` | staff |  |
| GET | `/api/calendar/calendar/:id` | staff |  |
| PUT | `/api/calendar/calendar/:id` | staff |  |
| POST | `/api/calendar/calendar/:id/rsvp` | staff |  |
| GET | `/api/calendar/calendar/my` | staff |  |
| GET | `/api/calendar/calendar/upcoming` | staff |  |

### /api/chat

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/chat/projects/:projectId/messages` | staff |  |
| POST | `/api/chat/projects/:projectId/messages` | staff |  |
| DELETE | `/api/chat/projects/:projectId/messages/:messageId` | staff |  |
| PUT | `/api/chat/projects/:projectId/messages/:messageId` | staff |  |
| POST | `/api/chat/projects/:projectId/messages/:messageId/reactions` | staff |  |
| DELETE | `/api/chat/projects/:projectId/messages/:messageId/reactions/:emoji` | staff |  |

### /api/client-acquisition

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/client-acquisition/config` | public | public intake: Public ashbi.ca inquiry form configuration; own CORS allowlist, no cookies. |
| GET | `/api/client-acquisition/inquiries` | staff |  |
| DELETE | `/api/client-acquisition/inquiries/:id` | admin |  |
| POST | `/api/client-acquisition/intake` | public | public intake: Public ashbi.ca inquiry submission; own CORS allowlist, no cookies. |

### /api/client-portal

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/client-portal/contracts` | client-portal |  |
| GET | `/api/client-portal/contracts/:id/pdf` | client-portal |  |
| DELETE | `/api/client-portal/documents/:docId` | client-portal |  |
| GET | `/api/client-portal/documents/:docId/download` | client-portal |  |
| GET | `/api/client-portal/invoices` | client-portal |  |
| GET | `/api/client-portal/invoices/:id/pdf` | client-portal |  |
| POST | `/api/client-portal/logout` | client-portal |  |
| GET | `/api/client-portal/me` | client-portal |  |
| GET | `/api/client-portal/projects` | client-portal |  |
| GET | `/api/client-portal/projects/:id` | client-portal |  |
| GET | `/api/client-portal/projects/:id/documents` | client-portal |  |
| POST | `/api/client-portal/projects/:id/feedback` | client-portal |  |
| GET | `/api/client-portal/projects/:id/messages` | client-portal |  |
| POST | `/api/client-portal/projects/:id/messages` | client-portal |  |
| POST | `/api/client-portal/projects/:id/revisions/:revisionId/respond` | client-portal |  |
| GET | `/api/client-portal/projects/:id/tasks` | client-portal |  |
| POST | `/api/client-portal/projects/:id/upload` | client-portal |  |
| POST | `/api/client-portal/request-access` | public | magic link: Emails a client portal magic link. |
| GET | `/api/client-portal/retainer` | client-portal |  |
| GET | `/api/client-portal/unread-count` | client-portal |  |
| POST | `/api/client-portal/verify-token` | public | magic link: Exchanges the emailed magic-link token for a portal session cookie. |

### /api/clients

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/clients` | staff |  |
| POST | `/api/clients` | staff |  |
| GET | `/api/clients/:id` | staff |  |
| PUT | `/api/clients/:id` | staff |  |
| GET | `/api/clients/:id/contacts` | staff |  |
| POST | `/api/clients/:id/contacts` | staff |  |
| GET | `/api/clients/:id/insights` | staff |  |
| POST | `/api/clients/:id/notes` | staff |  |

### /api/command-center

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/command-center` | staff |  |
| GET | `/api/command-center/ping` | staff |  |

### /api/comments

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| DELETE | `/api/comments/comments/:id` | staff |  |
| PUT | `/api/comments/comments/:id` | staff |  |
| GET | `/api/comments/tasks/:taskId/comments` | staff |  |
| POST | `/api/comments/tasks/:taskId/comments` | staff |  |
| GET | `/api/comments/users/mentionable` | staff |  |

### /api/contracts

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/contracts` | staff |  |
| POST | `/api/contracts` | staff |  |
| GET | `/api/contracts/:id` | staff |  |
| GET | `/api/contracts/:id/draft` | staff |  |
| PATCH | `/api/contracts/:id/draft` | staff |  |
| GET | `/api/contracts/:id/pdf` | staff |  |
| POST | `/api/contracts/:id/public-link/revoke` | staff |  |
| POST | `/api/contracts/:id/public-link/rotate` | staff |  |
| POST | `/api/contracts/:id/resend` | staff |  |
| POST | `/api/contracts/:id/send` | staff |  |
| POST | `/api/contracts/:id/void` | staff |  |
| POST | `/api/contracts/from-proposal/:proposalId` | staff |  |
| GET | `/api/contracts/sign/:signToken` | public | capability token: Contract signing link (legacy path). |
| POST | `/api/contracts/sign/:signToken` | public | capability token: Contract signature (legacy path). |

### /api/creative-brief

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/creative-brief` | staff |  |
| DELETE | `/api/creative-brief/:id` | staff |  |
| GET | `/api/creative-brief/:id` | staff |  |
| PATCH | `/api/creative-brief/:id` | staff |  |
| GET | `/api/creative-brief/client/:clientId` | staff |  |
| POST | `/api/creative-brief/generate` | staff |  |

### /api/credentials

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/credentials` | admin |  |
| POST | `/api/credentials` | admin |  |
| DELETE | `/api/credentials/:id` | admin |  |
| GET | `/api/credentials/:id` | admin |  |
| PUT | `/api/credentials/:id` | admin |  |
| GET | `/api/credentials/:id/password` | admin |  |

### /api/dashboard

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/dashboard/stats` | staff |  |

### /api/draft

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| DELETE | `/api/draft/:entity/:id` | staff |  |
| GET | `/api/draft/:entity/:id` | staff |  |
| PUT | `/api/draft/:entity/:id` | staff |  |

### /api/email-triage

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| PUT | `/api/email-triage/approve/:draftId` | staff |  |
| PUT | `/api/email-triage/archive/:itemId` | staff |  |
| POST | `/api/email-triage/draft/:messageId` | staff |  |
| GET | `/api/email-triage/queue` | staff |  |
| POST | `/api/email-triage/scan` | staff |  |
| PUT | `/api/email-triage/update-draft/:draftId` | staff |  |

### /api/estimates

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/estimates` | staff |  |
| POST | `/api/estimates` | staff |  |
| DELETE | `/api/estimates/:id` | staff |  |
| GET | `/api/estimates/:id` | staff |  |
| PUT | `/api/estimates/:id` | staff |  |
| POST | `/api/estimates/:id/convert` | staff |  |
| POST | `/api/estimates/:id/send` | staff |  |
| GET | `/api/estimates/view/:viewToken` | public | capability token: Estimate view link. |
| POST | `/api/estimates/view/:viewToken/approve` | public | capability token: Estimate approval via view link. |

### /api/expenses

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/expenses` | staff |  |
| POST | `/api/expenses` | staff |  |
| DELETE | `/api/expenses/:id` | staff |  |
| GET | `/api/expenses/:id` | staff |  |
| PUT | `/api/expenses/:id` | staff |  |
| GET | `/api/expenses/summary` | staff |  |
| POST | `/api/expenses/upload-receipt` | staff |  |

### /api/gmail

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/gmail/draft-reply` | staff |  |
| POST | `/api/gmail/send` | staff |  |
| GET | `/api/gmail/status` | staff |  |
| POST | `/api/gmail/sync-now` | staff |  |

### /api/google-calendar

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/google-calendar/connection` | staff |  |
| POST | `/api/google-calendar/connection/disconnect` | staff |  |
| POST | `/api/google-calendar/events/:eventId/sync` | staff |  |
| GET | `/api/google-calendar/oauth/callback` | public | oauth callback: OAuth state is a signed JWT verified in the handler. |
| GET | `/api/google-calendar/oauth/start` | staff |  |

### /api/health

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/health` | public | health: Readiness probe for the deploy controller and uptime checks. |

### /api/inbox

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/inbox` | staff |  |
| GET | `/api/inbox/stats` | staff |  |
| GET | `/api/inbox/unmatched` | staff |  |
| POST | `/api/inbox/unmatched/:id/assign` | staff |  |
| POST | `/api/inbox/unmatched/:id/ignore` | staff |  |

### /api/integrations

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/integrations` | staff |  |
| GET | `/api/integrations/:type` | staff |  |
| POST | `/api/integrations/:type/connect` | staff |  |
| POST | `/api/integrations/:type/disconnect` | staff |  |
| POST | `/api/integrations/:type/sync` | staff |  |

### /api/invoice-chaser

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/invoice-chaser/chase` | staff |  |
| GET | `/api/invoice-chaser/overdue` | staff |  |

### /api/invoices

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/invoices` | staff |  |
| POST | `/api/invoices` | staff |  |
| DELETE | `/api/invoices/:id` | admin |  |
| GET | `/api/invoices/:id` | staff |  |
| PUT | `/api/invoices/:id` | staff |  |
| POST | `/api/invoices/:id/mark-paid` | staff |  |
| POST | `/api/invoices/:id/payment-link` | staff |  |
| GET | `/api/invoices/:id/payments` | staff |  |
| GET | `/api/invoices/:id/pdf` | staff |  |
| POST | `/api/invoices/:id/pdf` | staff |  |
| POST | `/api/invoices/:id/public-link/revoke` | staff |  |
| POST | `/api/invoices/:id/public-link/rotate` | staff |  |
| POST | `/api/invoices/:id/resend` | staff |  |
| POST | `/api/invoices/:id/send` | staff |  |
| POST | `/api/invoices/:id/undo-void` | admin |  |
| POST | `/api/invoices/bulk/archive` | staff |  |
| POST | `/api/invoices/bulk/mark-paid` | staff |  |
| POST | `/api/invoices/bulk/send` | staff |  |
| GET | `/api/invoices/client/:viewToken` | public | capability token: Invoice view link (legacy path). |
| POST | `/api/invoices/from-proposal/:proposalId` | staff |  |
| GET | `/api/invoices/stats` | staff |  |
| POST | `/api/invoices/stripe-webhook` | public | signed webhook: Stripe-Signature verified in the handler. |
| GET | `/api/invoices/templates` | staff |  |
| POST | `/api/invoices/templates` | staff |  |
| DELETE | `/api/invoices/templates/:id` | staff |  |

### /api/leads

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/leads/leads` | staff |  |
| PATCH | `/api/leads/leads/:id/convert` | staff |  |
| POST | `/api/leads/leads/intake` | public | public intake: Legacy public lead form (see access review notes in the #412 report). |

### /api/live

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/live` | public | health: Liveness probe; returns only status and revision. |

### /api/mailgun

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/mailgun` | public | signed webhook: Mailgun HMAC signature verified in the handler (fails closed outside dev). |
| POST | `/api/mailgun/events` | public | signed webhook: Mailgun HMAC signature and single-use token verified in the handler. |
| POST | `/api/mailgun/send` | staff |  |

### /api/mailgun-hitl

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/mailgun-hitl/hitl-reply` | public | signed webhook: Mailgun HMAC signature verified in the handler; always answers 200. |

### /api/messages

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/messages/messages/paste` | staff |  |

### /api/milestones

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| DELETE | `/api/milestones/milestones/:id` | staff |  |
| GET | `/api/milestones/milestones/:id` | staff |  |
| PUT | `/api/milestones/milestones/:id` | staff |  |
| DELETE | `/api/milestones/milestones/:id/tasks/:taskId` | staff |  |
| POST | `/api/milestones/milestones/:id/tasks/:taskId` | staff |  |
| GET | `/api/milestones/projects/:projectId/milestones` | staff |  |
| POST | `/api/milestones/projects/:projectId/milestones` | staff |  |

### /api/notes

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/notes` | staff |  |
| DELETE | `/api/notes/:id` | staff |  |
| GET | `/api/notes/:id` | staff |  |
| PUT | `/api/notes/:id` | staff |  |
| POST | `/api/notes/:id/pin` | staff |  |
| POST | `/api/notes/:id/restore` | staff |  |
| GET | `/api/notes/templates` | staff |  |

### /api/notifications

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/notifications` | staff |  |
| PATCH | `/api/notifications/:id/read` | staff |  |
| DELETE | `/api/notifications/cleanup` | admin |  |
| PATCH | `/api/notifications/read-all` | staff |  |
| GET | `/api/notifications/unread-count` | staff |  |

### /api/onboarding

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/onboarding/client` | staff |  |
| GET | `/api/onboarding/progress` | staff |  |
| POST | `/api/onboarding/progress/restart` | staff |  |
| POST | `/api/onboarding/progress/skip` | staff |  |
| POST | `/api/onboarding/progress/start` | staff |  |
| POST | `/api/onboarding/progress/tasks/skip` | staff |  |

### /api/pipeline

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/pipeline` | staff |  |
| GET | `/api/pipeline/analytics` | staff |  |
| POST | `/api/pipeline/deals` | staff |  |
| DELETE | `/api/pipeline/deals/:id` | staff |  |
| PUT | `/api/pipeline/deals/:id` | staff |  |
| POST | `/api/pipeline/stages` | staff |  |
| DELETE | `/api/pipeline/stages/:id` | staff |  |
| PUT | `/api/pipeline/stages/:id` | staff |  |

### /api/portal

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/portal/:token` | public | capability token: Project status page addressed by an unguessable project viewToken. |
| POST | `/api/portal/booking` | public | public intake: Public booking widget submission (see access review notes in the #412 report). |
| GET | `/api/portal/booking/availability` | public | public intake: Public booking widget availability (see access review notes in the #412 report). |
| GET | `/api/portal/contract/:signToken` | public | capability token: Contract signing link. |
| POST | `/api/portal/contract/:signToken/sign` | public | capability token: Contract signature via signing link. |
| GET | `/api/portal/form/:viewToken` | public | capability token: Client form link. |
| POST | `/api/portal/form/:viewToken` | public | capability token: Client form submission via form link. |
| GET | `/api/portal/invoice/:viewToken` | public | capability token: Invoice view link. |
| POST | `/api/portal/invoice/:viewToken/pay` | public | capability token: Starts checkout for the invoice behind the view link. |
| GET | `/api/portal/proposal/:viewToken` | public | capability token: Proposal view link. |
| POST | `/api/portal/proposal/:viewToken/approve` | public | capability token: Proposal approval via view link. |
| POST | `/api/portal/proposal/:viewToken/decline` | public | capability token: Proposal decline via view link. |

### /api/projects

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/projects` | staff |  |
| POST | `/api/projects` | staff |  |
| GET | `/api/projects/:id` | staff |  |
| PUT | `/api/projects/:id` | staff |  |
| POST | `/api/projects/:id/ai-plan` | staff |  |
| GET | `/api/projects/:id/budget` | staff |  |
| GET | `/api/projects/:id/communications` | staff |  |
| GET | `/api/projects/:id/communications/:communicationId` | staff |  |
| GET | `/api/projects/:id/context` | staff |  |
| POST | `/api/projects/:id/context` | staff |  |
| GET | `/api/projects/:id/health-history` | staff |  |
| GET | `/api/projects/:id/plan` | staff |  |
| POST | `/api/projects/:id/plan/refresh` | staff |  |
| GET | `/api/projects/:id/tasks` | staff |  |
| POST | `/api/projects/:id/tasks` | staff |  |
| GET | `/api/projects/:projectId/notes` | staff |  |
| POST | `/api/projects/:projectId/notes` | staff |  |
| POST | `/api/projects/:projectId/notes/from-template/:templateId` | staff |  |
| POST | `/api/projects/from-template` | staff |  |
| GET | `/api/projects/templates` | staff |  |
| POST | `/api/projects/templates` | staff |  |
| DELETE | `/api/projects/templates/:templateId` | staff |  |

### /api/proposal-builder

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/proposal-builder/:id` | staff |  |
| PUT | `/api/proposal-builder/:id` | staff |  |
| POST | `/api/proposal-builder/:id/accept` | staff |  |
| GET | `/api/proposal-builder/:id/pdf` | staff |  |
| POST | `/api/proposal-builder/:id/send` | staff |  |
| POST | `/api/proposal-builder/:id/send-pdf` | staff |  |
| POST | `/api/proposal-builder/:id/track` | public | tracking pixel: Proposal view tracking pixel (see access review notes in the #412 report). |
| POST | `/api/proposal-builder/generate` | staff |  |
| GET | `/api/proposal-builder/pricing-tiers` | staff |  |
| GET | `/api/proposal-builder/stats` | staff |  |
| GET | `/api/proposal-builder/templates` | staff |  |

### /api/proposals

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/proposals` | staff |  |
| POST | `/api/proposals` | staff |  |
| DELETE | `/api/proposals/:id` | staff |  |
| GET | `/api/proposals/:id` | staff |  |
| PUT | `/api/proposals/:id` | staff |  |
| POST | `/api/proposals/:id/duplicate` | staff |  |
| POST | `/api/proposals/:id/public-link/revoke` | staff |  |
| POST | `/api/proposals/:id/public-link/rotate` | staff |  |
| POST | `/api/proposals/:id/resend` | staff |  |
| POST | `/api/proposals/:id/send` | staff |  |
| GET | `/api/proposals/:id/versions` | staff |  |
| POST | `/api/proposals/:id/versions/:versionId/restore` | staff |  |
| POST | `/api/proposals/bulk/archive` | staff |  |
| POST | `/api/proposals/bulk/send` | staff |  |
| GET | `/api/proposals/client/:viewToken` | public | capability token: Proposal view link (legacy path). |
| POST | `/api/proposals/client/:viewToken/approve` | public | capability token: Proposal approval (legacy path). |
| POST | `/api/proposals/client/:viewToken/decline` | public | capability token: Proposal decline (legacy path). |

### /api/push

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/push/send` | admin |  |
| POST | `/api/push/subscribe` | staff |  |
| POST | `/api/push/unsubscribe` | staff |  |
| GET | `/api/push/vapid-key` | staff |  |

### /api/rate-cards

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/rate-cards` | staff |  |
| POST | `/api/rate-cards` | staff |  |
| DELETE | `/api/rate-cards/:id` | staff |  |
| GET | `/api/rate-cards/:id` | staff |  |
| PUT | `/api/rate-cards/:id` | staff |  |

### /api/realtime

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/realtime/ice-servers` | staff |  |

### /api/responses

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/responses/:id` | staff |  |
| PUT | `/api/responses/:id` | staff |  |
| POST | `/api/responses/:id/approve` | admin |  |
| POST | `/api/responses/:id/reject` | admin |  |
| POST | `/api/responses/:id/sent` | staff |  |
| POST | `/api/responses/:id/submit` | staff |  |
| POST | `/api/responses/:threadId/drafts` | staff |  |
| GET | `/api/responses/pending` | admin |  |

### /api/retainers

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/retainers/retainer` | staff |  |
| POST | `/api/retainers/retainer` | staff |  |
| GET | `/api/retainers/retainer/:clientId` | staff |  |
| PUT | `/api/retainers/retainer/:clientId` | staff |  |
| POST | `/api/retainers/retainer/:clientId/generate-invoice` | staff |  |
| POST | `/api/retainers/retainer/:clientId/log-hours` | staff |  |
| GET | `/api/retainers/retainer/:clientId/status` | staff |  |
| POST | `/api/retainers/retainer/check-all` | staff |  |

### /api/revisions

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/revisions/projects/:projectId/revisions` | staff |  |
| POST | `/api/revisions/projects/:projectId/revisions` | staff |  |
| PUT | `/api/revisions/revisions/:id` | staff |  |
| POST | `/api/revisions/revisions/:id/approve` | admin |  |

### /api/search

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/search` | staff |  |
| POST | `/api/search/ask` | staff |  |
| GET | `/api/search/similar/:threadId` | staff |  |

### /api/semantic-search

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/semantic-search/embed` | staff |  |
| DELETE | `/api/semantic-search/embeddings/:source/:sourceId` | staff |  |
| POST | `/api/semantic-search/rebuild/:clientId` | staff |  |
| GET | `/api/semantic-search/search` | staff |  |
| GET | `/api/semantic-search/stats` | staff |  |

### /api/settings

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/settings/ai-provider` | staff |  |
| POST | `/api/settings/ai-provider` | admin |  |
| GET | `/api/settings/ai-provider/ollama-models` | staff |  |
| GET | `/api/settings/assignment-rules` | staff |  |
| POST | `/api/settings/assignment-rules` | admin |  |
| DELETE | `/api/settings/assignment-rules/:id` | admin |  |
| PUT | `/api/settings/assignment-rules/:id` | admin |  |
| GET | `/api/settings/escalation` | staff |  |
| GET | `/api/settings/sla` | staff |  |
| GET | `/api/settings/templates` | staff |  |
| POST | `/api/settings/templates` | admin |  |
| DELETE | `/api/settings/templates/:id` | admin |  |
| GET | `/api/settings/templates/:id` | staff |  |
| PUT | `/api/settings/templates/:id` | admin |  |
| POST | `/api/settings/templates/:id/render` | staff |  |

### /api/slack

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/slack` | admin + staff |  |
| POST | `/api/slack/events` | public | signed webhook: Slack request signature verified before the body is trusted. |
| POST | `/api/slack/install` | admin + staff |  |
| POST | `/api/slack/installations/:installationId/disconnect` | admin + staff |  |
| POST | `/api/slack/installations/:installationId/mappings` | admin + staff |  |
| GET | `/api/slack/oauth/callback` | public | oauth callback: OAuth state is a signed JWT verified in the handler. |
| GET | `/api/slack/oauth/start` | admin + staff |  |

### /api/tasks

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/tasks` | staff |  |
| DELETE | `/api/tasks/:id` | staff |  |
| GET | `/api/tasks/:id` | staff |  |
| PUT | `/api/tasks/:id` | staff |  |
| GET | `/api/tasks/:id/breadcrumbs` | staff |  |
| POST | `/api/tasks/:id/complete` | staff |  |
| PUT | `/api/tasks/:id/content` | staff |  |
| PUT | `/api/tasks/:id/dependency` | staff |  |
| POST | `/api/tasks/:id/move` | staff |  |
| GET | `/api/tasks/:id/page` | staff |  |
| POST | `/api/tasks/:id/subpage` | staff |  |
| POST | `/api/tasks/:projectId/quick` | staff |  |
| POST | `/api/tasks/bulk-update` | staff |  |
| GET | `/api/tasks/gantt` | staff |  |
| GET | `/api/tasks/kanban/:projectId` | staff |  |
| GET | `/api/tasks/mentions/search` | staff |  |
| GET | `/api/tasks/my` | staff |  |

### /api/team

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/team` | staff |  |
| POST | `/api/team` | admin |  |
| GET | `/api/team/:id` | staff |  |
| PUT | `/api/team/:id` | admin |  |
| POST | `/api/team/:id/reset-password` | admin |  |
| GET | `/api/team/allocations` | staff |  |
| GET | `/api/team/workload` | staff |  |

### /api/templates

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/templates` | staff |  |
| POST | `/api/templates` | staff |  |
| DELETE | `/api/templates/:id` | staff |  |
| PUT | `/api/templates/:id` | staff |  |
| POST | `/api/templates/:id/apply/:projectId` | staff |  |

### /api/threads

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/threads` | staff |  |
| POST | `/api/threads` | staff |  |
| GET | `/api/threads/:id` | staff |  |
| PUT | `/api/threads/:id` | staff |  |
| POST | `/api/threads/:id/analyze` | staff |  |
| POST | `/api/threads/:id/assign` | staff |  |
| POST | `/api/threads/:id/messages` | staff |  |
| POST | `/api/threads/:id/notes` | staff |  |
| POST | `/api/threads/:id/resolve` | staff |  |
| POST | `/api/threads/:id/snooze` | staff |  |

### /api/time

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/time/projects/:projectId/time-entries` | staff |  |
| POST | `/api/time/time-entries` | staff |  |
| DELETE | `/api/time/time-entries/:id` | staff |  |
| PUT | `/api/time/time-entries/:id` | staff |  |
| GET | `/api/time/time-entries/my` | staff |  |
| GET | `/api/time/time-entries/summary` | staff |  |
| PATCH | `/api/time/timesheets/:id/approve` | staff |  |
| PATCH | `/api/time/timesheets/:id/reject` | staff |  |
| GET | `/api/time/timesheets/weekly` | staff |  |

### /api/time-sessions

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/time-sessions` | staff |  |
| POST | `/api/time-sessions/:id/stop` | staff |  |
| GET | `/api/time-sessions/running` | staff |  |

### /api/time-tracking

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| DELETE | `/api/time-tracking/:id` | staff |  |
| POST | `/api/time-tracking/:id/stop` | staff |  |
| POST | `/api/time-tracking/manual` | staff |  |
| GET | `/api/time-tracking/running` | staff |  |
| POST | `/api/time-tracking/start` | staff |  |
| POST | `/api/time-tracking/stop-all` | staff |  |
| GET | `/api/time-tracking/summary` | staff |  |

### /api/trash

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| GET | `/api/trash` | staff |  |
| DELETE | `/api/trash/:id/permanent` | admin |  |
| POST | `/api/trash/:id/restore` | staff |  |
| DELETE | `/api/trash/empty` | admin |  |

### /api/webhooks

| Method | Path | Access | Public reason |
| --- | --- | --- | --- |
| POST | `/api/webhooks/email` | public | signed webhook: Inbound email webhook; signature verified in the handler. |
| GET | `/api/webhooks/email/status` | public | health: Static liveness response for the email webhook; reads no data. |
| POST | `/api/webhooks/email/test` | staff |  |
| POST | `/api/webhooks/stripe` | public | signed webhook: Stripe-Signature verified in the handler. |
