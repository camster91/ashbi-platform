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
happens inside its handler. Role checks inside handlers are not shown.

The Tenancy column shows whether `tenancyMiddleware` scopes the route's
Prisma client to the caller's organization (`scoped`) or hands it the raw
client (`exempt`). A signed-in route marked `exempt` must confine its own
queries; the test keeps a reviewed list of those routes with the reason.

## Guards

| Access | Meaning |
| --- | --- |
| admin | `fastify.adminOnly`: valid, unrevoked staff session with role `ADMIN`. |
| staff | `fastify.authenticate`: valid, unrevoked JWT session (any role). |
| api-key | `fastify.authenticateWithApiKey`: hashed API key (AI bridge / ChatGPT actions). |
| client-portal | `clientAuth` in `client-portal.routes.js`: client portal session cookie. |
| bot-secret | `requireBotAuth` in `bot.routes.js`: bot bearer secret, fails closed without a bot tenant. |
| recent-auth | `requireRecentAuth` (`src/auth/reauth.js`): step-up re-authentication within the last 10 minutes in this session, else `403 REAUTH_REQUIRED`. Always paired with a session guard. See docs/privileged-actions.md. |
| recent-auth (access change) | `requireRecentAuthForAccessChange` in `team.routes.js`: `recent-auth`, only when the request changes the member's role or active state. |
| scope … | `requireApiKeyScope(scope)` (`src/auth/api-key-scopes.js`): the API key must carry that scope, else `403 INSUFFICIENT_SCOPE`. |
| public | No auth hook. Each one is on the allowlist in the test, with the reason shown in the table. |

## Summary

| Access | Routes |
| --- | --- |
| admin | 32 |
| admin + recent-auth | 10 |
| admin + recent-auth (access change) | 1 |
| admin + staff | 6 |
| api-key | 1 |
| api-key + scope ai_bridge:actions | 2 |
| api-key + scope ai_bridge:read | 1 |
| bot-secret | 41 |
| client-portal | 19 |
| public | 46 |
| recent-auth + staff | 1 |
| staff | 342 |
| **total** | 502 |

## Routes by prefix

### (root)

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| OPTIONS | `*` | public | scoped | infrastructure: CORS preflight handled by @fastify/cors. |

### /api/ai

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/ai/ask` | staff | scoped |  |
| POST | `/api/ai/chat` | staff | scoped |  |
| POST | `/api/ai/client-health` | staff | scoped |  |
| POST | `/api/ai/draft-response` | staff | scoped |  |
| POST | `/api/ai/draft-update` | staff | scoped |  |
| POST | `/api/ai/generate-proposal` | staff | scoped |  |
| POST | `/api/ai/query` | staff | scoped |  |
| POST | `/api/ai/refine-response` | staff | scoped |  |
| POST | `/api/ai/summarize-project` | staff | scoped |  |
| POST | `/api/ai/triage-inbox` | staff | scoped |  |

### /api/ai-bridge

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ai-bridge/capabilities` | api-key | scoped |  |
| POST | `/api/ai-bridge/v1/actions/:actionId/confirm` | api-key + scope ai_bridge:actions | scoped |  |
| POST | `/api/ai-bridge/v1/actions/prepare` | api-key + scope ai_bridge:actions | scoped |  |
| POST | `/api/ai-bridge/v1/chat/completions` | api-key + scope ai_bridge:read | scoped |  |

### /api/ai-connections

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ai-connections` | admin | scoped |  |
| POST | `/api/ai-connections/connect` | admin + recent-auth | scoped |  |
| POST | `/api/ai-connections/disable` | admin + recent-auth | scoped |  |
| POST | `/api/ai-connections/enable` | admin + recent-auth | scoped |  |
| POST | `/api/ai-connections/revoke` | admin + recent-auth | scoped |  |
| POST | `/api/ai-connections/rotate` | admin + recent-auth | scoped |  |
| PATCH | `/api/ai-connections/settings` | admin | scoped |  |
| POST | `/api/ai-connections/validate` | admin | scoped |  |

### /api/ai-context

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ai-context` | staff | scoped |  |
| POST | `/api/ai-context` | admin | scoped |  |
| DELETE | `/api/ai-context/:key` | admin | scoped |  |
| GET | `/api/ai-context/prompt` | staff | scoped |  |

### /api/ai-team

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ai-team/agents` | staff | scoped |  |
| POST | `/api/ai-team/chat` | staff | scoped |  |
| GET | `/api/ai-team/history/:agentRole` | staff | scoped |  |

### /api/api-keys

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/api-keys` | staff | scoped |  |
| POST | `/api/api-keys` | recent-auth + staff | scoped |  |
| DELETE | `/api/api-keys/:id` | staff | scoped |  |

### /api/approvals

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/approvals/approvals` | staff | scoped |  |
| GET | `/api/approvals/approvals/:id` | staff | scoped |  |
| PATCH | `/api/approvals/approvals/:id` | admin + staff | scoped |  |
| GET | `/api/approvals/approvals/pending-count` | staff | scoped |  |

### /api/ash-chat

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/ash-chat/conversations` | staff | scoped |  |
| DELETE | `/api/ash-chat/conversations/:id` | staff | scoped |  |
| GET | `/api/ash-chat/conversations/:id/messages` | staff | scoped |  |
| POST | `/api/ash-chat/message` | staff | scoped |  |

