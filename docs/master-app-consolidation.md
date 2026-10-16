# One Ashbi workspace for agency and freelance work

Reviewed October 11, 2026 against the repository and official product documentation. This is a feature-completion and one-time data-input plan, not a statement of complete replacement readiness. It extends [replacement readiness](replacement-readiness-matrix.md), [product status](product-status.md), roadmap #393 and migration #414.

Current status and delivery order: [master delivery plan](master-app-delivery-plan.md); actionable checklist: [GitHub #565](https://github.com/camster91/ashbi-platform/issues/565). This document retains source requirements and scope, not a second current TODO list.

October 16, 2026 source reconciliation: merged main `e7c7bed2654867146166c7303c1caa4e6405fd4a` ([#640](https://github.com/camster91/ashbi-platform/pull/640)) includes scoped optional OAuth actions, the default-disabled staff bot pilot, native Gmail identity/bounded INBOX ingestion, human portal handoffs and explicit manual document conflict reconciliation. This is not a production deployment or real-provider acceptance claim. Project Note audiences (#592), retained history (#606) and standalone collections (#590) are implemented; the 100-revision/admin-restore/no-time-purge policy is approved. Historical deployment holds are superseded by the owner's deployment authorization; release gates and source-primary cutover boundaries remain.

## Product decision

Cameron confirmed that both agency and freelance work should be shared with the Ashbi team. Use one organization with **Ashbi Design**, **Freelance** and **All work** portfolio views. Clients, contacts, people and documents should be canonical records rather than duplicate copies per view. Existing role permissions and client-specific visibility still apply: sharing with the team does not expose internal work to clients.

Project portfolios, stages, recurrence, views, typed fields, templates, document/time/financial portfolios, groups/gallery, contributors/workload, confirmed actions, named relations and independent boards are merged through #586. Independent wiki/inherited wiki audiences, revision checks and draft recovery passed PostgreSQL/browser CI and merged in #586. Collections/formulas/rollups/forms, Project Note audiences and retained history are implemented. Explicit manual conflict reconciliation is implemented in e7; realtime simultaneous-edit convergence and populated team acceptance remain separate. Current users share one organization; preserve canonical clients, project-linked financial associations and permissions. Existing classifications require reviewed input.

Do not assume the two portfolios have the same invoice issuer, tax profile, numbering, currency, mailbox or payment account. Inventory those identities before mapping financial history. Historical issuer, invoice numbers, amounts, currencies, tax and payment references must stay intact. Cross-currency totals need separate currency totals or an explicit rate policy.

## Capability comparison

"Present" below means source/UI exists, not whole-app live acceptance. The deployed OAuth/health/backup verification from October 11 covers those features only.

| Capability / advantage | Current Ashbi evidence | Remaining work |
| --- | --- | --- |
| Notion: docs, nested pages, reusable knowledge | Project Note hierarchy/templates/mentions and task subpages; independent wiki/inherited wiki audiences merged in #586 with PostgreSQL/browser CI | Real-project search/share/export/recovery acceptance; realtime convergence remains separate from implemented audiences/history/manual recovery (#285/#404) |
| Notion: flexible databases and views | Typed task fields, saved views, filters/groups/gallery and named relations merged; standalone records/formulas/rollups/forms implemented in merged #590 | Populated target acceptance; historical implementation/main-CI work is complete |
| Notion: collaboration and intake | Mentions/chat/intake code; revision conflicts and retained drafts merged in #586; record forms implemented in #590 | Target acceptance and realtime convergence; Note sharing, history restore and manual recovery are implemented |
| Fluent Boards: visual task delivery | Stages, templates, independent boards, accountable owner/contributors and calendar/completion recurrence merged with required CI through #586 | Deployment and populated target acceptance; dependency/timeline, keyboard and mobile delivery |
| Fluent Boards: workload and integrations | Workload/contributors merged in #579; timesheets, scheduling, planner, automation and scoped HTTP/MCP code | Populated reporting/automation/integration acceptance; reusable importers remain outside scope |
| Bonsai: CRM and client experience | Clients/contacts, pipeline, proposals, estimates, contracts, intake, booking and client portal | Representative lead → project → approval → delivery acceptance; permission and branding evidence (#286) |
| Bonsai: time, budgets and billing | Timers/manual entries, approved/invoiced locks, rate cards, retainers, recurring invoice code and expenses; atomic drafts #588 and approved-unbilled billing #589 merged with required CI | Populated/provider acceptance; line-item/tax/partial-payment/refund reconciliation, recurring delivery and reports by currency (#280/#378/#379) |
| Bonsai: signed agreements | Contract signing portal exists | Signature evidence, final-document integrity, retention/export and provider/business acceptance (#380); imported PDFs are historical documents, not newly signed agreements |
| One master app: API / MCP | Tenant-scoped HTTP/API keys and enabled read-only ChatGPT OAuth | Portfolio filters and canonical relationships in API/MCP; actual ChatGPT connection/revocation acceptance (#561). Extend writes only through existing scoped confirmation/audit rules |
| One master app: operational reliability | Exact-release API/worker checks, encrypted backups, isolated restore drill and off-server copies; backup timer enabled | Named alert owner and delivery (#303); continued scheduled backup/restore monitoring, daily team use, client acceptance and source-retirement evidence |

This aims to carry every existing Ashbi workflow forward. A product's entire optional catalogue is not automatically a build commitment: record each additional feature as required, preserved historical data, deferred or externally serviced, with Cameron's decision. Embedded AI remains optional; ChatGPT/MCP is the primary AI interface as requested. WordPress-specific plugin embedding, public websites, banking and jurisdiction-specific tax filing need separate requirement decisions rather than presumed native replacements.

## Source-informed feature requirements

Saved task views #570 and typed project/task/client/person fields and relations #571 are merged with required CI. Standalone collections/formulas/rollups/forms are implemented in #590, with all required CI passed and normal merge e1690e4. These code milestones do not prove populated target or complete database parity.

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

Use the [current delivery/status entrypoint](master-app-delivery-plan.md) and #565. Finish the pinned e7 release and changed-workflow QA, accept implemented ChatGPT/human-bot/portal/document workflows, then address the seven validated adapter, coverage, queue and policy gaps recorded there. Rehearse reviewed bounded input while sources remain primary; record readback, team acceptance and an explicit cutover with retained fallback. Do not rebuild collections, Note audiences or retained history, or ask again for the resolved history policy. Financial identity and source-fidelity safeguards above remain in force.

## Sources checked

- [Notion databases](https://www.notion.com/help/intro-to-databases) and [exports](https://www.notion.com/help/export-your-content).
- [Fluent Boards features](https://fluentboards.com/features/), [board exports](https://docs.fluentboards.com/board-settings) and [developer import/export format](https://developers.fluentboards.com/rest-api/import-export).
- [Bonsai product capabilities](https://www.hellobonsai.com/) and [account data export](https://help.hellobonsai.com/en/articles/1295803-how-to-export-your-account-data-from-bonsai).

Collected source material informs requirements and later one-time input; it does not prove feature parity or complete historical coverage.
