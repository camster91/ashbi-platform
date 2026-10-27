# Feature cleanup inventory

23 October 2026. Owner direction and execution order: [#565](https://github.com/camster91/ashbi-platform/issues/565), [plan](../tasks/plan.md), dependency audit #686. This is a source inventory, not permission to delete customer records.

| Area | Disposition | Evidence and next action |
| --- | --- | --- |
| Client/project/task UI and services | Keep/adapt | Existing pages, routes and validation; #690/#691 port one workflow at a time. |
| Documents, project notes and editors | Keep/consolidate | TaskPage imports NotionEditor; its name does not make it an obsolete importer. Preserve hierarchy, permissions, revisions and conflicts under #285. |
| Contracts/proposals and signing records | Keep/adapt | Existing public/staff routes and evidence hashes; #280/#380 own the complete lifecycle and evidence decision. |
| Invoices and Stripe | Keep/adapt | Current service creates Checkout sessions; #693/#694 add native Stripe invoice drafting/status. Preserve legacy billing and locks. |
| Client portal and deliberate approvals | Keep/adapt | Restricted project/file/document/invoice access stays under #286/#417; client privacy is not optional. |
| Singular legacy timer route | Remove in #687 | `src/routes/time-session.routes.js` has no application/test consumer. Only references found are in historical `scripts/_legacy/fix-3-missing-imports.py`. The mounted route is `src/routes/time-sessions.routes.js`. |
| Legacy landing route | Remove in #687 | `src/routes/landing.routes.js` has no application/test consumer, only the same legacy generator reference. Its `prisma.lead` model is absent; do not mount or repair it as cleanup. |
| Capacitor packages | Remove after package audit #688 | Six dependencies in web/package.json, no source consumers found in the earlier proposal. Recheck all configs/scripts; preserve browser push. |
| Duplicate timer UI/APIs | Consolidate after #692 passes | Header and project controls must use one persisted session before any active handler is removed. |
| Embedded AI, bots, semantic search, MCP expansion | Defer/retire after dependency map | #561 is deferred. Do not delete security/redaction tests or existing OAuth data simply because the new milestone excludes agents. Credential exposure #382 still requires remediation. |
| Slack/WhatsApp and provider ingestion | Defer/retire consumers first | PR #685 review identified static `postSlackMessage` imports in ai-bridge/ai-tool and SlackChannelMapping use. A service/table deletion can break startup. |
| Sales pipeline versus inbound processing | Separate before removal | `src/services/pipeline.service.js` processes inbound messages and is imported by worker, Mailgun, webhook and thread routes. It is not the sales-deal service and must not be deleted with Pipeline.jsx. |
| Calls, screen recording and transcription | Defer new work | Files/comments/project approvals remain. Preserve any original media and export paths before removing code/models. |
| Notion/Bonsai importers and legacy data | Keep until checked cutover | #414 owns private source reconciliation and unsupported records. Removing importers before verified input blocks replacement. Never commit source exports. |
| PostgreSQL/Redis/BullMQ/local files | Replace only after prototype | #689 must demonstrate retained guarantees on D1/R2/bounded jobs before any runtime or table is dropped. |
| WordPress bridge | Separate work, not lean core | PR #682 proposes a restoration, so the earlier proposal's no-mounted-bridge claim is branch-specific. Leave PR and stored site data untouched. |
| Legacy tests | Keep meaningful guarantees | No deletion based on file count/lines/name. Consumer removal precedes test retirement; preserve unique security, money, accessibility and recovery assertions. |

## Backlog dispositions

Fourteen issues were closed as not planned/superseded, with explanatory comments and retained history: #418, #415, #411, #410, #393, #392, #390, #407, #288, #391, #287, #324, #323 and #548. None is a claim that migration, QA, media, integration or UX work was completed.

#545 was closed as completed after verifying merged #669 and current Tailwind 4 source. Security/build advisory #533 remains open until its actual dependency graph and advisory are rechecked; a version migration alone is not a security verdict.

Security #296/#381/#382, privacy #310, contract evidence #380, backup #282, accessibility and the two unresolved browser flakes #547/#659 stay open. Existing runtime alerting work remains relevant while the old application runs. Operational and cross-repository work is not silently erased as feature clutter.
