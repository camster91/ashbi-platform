# Ashbi Hub remediation release candidate — 2026-08-21

## Included fixes

| Priority | Route / workflow | Live evidence | Fix | Validation |
| --- | --- | --- | --- | --- |
| P0 | Ash Chat conversations | `GET /api/ash-chat/conversations` returns HTTP 500 in a signed-in browser. | The route now accepts the request object before reading its request-scoped Prisma client. | Focused backend regression test. |
| P1 | Timesheets overview and review actions | Weekly overview requests an unregistered `/time-entries/timesheets/...` path and receives HTTP 404. | Client calls the registered `/time/timesheets/...` routes. | Focused API and server route tests. |
| P0 | Schedule | Route crashes in its error boundary: `googleSyncMutation is not defined`. | The Google Calendar control now belongs to the event-detail modal, where its event and mutation exist. | Focused UI contract test and production build. |
| P2 | Dashboard notifications | A task update payload is shown as raw JSON. | Structured title/message payloads are rendered as readable content, with plain-text fallback. | Focused formatter test. |

## Release status

- Branch: `codex/hub-remediation-release-20260821`, created from `origin/main` at `6522707`.
- Production remains unchanged.
- Browser validation of these fixes is pending deployment approval.
