# Workflow state contract

Critical workflows must explain what happened, what the user can do next, whether entered work is safe, and how to recover. This contract applies to authentication, dashboard, projects, finance forms, and the client portal.

| State | Required presentation | Recovery and data-safety rule |
| --- | --- | --- |
| Initial | Stable shell or neutral empty area; do not imply data exists | No action required |
| Loading | Named `role="status"`; stable skeleton dimensions | Preserve the previous usable result when refreshing |
| Slow | Explain that the request is still running | Offer cancellation only when it is safe; never invite duplicate writes |
| Empty | Say what is absent and why it matters | Offer the permitted first action or a route back |
| Partial | Keep usable data visible and identify the unavailable section | Retry only the failed read |
| Offline/network | State that connectivity is unavailable | Preserve input; retry reads after reconnection; do not replay uncertain writes |
| 401 | Say the session ended | Sign in again and return to the intended route |
| 403 | Distinguish lack of permission from missing data | Contact an administrator or return to a permitted route |
| 404 | Say the item may have moved or been deleted | Return to the collection and refresh |
| 409 | Explain that a newer version exists | Refresh/reconcile before writing; never overwrite silently |
| 422 | Identify invalid fields inline and in a summary | Preserve all valid input and focus the first invalid field |
| 429 | Explain the temporary limit | Disable duplicate actions and expose when retry is safe |
| 5xx | Say the service could not complete the request | Reads may retry; uncertain writes require verification before another submission |
| Retrying | Announce once and disable the retry control | Preserve input and current focus context |
| Unsaved/saving | Use text, not colour alone | Warn before navigation while work is not durable |
| Saved/success | Name the completed result | Do not show success until the server confirms it |
| Fatal | State that the view cannot continue | Warn about unsaved work before reload and provide support/incident guidance when available |

## Interaction and responsive requirements

- Status and alert messages are announced once; repeated polling must not repeatedly interrupt assistive technology.
- Retry controls are keyboard accessible, retain input, and prevent duplicate requests.
- Focus moves to invalid input or a newly opened recovery surface and returns to the invoking control when it closes.
- Motion respects reduced-motion preferences. Skeletons reserve final layout space.
- At 320–1440 CSS pixels and 200% zoom, messages wrap without horizontal scrolling and alerts/toasts do not cover primary actions.

## Adoption checklist

- Authentication: named loading, distinct session/network failure, safe retry.
- Dashboard: stable accessible skeleton, typed shared error, read-only retry.
- Project: named loading, typed shared error, distinct missing state and route back.
- Finance: visible draft loading/unsaved/saving/saved/conflict/failure states, retry, revision-safe clearing.
- Client portal: distinct access, session, workflow, upload, download, and project-load errors; no ghost success.

Authenticated visual and screen-reader evidence is recorded separately because it requires real role-specific sessions and human assistive-technology verification.
