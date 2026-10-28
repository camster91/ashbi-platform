# Feature cleanup inventory

23 October 2026. Owner direction and execution order: [#565](https://github.com/camster91/ashbi-platform/issues/565), [plan](../tasks/plan.md), dependency audit #686. This is a source inventory, not permission to delete customer records.

27 October 2026: at the owner's explicit request, all 54 remaining issues were
closed as not planned and all five open pull requests were closed unmerged,
including the previously held #684. The issue references below preserve the
historical plan; their closure does not establish implementation, deployment,
acceptance or remediation. The route removal below is local source work.

| Area | Disposition | Evidence and next action |
| --- | --- | --- |
| Client/project/task UI and services | Keep/adapt | Existing pages, routes and validation; #690/#691 port one workflow at a time. |
| Documents, project notes and editors | Keep/consolidate | TaskPage imports NotionEditor; its name does not make it an obsolete importer. Preserve hierarchy, permissions, revisions and conflicts under #285. |
| Contracts/proposals and signing records | Keep/adapt | Existing public/staff routes and evidence hashes; #280/#380 own the complete lifecycle and evidence decision. |
| Invoices and Stripe | Keep/adapt | Current service creates Checkout sessions; #693/#694 add native Stripe invoice drafting/status. Preserve legacy billing and locks. |
| Client portal and deliberate approvals | Keep/adapt | Restricted project/file/document/invoice access stays under #286/#417; client privacy is not optional. |
| Singular legacy timer route | Removed from source in #687 cleanup | Deleted `src/routes/time-session.routes.js` after rechecking consumers against main `8dc9c45` on 27 October 2026. The mounted module remains `src/routes/time-sessions.routes.js`; persisted sessions and time entries are unchanged. See removal evidence below. |
| Legacy landing route | Removed from source in #687 cleanup | Deleted `src/routes/landing.routes.js` after the same consumer check. Its `prisma.lead` model is absent. The mounted `src/routes/leads.routes.js` remains unchanged. See removal evidence below. |
| Capacitor packages | Retain pending coordinated native retirement | The 27 October audit found real consumers: `web/capacitor.config.json`, `web/android/app/build.gradle`, `web/android/capacitor.settings.gradle`, generated plugin dependencies and `MainActivity.java`. Removing the six packages alone would break the native build. Browser push remains independent. |
| Duplicate timer UI/APIs | Consolidate after #692 passes | Header and project controls must use one persisted session before any active handler is removed. |
| Embedded AI, bots, semantic search, MCP expansion | Defer/retire after dependency map | #561 is deferred. Do not delete security/redaction tests or existing OAuth data simply because the new milestone excludes agents. Credential exposure #382 still requires remediation. |
| Slack/WhatsApp and provider ingestion | Defer/retire consumers first | PR #685 review identified static `postSlackMessage` imports in ai-bridge/ai-tool and SlackChannelMapping use. A service/table deletion can break startup. |
| Sales pipeline versus inbound processing | Separate before removal | `src/services/pipeline.service.js` processes inbound messages and is imported by worker, Mailgun, webhook and thread routes. It is not the sales-deal service and must not be deleted with Pipeline.jsx. |
| Calls, screen recording and transcription | Defer new work | Files/comments/project approvals remain. Preserve any original media and export paths before removing code/models. |
| Notion/Bonsai importers and legacy data | Keep until checked cutover | #414 owns private source reconciliation and unsupported records. Removing importers before verified input blocks replacement. Never commit source exports. |
| PostgreSQL/Redis/BullMQ/local files | Replace only after prototype | #689 must demonstrate retained guarantees on D1/R2/bounded jobs before any runtime or table is dropped. |
| WordPress bridge | Separate work, not lean core | Closed unmerged PR #682 proposed a restoration, so the earlier proposal's no-mounted-bridge claim is branch-specific. Stored site data remains untouched. |
| Legacy tests | Keep meaningful guarantees | No deletion based on file count/lines/name. Consumer removal precedes test retirement; preserve unique security, money, accessibility and recovery assertions. |

## Legacy route removal evidence (#687)

The application registers explicit imports through `src/domains/`; it does not
discover route files dynamically. A repository-wide search for
`time-session.routes` and `landing.routes` found no application, test, build or
deployment consumer. At the route-removal checkpoint, the only executable-text
references were in the historical one-off
`scripts/_legacy/fix-3-missing-imports.py`. It targeted a hardcoded old workspace
and edited existing files with `read_text()`; no package script or CI invoked it.
That fixer was subsequently removed in the bloat cleanup below. Its source
remains available in Git history, including revision `2781218`.

`registerClientWorkspaceRoutes` still mounts the plural `time-sessions` module at
`/api/time-sessions`. `registerCommercialRevenueRoutes` still mounts `leads` at
`/api/leads`. Existing route-table, domain registration and access-matrix tests
verify these active contracts without updating their snapshots or allowlists.
The timer start schema is also used by `time-tracking.routes.js` and is retained.

No schema, stored data, frontend, package, deployment or release setting changes
are part of this removal. Before commit, restore the two files from `HEAD` to
undo it; after commit, revert the cleanup commit. Restoring these unmounted files
requires no database repair or migration. Source cleanup alone is not deployment
or target-environment acceptance.

## Backlog dispositions

Fourteen issues were closed as not planned/superseded, with explanatory comments and retained history: #418, #415, #411, #410, #393, #392, #390, #407, #288, #391, #287, #324, #323 and #548. None is a claim that migration, QA, media, integration or UX work was completed.

#545 was closed as completed after verifying merged #669 and current Tailwind 4 source. Security/build advisory #533 was subsequently closed as not planned in the owner's bulk closure; its actual dependency graph and advisory still need verification. A version migration alone is not a security verdict.

Security #296/#381/#382, privacy #310, contract evidence #380, backup #282, accessibility and the two browser flakes #547/#659 were also closed as not planned in that bulk closure. Their unresolved acceptance and remediation needs are preserved as historical context. Existing runtime alerting work remains relevant while the old application runs.

## Dependency cleanup — 27 October 2026

Removed the unused root development dependency `execa` after searching tracked
source, scripts, configuration, CI and package commands across the repository.
Regenerated the lockfile with npm in an isolated scratch directory. Seventeen
development-only package entries were removed; every retained package entry,
including all production entries, is unchanged. Restore the manifest and lockfile
together to undo this removal.

Retained `@opentelemetry/api` because the SDK and auto-instrumentation packages
require its peer API, even though application files do not import it directly.
Retained `proxy-agent` because it supplies the browser tooling peer documented
in [dependency-lockfile-maintenance.md](dependency-lockfile-maintenance.md).
Retained CSV importers and their dependencies until source cutover is verified.

Validation used Node 24.22.0 after a clean `npm ci` and Prisma generation:
`npm run verify:quick` passed (2,631 backend tests and 1,949 frontend tests),
both package dependency trees passed `npm ls --all`, and `npm run build` passed
including frontend budgets. Secret scanning and whitespace checks passed.
On this Mac, the test command used a temporary directory without symlink path
components: the default `/var` temporary path causes three existing CLI/artifact
tests to fail on unchanged main. No test, security check or acceptance threshold
was disabled. These are local checks, not hosted CI or production acceptance.

## Validator and verification follow-up — 27 October 2026

Removed `landingLeadSchema` and `landingLeadUpdateSchema`, which had no remaining
application consumers after the legacy landing route removal. The generated
OpenAPI document, mounted routes and active lead validators remain unchanged.

Three existing CLI/artifact test fixtures now canonicalize their temporary
root paths so macOS's `/var` alias does not cause false failures. Production
path validation and all symlink/traversal rejection assertions are retained.
The full `verify:quick` command passed on Node 24.22.0 with the default temporary
directory: 2,631 backend and 1,949 frontend tests. The earlier temporary-directory
override recorded above is no longer needed for these fixtures.

## Test and tooling cleanup — 27 October 2026

Consolidated five small frontend workflow-contract files into their existing
finance/operations and general workflow suites. Moved those two grouped suites,
date-only helpers and telemetry scrubbing to the Node contracts project. All
frontend assertions are retained; nine files no longer start jsdom and five
test files are eliminated through grouping. Markdown sanitization and component
tests retain their browser environment.

Removed four redundant backend cases: two upload-allowlist checks duplicated
by the broader `file-upload-validation.test.js` cases, and two source-existence
checks already enforced by actual schema imports and validation tests. The case
previously titled path-traversal prevention only checked export text. Actual
traversal and byte-policy checks remain in `file-upload-policy.test.js`, and the
route-validation ratchet is unchanged.

Removed five unreferenced one-off fixers from `scripts/_legacy/`, the unused
`.pi` worktree/automatic-merge scripts, and the unused `utils/ai-prompts-proxy.js`
barrel. None has an application, package-command or CI consumer. The remaining
legacy audit scripts are retained because historical operator documents refer
to them. Removed generated Upwork debug screenshot/notification output and
ignored those two output paths to prevent recommitting them. Before deletion,
all ten files were copied to a named backup outside the checkout; tracked
versions also remain recoverable from Git history. No migration, original
business record, native package, font or visual baseline was removed.

The Hub Docker context excludes the separate `apps/`, `prototypes/` and
`upwork-agent/` packages and root browser `tests/`, which its Dockerfile does not
copy. These remain in source; all Dockerfile COPY inputs are retained. A local
Docker image check was unavailable because the installed CLI lacks Buildx.

Local validation passed on Node 24.22.0: `verify:quick` (2,627 backend tests and
1,949 frontend tests across 257 frontend files), the application build and
frontend budgets, the Dockerfile COPY-input check, four artifact-workflow
contract tests, secret scanning and whitespace checks. A comparison confirmed
that every moved/grouped frontend assertion was retained. Installed dependencies
and generated build output can be recreated from the retained lockfiles and
build commands; they are not source or backup evidence.
