# Document recovery decision

Prepared October 13, 2026 for issue #404. **Option B approved by Cameron on October 15:** retain the newest 100 recorded revisions per document, including current; authorized staff may read, fresh administrators may restore as a new edit; no automatic time-based purge. Implementation and production acceptance remain separate evidence gates.

## Observed behavior

Project notes store Markdown content, metadata, author and hierarchy. Updates replace the stored content. Activity records describe edits and moves but do not contain a recoverable content snapshot. Trash provides deletion recovery; it does not provide edit history. Attachments belong to the existing project/file system rather than a Note revision relation. Historical note content that was overwritten cannot be recreated from activity entries.

## Options

| Option | Retention | Recovery | Tradeoff |
| --- | --- | --- | --- |
| A: conflict prevention and backups | Reject stale edits; existing backup retention | Restore an isolated backup and manually recover a document | Lowest extra storage, but edits after a backup can be lost and recovery needs operational assistance |
| B: bounded document revisions (recommended) | Last 100 successful content/metadata revisions per document; no automatic time-based purge initially | Staff can inspect history; administrators restore a chosen revision as a new revision | Predictable per-document bound, usable recovery, explicit limits for high-edit documents |
| C: all revisions | Preserve every successful revision until an approved deletion policy applies | Same workflow as B | Best historical coverage; unbounded growth and longer-lived sensitive content require a separate retention plan |

## Recommended behavior

Apply option B to internal project notes, wikis, meeting notes and document templates. Add optimistic revisions to all note mutation paths, including template, pin and move actions. A stale revision returns a conflict and preserves the user's unsaved draft. Store snapshots transactionally before overwriting data, recording the actor, time and revision. Avoid extra notifications when restoring history; changed mention recipients should require an explicit choice through the normal edit flow.

Reading and restoring must use the same tenant and project authorization as the document. Clients must never gain internal history access. Staff can inspect authorized history; administrator restoration should create a fresh current revision rather than rewriting historical snapshots. Revalidate hierarchy and authorized mentions on restore: a deleted parent or departed teammate must not be reintroduced silently. Show unavailable references and let the administrator resolve them before applying a restore.

File links are retained as text references, without duplicating file bytes. A document restore cannot resurrect deleted attachments; show an unavailable-file state and keep attachment recovery under the existing Trash/backup workflow. Do not claim attachment integrity from note-version storage alone. Hard deletion and source-export requests need an explicit policy for retained snapshots; do not add automatic purges before that decision.

Recovery targets to validate, not guaranteed service levels: recover an individual retained revision through the UI within five minutes, with no loss of other notes or current unrelated edits. The oldest recoverable edit is bounded by the last 100 retained revisions. Backend backup recovery remains a separate isolated rehearsal with measured recovery time and backup age.

## Storage and acceptance

With a 50,000-character content limit, a naive 100-revision design can retain approximately five million content characters per heavily edited document, plus metadata and database overhead. Measure encoded bytes and real edit rates before approving a purge schedule. Store full snapshots first for simple integrity checks; compression or deltas can be considered after recovery is proven.

Acceptance requires two-tenant read/restore denial, stale concurrent edits retaining drafts, transactional snapshots, restore-as-new-revision, archived/deleted parents and members, malicious Markdown rendering, inaccessible attachments, the 100-revision boundary, export fidelity, Trash recovery and an isolated backup restoration. Mobile/keyboard history inspection and an administrator restore journey must pass against a disposable populated database before production acceptance.

The revision bound and restore authority are approved. New capture starts with each existing document's current state; previously overwritten content is unavailable. Historical reads must satisfy both current access and the captured audience. Restoring retains current sharing, ownership, hierarchy and mentions. Editor attribution may be unavailable for baseline and uninstrumented automated/raw writes; it must never be inferred from the original author. Implementation, populated migration rehearsal, exports, backup recovery and target acceptance still require their own evidence.