### /api/asset-library

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/asset-library/assets` | staff | scoped |  |
| DELETE | `/api/asset-library/assets/:id` | staff | scoped |  |
| GET | `/api/asset-library/assets/:id` | staff | scoped |  |
| PATCH | `/api/asset-library/assets/:id` | staff | scoped |  |
| GET | `/api/asset-library/assets/client/:clientId` | staff | scoped |  |
| GET | `/api/asset-library/assets/search` | staff | scoped |  |
| GET | `/api/asset-library/guidelines` | staff | scoped |  |
| POST | `/api/asset-library/guidelines` | staff | scoped |  |

### /api/attachments

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/attachments` | staff | scoped |  |
| POST | `/api/attachments` | staff | scoped |  |
| DELETE | `/api/attachments/attachments/:id` | staff | scoped |  |
| GET | `/api/attachments/uploads/:filename` | staff | scoped |  |

### /api/audit-events

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/audit-events` | admin | scoped |  |
| GET | `/api/audit-events/catalog` | admin | scoped |  |

### /api/auth

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/admin/clients/:clientId/invite` | staff | exempt | Admin only; the client is looked up with the admin's organizationId. |
| POST | `/api/auth/change-password` | staff | exempt | Changes only the caller's own password. |
| POST | `/api/auth/client/login` | public | exempt | credential exchange: Client portal password login. |
| POST | `/api/auth/client/signup` | public | exempt | credential exchange: Requires a client invitation token. |
| POST | `/api/auth/forgot-password` | public | exempt | credential exchange: Issues a reset email; response does not reveal whether the account exists. |
| POST | `/api/auth/login` | public | exempt | credential exchange: Staff password login. |
| POST | `/api/auth/login/mfa` | public | exempt | credential exchange: Second login step; requires the short-lived MFA challenge token. |
| POST | `/api/auth/logout` | public | exempt | credential exchange: Verifies the session cookie in the handler when present; always clears it. |
| GET | `/api/auth/me` | staff | exempt | Reads and returns only the caller's own user record. |
| PUT | `/api/auth/me` | staff | exempt | Updates only the caller's own user record. |
| GET | `/api/auth/mfa` | staff | exempt | Reads only the caller's own two-factor state. |
| POST | `/api/auth/mfa/admin/users/:userId/reset` | staff | exempt | Admin only; the target user is looked up with the admin's organizationId. |
| POST | `/api/auth/mfa/confirm` | staff | exempt | Writes only the caller's own two-factor state. |
| POST | `/api/auth/mfa/disable` | staff | exempt | Writes only the caller's own two-factor state. |
| POST | `/api/auth/mfa/enroll` | staff | exempt | Writes only the caller's own two-factor state. |
| POST | `/api/auth/reauth` | staff | exempt | Verifies only the caller's own password or second factor and writes only the caller's own MFA attempt state. |
| POST | `/api/auth/register` | public | exempt | credential exchange: First-admin bootstrap gated by ADMIN_INVITE_TOKEN; later registrations require an admin session checked in the handler. |
| POST | `/api/auth/reset-password` | public | exempt | credential exchange: Requires the emailed single-use reset token. |

### /api/automations

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/automations/history` | admin | scoped |  |

### /api/bot

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/bot/activities` | bot-secret | exempt |  |
| POST | `/api/bot/activity` | bot-secret | exempt |  |
| GET | `/api/bot/approvals` | bot-secret | exempt |  |
| POST | `/api/bot/approvals` | bot-secret | exempt |  |
| GET | `/api/bot/approvals/:id` | bot-secret | exempt |  |
| PATCH | `/api/bot/approvals/:id` | bot-secret | exempt |  |
| POST | `/api/bot/auth` | public | exempt | credential exchange: Checks the bot bearer secret in the handler before issuing a JWT. |
| POST | `/api/bot/client` | bot-secret | exempt |  |
| GET | `/api/bot/client-email-map` | bot-secret | exempt |  |
| POST | `/api/bot/client-email-map` | bot-secret | exempt |  |
| GET | `/api/bot/clients` | bot-secret | exempt |  |
| POST | `/api/bot/communications` | bot-secret | exempt |  |
| GET | `/api/bot/communications/:projectId` | bot-secret | exempt |  |
| GET | `/api/bot/context/:projectId` | bot-secret | exempt |  |
| POST | `/api/bot/context/:projectId` | bot-secret | exempt |  |
| GET | `/api/bot/dashboard` | bot-secret | exempt |  |
| POST | `/api/bot/gmail-draft` | bot-secret | exempt |  |
| POST | `/api/bot/hitl/notify` | bot-secret | exempt |  |
| GET | `/api/bot/leads` | bot-secret | exempt |  |
| GET | `/api/bot/notifications` | bot-secret | exempt |  |
| POST | `/api/bot/onboard` | bot-secret | exempt |  |
| POST | `/api/bot/project` | bot-secret | exempt |  |
| GET | `/api/bot/project/:id` | bot-secret | exempt |  |
| PATCH | `/api/bot/project/:id` | bot-secret | exempt |  |
| POST | `/api/bot/project/:id/note` | bot-secret | exempt |  |
| GET | `/api/bot/projects` | bot-secret | exempt |  |
| GET | `/api/bot/projects/:id/hours` | bot-secret | exempt |  |
| GET | `/api/bot/projects/hours/summary` | bot-secret | exempt |  |
| POST | `/api/bot/reports/generate/:clientId` | bot-secret | exempt |  |
| GET | `/api/bot/reports/pending` | bot-secret | exempt |  |
| GET | `/api/bot/retainer-alerts` | bot-secret | exempt |  |
| GET | `/api/bot/retainer/:clientId` | bot-secret | exempt |  |
| GET | `/api/bot/sync` | bot-secret | exempt |  |
| GET | `/api/bot/system/gateway-status` | bot-secret | exempt |  |
| POST | `/api/bot/system/restart-gateway` | bot-secret | exempt |  |
| POST | `/api/bot/task` | bot-secret | exempt |  |
| PATCH | `/api/bot/task/:id` | bot-secret | exempt |  |
| POST | `/api/bot/tasks/bulk` | bot-secret | exempt |  |
| GET | `/api/bot/team` | bot-secret | exempt |  |
| POST | `/api/bot/thread` | bot-secret | exempt |  |
| POST | `/api/bot/thread/:id/note` | bot-secret | exempt |  |
| POST | `/api/bot/weekly-digest` | bot-secret | exempt |  |

