# Ashbi workspace design system

This is the shared presentation system for the Cloudflare app. It extends the existing Ashbi Hub identity: warm paper, indigo ink, lime actions and Plus Jakarta Sans. It is an application system, not a replacement brand identity.

## Source of truth

- `ui-styles.mjs`: semantic tokens, responsive layout and shared component states.
- `ui-shell.mjs`: document structure, navigation and decorative icons.
- `ui-presentation.mjs`: shared task/project status labels and active-navigation visibility.
- `ui-projects.mjs`: project routes, shared project header and scoped section navigation.
- `ui-records.mjs`: shared record forms, file upload form, edit dialogs and record cards.
- `ui.mjs` and `ui-*.mjs`: application behavior and accessible content.
- `ui-fonts/manifest.json`: pinned, licensed UI font assets and integrity hashes.

Keep styles out of workflow strings. Reuse an existing primitive before adding a variant. Add a semantic token when a new role is needed; do not scatter literal colors or introduce page-specific font families. Preserve visible labels, native controls, focus restoration and authorization-driven visibility.

## Typography

Use Plus Jakarta Sans variable normal (200–800), with a system sans fallback. The app uses 400 for body copy, 500 for navigation, 600 for labels and 650 for headings/actions. The wordmark uses 800. Use tabular numerals for metric totals and the active timer. Body text is 16px; record metadata and controls are 14px; compact labels/actions are 13px; badges/help are 12–13px. Section headings are 18px and page titles scale from 28 to 32px. Body line height is 1.55; headings are 1.3.

The Latin subset is preloaded (27,348 bytes). Other Unicode subsets load only as needed. Font delivery is same-origin, authenticated, content-fingerprinted and privately cacheable. `font-display: swap` keeps content visible during loading. Never add a third-party font request. Signed contract PDFs use separate multilingual fonts; UI font changes must not alter document rendering or evidence.

## Color and spacing

| Role | Token | Value |
| --- | --- | --- |
| Canvas | `--color-canvas` | `#faf9f5` |
| Raised surface | `--color-surface` | `#ffffff` |
| Main text | `--color-text` | `#292840` |
| Supporting text | `--color-muted` | `#626272` |
| Brand / active navigation | `--color-brand` | `#2e2958` |
| Subtle selection / notice | `--color-brand-soft` | `#eeedf6` |
| Primary action | `--color-action` | `#e6f354` |
| Keyboard focus | `--color-focus` | `#5145b5` |
| Error text | `--color-error` | `#a22630` |

Use the 4, 8, 12, 16, 24, 32, 48px spacing scale. Controls have 8px corners; panels/dialogs have 14px corners. Borders, spacing and typography establish hierarchy; reserve shadows for modal dialogs. Use indigo text on lime buttons, never white text on lime.

## Primitives and states

- `.panel`: contained work area; `.item`: individual record with a dividing rule; `.row`: wrapping title/action row.
- `.stats` / `.stat`: responsive metric cards; `.badge`: compact supplementary status. Status must also have a text label.
- `button` / `.button`: primary action; `.secondary`: supporting action. Links retain link semantics. Disabled controls remain visibly disabled; pressed controls use indigo and `aria-pressed`.
- `.record-actions` / `.form-actions`: wrapping action rows with consistent 8px gaps. Keep metadata outside action groups. Edit controls use a compact visible label and retain the full record name in their accessible name. Save and Cancel share a form action row; Cancel remains `type="button"`.
- Native labeled fields: at least 44px tall; 16px input text on phones prevents focus zoom. Do not replace labels with placeholders. Checkboxes retain native semantics.
- `.notice`, `.error`, `.help`: explanatory, failure and supporting content. Live-region behavior belongs to the workflow; color alone never communicates failure.
- Native `dialog`: contained scroll, dimmed backdrop and consistent padding. Preserve keyboard containment, Escape handling and return focus.
- Navigation: visible text plus decorative SVGs. `aria-current` identifies the active route. `[hidden]` always removes unauthorized/unavailable content from layout.

## Responsive and accessible behavior

Below 768px navigation becomes a horizontally scrollable row and content uses 16px side padding. Filters become one column below 900px; task boards below 1100px. Metric cards use two columns below 900px. Content must wrap without widening the viewport at 390, 768 and 1440px; check long record names and error messages as well as empty states.

On narrow screens, direct links, route changes, font loading and viewport resizing keep the active navigation item visible by scrolling only the horizontal strip. Do not move document scroll or keyboard focus to reveal it. Task/project labels use the shared readable names; keep API and stored status values unchanged, and preserve unknown source values as text.

All focusable controls use a visible 3px focus ring. Keep the skip link and semantic headings. Respect reduced-motion and forced-colors preferences. The app currently defines a light theme only.

## Verification

Run `npm run build`, focused API/auth checks and `npm run test:browser` in this package. Browser groups exercise real local D1 fixtures, navigation, dialogs, keyboard behavior, overflow and axe checks. Inspect dashboard, list/board and dialog screenshots at desktop and phone widths. Record results separately from production deployment or real-user acceptance.

## Project workspace

Open projects at `#projects/:id`, with scoped Tasks, Documents, Files, Time and Billing sections. The project heading and selected section remain visible; section links use native navigation and `aria-current`. Keep the global Projects item active. Project selectors contain the current project only, and server queries filter before pagination. Use the existing workflow modules and permission checks; global recovery controls remain available for uncertain financial requests. Never infer client sharing or financial authority from a selected project.

## Actionable overview

Daily priorities apply the existing server-side task/review/invoice filters and reset conflicting selections before requesting data. Show only authorized shortcuts. Keep daily feeds before inventory totals and exports. Link to canonical record and project workflows, preserve saved invoice observation warnings and per-currency totals, and never present a partial page length as a total. Shortcut activation focuses its destination heading immediately; asynchronous responses must not steal later focus.

## Compact lists

Client, project and task lists use `.compact-record`: aligned identity, status, details and actions above 1100px, stacked content below. Render through `compactRecord` to retain the same authorized actions as `recordItem`. Resolve parent and assignee names from already-loaded authorized choices; preserve source identifiers when a name is unavailable. Boards, dialogs and project overviews continue to use the ordinary record presentation. Never truncate essential names or reduce control targets to create density.

## Navigation groups

Work contains daily delivery routes; Clients & billing contains relationship and commercial workflows; Documents holds content and files; Administration holds source history. Groups have accessible names and disappear when every contained link is unavailable. `syncNavigation` owns presentation visibility and active route selection; APIs remain authoritative for access. Keep the same link names and native destinations at every width, and preserve active-link scrolling on the mobile strip.

## Global search

The header search button and Control/Command+K open a native modal. Search names/titles on the server, with separate bounded pages for clients, projects, tasks and documents. Results expose only identifiers and titles; canonical record views recheck access. Active-project and document-ancestor rules apply before pagination. Keep empty/loading/error states, Escape focus return and stale-response protection. Do not preload the dataset or infer complete counts from a result page.

## Account access

Native authentication uses the shared type, color, control and focus tokens in a centered responsive card. Password, MFA, enrollment and recovery states have explicit headings, labels and live status/error messages. Render secrets only in their intended password/enrollment controls; never persist them in browser storage. Session expiry returns to sign-in, while logout must confirm revocation before navigating away.
