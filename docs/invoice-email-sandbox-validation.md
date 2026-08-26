# Invoice email sandbox validation

## Purpose

Prove that the Hub records invoice-email truth without contacting a real client,
claiming inbox delivery from provider acceptance, or duplicating a send during a
retry. Passing this runbook does not authorize production deployment, live
Mailgun credentials, real-client email, migration application, or Bonsai
cutover.

## Approval and setup gates

Before any provider call, obtain Cameron's action-time approval for the exact
sandbox sender, recipient, invoice, and test window. Use a dedicated sandbox
mailbox and Mailgun test configuration. Apply the reviewed migration only in an
approved disposable or controlled test environment with a verified backup.

## Required cases

| Case | Required evidence |
| --- | --- |
| Draft creation | Creating or editing a draft produces no delivery attempt and no provider call. |
| Initial issue | One reviewed issue action creates one `INITIAL` attempt and one prepared event before the provider call. |
| Provider acceptance | The attempt becomes `PROVIDER_ACCEPTED`, retains the provider message ID, and the UI says “Accepted by email provider”; it never says delivered or received. |
| Request replay | Replaying the same request ID returns the same attempt and does not call the provider again. |
| Confirmed rejection | The attempt becomes `FAILED`, retains a safe reason code, and staff can make a separate explicit resend attempt. |
| Unknown outcome | A timeout or transport loss becomes `OUTCOME_UNKNOWN`; staff are told not to retry until reconciliation proves whether the provider accepted it. |
| Missing recipient | The invoice may be issued, but no email attempt is created and the UI says email was not attempted. |
| Resend | An explicit resend has a new request ID, `RESEND` kind, next attempt number, and independent provider evidence. |
| Tenant isolation | Staff in another organization cannot read, create, replay, or infer the attempt or recipient. |
| History integrity | Prepared and final events remain append-only, ordered, exportable, and linked to the invoice. |

## Inbox evidence boundary

Mailgun API acceptance proves only that Mailgun accepted the request. Provider
webhook evidence may later prove provider processing or a recipient-server
event, but neither proves a person read the message. Record sandbox mailbox
arrival separately with timestamp, matching provider message ID, and the
approved recipient. Do not generalize sandbox arrival into production inbox
deliverability.

## Exit criteria

Every required case passes without a real client address, duplicate provider
call, secret in logs or screenshots, or manual database correction. Retain the
redacted attempt/event export, provider evidence, mailbox evidence, migration
revision, rollback command, and test timestamp. Bonsai remains the billing
fallback until the broader replacement and financial cutover gates pass.