### /api/brand

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/brand` | staff | scoped |  |
| PUT | `/api/brand` | admin | scoped |  |
| POST | `/api/brand/logo` | admin | scoped |  |

### /api/calendar

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/calendar/calendar` | staff | scoped |  |
| POST | `/api/calendar/calendar` | staff | scoped |  |
| DELETE | `/api/calendar/calendar/:id` | staff | scoped |  |
| GET | `/api/calendar/calendar/:id` | staff | scoped |  |
| PUT | `/api/calendar/calendar/:id` | staff | scoped |  |
| POST | `/api/calendar/calendar/:id/rsvp` | staff | scoped |  |
| GET | `/api/calendar/calendar/my` | staff | scoped |  |
| GET | `/api/calendar/calendar/upcoming` | staff | scoped |  |

### /api/chat

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/chat/projects/:projectId/messages` | staff | scoped |  |
| POST | `/api/chat/projects/:projectId/messages` | staff | scoped |  |
| DELETE | `/api/chat/projects/:projectId/messages/:messageId` | staff | scoped |  |
| PUT | `/api/chat/projects/:projectId/messages/:messageId` | staff | scoped |  |
| POST | `/api/chat/projects/:projectId/messages/:messageId/reactions` | staff | scoped |  |
| DELETE | `/api/chat/projects/:projectId/messages/:messageId/reactions/:emoji` | staff | scoped |  |

### /api/client-acquisition

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/client-acquisition/config` | public | exempt | public intake: Public ashbi.ca inquiry form configuration; own CORS allowlist, no cookies. |
| GET | `/api/client-acquisition/inquiries` | staff | scoped |  |
| DELETE | `/api/client-acquisition/inquiries/:id` | admin | scoped |  |
| POST | `/api/client-acquisition/intake` | public | exempt | public intake: Public ashbi.ca inquiry submission; own CORS allowlist, no cookies. |

### /api/client-portal

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/client-portal/contracts` | client-portal | exempt |  |
| GET | `/api/client-portal/contracts/:id/pdf` | client-portal | exempt |  |
| DELETE | `/api/client-portal/documents/:docId` | client-portal | exempt |  |
| GET | `/api/client-portal/documents/:docId/download` | client-portal | exempt |  |
| GET | `/api/client-portal/invoices` | client-portal | exempt |  |
| GET | `/api/client-portal/invoices/:id/pdf` | client-portal | exempt |  |
| POST | `/api/client-portal/logout` | client-portal | exempt |  |
| GET | `/api/client-portal/me` | client-portal | exempt |  |
| GET | `/api/client-portal/projects` | client-portal | exempt |  |
| GET | `/api/client-portal/projects/:id` | client-portal | exempt |  |
| GET | `/api/client-portal/projects/:id/documents` | client-portal | exempt |  |
| POST | `/api/client-portal/projects/:id/feedback` | client-portal | exempt |  |
| GET | `/api/client-portal/projects/:id/messages` | client-portal | exempt |  |
| POST | `/api/client-portal/projects/:id/messages` | client-portal | exempt |  |
| POST | `/api/client-portal/projects/:id/revisions/:revisionId/respond` | client-portal | exempt |  |
| GET | `/api/client-portal/projects/:id/tasks` | client-portal | exempt |  |
| POST | `/api/client-portal/projects/:id/upload` | client-portal | exempt |  |
| POST | `/api/client-portal/request-access` | public | exempt | magic link: Emails a client portal magic link. |
| GET | `/api/client-portal/retainer` | client-portal | exempt |  |
| GET | `/api/client-portal/unread-count` | client-portal | exempt |  |
| POST | `/api/client-portal/verify-token` | public | exempt | magic link: Exchanges the emailed magic-link token for a portal session cookie. |

### /api/clients

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/clients` | staff | scoped |  |
| POST | `/api/clients` | staff | scoped |  |
| GET | `/api/clients/:id` | staff | scoped |  |
| PUT | `/api/clients/:id` | staff | scoped |  |
| GET | `/api/clients/:id/contacts` | staff | scoped |  |
| POST | `/api/clients/:id/contacts` | staff | scoped |  |
| GET | `/api/clients/:id/insights` | staff | scoped |  |
| POST | `/api/clients/:id/notes` | staff | scoped |  |

