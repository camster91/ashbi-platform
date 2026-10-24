# Ashbi workspace — private Cloudflare pilot

This is the deployable successor to the isolated local foundation proof. It uses verified Cloudflare Access JWTs and active D1 actors; there is no fixture-code login endpoint. It does not replace the current application or migrate production records.

## Local checks

`npm ci`, `npm test`, `npm run build`, `npx playwright install chromium`, `npm run test:browser` from this directory. Build is a dry-run only. `auth.test.mjs` verifies real RSA signatures and claims; `test.mjs` runs the application handler with real local D1 through Miniflare. This is not a hosted identity/MFA login test. Tests inject a signing key into the exported handler factory; the deployed default handler always uses Cloudflare's JWKS. Fixture identities are never configured in the hosted Worker.

Scope: clients, projects, tasks, plain text project documents, one timer per staff user, manual time and bounded record export. Staff records are organization scoped; clients are limited to own, deliberately shared projects and child records. Project visibility also gates children. All mutations require the same Origin and bounded input; edits require a revision. Lists paginate at 50 records; time shows the active own timer first plus the latest 100 completed own entries (at most 101 records). No destructive delete endpoint. The UI supports create/list/edit, project and task statuses, staff assignments, calendar due dates, contact email/company, task completion and time. Notes are plain text, not a full Notion block editor.

Finance/contract signing are explicitly unavailable in the interface. The next stacked source increment adds private file upload/download, sharing and soft-removal/restoration; it is enabled only when a FILES R2 binding exists. R2 is disabled in the owning account and requires dashboard activation. No public bucket or alternative storage is substituted. Stripe credentials and webhook endpoint acceptance remain outstanding. No customers, invitations, charges or source imports are created by deployment.

The built-artifact browser suite runs `dist/worker.js` with synthetic RSA identities and actual local D1, covering create/edit/assignment/date/complete/reload/timer, local private upload/download/remove/restore, keyboard/modal focus and 390/768/1440px overflow/axe checks. A source-only browser pass initially missed Wrangler injecting `__name` helpers into a serialized function; the built-bundle check caught that failure. Client JavaScript is now a literal string, and this regression runs in CI after the build. Local browser bootstrap required an alternative Chromium binary because the standard download was truncated in this environment; that is test tooling only, never a production auth bypass.

## Access and recovery

Separate app at `ashbi-workspace.camster915391.workers.dev`; explicitly permit Cameron and Bianca's Ashbi addresses only. One-hour JWT/session maximum; verify issuer, audience, RS256 signature, expiry, issued time, subject and email. Check actor activity on every request; deactivate the actor to immediately remove app access. Do not grant a client by email domain or put JWTs in browser storage. Client activation requires explicit provisioning plus a reviewed Access policy, never a role from user input.

The Access app requires independent MFA. Organisation capability is enabled for TOTP/biometrics/security keys; global enforcement stays off so existing app policies are unchanged. Staff must enrol a device at the Access App Launcher. A retained enrolled backup security key and verified Cloudflare administrator recovery are required before real-data acceptance. Recover a lost device through the Cloudflare administrator process with verified ownership; never disable the app's policy to recover it. Local JWT tests do not prove successful human enrolment or account recovery.

## Data, deployment and rollback

A new D1 database is independent of the existing PostgreSQL application. Schema is additive in this new database; never replay it over existing data. No business data is seeded. Access actors are provisioned through an approved administrative operation. Runtime configuration stores only public identifiers. Tokens/secret keys do not belong here.

Deployment uses the reviewed dry-run bundle via the connected Cloudflare API. Keep workers.dev disabled until schema, actor mapping and Access policy are verified; disable version preview URLs. Production release metadata must record bundle SHA-256, source tree, Worker version and D1 ID. Enable observability at 10%, with invocation logs disabled and query strings redacted; app code never logs content or tokens. `/health` returns status and release only; Access may intercept it at the edge.

Rollback the isolated pilot by disabling its workers.dev route; preserve the D1 database and Access configuration for investigation. Do not roll back the existing Hub or restore exposed historical seed data. Export is limited to 1,000 records per table and explicitly refuses larger exports; it omits identities and does not include private objects. It is not a complete backup. D1 Time Travel/administrative export plus isolated restore rehearsal and R2 original-byte recovery remain release gates before real customer data/cutover. No source-system deletion or cancellation is authorised by this pilot.

Owner direction is now Cloudflare deployment. Existing Coolify configuration and held #684 remain unchanged; no main merge is needed for this isolated release.


## Private originals (local implementation; hosted activation pending)

`files.test.mjs` uses actual local Miniflare R2 and D1. Migration `0003.sql` adds metadata only; apply it once to the isolated hosted D1 only when releasing the file increment. Before binding R2, activate it through the owning account's reviewed dashboard flow and create a private bucket with public access disabled. This repository deliberately contains no live R2 binding until that gate is satisfied. Deploying these sources without FILES leaves the feature unavailable.

Uploads are limited to 5 MiB based on bytes read, not trusted Content-Length. D1 pending metadata is reserved before an immutable random object key is written; SHA-256 is supplied to R2 and checked again on download. An interrupted upload may leave pending records/objects requiring reconciliation; they are never visible through the API. A retry after a lost response can create a duplicate. Soft removal keeps original bytes and costs storage; staff can restore using revisions. Files always download as attachments. Client upload and inline preview are outside this slice. Arbitrary attachments are not antivirus-scanned; use synthetic records during this pilot.

