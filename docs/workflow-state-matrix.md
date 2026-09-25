# Workflow state contract

Critical workflows must explain what happened, what the user can do next, whether entered work is safe, and how to recover. This contract applies to authentication, dashboard, projects, finance forms, and the client portal.

| State | Required presentation | Recovery and data-safety rule |
| --- | --- | --- |
| Initial | Stable shell or neutral empty area; do not imply data exists | No action required |
| Loading | Named `role="status"`; stable skeleton dimensions | Preserve the previous usable result when refreshing |
| Slow | Explain that the request is still running (implemented: `useSlowState`, `SlowNotice`/`SlowMessage`, built into `LoadingState`, page skeletons, `Button` loading, `QueryErrorState` retry) | Offer cancellation only when it is safe; never invite duplicate writes |
| Empty | Say what is absent and why it matters | Offer the permitted first action or a route back |
| Partial | Keep usable data visible and identify the unavailable section (implemented: `PartialSectionNotice`) | Retry only the failed read |
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
| Fatal | State that the view cannot continue (implemented: `ErrorBoundary` fatal screen) | Warn about unsaved work before reload and provide support/incident guidance when available |

## Implemented shared states

### Slow
- `web/src/hooks/useSlowState.js` exports `SLOW_THRESHOLD_MS` (8 seconds) and `useSlowState(active, thresholdMs)`, which turns true once a read or write has been pending past the threshold and resets when it settles.
- `web/src/components/ui/SlowNotice.jsx`:
  - `SlowNotice` mounts an empty polite live region as soon as work starts, then adds the copy after the threshold so screen readers announce it once.
  - `SlowMessage` is the copy alone, for use inside an existing live region.
  - `SlowLoadingStatus` is a status with no spinner, for surfaces that do their own styling.
  - Copy: "Still working… this is taking longer than usual." Reads add "You can keep waiting. If it does not finish, check your connection and retry." Writes add "Keep this page open and do not submit again. We will confirm when it finishes."
- Built into the shared primitives:
  - `LoadingState`: the copy appears inside its own status. Opt out with `slowAfterMs={false}`.
  - `TablePageSkeleton`, `KanbanPageSkeleton` and `ListPageSkeleton`: `aria-busy` is cleared once the copy appears.
  - `Button` with `loading`/`isLoading`: the write copy appears in a sibling polite region. The button element is never remounted, so it keeps focus.
  - `QueryErrorState` while `isRetrying`: the notice sits outside the error alert.
- Adoption:
  - Primitives: Invoices and Proposals (`LoadingState` and `Button`), Projects (`KanbanPageSkeleton`), Clients (`TablePageSkeleton`).
  - The Dashboard first-load skeleton uses `SlowMessage`.
  - The Project first load uses `LoadingState`.
  - Client portal: portal, project and document loading use `SlowLoadingStatus`. The login-link, upload and chat-send writes use `SlowNotice` with `SLOW_WRITE_INLINE`.
- The copy's fade-in uses `motion-reduce:animate-none`.

### Partial
- `web/src/components/PartialSectionNotice.jsx` replaces only the failed section.
  - It is a warning surface with `role="status"` and polite announcement, so polling does not repeatedly interrupt assistive technology.
  - The notice names the section and reuses the typed `getQueryErrorGuidance` detail.
  - Its retry control is named `Retry <section>`, refetches only that query, is disabled while retrying, and gets the slow notice.
- Dashboard: a task-query failure shows "Task data is temporarily unavailable" next to the loaded stats, and the My Tasks card shows "—" rather than a false 0. A failed background refresh keeps the last stats visible with a "could not be refreshed" notice.
- Project: a failure of the revision-rounds query shows the notice in place of that section, and the plan, tasks and sidebar stay usable.

### Fatal
- `web/src/components/ErrorBoundary.jsx` shows:
  - what happened, and that the view cannot continue;
  - **Try again**, which re-renders in place;
  - **Reload application**, with the unsaved-work warning;
  - support guidance;
  - an error reference (`ERR-<time>-<random>`, from `createErrorReference` in `web/src/lib/support.js`) with a **Copy reference** button. "Reference copied." appears only after the clipboard write succeeds.
- Focus moves to the heading.
- Raw error messages and stack traces are never rendered, because they can contain client or personal data.
- Support guidance comes from build-time `VITE_SUPPORT_URL` (http/https only) and/or `VITE_SUPPORT_EMAIL`. When neither is set, the screen tells the user to contact their Ashbi Hub administrator or usual Ashbi contact and quote the reference. No contact address is invented.
- The reference is passed as the fourth `onError` argument. `main.jsx` tags the Sentry event with `errorReference`, which only takes effect when `VITE_SENTRY_DSN` is set, so the screen never claims the error was logged.

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