### /api/command-center

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/command-center` | staff | scoped |  |
| GET | `/api/command-center/ping` | staff | scoped |  |

### /api/comments

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| DELETE | `/api/comments/comments/:id` | staff | scoped |  |
| PUT | `/api/comments/comments/:id` | staff | scoped |  |
| GET | `/api/comments/tasks/:taskId/comments` | staff | scoped |  |
| POST | `/api/comments/tasks/:taskId/comments` | staff | scoped |  |
| GET | `/api/comments/users/mentionable` | staff | scoped |  |

### /api/contracts

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/contracts` | staff | scoped |  |
| POST | `/api/contracts` | staff | scoped |  |
| GET | `/api/contracts/:id` | staff | scoped |  |
| GET | `/api/contracts/:id/draft` | staff | scoped |  |
| PATCH | `/api/contracts/:id/draft` | staff | scoped |  |
| GET | `/api/contracts/:id/pdf` | staff | scoped |  |
| POST | `/api/contracts/:id/public-link/revoke` | staff | scoped |  |
| POST | `/api/contracts/:id/public-link/rotate` | staff | scoped |  |
| POST | `/api/contracts/:id/resend` | staff | scoped |  |
| POST | `/api/contracts/:id/send` | staff | scoped |  |
| POST | `/api/contracts/:id/void` | staff | scoped |  |
| POST | `/api/contracts/from-proposal/:proposalId` | staff | scoped |  |
| GET | `/api/contracts/sign/:signToken` | public | exempt | capability token: Contract signing link (legacy path). |
| POST | `/api/contracts/sign/:signToken` | public | exempt | capability token: Contract signature (legacy path). |

### /api/creative-brief

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/creative-brief` | staff | scoped |  |
| DELETE | `/api/creative-brief/:id` | staff | scoped |  |
| GET | `/api/creative-brief/:id` | staff | scoped |  |
| PATCH | `/api/creative-brief/:id` | staff | scoped |  |
| GET | `/api/creative-brief/client/:clientId` | staff | scoped |  |
| POST | `/api/creative-brief/generate` | staff | scoped |  |

### /api/credentials

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/credentials` | admin | scoped |  |
| POST | `/api/credentials` | admin | scoped |  |
| DELETE | `/api/credentials/:id` | admin | scoped |  |
| GET | `/api/credentials/:id` | admin + recent-auth | scoped |  |
| PUT | `/api/credentials/:id` | admin | scoped |  |
| GET | `/api/credentials/:id/password` | admin + recent-auth | scoped |  |

### /api/dashboard

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/dashboard/stats` | staff | scoped |  |

### /api/draft

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| DELETE | `/api/draft/:entity/:id` | staff | scoped |  |
| GET | `/api/draft/:entity/:id` | staff | scoped |  |
| PUT | `/api/draft/:entity/:id` | staff | scoped |  |

### /api/email-triage

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| PUT | `/api/email-triage/approve/:draftId` | staff | scoped |  |
| PUT | `/api/email-triage/archive/:itemId` | staff | scoped |  |
| POST | `/api/email-triage/draft/:messageId` | staff | scoped |  |
| GET | `/api/email-triage/queue` | staff | scoped |  |
| POST | `/api/email-triage/scan` | staff | scoped |  |
| PUT | `/api/email-triage/update-draft/:draftId` | staff | scoped |  |

### /api/estimates

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/estimates` | staff | scoped |  |
| POST | `/api/estimates` | staff | scoped |  |
| DELETE | `/api/estimates/:id` | staff | scoped |  |
| GET | `/api/estimates/:id` | staff | scoped |  |
| PUT | `/api/estimates/:id` | staff | scoped |  |
| POST | `/api/estimates/:id/convert` | staff | scoped |  |
| POST | `/api/estimates/:id/send` | staff | scoped |  |
| GET | `/api/estimates/view/:viewToken` | public | exempt | capability token: Estimate view link. |
| POST | `/api/estimates/view/:viewToken/approve` | public | exempt | capability token: Estimate approval via view link. |

### /api/expenses

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/expenses` | staff | scoped |  |
| POST | `/api/expenses` | staff | scoped |  |
| DELETE | `/api/expenses/:id` | staff | scoped |  |
| GET | `/api/expenses/:id` | staff | scoped |  |
| PUT | `/api/expenses/:id` | staff | scoped |  |
| GET | `/api/expenses/summary` | staff | scoped |  |
| POST | `/api/expenses/upload-receipt` | staff | scoped |  |

### /api/gmail

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/gmail/draft-reply` | staff | scoped |  |
| POST | `/api/gmail/send` | staff | scoped |  |
| GET | `/api/gmail/status` | staff | scoped |  |
| POST | `/api/gmail/sync-now` | staff | scoped |  |

### /api/google-calendar

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/google-calendar/connection` | staff | scoped |  |
| POST | `/api/google-calendar/connection/disconnect` | staff | scoped |  |
| POST | `/api/google-calendar/events/:eventId/sync` | staff | scoped |  |
| GET | `/api/google-calendar/oauth/callback` | public | scoped | oauth callback: OAuth state is a signed JWT verified in the handler. Not tenancy-exempt, so the tenant guard also requires the staff session cookie. |
| GET | `/api/google-calendar/oauth/start` | staff | scoped |  |

### /api/health

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/health` | public | exempt | health: Readiness probe for the deploy controller and uptime checks. |