The record export remains unchanged and excludes file metadata/bytes. Soft restoration is not a disaster-recovery rehearsal. #282 still requires an independent backup, isolated restore, metadata/object/hash reconciliation and recovery acceptance before real customer files or source migration.

## Navigation and timer regression coverage

Each route load owns its records, parent choices, cursor and request generation. Only the current generation can render, report an error, clear loading or move focus; list continuations and mutation completions keep the originating view. The skip link focuses main without changing the hash route. Time reads use one D1 snapshot with the active timer independent of bounded completed history.

`npm test` retains the original 20 checks and adds actual-D1 timer recovery beyond 100 newer entries, actor/organization isolation, concurrent Stop and restart. `npm run test:browser` retains the built-artifact workflow/responsive/axe suite and runs `browser-regressions.mjs` with explicitly held out-of-order responses, stale pagination/errors/loading/focus, keyboard skip on Tasks/Files/Overview and visible Stop/restart with 105 newer entries. All fixtures stay local and synthetic.

## Task list and board (source increment)

Tasks have List and Board views over the same authorized task records. The board groups the pilot's existing `todo`, `doing` and `done` values as To do, In progress and Done. Use the existing Edit dialog to change a status; revisions still reject concurrent overwrites. Source project-lifecycle mapping under #405 and task comments remain outstanding under #691.

Project, status and staff-assignee filters apply to loaded records only. The count explicitly says when more records are available; Load more retains the view and filters. View/filter changes preserve an unsaved create form. In-place status saves retain the view/filter options; full reload starts in List and reloads persisted task data. No schema or API change is needed for this presentation increment.

`browser-task-board.mjs` adds List/Board/filter and pagination coverage, keyboard status-save/reload, a real local-D1 edit conflict, and 390/768/1440px Board axe/overflow checks. Set `WORKSPACE_TEST_OUTPUT_DIR` to retain synthetic Board screenshots when running the built browser suite.

## Task comments (source increment)

Migration `0004.sql` is additive and must precede deployment of the comment API. It creates plain-text comments with organization/task/author foreign keys and a per-author request key. A populated local D1 migration test verifies existing tasks and actors survive unchanged. This migration has not been applied to hosted D1.

Staff can open Comments from either task view and post an internal comment or explicitly share it. Clients can read shared comments and reply only when both the owning task and project are visible to their own client. Client replies are always shared; the API rejects caller-controlled author, organization, task and timestamps. Thread reads, posts and retry responses recheck parent permissions. Timestamps display in Toronto time. Content remains literal text, up to the existing 10,000-character comment limit.

The newest 50 permitted comments load first, with stable timestamp/id cursors for older pages. Paging preserves the reply draft. A failed post keeps the draft and the same request UUID for retrying unchanged text/sharing; the server returns the original record after a lost success, and simultaneous retries create one record. Editing the draft starts a new comment intent. Drafts are held only while the dialog remains open; reopening or reloading fetches persisted comments. Closing/navigation invalidates pending dialog results, loading/errors and focus updates.

Comments are append-only in this source slice. Existing legacy comment editing/deletion, mentions and source history remain intact pending their verified replacements and migration mapping. Author labels currently use existing actor IDs (or You). The bounded staff record export now includes `task_comments` and author references; identity and original-file recovery still need the full backup procedure. There is no email/notification delivery in this slice.

`browser-comments.mjs` adds separately signed staff/client journeys against the built Worker and actual local D1, literal-content checks, a lost-success retry, stable older pages, stale dialog/post results, keyboard focus and 390/768/1440px modal axe/overflow checks. `X-Test-Actor` selects only explicitly provisioned synthetic identities in the local test HTTP harness; deployed Worker identity handling is unchanged.

## Document versions and restoration (source increment)

Migration `0005.sql` adds document snapshots and an internal write token without changing existing title/content/project/visibility values. It captures each existing document at its known current revision; author and recorded date remain null when unknown. A reviewed write fence is required around migration and the Worker change so an older writer cannot bypass capture. The migration has not been applied to hosted D1.

Every supported document create, edit and restoration commits its row and snapshot in one D1 batch. A random server token ensures that only the successful revision writer can capture that snapshot. Snapshot failure rolls the entire operation back. Staff can page through metadata, preview literal plain text and restore title/text as a new revision. Restores retain the project and require the observed current revision plus an explicit sharing choice. They record actor, capture time and source revision. Current-document API responses omit the internal token.

Version history is staff-only. Clients continue to read only a currently shared document in their own visible project; sharing the current document never publishes previous internal drafts. The History dialog defaults restored sharing off and requires a fresh review after a concurrent-change conflict. An unchanged lost restore acknowledgement can be checked by reloading history; retrying its old observed revision cannot create another version. Date display uses Toronto time. Unknown pre-upgrade dates/authors stay unknown.

History metadata and content loads, pagination, reload and restore completions have dialog-local generations and route/close guards. Closing or changing routes discards UI, errors, busy state and focus effects from old requests. Bounded staff exports include `note_versions` and restoration provenance; this is still not complete identity/original-file recovery.

`browser-documents.mjs` exercises edit/preview/private and shared restoration, a signed client's historical denial, concurrent edits, lost acknowledgements, version paging, stale list/preview/restore results, keyboard focus and responsive axe checks. Original legacy rich rendering, hierarchy, templates, mentions, grants and migration evidence remain intact while their Workers replacements are unfinished. Source Notion IDs and content mapping remain part of #414; hierarchy/search and wider document acceptance remain under #285.
