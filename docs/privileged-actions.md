# Privileged-action policy

Status: **proposal for owner approval** (#416). The mechanisms below are
implemented; the choices marked *Proposal* are defaults the owner should
confirm or change before this is treated as policy.

Issue #416 acceptance items this covers:

- Sensitive administrative actions require the defined re-authentication or
  approval and emit a durable audit event.
- Service credentials are scoped, expiring or rotated, revocable, and never
  exposed in ordinary logs or exports.
- Tests show denial for expired, revoked, insufficient-role and stale-session
  access.
- Administrative impersonation and emergency (break-glass) access are
  exceptional, time-bounded, approved, visible to the affected organization
  and audited.

## Step-up re-authentication

A signed-in session is not enough for the actions listed below. The user must
also have re-authenticated **in the same session within the last 10 minutes**
(*Proposal*: the 10-minute window, `REAUTH_TTL_SECONDS` in
`src/auth/reauth.js`).

### `POST /api/auth/reauth`

| Account | Body | Checked with |
| --- | --- | --- |
| Two-factor enabled | `{ "code": "123456" }` or `{ "code": "abcd-efgh-jkmn-pqrs" }` (recovery code) | `verifySecondFactor`: the same per-account attempt budget and 15-minute lockout as sign-in. A password is refused with `400 MFA_CODE_REQUIRED`. A recovery code is consumed, revokes the account's other sessions, and reissues this session's cookie. |
| Password only | `{ "password": "…" }` | bcrypt; the route has the same per-IP limit as `/login` (20 per 15 minutes), plus a per-account budget of 10 failures per 15 minutes (`429 REAUTH_LOCKED`). |

On success the response sets the `reauth` cookie: httpOnly, `sameSite=strict`,
`secure` in production, path `/`, max-age 600 seconds. Its value is an HS256
JWT signed with a key derived from `JWT_SECRET` (not the session key, so it can
never be used as a session or vice versa) and bound to:

- the user id,
- the account's `sessionVersion`,
- the issuing session's `jti`, or its `iat` when the session token has no `jti`
  (session tokens currently have none).

It is therefore stale after sign-out, a password change or reset, any MFA
change, a recovery-code use, or an admin revocation, and cannot be carried to
another session of the same user. Sign-out also clears the cookie. Session
tokens issued in the same second for the same user share an `iat`; that is the
granularity of the binding.

Failures answer `400` (wrong password or code; a `401` would read as an
expired session and sign the browser out) or `429` (two-factor lockout or rate
limit).

### The guard

`requireRecentAuth` (`src/auth/reauth.js`) is a `preHandler` that runs after a
session guard (`fastify.authenticate` / `fastify.adminOnly`). It answers

```json
403 { "error": "Confirm your identity to continue.", "code": "REAUTH_REQUIRED" }
```

when the cookie is missing, forged, expired, for another user, or stale (wrong
`sessionVersion` or session binding). It is not an authentication guard by
itself; the API access matrix test fails if a route carries it without a
session guard, and shows it as `recent-auth` in
[api-access-matrix.md](api-access-matrix.md).

The web app handles the `403` centrally (`web/src/lib/api.js`): it opens
`ReauthDialog`, calls `/api/auth/reauth`, and retries the original request
once.

### Guarded actions

*Proposal*: list membership.

| Action | Route | How it is protected |
| --- | --- | --- |
| Create an API key | `POST /api/api-keys` | `requireRecentAuth` |
| Change a member's role, or deactivate / reactivate a member | `PUT /api/team/:id` | `requireRecentAuthForAccessChange`: `requireRecentAuth` only when the role or active state actually changes; name, skills and capacity edits are not prompted |
| Reset another member's password | `POST /api/team/:id/reset-password` | `requireRecentAuth` (added beyond the issue's list: it hands the admin the member's account) |
| Reveal a stored credential | `GET /api/credentials/:id`, `GET /api/credentials/:id/password` | `requireRecentAuth` (in addition to the existing purpose-tagged credential-access audit) |
| Switch the deployment AI provider or model | `POST /api/settings/ai-provider` | `requireRecentAuth` (in addition to the platform-operator check) |
| Turn the deployment AI kill switch on or off | `POST /api/settings/ai-kill-switch` | `requireRecentAuth` (in addition to the platform-operator check) |
| Connect, rotate or revoke the organization's AI provider key | `POST /api/ai-connections/connect`, `/rotate`, `/revoke` | `requireRecentAuth` (ADMIN). The key is validated with the provider before it is stored or replaced; see [ai-byok.md](ai-byok.md) |
| Turn AI off or on for the organization | `POST /api/ai-connections/disable`, `/enable` | `requireRecentAuth` (ADMIN) |
| Approve or reject an action an AI prepared | `POST /api/ai-tools/approvals/:id/approve`, `/reject` | `requireRecentAuth` (staff: ADMIN for any action in the organization, TEAM for their own). Every queued action is a prepare or execute tool; see [ai-tool-registry.md](ai-tool-registry.md). The AI bridge's own `POST /api/ai-bridge/v1/actions/:actionId/confirm` stays an API-key confirmation by the key's owner (an API key cannot re-authenticate); its receipt records `method: api_key_confirm` |
| Start viewing as a team member or client user (support impersonation) | `POST /api/auth/impersonation` | `requireRecentAuth` (ADMIN), plus a written reason; see [Support impersonation](#support-impersonation) |
| Create a client share link for a media review (*Proposal*, #417) | `POST /api/reviews/:id/share-links` | `requireRecentAuth` (ADMIN or TEAM). The link exposes the review session, its file, annotations and decisions outside the tenant; it expires (14 days by default, at most 90) and is revocable. Revoking is not guarded: it only removes access. See [media-review.md](media-review.md) |
| Discard dead-lettered domain events so later events of the same aggregate can proceed (*Proposal*, #412) | `POST /api/domain-events/discard` | `requireRecentAuth` (ADMIN). Only `dead` events of the caller's organization, at most 50 per call, with a reason (`poison_payload`, `consumer_retired`, `superseded`, `other`); terminal; each writes a `domain_event.discarded` audit event. See [event-outbox.md](event-outbox.md) |
| Requeue dead-lettered domain events (*Proposal*, #412) | `POST /api/domain-events/replay` | `requireRecentAuth` (ADMIN). Only `dead` events of the caller's organization, at most 50 per call and 5 replays per event; each requeue writes a `domain_event.replayed` audit event. Subscribers receive the event again (at-least-once). See [event-outbox.md](event-outbox.md) |
| Disable own two-factor | `POST /api/auth/mfa/disable` | Unchanged: already requires the current password **and** a TOTP or recovery code in the request itself, which is stricter than the window |
| Reset another member's two-factor | `POST /api/auth/mfa/admin/users/:userId/reset` | Unchanged: already requires the admin's password in the request, and the admin's own TOTP or recovery code when the admin has two-factor on |

Not applicable today:

- **Rotating an API key**: there is no rotation endpoint; rotate by creating a
  new key (guarded) and revoking the old one. Revocation is not guarded: it
  only removes access.
- **Organization-wide data export**: there is no HTTP export route. The
  workspace export is the operator CLI `scripts/export-workspace.js`, which
  runs with database access, not a user session.
- **Credential vault export**: there is no bulk export; the list route returns
  masked passwords only.

Not guarded (*Proposal*): re-checking the stored AI key
(`POST /api/ai-connections/validate`) and changing the AI models or monthly
budget (`PATCH /api/ai-connections/settings`); both are admin-only and
audited.

Candidates for the owner to consider adding: creating a member with the
`ADMIN` role (`POST /api/team`), inviting an admin through
`POST /api/auth/register`, and deleting stored credentials.

### Audit events

| Event | When | Metadata |
| --- | --- | --- |
| `auth.reauthenticated` | Successful re-authentication | `method`: `password`, `totp` or `recovery_code` |
| `auth.reauth_failed` | Rejected password or code | `reason`: `invalid_password`, `invalid`, `replayed` or `locked`. Throttled to one per account per 60 seconds, like `auth.login_failed` |
| `auth.mfa_recovery_code_used` | Re-authenticated with a recovery code | `remaining` |

Support impersonation and break-glass have their own events
(`impersonation.started`, `impersonation.ended`, `break_glass.granted`,
`break_glass.redeemed`, `break_glass.revoked`).

The guarded actions keep emitting their own events (`api_key.created`,
`user.role_changed`, `user.deactivated`, `user.reactivated`,
`auth.password_changed`, `settings.ai_provider_changed`, `ai.disabled`,
`ai.enabled`, `ai.connection_connected`, `ai.connection_rotated`,
`ai.connection_revoked`, `ai.tool_approved`, `ai.tool_rejected`,
`ai.tool_executed`, `ai.tool_failed`, `review.share_link_created`, and the
credential vault's access records). See [audit-events.md](audit-events.md).

## API keys (service credentials)

API keys authenticate the AI bridge (`/api/ai-bridge/*`, see
[chatgpt-connector.md](chatgpt-connector.md)).

| Property | Rule |
| --- | --- |
| Scoped | Each new key needs at least one scope from a closed catalogue (`API_KEY_SCOPES` in `src/auth/api-key-scopes.js`). Routes check it with `requireApiKeyScope`; a missing scope answers `403 { code: "INSUFFICIENT_SCOPE", requiredScope }`. |
| Expiring | A new key must expire: 90 days by default, at most 365 days (*Proposal*: both numbers). Longer or past expiries are rejected with `400`. |
| Revocable | `DELETE /api/api-keys/:id` sets `isActive = false` and `revokedAt`. Authentication rejects a key with either set, an expired key, and a key whose owner is deactivated. |
| Secret | Only the SHA-256 of the key is stored; the raw key is returned once at creation. Audit metadata records scopes and expiry, never the key or its hash. Request and application logs redact `authorization`, `x-api-key`, `cookie` and `set-cookie` headers and `apiKey` / `password` fields (`src/utils/log-redaction.js`). |
| Created under step-up | `POST /api/api-keys` requires recent re-authentication. |

Scope catalogue, derived from the bridge routes:

| Scope | Routes |
| --- | --- |
| `ai_bridge:read` | `POST /api/ai-bridge/v1/chat/completions` (read-only chat over the organization's projects, tasks, clients, threads and retainers) |
| `ai_bridge:actions` | `POST /api/ai-bridge/v1/actions/prepare`, `POST /api/ai-bridge/v1/actions/:actionId/confirm` (workflow writes; the owner's role must also be `ADMIN` or `TEAM`) |
| any valid key | `GET /api/ai-bridge/capabilities` (also lists the key's granted scopes) |

### Existing keys

Migration `20260925140000_api_key_scopes_revocation` keeps every existing
key's access, and gives keys without an expiry a sunset date:

- every existing key is backfilled with both scopes, which is exactly the
  access every key had before scopes existed;
- active keys created without an expiry get `expiresAt = migration time + 90
  days` (service credentials must expire or rotate). They keep working until
  then; the settings list shows the date so the owner can replace them in
  time. **Operator action:** after deploying, tell owners of such keys (for
  example the ChatGPT connector) to rotate them before that date. The
  **No expiry** flag (`noExpiry: true` in `GET /api/api-keys`) remains for
  any key that still has no expiry;
- keys already revoked (`isActive = false`) get `revokedAt` set to their last
  update time.

## Support impersonation

An administrator can see the app exactly as one member of their organization
sees it, to reproduce a support problem, without knowing or resetting that
person's password. Code: `src/auth/impersonation.js`,
`src/routes/privileged-access.routes.js`, the hook in `src/index.js`, and
`web/src/components/ImpersonationBanner.jsx` / `ImpersonateAction.jsx`.

### Who may view as whom

| Rule | Enforcement |
| --- | --- |
| Only an `ADMIN` | `fastify.adminOnly`, and the actor row is re-read (`role = ADMIN`, active) |
| Only after step-up | `requireRecentAuth` (the same 10-minute window as the other privileged actions) |
| With a reason | 10 to 500 characters (*Proposal*), required by the API, stored on the `impersonation_sessions` row, shown to the viewed person and in the Team page's **Support views** list. It is free text, so it is never copied into audit metadata |
| Same organization only | The target is looked up through `createScopedPrisma(adminOrganizationId)`; another tenant's user id answers the same `404 IMPERSONATION_TARGET_NOT_FOUND` as an unknown id |
| Non-admin staff (`TEAM`, `STAFF`) or `CLIENT` targets only | Never another `ADMIN` or a `BOT` (`403 IMPERSONATION_TARGET_FORBIDDEN`), never a platform operator (`PLATFORM_OPERATOR_USER_IDS`), never yourself (`400 IMPERSONATION_SELF`), never a deactivated account (`409`). A client user needs a portal contact (`409 IMPERSONATION_TARGET_NO_PORTAL`). The database repeats the role, self and length rules as CHECK constraints |
| One view at a time | Starting a new view ends the admin's previous one (`superseded`) |

### How the view works

- **Time-boxed, not renewable:** 30 minutes (*Proposal*,
  `IMPERSONATION_TTL_SECONDS`); the database caps any view at 60 minutes.
  There is no extend endpoint; a new view needs a new step-up and reason, and
  is announced again.
- **The admin's own session is never replaced.** Starting sets a second
  httpOnly, `sameSite=strict` cookie, `imp`, whose value is an HS256 token
  signed with a key derived from `JWT_SECRET` for this purpose only. It
  carries **both identities** (`act` = admin, `sub` = viewed person), the
  organization, the view id, and the admin session's `sessionVersion` and
  binding (like the `reauth` cookie).
- On **every** `/api` request that carries the cookie (including `/api/auth`
  routes), the `onRequest` hook re-verifies the admin's session, then checks
  the database: the view row is open, unexpired and in the admin's
  organization, the admin is still an active `ADMIN` with the same session,
  and the viewed person is still active with the role the view started with.
  Only then is `request.user` replaced by the viewed person (with an
  `impersonation` block). Anything else (the view expired, was stopped or
  revoked elsewhere, or the cookie is forged or another admin's) clears the
  cookie and **refuses that request** with `409 IMPERSONATION_ENDED`: it was
  sent from a screen showing the viewed person and must never run as the
  admin. Only the view-status read (`GET /api/auth/impersonation`), stop and
  sign-out go through. The web app reloads on that code; its next request,
  now without the cookie, is the admin's own.
- `GET /api/auth/me` returns the viewed person plus
  `impersonation: { sessionId, actor, subject, startedAt, expiresAt, readOnly }`,
  which drives the banner. A client user is viewed through the client portal
  (`/client/dashboard`); the staff APIs refuse a client identity as always.
- The web app reloads on start and stop so no cached data of the other
  identity survives. Realtime (Socket.IO) is off for the admin while any
  view of theirs is open: the socket authenticates the admin's own session
  and would otherwise join the admin's rooms. A handshake carrying the view
  cookie, or from an admin with an open view, is refused, and starting a
  view drops the admin's existing sockets (other tabs share the cookie) on
  every API instance: locally at once, and on the others through Redis
  pub/sub (there is no shared Socket.IO adapter). As a fallback for a lost
  message, each instance also sweeps its sockets every 10 seconds and drops
  those of admins with an open view.
  Live updates resume after the view ends and the page reloads.

### Read-only and blocked areas

*Proposal*: read-only is the only mode in this slice (`readOnly` is always
`true`; write-through is not implemented).

| While viewing | Answer |
| --- | --- |
| Any `POST`, `PUT`, `PATCH` or `DELETE` | `403 { code: "IMPERSONATION_READ_ONLY" }`, before any route code runs. Only `POST /api/auth/impersonation/stop` and `POST /api/auth/logout` are allowed |
| Sensitive areas, **for every method including reads**: `/api/auth/mfa*` (two-factor), `/api/auth/reauth` (step-up), `/api/auth/change-password`, `/api/auth/register`, `/api/auth/break-glass`, `/api/api-keys`, `/api/credentials`, `/api/ai-connections`, `/api/ai-tools/approvals`, `/api/settings/ai-provider`, `/api/settings/ai-kill-switch`, `/api/audit-events`, `/api/push`, and starting another view | `403 { code: "IMPERSONATION_BLOCKED" }` (`IMPERSONATION_BLOCKED_PREFIXES`) |
| Any route behind `requireRecentAuth` | `403 IMPERSONATION_BLOCKED` (the view cannot re-authenticate, so it is never prompted) |
| Admin-only routes | `403 Admin access required`: the request carries the viewed person's role |
| Billing and payment actions, account deletion, session management | Covered by the read-only rule (all are writes) |
| `GET` routes with side effects, marked `config: { sideEffectingGet: true }`: `GET /api/google-calendar/oauth/start` (would bind a Google account the admin controls to the viewed person) and `GET /api/slack/oauth/start`. `/api/google-calendar/oauth` and `/api/slack/oauth` are also on the blocked list | `403 IMPERSONATION_READ_ONLY` / `IMPERSONATION_BLOCKED` |

Paths are matched after percent-decoding and slash normalisation **and**
against the matched route pattern (`request.routeOptions.url`), so
`/api/api-%6beys` or `//api/audit-events` cannot slip past the list.

Accepted (*Proposal*): two reads create an organization-level default the
first time they run, whoever calls them — `GET /api/brand` (default brand
settings row) and `GET /api/projects/:id/health-history` (seeds the history
with the current health). Neither is tied to the caller's identity or
changes anything a normal read by that person would not, so they are not
marked.

The web app shows these refusals as a "Read-only support view" message.

### Visibility and records

- **Banner:** every page (staff app and client portal) shows a sticky
  `region` named "Support view": "Viewing as *name* — read only — ends in *N*
  min — Stop". When the time runs out the banner ends the view itself.
- **The viewed person** gets an in-app notification
  (`security.impersonation_started`) naming the admin, the time limit and the
  reason.
- **Audit:** `impersonation.started` and `impersonation.ended` (with the end
  reason and duration) in the organization's Activity Log. Every other audit
  event written during the view records the **admin** as `actorUserId` and
  adds `impersonatedUserId` and `impersonationSessionId` (see
  [audit-events.md](audit-events.md)).
- **Request logs:** each request of a view logs `impersonated request` with
  `actorUserId`, `impersonatedUserId` and `impersonationSessionId`, and the
  request logger carries the same fields. The cookie value is never logged.
- **Support views list:** `GET /api/auth/impersonation/sessions` (admins, not
  while viewing) returns the last 50 views with reasons; the Team page shows it.

### Ending and revocation

| Event | End reason |
| --- | --- |
| Stop button / `POST /api/auth/impersonation/stop` | `stopped` |
| The window passed (recorded on the first request after it, ended at `expiresAt`) | `expired` |
| The admin started another view | `superseded` |
| The admin signed out | `signed_out` |
| An admin reset the password of either person (`POST /api/team/:id/reset-password`), or either used a reset link | `revoked_password_reset` |
| Either person changed their own password | `revoked_password_change` |
| Either person's role changed (`PUT /api/team/:id`) | `revoked_role_change` |
| Either person was deactivated | `revoked_deactivated` |

Independently of those records, the per-request checks end a view whenever
the admin's session is revoked or rotated, the admin loses the `ADMIN` role,
or the viewed person is deactivated or changes role.

## Break-glass administrator recovery

For an organization whose administrators are all locked out (lost password
**and** two-factor device, deactivated, or gone). There is no platform
operator console in the web app, and no support identity gets standing access
to any tenant (#416 boundary): break-glass is an **operator CLI**,
`scripts/break-glass.mjs`, that issues a single-use recovery link for one
named staff member of that organization, who redeems it themselves.

| Guard rail | Rule |
| --- | --- |
| Off by default | Both the CLI and `POST /api/auth/break-glass/redeem` refuse unless `BREAK_GLASS_ENABLED=true` (the route answers `404` before looking at the body). Set it only for the emergency and unset it afterwards |
| Operator only | `--operator` must be in `PLATFORM_OPERATOR_USER_IDS` **and** still an active `ADMIN` in the database (the same rule as the AI kill switch), for `issue`, `revoke` and `list`. The id is claimed, not authenticated, so each grant and its `break_glass.granted` / `break_glass.revoked` events also record the **OS user and host** the CLI ran as (`issuedByOsUser`, `issuedFromHost`; metadata `osUser`, `host`) |
| Reason | `--reason`, 10 to 500 characters, stored on the grant and shown in the notifications |
| Target | An `ADMIN` of the organization (a deactivated one is reactivated). A non-admin staff member (`TEAM` or `STAFF`) only with `--promote`, and only when the organization has **no** active admin, checked both when issuing and again when redeeming (redemptions in one organization are serialized by a lock, so two grants redeemed at once never both find no administrator). Never a client user or bot |
| Time-boxed, single use | 30 minutes (*Proposal*, `BREAK_GLASS_TTL_SECONDS`; the database caps it at 60). Redeeming claims the grant atomically; a second use, an expired or a revoked grant answer the same generic `400`. A new grant for the same person revokes the outstanding one |
| Secret handling | The 256-bit token is printed once as a link with the token in the URL **fragment** (`/break-glass#token=…`), so it never reaches server or proxy logs; only its SHA-256 is stored. The page removes it from the address bar |
| Effect | New password; two-factor turned off (re-enroll after signing in); account reactivated; every session signed out; the person's API keys revoked; open impersonation views by or of them ended; `role = ADMIN` only for a `--promote` grant |
| Audit | In the **target** organization: `break_glass.granted`, `break_glass.redeemed`, `break_glass.revoked`, plus `auth.password_changed` (`method: break_glass`), `auth.mfa_reset`, `user.role_changed`, `user.reactivated` as applicable |
| Notification | Every active admin of the target organization and the target are notified in-app when a grant is issued; the admins again when it is used |

### Operator runbook

1. **Verify out of band** that the requester is the organization's owner or a
   named administrator: a call to a phone number already on file, a signed
   request from the owner's known email, or the organization's documented
   recovery contact. Record the ticket id. Do not proceed on email alone.
2. On the API host, with the production environment loaded, enable the flag
   for this run only and issue the grant:

   ```bash
   BREAK_GLASS_ENABLED=true node scripts/break-glass.mjs issue \
     --organization-id <orgId> --email <admin@their-agency> \
     --operator <your platform operator user id> \
     --reason "Ticket 123: owner lost phone and password; verified by call" \
     --confirm
   ```

   Add `--promote --email <staff member>` (a `TEAM` or `STAFF` account) only
   when the organization has no active administrator left.
3. Send the printed link to the verified person over a **different channel**
   from the request (for example by phone or SMS to the number on file). It
   works once and expires in 30 minutes.
4. The person opens it, sets a new password, signs in, and sets up two-factor
   again in Settings.
5. Also enable the flag on the API process for the redemption
   (`BREAK_GLASS_ENABLED=true` in its environment, then restart), and turn it
   off again as soon as the grant is redeemed or has expired.
6. Check the organization's Activity Log for `break_glass.granted` and
   `break_glass.redeemed`, and attach both to the ticket.

To cancel an unused grant: `node scripts/break-glass.mjs revoke --grant <id>
--operator <id>` (works with the flag off). `node scripts/break-glass.mjs list
--organization-id <id> --operator <id>` shows recent grants (never tokens).

## Related revocations

- An administrator password reset (`POST /api/team/:id/reset-password`) ends
  the member's sessions and revokes their active API keys. Whoever held the
  old password could otherwise keep access through a key created with it.
- A role change through `PUT /api/team/:id` ends the member's sessions, because
  `adminOnly` trusts the role carried in the session token.
- Password resets, password changes, role changes and deactivations also end
  any support view by or of the person (see
  [Ending and revocation](#ending-and-revocation)).

## Known limitations

- Two-factor re-authentication shares the sign-in attempt budget. Someone
  holding only a stolen session cookie can therefore use bad codes to lock the
  real user's two-factor sign-in for 15 minutes. That is the same trade-off as
  sign-in itself; the lockout blocks guessing and is recorded in the audit log.
- The per-account password budget for re-authentication (10 failures per 15
  minutes) is kept in process memory, so each API instance enforces its own.
- Session tokens carry no `jti`, so a re-authentication is bound to the
  session's issue time to the second; two sessions of the same user issued in
  the same second share a binding. The impersonation cookie uses the same binding.
- Support views are read-only; there is no audited write-through mode.
- Realtime (Socket.IO) is off for the admin, on every device, while a view of theirs is open; screens do not update live.
- Break-glass has no web console for operators and relies on the CLI running
  with production database access; the operator identity is the
  `--operator` id checked against `PLATFORM_OPERATOR_USER_IDS`, not a
  separately authenticated session. Anyone who can run the CLI with the
  production database can claim a listed id; the recorded OS user and host
  make that traceable, and host access is the real control.
- Deferred to later #416 work: enterprise SSO, SCIM provisioning, domain
  verification and managed-device controls.