### /api/inbox

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/inbox` | staff | scoped |  |
| GET | `/api/inbox/stats` | staff | scoped |  |
| GET | `/api/inbox/unmatched` | staff | scoped |  |
| POST | `/api/inbox/unmatched/:id/assign` | staff | scoped |  |
| POST | `/api/inbox/unmatched/:id/ignore` | staff | scoped |  |

### /api/integrations

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/integrations` | staff | scoped |  |
| GET | `/api/integrations/:type` | staff | scoped |  |
| POST | `/api/integrations/:type/connect` | staff | scoped |  |
| POST | `/api/integrations/:type/disconnect` | staff | scoped |  |
| POST | `/api/integrations/:type/sync` | staff | scoped |  |

### /api/invoice-chaser

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/invoice-chaser/chase` | staff | scoped |  |
| GET | `/api/invoice-chaser/overdue` | staff | scoped |  |

### /api/invoices

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/invoices` | staff | scoped |  |
| POST | `/api/invoices` | staff | scoped |  |
| DELETE | `/api/invoices/:id` | admin | scoped |  |
| GET | `/api/invoices/:id` | staff | scoped |  |
| PUT | `/api/invoices/:id` | staff | scoped |  |
| POST | `/api/invoices/:id/mark-paid` | staff | scoped |  |
| POST | `/api/invoices/:id/payment-link` | staff | scoped |  |
| GET | `/api/invoices/:id/payments` | staff | scoped |  |
| GET | `/api/invoices/:id/pdf` | staff | scoped |  |
| POST | `/api/invoices/:id/pdf` | staff | scoped |  |
| POST | `/api/invoices/:id/public-link/revoke` | staff | scoped |  |
| POST | `/api/invoices/:id/public-link/rotate` | staff | scoped |  |
| POST | `/api/invoices/:id/resend` | staff | scoped |  |
| POST | `/api/invoices/:id/send` | staff | scoped |  |
| POST | `/api/invoices/:id/undo-void` | admin | scoped |  |
| POST | `/api/invoices/bulk/archive` | staff | scoped |  |
| POST | `/api/invoices/bulk/mark-paid` | staff | scoped |  |
| POST | `/api/invoices/bulk/send` | staff | scoped |  |
| GET | `/api/invoices/client/:viewToken` | public | exempt | capability token: Invoice view link (legacy path). |
| POST | `/api/invoices/from-proposal/:proposalId` | staff | scoped |  |
| GET | `/api/invoices/stats` | staff | scoped |  |
| POST | `/api/invoices/stripe-webhook` | public | exempt | signed webhook: Stripe-Signature verified in the handler. |
| GET | `/api/invoices/templates` | staff | scoped |  |
| POST | `/api/invoices/templates` | staff | scoped |  |
| DELETE | `/api/invoices/templates/:id` | staff | scoped |  |

### /api/leads

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/leads/leads` | staff | scoped |  |
| PATCH | `/api/leads/leads/:id/convert` | staff | scoped |  |

### /api/live

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/live` | public | exempt | health: Liveness probe; returns only status and revision. |

### /api/mailgun

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/mailgun` | public | exempt | signed webhook: Mailgun HMAC signature verified in the handler (fails closed outside dev). |
| POST | `/api/mailgun/events` | public | exempt | signed webhook: Mailgun HMAC signature and single-use token verified in the handler. |
| POST | `/api/mailgun/send` | staff | exempt | Admin only; sends one email and reads no tenant data. |

### /api/mailgun-hitl

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/mailgun-hitl/hitl-reply` | public | exempt | signed webhook: Mailgun HMAC signature verified in the handler; always answers 200. |

### /api/messages

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/messages/messages/paste` | staff | scoped |  |

### /api/milestones

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| DELETE | `/api/milestones/milestones/:id` | staff | scoped |  |
| GET | `/api/milestones/milestones/:id` | staff | scoped |  |
| PUT | `/api/milestones/milestones/:id` | staff | scoped |  |
| DELETE | `/api/milestones/milestones/:id/tasks/:taskId` | staff | scoped |  |
| POST | `/api/milestones/milestones/:id/tasks/:taskId` | staff | scoped |  |
| GET | `/api/milestones/projects/:projectId/milestones` | staff | scoped |  |
| POST | `/api/milestones/projects/:projectId/milestones` | staff | scoped |  |

### /api/notes

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/notes` | staff | scoped |  |
| DELETE | `/api/notes/:id` | staff | scoped |  |
| GET | `/api/notes/:id` | staff | scoped |  |
| PUT | `/api/notes/:id` | staff | scoped |  |
| POST | `/api/notes/:id/pin` | staff | scoped |  |
| POST | `/api/notes/:id/restore` | staff | scoped |  |
| GET | `/api/notes/templates` | staff | scoped |  |

