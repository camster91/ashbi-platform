# Public site and Hub contract

Status: Architecture decision; two-sided intake code-present locally, not deployed or target-connected

## Decision

Keep `ashbi.ca` and `hub.ashbi.ca` as separate applications with one shared company strategy, service vocabulary, evidence policy, and event taxonomy.

- `ashbi.ca` is the fast public acquisition and publishing surface.
- `hub.ashbi.ca` is the authenticated operating system with narrowly scoped public intake, document, and client-portal endpoints.
- The client portal exposes approved client information, not internal Hub state.
- Bonsai remains the financial fallback until replacement gates pass.
- Notion remains a controlled migration source, not a permanent competing task system.

## Journey

```text
Search / referral / Upwork / outreach
                 -> ashbi.ca proof, services, fit, inquiry
                 -> Hub public intake and attribution
                 -> qualification and discovery
                 -> proposal and contract
                 -> project, tasks, approvals, and delivery
                 -> invoice and Stripe payment
                 -> managed support, referral, and approved case-study learning
```

## Shared identifiers

The journey needs durable identifiers for organization, person/contact, lead, opportunity, proposal, contract, project, invoice, payment, and source event. Public URLs and analytics must not expose internal sequential identifiers or sensitive client data.

## Public intake contract

The Hub implementation uses two intentionally public routes:

- `GET /api/client-acquisition/config` returns whether intake is enabled, the active privacy version, and the canonical service lines. It does not return organization or owner identifiers.
- `POST /api/client-acquisition/intake` accepts the validated inquiry, creates one tenant-owned lead and source event, and notifies the configured internal owner. New submissions return `202`; exact idempotent replays return `200` without another write.

The write route remains disabled unless the target organization, internal owner, privacy version, and allowed Ashbi.ca origins are all explicitly configured. Ashbi.ca now has a local contact form that reads this public configuration, preserves an unchanged-payload retry key, and posts the canonical consent and attribution contract. It remains inert without an explicit build endpoint. The database migrations, target identifiers, deployed connection, and controlled target test remain pending.

Authenticated staff use `/inquiries` in the Hub to review the original evidence, attribution, and account owner. `REVIEWING`, `QUALIFIED`, and `NURTURE` decisions require a named next human action and due date; `QUALIFIED`, `NURTURE`, and `DISQUALIFIED` decisions require concise internal evidence; and a disqualification requires one bounded reason code. Only a `QUALIFIED` inquiry can be converted. Conversion creates or reuses one tenant client based on a case-insensitive contact-email match, links the inquiry to that client, clears the completed inquiry follow-up, and records a durable event. A transactional claim prevents simultaneous requests from creating duplicate clients. Conversion does not send a message, generate a proposal, or infer project scope.

Minimum accepted fields:

- Name and contact method.
- Business or organization name when supplied.
- Service interest using the canonical service taxonomy.
- Business context and requested outcome.
- Timing and approved budget band when requested.
- Consent and privacy acknowledgement.
- First-party attribution: landing page, referrer, source, medium, campaign, and approved click identifier where available.
- A client-generated idempotency token.

Canonical service values are `brand_packaging`, `web_commerce`, `custom_platform`, `ai_automation`, `managed_support`, and `unknown`. Budget, when supplied, is stored as a band plus an explicit `CAD` or `USD` currency; currencies are not combined.

Controls:

- Server-side schema validation and normalized enumerations.
- Rate limiting, abuse detection, safe errors, and no internal stack details.
- Idempotent lead creation and an auditable source event.
- Retention limits for raw attribution and form content.
- Owner notification without automatic prospect messaging.
- No secret, credential, private client record, or internal note in public responses.
- An allowed browser origin, matching privacy-notice version, and a silent honeypot path that performs no database write.
- Staff-only qualification states, evidence, bounded rejection reasons, and dated next actions; converted inquiries cannot be reopened through the qualification route.
- Deliberate, idempotent inquiry-to-client conversion with tenant-scoped client/contact reuse.

## Portal boundary

The portal may show approved status, milestones, requests, files, proposals, contracts, invoices, payments, and feedback for the authenticated client. It must not expose internal notes, credentials, private margins, unrelated clients, internal AI context, or unapproved files.

Capability links expire or revoke. Client authentication, tenant ownership, and object ownership are independently verified.

## Revenue boundary

Stripe Checkout is the planned hosted payment surface. The Hub owns invoice state and reconciles provider events idempotently. A browser redirect never proves payment; only a verified provider event and matching amount, currency, invoice, and transaction can transition the ledger.

Live keys, charges, refunds, subscriptions, tax configuration, provider connections, and Bonsai cutover require action-time approval. Taxes remain explicitly configured from approved registrations and responsibilities; they are not inferred by the application.

## Integration principles

- Least-privilege, environment-specific credentials.
- Signed inbound webhooks and idempotent outbound commands.
- Explicit unknown or reconciliation-required state after uncertain delivery.
- Audit trail, monitoring, cost limits, manual fallback, and bounded retries.
- Portable export and documented deletion/retention behavior.

## Release gate

No surface is called unified until a controlled inquiry can be traced through the correct Hub tenant, opportunity, proposal, contract, project, invoice, test payment, and ledger entry without duplicate records or manual database correction.
