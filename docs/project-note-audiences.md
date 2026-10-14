# Project Note audiences

Implemented on feat/project-note-audiences-20261014 under #565: inherited permission algebra, bounded metadata authorization, SQL audience/revision/scope guards, UI sharing, scoped read/preview/confirmed MCP access changes, and archive/restore privacy barriers. Local focused backend checks pass; required PostgreSQL/browser and full release gates remain pending. Not merged or production deployed. Simultaneous editing and retained history remain separate unfinished requirements; no history policy is selected.

## Integrated surfaces

- `src/routes/note.routes.js` lists project/global notes and templates, reads content, creates/copies/edits notes, pins, archives and restores. Each path applies fresh active staff authorization and effective audience checks.
- `src/integrations/workspace-tools.js` exposes project content through `list_notes`; permission filtering now occurs before content, ids/counts and pagination are returned.
- `src/routes/onboarding.routes.js` counts an actor's authored notes; counts use the same audience semantics.
- Mention recipients require current active staff and inherited read access. Notification lists, counts and read mutations filter revoked note access. Globally shared activity feeds exclude internal Note events rather than exposing their titles.
- `src/services/trash.service.js`, `trash-purge.service.js` and the note archive/restore paths retain recovery data. Both recovery paths check current audience management and retain barriers on hierarchy changes. Trash lists hide unauthorized note snapshots.
- `src/services/workspace-export.service.js` exports internal notes for the organization owner. Existing scalar export includes audience mode, revision, grants and barriers; no importer was added.

The current note archive route promotes children to roots. Simply adding direct grants would expose a shared child previously hidden by a restricted ancestor, or restore access to a child author who previously could not read that ancestor. The database requires active same-project parents, so retaining a pointer to a deleted parent cannot be used as a shortcut. Restoring/reparenting or copying restricted templates can cause the same exposure.

## Permission contract

Default TEAM preserves the existing shared Ashbi Design/freelance organization. RESTRICTED permits the owner and explicit READ/EDIT staff grants; current active organization administrators retain repair/management access. A child is readable/editable only when every ancestor permits it. Owning a child never overrides an ancestor, and READ grants never confer edit or audience management.

`src/shared/document-audiences.js` composes complete same-workspace/project child-to-root paths without titles/content. Explicit inherited barriers preserve effective read/edit sets when a child is promoted. Null sets mean all current active staff, not anonymous/client access. Administrator bypass is evaluated from the current stored role at request time rather than copying current administrators into permanent grants. Source services must resolve fresh staff membership before using this algebra.

Barriers contain permission ids/roles only; they are not document history or retained content snapshots. They must be written only by authorized hierarchy operations, never arbitrary content payloads. Non-admin owners cannot silently discard a barrier and expose a formerly private ancestor's contents. Promotion/move/template-copy operations must prove the effective audience before/after or retain a restrictive barrier; any deliberate widening requires explicit authorized review. Restore must revalidate active same-project parents and rights.

## Implementation and acceptance

1. Note mode/access revision/barrier and a bounded JSON grant array are implemented on the canonical row. Grants are capped at 100 and scoped by SQL guards; the whole audience changes in one revision-checked audited transaction. No separate grant table is needed for this bounded roster. Existing rows default TEAM; identity/ownership is immutable.
2. Implement metadata-first effective authorization for all lists, exact pagination/counts, content/template reads, edits, pinning, archive and both restore paths. Preserve inherited access during promotions and copies; reject stale access/content revisions and forbidden parent changes.
3. Add scoped read/access/change API/MCP operations with human preview, confirmation, expiry, idempotency, current-role revocation and transactional audit. Restrict mention notifications; hidden titles/counts/rosters never escape unauthorized read paths.
4. Add usable owner/admin audience UI and read-only indicators. Hide forbidden edit/hierarchy/archive controls; keep drafts after conflict/revocation without submitting stale permissions. Export audience configuration for the organization owner.
5. Prove owner/editor/reader/outsider/admin/client/BOT/deactivated roles, foreign scope/project, multi-level inheritance, cycles/missing ancestors, template copies, promotions, direct/Trash restores and administrator demotion through unit and PostgreSQL tests. Run persisted desktop/mobile/keyboard/accessibility journeys and normal merge gates.

Document simultaneous editing and retained-version restoration remain separate requirements. The retention bound and restore authority in `document-recovery-decision.md` still require the owner's choice; this permission work does not select either policy.

API: GET/PUT /api/notes/:id/access. MCP adds get_project_note, get_project_note_access, preview_project_note_access and confirmed set_project_note_access. Exact preview fingerprints bind actor, ancestors, grants/barriers and proposed staff state. Ordinary content updates cannot clear a preserved barrier; deliberate removal/widening of a barrier is not exposed by this slice.