### /api/notifications

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/notifications` | staff | scoped |  |
| PATCH | `/api/notifications/:id/read` | staff | scoped |  |
| DELETE | `/api/notifications/cleanup` | admin | scoped |  |
| PATCH | `/api/notifications/read-all` | staff | scoped |  |
| GET | `/api/notifications/unread-count` | staff | scoped |  |

### /api/onboarding

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/onboarding/client` | staff | scoped |  |
| GET | `/api/onboarding/progress` | staff | scoped |  |
| POST | `/api/onboarding/progress/restart` | staff | scoped |  |
| POST | `/api/onboarding/progress/skip` | staff | scoped |  |
| POST | `/api/onboarding/progress/start` | staff | scoped |  |
| POST | `/api/onboarding/progress/tasks/skip` | staff | scoped |  |

### /api/pipeline

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/pipeline` | staff | scoped |  |
| GET | `/api/pipeline/analytics` | staff | scoped |  |
| POST | `/api/pipeline/deals` | staff | scoped |  |
| DELETE | `/api/pipeline/deals/:id` | staff | scoped |  |
| PUT | `/api/pipeline/deals/:id` | staff | scoped |  |
| POST | `/api/pipeline/stages` | staff | scoped |  |
| DELETE | `/api/pipeline/stages/:id` | staff | scoped |  |
| PUT | `/api/pipeline/stages/:id` | staff | scoped |  |

### /api/portal

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/portal/:token` | public | exempt | capability token: Project status page addressed by an unguessable project viewToken. |
| POST | `/api/portal/booking` | public | exempt | public intake: Public booking page submission; books into the one booking organization only. |
| GET | `/api/portal/booking/availability` | public | exempt | public intake: Public booking page availability; returns free/busy slots for the one booking organization only. |
| GET | `/api/portal/contract/:signToken` | public | exempt | capability token: Contract signing link. |
| POST | `/api/portal/contract/:signToken/sign` | public | exempt | capability token: Contract signature via signing link. |
| GET | `/api/portal/form/:viewToken` | public | exempt | capability token: Client form link. |
| POST | `/api/portal/form/:viewToken` | public | exempt | capability token: Client form submission via form link. |
| GET | `/api/portal/invoice/:viewToken` | public | exempt | capability token: Invoice view link. |
| POST | `/api/portal/invoice/:viewToken/pay` | public | exempt | capability token: Starts checkout for the invoice behind the view link. |
| GET | `/api/portal/proposal/:viewToken` | public | exempt | capability token: Proposal view link. |
| POST | `/api/portal/proposal/:viewToken/approve` | public | exempt | capability token: Proposal approval via view link. |
| POST | `/api/portal/proposal/:viewToken/decline` | public | exempt | capability token: Proposal decline via view link. |

### /api/projects

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/projects` | staff | scoped |  |
| POST | `/api/projects` | staff | scoped |  |
| GET | `/api/projects/:id` | staff | scoped |  |
| PUT | `/api/projects/:id` | staff | scoped |  |
| POST | `/api/projects/:id/ai-plan` | staff | scoped |  |
| GET | `/api/projects/:id/budget` | staff | scoped |  |
| GET | `/api/projects/:id/communications` | staff | scoped |  |
| GET | `/api/projects/:id/communications/:communicationId` | staff | scoped |  |
| GET | `/api/projects/:id/context` | staff | scoped |  |
| POST | `/api/projects/:id/context` | staff | scoped |  |
| GET | `/api/projects/:id/health-history` | staff | scoped |  |
| GET | `/api/projects/:id/plan` | staff | scoped |  |
| POST | `/api/projects/:id/plan/refresh` | staff | scoped |  |
| GET | `/api/projects/:id/tasks` | staff | scoped |  |
| POST | `/api/projects/:id/tasks` | staff | scoped |  |
| GET | `/api/projects/:projectId/notes` | staff | scoped |  |
| POST | `/api/projects/:projectId/notes` | staff | scoped |  |
| POST | `/api/projects/:projectId/notes/from-template/:templateId` | staff | scoped |  |
| POST | `/api/projects/from-template` | staff | scoped |  |
| GET | `/api/projects/templates` | staff | scoped |  |
| POST | `/api/projects/templates` | staff | scoped |  |
| DELETE | `/api/projects/templates/:templateId` | staff | scoped |  |

### /api/proposal-builder

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/proposal-builder/:id` | staff | scoped |  |
| PUT | `/api/proposal-builder/:id` | staff | scoped |  |
| POST | `/api/proposal-builder/:id/accept` | staff | scoped |  |
| GET | `/api/proposal-builder/:id/pdf` | staff | scoped |  |
| POST | `/api/proposal-builder/:id/send` | staff | scoped |  |
| POST | `/api/proposal-builder/:id/send-pdf` | staff | scoped |  |
| POST | `/api/proposal-builder/:id/track` | staff | scoped |  |
| POST | `/api/proposal-builder/generate` | staff | scoped |  |
| GET | `/api/proposal-builder/pricing-tiers` | staff | scoped |  |
| GET | `/api/proposal-builder/stats` | staff | scoped |  |
| GET | `/api/proposal-builder/templates` | staff | scoped |  |

