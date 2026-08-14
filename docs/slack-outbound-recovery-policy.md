# Slack outbound recovery policy

An Ashbi-confirmed Slack post is an external side effect. A timeout, network
failure, or malformed provider response does **not** prove that Slack did not
accept the message. Ashbi therefore records the target as `UNKNOWN` and never
automatically retries it.

## Operator procedure

1. Open the durable AI action record and retain its project, mapped channel,
   optional thread, message text, confirmation time, and error code.
2. Check the mapped Slack channel/thread with an authorized workspace account.
3. If the message is present, retain the evidence and mark the incident
   reconciled outside Ashbi; do not resend it.
4. If the message is absent, create a **new** confirmed action with a new
   idempotency key. Do not reuse the failed action or mutate its result.
5. If presence cannot be determined, leave the original action `FAILED` with
   `deliveryState: UNKNOWN`, notify the project owner, and do not resend.

Provider errors that are unambiguously pre-delivery may be retried only through
a new, separately confirmed action. This preserves the original audit record
and prevents a retry from silently becoming a duplicate Slack post.

## Required evidence before replacement claims

The policy is code-supported, but it is not provider proof. Retain sandbox
evidence for successful posts, thread replies, denied/revoked tokens,
rate-limit handling, an `UNKNOWN` reconciliation, and tenant isolation.
