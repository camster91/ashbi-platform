# Observability, alerts, and service objectives

Ashbi emits provider-neutral OpenTelemetry traces when `OTLP_ENDPOINT` is set,
scrubbed Sentry events when `SENTRY_DSN` is set, and signed operational webhook
alerts when `NOTIFICATION_WEBHOOK_URL` and `OBSERVABILITY_OWNER` are set. Every
signal carries `APP_REVISION`, environment, and service role (`api` or `worker`).
Production is observability-degraded until both a destination and a named owner
are configured; `/api/health` exposes that state without exposing credentials.

## Initial service objectives

These are internal operating targets, not contractual guarantees:

- Core API readiness: 99.9% per calendar month, measured by the public
  dependency-aware health smoke.
- Core API error rate: fewer than 1% unhandled 5xx responses over 15 minutes.
- Scheduled job execution: at least 99% complete without a final-attempt
  failure per calendar month; every final failure must reach the named owner
  within five minutes.
- Worker continuity: a heartbeat no more than 45 seconds old and from the exact
  deployed revision.
- Release integrity: every production promotion must report the approved full
  revision, immutable image digest, and healthy database, Redis, and worker.

The owner reviews these targets monthly. A miss creates a dated corrective
issue with impact, duration, cause, and follow-up; it must not be silently
reclassified or removed from the measurement window.

## Alert ownership and drills

`OBSERVABILITY_OWNER` is the accountable human or on-call rotation name. It
must never default to an invented owner. The delivery destination is configured
outside source control. The minimum production alerts are dependency readiness,
unhandled 5xx spikes, stale/wrong-revision workers, final queue failures,
webhook delivery failures, failed deployments, and stale backups.

Before production clearance and quarterly thereafter, perform these drills in
staging and attach timestamps plus redacted delivery evidence to the tracking
issue:

1. Stop the staging worker and confirm readiness fails after 45 seconds.
2. Enqueue a deliberately failing non-client test job and confirm one
   final-attempt alert reaches `OBSERVABILITY_OWNER` within five minutes.
3. Deploy a wrong-revision test candidate and confirm automatic rollback.
4. Point the alert webhook at a controlled failing endpoint and confirm the
   delivery failure is visible to the telemetry provider.
5. Run `EXPECTED_REVISION=<full-sha> npm run smoke:production-health -- <url>`
   and retain the redacted output.

Never perform destructive failure drills against live client workloads.

## Telemetry data policy

Telemetry may contain service role, environment, release revision, route
template, HTTP status, trace ID, queue name, job name/ID, attempt count, timing,
and dependency status. It must not contain request or response bodies, document
content, messages, email addresses, authorization/cookie headers, passwords,
API keys, tokens, provider credentials, or client payloads. The application
scrubber removes user objects, query strings, long identifier path segments,
email-like strings, bearer values, and sensitive-key values before export.

Choose provider retention no longer than needed for incident response; the
initial ceiling is 30 days unless a documented legal or client requirement
approves otherwise. Restrict provider access to the named owner and authorized
operators, require MFA, and keep credentials only in the root-owned production
environment file or provider secret store. Evidence shared in GitHub issues
must be redacted.

## Incident response

For a readiness or release alert, pause promotions, record the exact revision
and image digest, identify the failed component, and use the immutable rollback
procedure in `docs/deployment-and-rollback.md`. For a queue failure, preserve
the job ID and sanitized error class, determine whether retry is safe, and
never copy the job payload into telemetry or an issue. For suspected data
exposure, revoke affected credentials, restrict provider access, preserve an
audit trail, and follow the security incident process before resuming exports.