### /api/proposals

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/proposals` | staff | scoped |  |
| POST | `/api/proposals` | staff | scoped |  |
| DELETE | `/api/proposals/:id` | staff | scoped |  |
| GET | `/api/proposals/:id` | staff | scoped |  |
| PUT | `/api/proposals/:id` | staff | scoped |  |
| POST | `/api/proposals/:id/duplicate` | staff | scoped |  |
| POST | `/api/proposals/:id/public-link/revoke` | staff | scoped |  |
| POST | `/api/proposals/:id/public-link/rotate` | staff | scoped |  |
| POST | `/api/proposals/:id/resend` | staff | scoped |  |
| POST | `/api/proposals/:id/send` | staff | scoped |  |
| GET | `/api/proposals/:id/versions` | staff | scoped |  |
| POST | `/api/proposals/:id/versions/:versionId/restore` | staff | scoped |  |
| POST | `/api/proposals/bulk/archive` | staff | scoped |  |
| POST | `/api/proposals/bulk/send` | staff | scoped |  |
| GET | `/api/proposals/client/:viewToken` | public | exempt | capability token: Proposal view link (legacy path). |
| POST | `/api/proposals/client/:viewToken/approve` | public | exempt | capability token: Proposal approval (legacy path). |
| POST | `/api/proposals/client/:viewToken/decline` | public | exempt | capability token: Proposal decline (legacy path). |

### /api/push

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/push/send` | admin | scoped |  |
| POST | `/api/push/subscribe` | staff | scoped |  |
| POST | `/api/push/unsubscribe` | staff | scoped |  |
| GET | `/api/push/vapid-key` | staff | scoped |  |

### /api/rate-cards

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/rate-cards` | staff | scoped |  |
| POST | `/api/rate-cards` | staff | scoped |  |
| DELETE | `/api/rate-cards/:id` | staff | scoped |  |
| GET | `/api/rate-cards/:id` | staff | scoped |  |
| PUT | `/api/rate-cards/:id` | staff | scoped |  |

### /api/realtime

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/realtime/ice-servers` | staff | scoped |  |

### /api/responses

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/responses/:id` | staff | scoped |  |
| PUT | `/api/responses/:id` | staff | scoped |  |
| POST | `/api/responses/:id/approve` | admin | scoped |  |
| POST | `/api/responses/:id/reject` | admin | scoped |  |
| POST | `/api/responses/:id/sent` | staff | scoped |  |
| POST | `/api/responses/:id/submit` | staff | scoped |  |
| POST | `/api/responses/:threadId/drafts` | staff | scoped |  |
| GET | `/api/responses/pending` | admin | scoped |  |

### /api/retainers

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/retainers/retainer` | staff | scoped |  |
| POST | `/api/retainers/retainer` | staff | scoped |  |
| GET | `/api/retainers/retainer/:clientId` | staff | scoped |  |
| PUT | `/api/retainers/retainer/:clientId` | staff | scoped |  |
| POST | `/api/retainers/retainer/:clientId/generate-invoice` | staff | scoped |  |
| POST | `/api/retainers/retainer/:clientId/log-hours` | staff | scoped |  |
| GET | `/api/retainers/retainer/:clientId/status` | staff | scoped |  |
| POST | `/api/retainers/retainer/check-all` | staff | scoped |  |

### /api/revisions

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/revisions/projects/:projectId/revisions` | staff | scoped |  |
| POST | `/api/revisions/projects/:projectId/revisions` | staff | scoped |  |
| PUT | `/api/revisions/revisions/:id` | staff | scoped |  |
| POST | `/api/revisions/revisions/:id/approve` | admin | scoped |  |

### /api/search

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/search` | staff | scoped |  |
| POST | `/api/search/ask` | staff | scoped |  |
| GET | `/api/search/similar/:threadId` | staff | scoped |  |

### /api/semantic-search

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/semantic-search/embed` | staff | scoped |  |
| DELETE | `/api/semantic-search/embeddings/:source/:sourceId` | staff | scoped |  |
| POST | `/api/semantic-search/rebuild/:clientId` | staff | scoped |  |
| GET | `/api/semantic-search/search` | staff | scoped |  |
| GET | `/api/semantic-search/stats` | staff | scoped |  |

### /api/settings

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/settings/ai-kill-switch` | admin + recent-auth | scoped |  |
| GET | `/api/settings/ai-provider` | staff | scoped |  |
| POST | `/api/settings/ai-provider` | admin + recent-auth | scoped |  |
| GET | `/api/settings/ai-provider/ollama-models` | staff | scoped |  |
| GET | `/api/settings/assignment-rules` | staff | scoped |  |
| POST | `/api/settings/assignment-rules` | admin | scoped |  |
| DELETE | `/api/settings/assignment-rules/:id` | admin | scoped |  |
| PUT | `/api/settings/assignment-rules/:id` | admin | scoped |  |
| GET | `/api/settings/escalation` | staff | scoped |  |
| GET | `/api/settings/sla` | staff | scoped |  |
| GET | `/api/settings/templates` | staff | scoped |  |
| POST | `/api/settings/templates` | admin | scoped |  |
| DELETE | `/api/settings/templates/:id` | admin | scoped |  |
| GET | `/api/settings/templates/:id` | staff | scoped |  |
| PUT | `/api/settings/templates/:id` | admin | scoped |  |
| POST | `/api/settings/templates/:id/render` | staff | scoped |  |

