# One Ashbi workspace for agency and freelance work

Reviewed October 11, 2026 against the repository and official product documentation. This is a feature-completion and one-time data-input plan, not a statement of complete replacement readiness. It extends [replacement readiness](replacement-readiness-matrix.md), [product status](product-status.md), roadmap #393 and migration #414.

Execution tracking: [#565](https://github.com/camster91/ashbi-platform/issues/565).

October 14 status correction: #579, #586, #588 and #589 are merged; the earlier slice PRs were consolidated or superseded. Consolidated delivery, independent wiki/inherited wiki audiences and conflict/draft recovery passed required CI in #586. Atomic draft invoice saves merged in #588; approved-time/expense-to-draft billing with scoped confirmed API/MCP and source release merged in #589. Main CI 38570627359 is green at `9d969e9`, while production release 38571830817 is held. References below to pending slice reviews/wiki CI and unimplemented unbilled billing describe the earlier snapshot and are superseded by this update. Project Note audiences, simultaneous editing and history restoration remain open; wiki audiences do not close those requirements. [Standalone collection/form/calculation work](structured-records.md) has locally validated shared contracts, but storage, UI, HTTP/MCP and full-stack acceptance remain in progress. These changes do not establish populated target, provider or replacement acceptance.

## Product decision

Cameron confirmed that both agency and freelance work should be shared with the Ashbi team. Use one organization with **Ashbi Design**, **Freelance** and **All work** portfolio views. Clients, contacts, people and documents should be canonical records rather than duplicate copies per view. Existing role permissions and client-specific visibility still apply: sharing with the team does not expose internal work to clients.

Project portfolio classification, configurable stages, calendar recurrence, saved views, typed task fields and board templates are merged. Document/time and financial portfolio screens, typed filters, grouped galleries, contributors, workload, completion repeats, confirmed task API/MCP actions, named relation grouping, independent project boards and document conflict/draft recovery are implemented in #574–#584 with required CI passed. Project-independent shared knowledge pages are implemented on the follow-up workspace-wiki branch with database scope/hierarchy guards, revision-controlled editing, reversible archive and confirmed MCP actions; PostgreSQL/browser acceptance remains pending. Required approving reviews and production/team acceptance remain pending; code presence is not a replacement-readiness claim. Standalone records, formulas/rollups, reusable forms, page-level permissions and history restoration remain open. Current users belong to one organization; a new multi-organization identity system is not required. Preserve project-linked financial associations and decide classification for clients spanning portfolios without duplicate clients. Existing projects remain unclassified until reviewed. Switching views must change neither ownership nor permissions.

Do not assume the two portfolios have the same invoice issuer, tax profile, numbering, currency, mailbox or payment account. Inventory those identities before mapping financial history. Historical issuer, invoice numbers, amounts, currencies, tax and payment references must stay intact. Cross-currency totals need separate currency totals or an explicit rate policy.

## Capability comparison

"Present" below means source/UI exists, not whole-app live acceptance. The deployed OAuth/health/backup verification from October 11 covers those features only.

| Capability / advantage | Current Ashbi evidence | Remaining work |
| --- | --- | --- |
| Notion: docs, nested pages, reusable knowledge | `Note` hierarchy/templates/mentions and `Docs.jsx`; task block editor and subpages; project-independent shared workspace wiki implemented on a follow-up branch | Wiki PostgreSQL/browser CI passed in #586; real-project edit/search/share/export/recovery acceptance (#285, #404), page-level permissions and history restoration |
| Notion: flexible databases and views | Saved table/board/calendar views and eight typed task fields merged; typed filters, grouped table/gallery and named relations passed required CI in #576/#577/#582 | Approving review and target acceptance; standalone records, formulas and rollups. JSON storage alone is not database parity |
| Notion: collaboration and intake | Doc mentions, project chat, client intake forms; revision conflict checks and retained drafts in #584 passed required CI | Required review and target acceptance; simultaneous editing, history restore, page-level sharing and reusable record forms |
| Fluent Boards: visual task delivery | Canonical projects with configurable stages, shared templates, independent boards, one accountable owner plus contributors, calendar and completion-triggered recurrence; implementation CI passed | Required reviews, deployment and target acceptance; prove populated dependency/timeline, keyboard and mobile delivery |
| Fluent Boards: workload and integrations | Logged-hours weekly capacity with separate owner/contributor counts in #579, plus timesheets, scheduling, project planner, automation UI and scoped HTTP/MCP tools | Required reviews and reporting/automation fidelity in target use; a reusable importer is not required |
| Bonsai: CRM and client experience | Clients/contacts, pipeline, proposals, estimates, contracts, intake, booking and client portal | Representative lead → project → approval → delivery acceptance; permission and branding evidence (#286) |
| Bonsai: time, budgets and billing | Timers/manual entries, approved/invoiced locks, rate cards, retainers, recurring invoice code and expenses | Unbilled draft workflow merged in #589; populated target acceptance and line-item/tax/partial-payment/refund reconciliation; recurring delivery, cash-flow/profitability/currency reports; provider test journey (#280, #378, #379) |
| Bonsai: signed agreements | Contract signing portal exists | Signature evidence, final-document integrity, retention/export and provider/business acceptance (#380); imported PDFs are historical documents, not newly signed agreements |
| One master app: API / MCP | Tenant-scoped HTTP/API keys and enabled read-only ChatGPT OAuth | Portfolio filters and canonical relationships in API/MCP; actual ChatGPT connection/revocation acceptance (#561). Extend writes only through existing scoped confirmation/audit rules |
| One master app: operational reliability | Exact-release API/worker checks, encrypted backups, isolated restore drill and off-server copies; backup timer enabled | Named alert owner and delivery (#303); continued scheduled backup/restore monitoring, daily team use, client acceptance and source-retirement evidence |

This aims to carry every existing Ashbi workflow forward. A product's entire optional catalogue is not automatically a build commitment: record each additional feature as required, preserved historical data, deferred or externally serviced, with Cameron's decision. Embedded AI remains optional; ChatGPT/MCP is the primary AI interface as requested. WordPress-specific plugin embedding, public websites, banking and jurisdiction-specific tax filing need separate requirement decisions rather than presumed native replacements.

## Source-informed feature requirements

October 13 update: saved table/board/calendar views merged in #570 and passed final PR/main CI. Typed project task fields and canonical task/project/client/person relations are now implemented on a follow-up branch ([contract](typed-task-fields.md)); their CI and target acceptance are pending. This closes the initial fixed-field limitation, not standalone database, formula, rollup or bidirectional relation parity.

The connected Notion source was inspected read-only on October 11. Its Projects & Tasks guide was last edited October 8 and still describes Notion as the work tracker, Stripe as payment authority, Google Workspace as file/agreement authority and Bonsai as historical records; older migration notes describe a retired Hub direction. Cameron's newer instruction in this conversation establishes Hub as the new consolidation target. This does not make the old source data obsolete or reactivate historical projects/invoices. No Notion content, status or permission was changed.

The collected Projects, Tasks and CRM schemas inform these concrete feature and later data-input requirements:

| Source collection | Preserve / implement |
| --- | --- |
| Projects | Client and portal relations; Owner; Project Type; Active/Waiting/Planning/Done; Next Action; Blocker / Decision; Review Gate; dates and last status check; Drive/Figma/GitHub/MarkUp links |
| Tasks | Project/portal relations; parent/subtask relations; To do/Doing/Review/Waiting/Later/Done/Retired; Owner; Due Date; Task Type; Approval Required; Client-facing and Client Update; Waiting on and Resume when; Client work formula and Project work type rollup |
| CRM | Company/contact identity; pipeline Stage separate from Client Status; Service and lead Source; estimated value/follow-up dates; Primary Project/portal/payment relations; Stripe Customer, Signed Agreement and Agreement Status; source verification dates |

These requirements are informed by source schemas and the private collection. Collection coverage does not guarantee complete permission, formula or historical export fidelity. Do not flatten Review into Done, Waiting into an unexplained blocked state, or Retired into an active project. Source client-facing flags do not by themselves authorize portal publication. Preserve Stripe/Drive/Figma/GitHub references as links; a master operating app need not duplicate their underlying payment, file, design and code engines.

## Features first, then one-time data input

Cameron clarified on October 11 that reusable importers are outside the delivery scope. Build usable features first, then enter the reviewed records once. Existing exports and read-only source collection are reference material, not prerequisites for development. Do not build provider synchronizers, a migration dashboard or reusable ingestion infrastructure for this scope.

The source collection covers reachable Notion collections/pages/comments, Fluent Boards records and files, current Bonsai connector records and historical workbooks. It is retained privately outside Git. Coverage gaps remain documented with the collection; they do not block feature implementation. Legacy import utilities and the file-inventory helper remain optional existing tools, not the chosen product roadmap or evidence of complete source fidelity.

## Delivery order and acceptance

1. **Shared everyday delivery.** Finish portfolio views, configurable named task stages, task/project templates, ownership, collaborators, dependencies and recurring work. Prove a shared client project through assignments, docs, time and approvals. Extend scoped API/MCP access with each canonical entity. First slice: project classification and project views, with task API and workspace MCP filters. Configurable project stages are now locally implemented; calendar recurring tasks are now locally implemented; board templates, additional views and end-to-end acceptance remain next. See [recurring tasks](recurring-tasks.md). See [project task stages](project-task-stages.md).
2. **Flexible knowledge and records.** Add typed properties, relations and saved table/board/calendar views using real Notion workflows as reference. Prove filtering, sorting, search, links, attachments, permissions, history and recovery. Include workspace knowledge that can exist without a client project.
3. **Complete client and revenue workflows.** Prove lead → proposal → agreement → delivery → approved time/expenses → invoice → test payment → receipt/reconciliation. Finish line items, taxes, partial payments/refunds, recurring billing, and profitability reports by currency. Preserve separate issuer identities where required. ChatGPT/MCP is the primary AI interface; embedded AI remains optional.
4. **QA representative populated workflows.** Test the UI, mobile/keyboard use and API/MCP journeys with representative QA records. Verify persisted edits, permissions, error/retry states, backups and recovery. Feature readiness means the workflow works end to end, not merely that a route or page exists.
5. **One-time data input and cutover.** Review canonical clients/projects, source identities, stages, relationships, finance values and files; enter them using the finished app/API in a bounded run. Keep original IDs/references where useful and reconcile record counts, totals by currency, relationships, files and ownership. Historical input must not trigger client messages, reminders or charges. Use backup and recovery evidence before switching a workflow to Hub. Retain source records and read-only fallback until team acceptance.

Both agency and freelance work are shared with the Ashbi team. Views must not duplicate clients or change permissions. Existing projects stay unclassified until reviewed. Full feature replacement is not yet complete; each slice must state local validation, deployed state and authenticated acceptance separately.

## Sources checked

- [Notion databases](https://www.notion.com/help/intro-to-databases) and [exports](https://www.notion.com/help/export-your-content).
- [Fluent Boards features](https://fluentboards.com/features/), [board exports](https://docs.fluentboards.com/board-settings) and [developer import/export format](https://developers.fluentboards.com/rest-api/import-export).
- [Bonsai product capabilities](https://www.hellobonsai.com/) and [account data export](https://help.hellobonsai.com/en/articles/1295803-how-to-export-your-account-data-from-bonsai).

Collected source material informs requirements and later one-time input; it does not prove feature parity or complete historical coverage.
