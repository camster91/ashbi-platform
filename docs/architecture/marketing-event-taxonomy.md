# Marketing and revenue event taxonomy

Status: Proposed. Instrumentation begins only after privacy and retention approval.

## Principles

- Events describe observable actions, not inferred intent or success.
- Store no message body, credentials, health information, or unnecessary personal data in analytics.
- Preserve currency on every commercial event; never combine CAD and USD totals without an explicit conversion method and date.
- Use first-party identifiers and consent state. Do not place personal data in URLs or event names.
- Provider delivery and browser navigation are not business completion events.

## Canonical service values

`brand_packaging`, `web_commerce`, `custom_platform`, `ai_automation`, `managed_support`, `unknown`

## Public journey events

| Event | Trigger | Required properties |
| --- | --- | --- |
| `page_viewed` | Consent-eligible page view | path, page_type, consent_state |
| `work_opened` | Visitor opens a verified work item | work_slug, service_line |
| `service_opened` | Visitor opens a service detail | service_line, service_slug |
| `fit_reviewed` | Visitor views fit or qualification content | path |
| `inquiry_started` | First meaningful interaction with inquiry form | service_line, form_version |
| `inquiry_submitted` | Hub accepts one idempotent inquiry | lead_id, service_line, source, medium, campaign |
| `inquiry_failed` | Submission is not accepted | failure_category, retryable; no form body |
| `booking_opened` | Visitor opens the approved booking destination | placement, approved_duration |

## Pipeline events

| Event | Trigger | Required properties |
| --- | --- | --- |
| `lead_qualified` | Account owner records qualification | lead_id, owner_id, service_line |
| `lead_disqualified` | Account owner records a bounded reason | lead_id, reason_code |
| `discovery_scheduled` | A real discovery record is created | opportunity_id, owner_id |
| `discovery_completed` | Owner records completion | opportunity_id |
| `proposal_sent` | Delivery provider accepts the approved proposal message | proposal_id, opportunity_id, currency, amount |
| `proposal_accepted` | Verified client action accepts proposal | proposal_id, opportunity_id |
| `contract_signed` | Verified signature completes the contract | contract_id, opportunity_id |
| `project_started` | Required commercial and onboarding gates pass | project_id, service_line |

## Revenue events

| Event | Trigger | Required properties |
| --- | --- | --- |
| `invoice_sent` | Provider accepts approved invoice delivery | invoice_id, currency, amount |
| `checkout_created` | Stripe returns a persisted active session | invoice_id, checkout_session_id, currency, amount |
| `payment_pending` | Verified provider event reports incomplete delayed payment | invoice_id, checkout_session_id |
| `payment_succeeded` | Signed event matches invoice, amount, currency, and unique transaction | invoice_id, transaction_id, currency, amount |
| `payment_failed` | Verified failure clears or updates the active attempt | invoice_id, failure_category |
| `refund_succeeded` | Verified refund reconciles to payment and ledger | invoice_id, transaction_id, currency, amount |
| `invoice_overdue` | Scheduled rule evaluates an unpaid invoice after due date | invoice_id, currency, amount, days_overdue |
| `retainer_started` | Verified subscription/contract and payment gate pass | retainer_id, service_line, currency, amount |
| `retainer_ended` | Provider and Hub state reconcile termination | retainer_id, reason_code |

## Operational events

| Event | Trigger | Required properties |
| --- | --- | --- |
| `approval_requested` | A bounded action waits for a named approver | approval_id, action_kind |
| `approval_decided` | Approver accepts or rejects | approval_id, decision |
| `automation_executed` | Approved automation reports a durable result | action_id, action_kind, outcome |
| `automation_reconciliation_required` | Provider outcome is unknown or inconsistent | action_id, provider, error_code |
| `migration_record_reconciled` | Source and Hub record match an approved rule | source_system, entity_type, source_id |
| `migration_discrepancy_found` | Comparison needs a human decision | source_system, entity_type, discrepancy_code |

## Funnel definitions

- Qualified lead: a lead with a named owner, evidenced fit decision, service line, valid contact path, and dated next human action.
- Opportunity: qualified work with a defined problem and next commercial action.
- Win: an accepted proposal plus the required contract and payment gate; proposal acceptance alone is not revenue.
- Revenue: reconciled invoice payment in its original currency; it is not profit.
- Retained client: governed by an approved reporting window and active paid agreement, not merely an open client record.

## Governance

Event schema changes require an architecture decision, analytics/privacy review, migration plan, and validation in both Ashbi.ca and the Hub. Dashboards must disclose incomplete or missing source data rather than silently treating it as zero.

The local staff acquisition summary is descriptive only: it groups persisted leads by status, service line, and recorded source, and reports missing source attribution plus scheduled, overdue, and unscheduled active follow-up. Funnel percentages remain unavailable until the required lifecycle events and reporting windows are verified.
