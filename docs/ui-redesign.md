# Ashbi Hub interface refactor

The objective is a coherent agency workspace where people can find work,
understand a record and complete its next step on a phone.

## Evidence and priority

Reviewed: the owner's five October 17 mobile screenshots (queue, proposal list,
proposal edit, invoices, contracts), plus checked-in desktop queue and invoice
baselines. The baselines are historical reference, not fresh live acceptance.
A populated whole-app desktop/tablet/mobile review remains required.

| Priority | Finding | Change |
| --- | --- | --- |
| P1 | Filters, explanations and actions push the actual work below the fold. | Short page introduction, one primary action, optional filters in a disclosure. |
| P1 | Mobile toolbars squeeze headings and actions into narrow columns. | Stack the page heading and actions; move secondary actions into a labelled menu. |
| P1 | Queue categories and large status controls create horizontal scrolling. | Keep short sets of categories visible in a responsive layout. |
| P1 | Proposal editing exposes prices and notes without a document body. | Build a document workflow with editable scope, deliverables, schedule, fees and terms. |
| P1 | Estimates and proposals have no clear distinction in the experience. | Use estimates for priced scope; proposals for the client-facing narrative and acceptance. |
| P1 | Finance lists expose many equally prominent actions. | Make the record the main destination; show the next useful action and an overflow menu. |
| P2 | Repeated cards, borders and metadata have similar visual weight. | Consistent rows, restrained surfaces, readable type and quieter secondary information. |

The highest-value change is a shared screen structure that puts the user's
work before controls. Apply it to real screens before extending it everywhere.

## Shared screen structure

- One clear heading, a short description and one primary action.
- Search and optional filters form a separate, compact toolbar.
- Active filters remain visible; a filtered deep link opens its filter panel.
- Main content starts early, with meaningful populated, loading, empty and error states.
- Forms use stacked, labelled fields on mobile. Pricing rows become labelled
  item blocks rather than squeezed tables.
- Buttons take their accessible name from visible content whenever possible.
- Every record shows identity, client, state and the next step. Detailed
  metadata belongs inside the record.
- Keep the Ashbi cream, indigo and lime palette. Reserve lime for emphasis.
- Keep current permissions, exact money handling, draft recovery, concurrent
  edit protection, history and API/MCP contracts throughout the refactor.

## Product areas

| Area | Main job |
| --- | --- |
| Work | Today's priorities, tasks, projects, planning and time |
| Clients | Client overview, people, activity and related work |
| Inbox | Client email, team conversations and requests needing a response |
| Money | Estimates, proposals, contracts, invoices, payments and expenses |
| Knowledge | Documents, wiki, assets and reusable templates |
| Settings | People, permissions, integrations and administration |

Desktop and mobile must use the same destination names and hierarchy.
Choose mobile shortcuts around frequent work; keep administration secondary.
Do not remove a destination before its replacement is discoverable.

## Implementation order

1. Shared heading/filter patterns and Daily Queue as the first real screen.
2. App shell/navigation and consistent list, record, form and dialog layouts.
3. Editable proposal and contract documents, with preview and existing review flows.
4. Estimates and invoice workflows, including readable mobile pricing and payment state.
5. Apply the verified patterns to projects, clients, inbox, knowledge and settings.

This is the design reference. The sole current task queue remains issue #565.
The stack upgrade and this interface refactor have separate branches and releases.
Document body persistence and portal/PDF/editor fidelity require explicit
implementation; changing styles does not complete those workflows.

## Acceptance

Verify populated flows at 390, 768 and 1440 pixels, plus a narrow 375-pixel check:
no page-level horizontal overflow, no clipped actions, visible keyboard focus,
labelled touch controls, discoverable active filters and a reachable final row.
For document changes, save/reload, draft recovery, concurrent editing,
preview, permitted sharing and client acceptance must work end to end.

## First implementation checkpoint

Daily Queue now uses shared PageHeading and FilterPanel components. Optional
help appears after the work, filters collapse until needed, active filter links
open their controls, and the four queue views stay visible on phones. Existing
status vocabulary replaces raw task/review enum labels. The global search field
uses a concise placeholder while retaining its full accessible label.

Local verification: 26 queue tests pass; changed-file lint and production
build/bundle budgets pass. Populated read-only synthetic preview checked at
375, 390, 768 and 1440 pixels with no page overflow. Browser interactions
verified opening filters, selecting an owner, reload restoration and clearing.
This checkpoint is local implementation, not a deployed app-wide redesign.

## Finance layout checkpoint

Proposals, contracts, estimates and invoices now use the shared heading.
Mobile proposal titles and metadata wrap without narrow date columns. New
actions lead; generation, CSV export and billing tools remain reachable with
quieter treatment. Invoice and estimate filters collapse until needed; the
invoice portfolio scope stays available in Collections. Invoice creation opens
above browsing controls from either view, and cancelling restores the previous
view and filters. Quantity/rate fields use two readable mobile columns. Shared
tabs no longer create a vertical scrollbar from their negative bottom margin.

Focused component tests and lint pass, including create-from-Collections and
portfolio-clear regressions. The production build and bundle budgets pass.
Populated synthetic production-preview checks verified all four lists at 390px,
invoice/proposal overflow at 375, 768 and 1440px, invoice menu/filter/Collections
controls and create/cancel, plus 44px-high estimate pricing fields. Fonts were
verified loaded. The preview rejects writes, so draft persistence, sending,
payments and company data acceptance are not claimed. These are presentation
improvements; editable proposal documents and richer billing workflows remain
separate implementation work.
