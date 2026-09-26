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

The guarded actions keep emitting their own events (`api_key.created`,
`user.role_changed`, `user.deactivated`, `user.reactivated`,
`auth.password_changed`, `settings.ai_provider_changed`, `ai.disabled`,
`ai.enabled`, `ai.connection_connected`, `ai.connection_rotated`,
`ai.connection_revoked`, `ai.tool_approved`, `ai.tool_rejected`,
`ai.tool_executed`, `ai.tool_failed`, and the credential vault's access
records). See
[audit-events.md](audit-events.md).

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

## Related revocations

- An administrator password reset (`POST /api/team/:id/reset-password`) ends
  the member's sessions and revokes their active API keys. Whoever held the
  old password could otherwise keep access through a key created with it.
- A role change through `PUT /api/team/:id` ends the member's sessions, because
  `adminOnly` trusts the role carried in the session token.

## Known limitations

- Two-factor re-authentication shares the sign-in attempt budget. Someone
  holding only a stolen session cookie can therefore use bad codes to lock the
  real user's two-factor sign-in for 15 minutes. That is the same trade-off as
  sign-in itself; the lockout blocks guessing and is recorded in the audit log.
- The per-account password budget for re-authentication (10 failures per 15
  minutes) is kept in process memory, so each API instance enforces its own.
- Session tokens carry no `jti`, so a re-authentication is bound to the
  session's issue time to the second; two sessions of the same user issued in
  the same second share a binding.