### /api/slack

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/slack` | admin + staff | scoped |  |
| POST | `/api/slack/events` | public | exempt | signed webhook: Slack request signature verified before the body is trusted. |
| POST | `/api/slack/install` | admin + staff | scoped |  |
| POST | `/api/slack/installations/:installationId/disconnect` | admin + staff | scoped |  |
| POST | `/api/slack/installations/:installationId/mappings` | admin + staff | scoped |  |
| GET | `/api/slack/oauth/callback` | public | exempt | oauth callback: OAuth state is a signed JWT verified in the handler. |
| GET | `/api/slack/oauth/start` | admin + staff | scoped |  |

### /api/tasks

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/tasks` | staff | scoped |  |
| DELETE | `/api/tasks/:id` | staff | scoped |  |
| GET | `/api/tasks/:id` | staff | scoped |  |
| PUT | `/api/tasks/:id` | staff | scoped |  |
| GET | `/api/tasks/:id/breadcrumbs` | staff | scoped |  |
| POST | `/api/tasks/:id/complete` | staff | scoped |  |
| PUT | `/api/tasks/:id/content` | staff | scoped |  |
| PUT | `/api/tasks/:id/dependency` | staff | scoped |  |
| POST | `/api/tasks/:id/move` | staff | scoped |  |
| GET | `/api/tasks/:id/page` | staff | scoped |  |
| POST | `/api/tasks/:id/subpage` | staff | scoped |  |
| POST | `/api/tasks/:projectId/quick` | staff | scoped |  |
| POST | `/api/tasks/bulk-update` | staff | scoped |  |
| GET | `/api/tasks/gantt` | staff | scoped |  |
| GET | `/api/tasks/kanban/:projectId` | staff | scoped |  |
| GET | `/api/tasks/mentions/search` | staff | scoped |  |
| GET | `/api/tasks/my` | staff | scoped |  |

### /api/team

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/team` | staff | scoped |  |
| POST | `/api/team` | admin | scoped |  |
| GET | `/api/team/:id` | staff | scoped |  |
| PUT | `/api/team/:id` | admin + recent-auth (access change) | scoped |  |
| POST | `/api/team/:id/reset-password` | admin + recent-auth | scoped |  |
| GET | `/api/team/allocations` | staff | scoped |  |
| GET | `/api/team/workload` | staff | scoped |  |

### /api/templates

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/templates` | staff | scoped |  |
| POST | `/api/templates` | staff | scoped |  |
| DELETE | `/api/templates/:id` | staff | scoped |  |
| PUT | `/api/templates/:id` | staff | scoped |  |
| POST | `/api/templates/:id/apply/:projectId` | staff | scoped |  |

### /api/threads

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/threads` | staff | scoped |  |
| POST | `/api/threads` | staff | scoped |  |
| GET | `/api/threads/:id` | staff | scoped |  |
| PUT | `/api/threads/:id` | staff | scoped |  |
| POST | `/api/threads/:id/analyze` | staff | scoped |  |
| POST | `/api/threads/:id/assign` | staff | scoped |  |
| POST | `/api/threads/:id/messages` | staff | scoped |  |
| POST | `/api/threads/:id/notes` | staff | scoped |  |
| POST | `/api/threads/:id/resolve` | staff | scoped |  |
| POST | `/api/threads/:id/snooze` | staff | scoped |  |

### /api/time

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/time/projects/:projectId/time-entries` | staff | scoped |  |
| POST | `/api/time/time-entries` | staff | scoped |  |
| DELETE | `/api/time/time-entries/:id` | staff | scoped |  |
| PUT | `/api/time/time-entries/:id` | staff | scoped |  |
| GET | `/api/time/time-entries/my` | staff | scoped |  |
| GET | `/api/time/time-entries/summary` | staff | scoped |  |
| PATCH | `/api/time/timesheets/:id/approve` | staff | scoped |  |
| PATCH | `/api/time/timesheets/:id/reject` | staff | scoped |  |
| GET | `/api/time/timesheets/weekly` | staff | scoped |  |

### /api/time-sessions

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/time-sessions` | staff | scoped |  |
| POST | `/api/time-sessions/:id/stop` | staff | scoped |  |
| GET | `/api/time-sessions/running` | staff | scoped |  |

### /api/time-tracking

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| DELETE | `/api/time-tracking/:id` | staff | scoped |  |
| POST | `/api/time-tracking/:id/stop` | staff | scoped |  |
| POST | `/api/time-tracking/manual` | staff | scoped |  |
| GET | `/api/time-tracking/running` | staff | scoped |  |
| POST | `/api/time-tracking/start` | staff | scoped |  |
| POST | `/api/time-tracking/stop-all` | staff | scoped |  |
| GET | `/api/time-tracking/summary` | staff | scoped |  |

### /api/trash

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| GET | `/api/trash` | staff | scoped |  |
| DELETE | `/api/trash/:id/permanent` | admin | scoped |  |
| POST | `/api/trash/:id/restore` | staff | scoped |  |
| DELETE | `/api/trash/empty` | admin | scoped |  |

### /api/webhooks

| Method | Path | Access | Tenancy | Notes |
| --- | --- | --- | --- | --- |
| POST | `/api/webhooks/email` | public | exempt | signed webhook: Inbound email webhook; signature verified in the handler. |
| GET | `/api/webhooks/email/status` | public | exempt | health: Static liveness response for the email webhook; reads no data. |
| POST | `/api/webhooks/email/test` | staff | exempt | Admin only; runs the email pipeline inside the admin's organization via runTenantJob. |
| POST | `/api/webhooks/stripe` | public | exempt | signed webhook: Stripe-Signature verified in the handler. |
