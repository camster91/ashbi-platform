# One Ashbi workspace for agency and freelance work

Reviewed October 11, 2026 against the repository and official product documentation. This is a feature and data-migration plan, not a statement of complete replacement readiness. It extends [replacement readiness](replacement-readiness-matrix.md), [product status](product-status.md), roadmap #393 and migration #414.

Execution tracking: [#565](https://github.com/camster91/ashbi-platform/issues/565).

## Product decision

Cameron confirmed that both agency and freelance work should be shared with the Ashbi team. Use one organization with **Ashbi Design**, **Freelance** and **All work** portfolio views. Clients, contacts, people and documents should be canonical records rather than duplicate copies per view. Existing role permissions and client-specific visibility still apply: sharing with the team does not expose internal work to clients.

Portfolio classification is planned, not implemented. Current users belong to one organization; a new multi-organization identity system is not required for this shared-team scope. Add explicit portfolio association/filtering to projects and financial reporting, propagated to tasks, time and docs through the project. Decide how to classify clients working across both portfolios; do not force duplicate clients. Existing projects remain unclassified until reviewed. Switching views must change neither ownership nor permissions.

Do not assume the two portfolios have the same invoice issuer, tax profile, numbering, currency, mailbox or payment account. Inventory those identities before mapping financial history. Historical issuer, invoice numbers, amounts, currencies, tax and payment references must stay intact. Cross-currency totals need separate currency totals or an explicit rate policy.

## Capability comparison

"Present" below means source/UI exists, not whole-app live acceptance. The deployed OAuth/health/backup verification from October 11 covers those features only.

| Capability / advantage | Current Ashbi evidence | Remaining work |
| --- | --- | --- |
| Notion: docs, nested pages, reusable knowledge | `Note` hierarchy/templates/mentions and `Docs.jsx`; task block editor and subpages | Real-project edit/search/share/export/recovery acceptance (#285, #404); project-independent workspace wiki design |
| Notion: flexible databases and views | Task `properties` JSON and fixed property UI are present | Typed custom properties, relational records, saved table/board/calendar/gallery views, query/filter/sort/group, formula and rollup requirements. JSON storage alone is not database parity |
| Notion: collaboration and intake | Doc mentions, project chat, client intake forms | Concurrent editing/conflict handling, history restore, page-level sharing; reusable forms linked to structured records rather than only the existing intake flow |
| Fluent Boards: visual task delivery | Kanban/list, task ordering, one assignee, subtasks, labels, dates, dependency and project templates | Configurable named boards/stages separate from lifecycle status, multiple collaborators versus accountable owner, recurrence, board templates, saved views; prove dependency/timeline, keyboard and mobile journeys |
| Fluent Boards: workload and integrations | Timesheets, scheduling, project planner, automation UI, scoped HTTP/MCP tools | Workload/report fidelity, deterministic rule triggers and recurrence tests, bridge coverage, export/import mappings; no Fluent Boards importer exists |
| Bonsai: CRM and client experience | Clients/contacts, pipeline, proposals, estimates, contracts, intake, booking and client portal | Representative lead → project → approval → delivery acceptance; permission and branding evidence (#286) |
| Bonsai: time, budgets and billing | Timers/manual entries, approved/invoiced locks, rate cards, retainers, recurring invoice code and expenses | Approved unbilled-time-to-invoice workflow; line-item/tax/partial-payment/refund reconciliation; recurring delivery, cash-flow/profitability/currency reports; provider test journey (#280, #378, #379) |
| Bonsai: signed agreements | Contract signing portal exists | Signature evidence, final-document integrity, retention/export and provider/business acceptance (#380); imported PDFs are historical documents, not newly signed agreements |
| One master app: API / MCP | Tenant-scoped HTTP/API keys and enabled read-only ChatGPT OAuth | Portfolio filters and canonical relationships in API/MCP; actual ChatGPT connection/revocation acceptance (#561). Extend writes only through existing scoped confirmation/audit rules |
| One master app: operational reliability | Exact-release API/worker checks, encrypted backups, isolated restore drill and off-server copies; backup timer enabled | Named alert owner and delivery (#303); continued scheduled backup/restore monitoring, daily team use, client acceptance and source-retirement evidence |

This aims to carry every existing Ashbi workflow forward. A product's entire optional catalogue is not automatically a build commitment: record each additional feature as required, preserved historical data, deferred or externally serviced, with Cameron's decision. Embedded AI remains optional; ChatGPT/MCP is the primary AI interface as requested. WordPress-specific plugin embedding, public websites, banking and jurisdiction-specific tax filing need separate requirement decisions rather than presumed native replacements.

## Export fidelity and blockers

The connected Notion source was inspected read-only on October 11. Its Projects & Tasks guide was last edited October 8 and still describes Notion as the work tracker, Stripe as payment authority, Google Workspace as file/agreement authority and Bonsai as historical records; older migration notes describe a retired Hub direction. Cameron's newer instruction in this conversation establishes Hub as the new consolidation target. This does not make the old source data obsolete or reactivate historical projects/invoices. No Notion content, status or permission was changed.

The fetched canonical Projects, Tasks and CRM schemas add these concrete migration requirements:

| Source collection | Preserve / implement |
| --- | --- |
| Projects | Client and portal relations; Owner; Project Type; Active/Waiting/Planning/Done; Next Action; Blocker / Decision; Review Gate; dates and last status check; Drive/Figma/GitHub/MarkUp links |
| Tasks | Project/portal relations; parent/subtask relations; To do/Doing/Review/Waiting/Later/Done/Retired; Owner; Due Date; Task Type; Approval Required; Client-facing and Client Update; Waiting on and Resume when; Client work formula and Project work type rollup |
| CRM | Company/contact identity; pipeline Stage separate from Client Status; Service and lead Source; estimated value/follow-up dates; Primary Project/portal/payment relations; Stripe Customer, Signed Agreement and Agreement Status; source verification dates |

This is schema discovery, not a row census or complete view/formula export. Formula code, saved-view definitions, row counts, permissions and files still need retrieval and reconciliation. Do not flatten Review into Done, Waiting into an unexplained blocked state, or Retired into an active project. Imported client-facing flags do not by themselves authorize portal publication. Preserve Stripe/Drive/Figma/GitHub references as links; a master operating app need not duplicate their underlying payment, file, design and code engines.

| Source | Available export path | Current importer | Before any live pilot |
| --- | --- | --- | --- |
| Notion | HTML or Markdown pages, database CSV and exported files; inventory relations, views and permissions separately | Selected project Markdown import; unsupported non-Markdown files block it; no rollback by run id | Preserve attachments and page IDs/links; build database mapping and per-run rollback; preserve formulas/relations/views as explicit mappings or exceptions |
| Fluent Boards | Board JSON/CSV, separate timesheet export | None | Capture assignees separately: official board-export documentation says they are excluded. Preserve named stages, statuses, parent links, comments, files, labels, recurrence and time as present in a representative export; do not invent a schema from marketing |
| Bonsai | Separate CSV datasets from Company Settings → Data | Legacy six-file clients/contacts/projects/invoices/time/expenses importer | Current exporter lists Companies/Company Addresses/Tasks and may differ from expected legacy headers. Verify a sample; improve source IDs, owner mapping, multi-line invoices and overhead expenses; preserve proposals/contracts/files separately; add ledger, conflict detection and rollback |

The existing Bonsai importer overwrites matched client/project values, maps some owners by name, imports one invoice line, and omits proposals/contracts/tasks/files. It must not be run on live history as if it were lossless. Notion Markdown import is also not a complete workspace import. Existing #414 owns shared ledger/reconciliation/cutover hardening; do not replace its runbook with a second incompatible contract.

## Start with read-only inventories

`scripts/inventory-migration-source.mjs` records relative paths, byte counts, SHA-256 file hashes, a deterministic manifest hash, format coverage hints and unresolved mappings. It never connects to a database/provider, parses record content, imports records or writes into the input tree. It always reports `migrationReady: false`; even a supported file extension proves neither schema compatibility nor fidelity.

```sh
node scripts/inventory-migration-source.mjs --source notion --input-dir /secure/exports/notion --summary-file /secure/reports/notion-inventory-001.json
node scripts/inventory-migration-source.mjs --source fluentboards --input-dir /secure/exports/fluentboards --summary-file /secure/reports/fluent-inventory-001.json
node scripts/inventory-migration-source.mjs --source bonsai --input-dir /secure/exports/bonsai --summary-file /secure/reports/bonsai-inventory-001.json
```

Use frozen, extracted exports and a new report path outside their directory. Symlinks/special files are refused as findings. Limits: 10,000 entries and 64 directory levels; split larger snapshots into documented batches. Reports contain potentially sensitive filenames, so retain them with the exports. Creation uses `wx` and mode `0600`; Windows requires workspace/OS ACLs for privacy. This is file-level inventory, not a record count, permission analysis, ZIP extractor, full schema validator or defense against an adversary modifying the source during scanning.

## Delivery order and acceptance

1. **Inventory and reconcile identities.** Collect one representative project from each source and list all active workflows, custom fields/views/rules, files and finance identities. Assign Ashbi/Freelance portfolio and source ownership. Archive originals and reviewed manifests; retain source access. No live data has moved in this preparation.
2. **Make everyday delivery work.** Add portfolio views, configurable board stages and repeatable task/project templates; prove one shared client project with docs, assignments, dependencies, time and client-visible approvals. Extend API/MCP alongside each canonical entity.
3. **Fill knowledge gaps.** Add typed structured records and saved views based on the real Notion databases; prove relations, permissions, assets, links, history and recovery. Rehearse a small Notion and Fluent Boards import into disposable staging with explicit assignee mapping.
4. **Finish and migrate revenue.** Prove sandbox proposal → agreement → approved time/expenses → invoice → test payment → receipt/reconciliation. Preserve history and issuer identity; imported invoices must never send reminders, create checkouts or charge clients. Complete Bonsai ledger/fidelity improvements before staging history import.
5. **Cut over one workflow at a time.** Use the existing [cutover runbook](migration-cutover-runbook.md). Require counts, file hashes, ownership, permission/relationship samples, zero unexplained differences, tested rollback, supported mobile/keyboard journeys, API/MCP acceptance and a team dogfood period. Retire a source workflow only after its own acceptance; keep exports and read-only fallback.

First app-development slice: portfolio-filtered project/task/doc/time views and configurable task stages, after the source/issuer inventory. Do not merge arbitrary source labels into global statuses or duplicate clients to simulate separate businesses. Production import requires an exact reviewed mapping, report and cutover scope; this preparation does not trigger external messages, billing or source deletion.

## Sources checked

- [Notion databases](https://www.notion.com/help/intro-to-databases) and [exports](https://www.notion.com/help/export-your-content).
- [Fluent Boards features](https://fluentboards.com/features/), [board exports](https://docs.fluentboards.com/board-settings) and [developer import/export format](https://developers.fluentboards.com/rest-api/import-export).
- [Bonsai product capabilities](https://www.hellobonsai.com/) and [account data export](https://help.hellobonsai.com/en/articles/1295803-how-to-export-your-account-data-from-bonsai).

Source export availability does not prove completeness or compatibility with the local importers. Exact tenant schemas and exports remain unverified until collected.
