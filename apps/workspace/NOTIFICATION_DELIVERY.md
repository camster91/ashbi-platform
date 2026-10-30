# Optional external notifications

Email and browser push are separate opt-in channels. Both are off by default. Building or deploying this code does not authorize activation, send a test message, create a provider account or turn on billing. In-app Inbox remains available without either provider.

## Account experience

Inbox → Email and browser notifications contains email preferences, recent email acceptance states, explicit browser permission controls and registered-browser revocation. Category preferences apply to both channels. Registration starts at the opt-in timestamp; existing unread history is not broadcast. Read notifications, revoked project access, inactive accounts and muted categories are rechecked before transport.

Notifications contain a generic link to Inbox, without task names, message previews, filenames or client information. Email addresses come from the existing account, never a recipient supplied by a request. Push endpoint URLs and browser keys stay private in D1 and are omitted from API responses. Sign-out revokes the current browser subscription where possible; the notification service worker also checks the current signed-in account before displaying an alert. Login removes the previous browser subscription. No app pages or private API responses are cached by this worker.

The service worker lives at `/notifications-sw.js`. The old `/sw.js` remains retired; it must not be repurposed for push. Browser permission is requested only after clicking Enable in this browser. Unsupported browsers and denied permissions receive an explicit explanation. Local browser automation simulates permission/subscription APIs; acceptance on a real supported device remains a distinct provider-backed check.

## Provider configuration and activation

Activation requires an operator's explicit release decision, verified sender/domain and privately installed credentials. Do not commit secrets or subscription URLs. Configure only the selected channel:

| Channel | Required settings |
| --- | --- |
| Email | `EMAIL_NOTIFICATIONS_ENABLED=true`, `RESEND_API_KEY`, `EMAIL_FROM`, canonical HTTPS `APP_ORIGIN` |
| Browser push | `PUSH_NOTIFICATIONS_ENABLED=true`, `PUSH_VAPID_PUBLIC_KEY`, `PUSH_VAPID_PRIVATE_KEY`, `PUSH_VAPID_SUBJECT` |

VAPID public key is the base64url encoding of an uncompressed 65-byte P-256 key; private key is the base64url 32-byte scalar. Subject is an operator contact URI. Preserve this key pair across deployments; changing it requires browser subscriptions to be renewed. Use the default push-service endpoint allowlist; custom endpoints are for an explicitly reviewed test/infrastructure configuration.

The existing Worker scheduled handler runs the bounded delivery drains independently of HTTP requests. A reviewed Cron Trigger (for example every five minutes) is required for active delivery. This increment does not change the hosted schedule. Confirm the existing Stripe scheduled drain is included in the scheduling review. Provider flags must stay false/absent until activation. Disable the flag to stop sending while keeping account preferences and receipts; users can still revoke browser subscriptions when the provider is disabled.

Email uses Resend's idempotency key for retries within a bounded window; an ambiguous request is not reported as delivered. Provider acceptance does not prove mailbox delivery. Push services do not offer equivalent application idempotency: unknown outcomes are retained as uncertain and are not blindly resent. A revoked/gone push endpoint is removed. Exact retry and queue limits are enforced in the transport modules; do not extend them without revisiting provider guarantees.

## Storage, recovery and release

Apply additive migrations `0034.sql` and `0035.sql` once through the normal private backup, isolated restore and deployment gates. They retain channel preferences, private subscriptions, delivery receipts and bounded-scan state. General staff exports do not include these private tables. Administrative backup access must remain restricted because push endpoints/keys and email recipient snapshots are sensitive. VAPID and provider credentials remain separate environment secrets, not database data.

Rollback code to the retained Worker while preserving the additive schema and receipts. Never replay external sends after restoring a database without reconciling the provider's idempotency horizon and uncertain work. Database restore cannot undo external email/push effects. Unknown push outcomes must remain terminal across recovery.

## Validation and remaining acceptance

Source and compiled route checks cover default-off behavior, origin/authentication boundaries, tenant isolation and disabled scheduler side effects. Transport checks use fabricated recipients/endpoints, real generated encryption keys and injected providers. Browser checks cover opt-in, interrupted saves, explicit permission and revocation controls, plus responsive accessibility. Recovery tests preserve opt-in and uncertain delivery outcomes.

Before activation: verify a provider-backed email to an explicitly approved test recipient; subscribe an approved real browser, verify generic payload and same-account display, revoke it and confirm suppression; record sender authentication and provider identifiers privately. Run the Stripe sandbox checklist in `READINESS_VERIFICATION.md` separately. No live payments, emails, pushes or authenticated production acceptance are established by local tests.

References: [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys), [Web Push encryption (RFC 8291)](https://www.rfc-editor.org/rfc/rfc8291), [VAPID (RFC 8292)](https://www.rfc-editor.org/rfc/rfc8292), [PushManager subscription](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe).
