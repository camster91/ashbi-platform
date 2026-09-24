# Public inquiry intake for ashbi.ca

ashbi.ca remains the public marketing site. The Hub provides only a governed
API that accepts inquiries (issue #426). Accepting an inquiry **never** creates
a client, proposal, estimate, invoice, payment, booking, or outbound message.
The only side effects are one `PublicInquiry` row and one in-app notification
for the configured owner, written in the same transaction.

Source: `src/routes/client-acquisition.routes.js`,
`src/services/client-acquisition.contract.js`, migration
`prisma/migrations/20260924150000_public_inquiries`.

## Configuration gate

Intake is enabled only when **all** of these are set; otherwise it fails closed.

| Variable | Meaning |
|---|---|
| `CLIENT_ACQUISITION_ORGANIZATION_ID` | Organization that owns every inquiry |
| `CLIENT_ACQUISITION_OWNER_ID` | Active ADMIN/TEAM user in that organization who is assigned new inquiries |
| `CLIENT_ACQUISITION_PRIVACY_VERSION` | Exact privacy-notice version visitors must have accepted |
| `CLIENT_ACQUISITION_SERVICE_LINES` | Comma-separated allowlist of service-line slugs |
| `CLIENT_ACQUISITION_ALLOWED_ORIGINS` | Comma-separated exact origins, e.g. `https://ashbi.ca,https://www.ashbi.ca` |

If the owner is missing, inactive, a client, or belongs to another
organization, intake returns `503 INTAKE_UNAVAILABLE` and logs the
misconfiguration (without identifiers).

## `GET /api/client-acquisition/config`

Always `200`, `Cache-Control: no-store`. Returns only:

```json
{ "enabled": true, "privacyVersion": "2026-09-01", "serviceLines": ["web-design"] }
```

When disabled: `{ "enabled": false, "privacyVersion": null, "serviceLines": [] }`.
No organization, owner, email, or database identifiers are ever returned.

## `POST /api/client-acquisition/intake`

Body (JSON, max 16 KB, unknown keys rejected):

| Field | Rule |
|---|---|
| `idempotencyKey` | 16–128 chars, `[A-Za-z0-9_:-]` (ashbi.ca sends `ashbi_ca:<uuid>`) |
| `name` | required, ≤ 200 |
| `email` | required, valid, ≤ 254 (stored lower-cased) |
| `company` | optional, ≤ 200 |
| `phone` | optional, ≤ 40 |
| `serviceLine` | must be in the configured allowlist (ashbi.ca slugs: `brand_packaging`, `web_commerce`, `custom_platform`, `ai_automation`, `managed_support`, `unknown`) |
| `businessContext`, `requestedOutcome` | required, ≤ 5000 each |
| `timing` | optional: `urgent_30_days`, `one_to_three_months`, `three_to_six_months`, `exploring` |
| `budgetBand` | optional: `under_5k`, `5k_10k`, `10k_25k`, `25k_plus`, `not_sure`, `prefer_not_to_say` |
| `budgetCurrency` | `CAD` or `USD`; required with any budget band, forbidden without one |
| `consent` | must be `true` |
| `privacyVersion` | must equal the active version |
| `attribution` | optional object: `landingPage` (same-site path, ≤ 500), `referrer` (http(s) URL, ≤ 500), `source`, `medium`, `campaign` (≤ 100), `clickId` (≤ 200) |
| `website` | honeypot; must be absent or empty |

The referrer is stored as origin + path only; its query string, fragment and
any credentials are stripped. Control characters are removed from all free text.

These rules mirror `ashbi-redesign/src/lib/hub-inquiry-contract.ts`
(`createHubInquiryPayload`). They were verified by running that function's
real output through `intakeSchema` on 2026-09-24. Change both together.

> ashbi-redesign's `docs/hub-inquiry-integration.md` records that the Hub
> integration was **paused** on 2026-09-03. This API stays disabled until the
> five `CLIENT_ACQUISITION_*` variables are set, and setting them needs a fresh decision.

Responses:

| Status | Body | Meaning |
|---|---|---|
| `201` | `{ accepted: true, replayed: false }` | New inquiry recorded |
| `200` | `{ accepted: true, replayed: true }` | Same key and same canonical payload; existing inquiry reused |
| `202` | `{ accepted: true, replayed: false }` | Honeypot tripped; nothing stored |
| `400` | `{ code: "INVALID_INQUIRY", fields: [...] }` | Validation failed; nothing stored |
| `403` | `{ code: "ORIGIN_NOT_ALLOWED" }` | `Origin` header missing or not allowlisted |
| `409` | `{ code: "IDEMPOTENCY_CONFLICT" }` | Same key, materially different payload; original kept |
| `409` | `{ code: "PRIVACY_VERSION_CHANGED", privacyVersion }` | Visitor must re-read the notice |
| `413` | Fastify body-too-large error | Body over 16 KB |
| `429` | rate-limit error | More than 10 intake requests per IP per 10 minutes |
| `503` | `{ code: "INTAKE_UNAVAILABLE" }` | Gate disabled or misconfigured |

A retry of an already-accepted key is answered as a replay even if the privacy
version changed afterwards.

## CORS

Only `/config` and `/intake` use this policy: the configured origins, methods
`GET`/`POST`, header `Content-Type`, and **no** `Access-Control-Allow-Credentials`.
The browser must send `credentials: "omit"`. The server also enforces the
origin allowlist itself, because CORS alone does not stop a request from being
processed.

## Staff access

- `GET /api/client-acquisition/inquiries`: ADMIN/TEAM, newest 200 for the caller's organization.
- `DELETE /api/client-acquisition/inquiries/:id`: ADMIN only, hard delete (organization-scoped).

## Retention and deletion

- Inquiries are kept until an admin deletes them (individual erasure requests
  use the DELETE endpoint) or the owning organization is deleted (cascade).
- Deleting the owner user keeps the inquiry and clears `ownerId`.
- Inquiries are not soft-deleted and do not appear in Trash.
- These behaviours are covered by
  `src/tests/unit/client-acquisition.routes.test.js` and
  `src/tests/integration/client-acquisition.database.test.js`.

## Rollout (requires Cameron's approval at each step)

1. Apply the migration with `npx prisma migrate deploy`.
2. Set the five variables, then restart the Hub.
3. Confirm `/config` reports `enabled: true` and the expected values.
4. Submit one synthetic inquiry from an allowlisted origin, then delete it.
