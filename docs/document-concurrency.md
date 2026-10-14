# Document editing conflicts

Each Note has a database-maintained revision starting at zero. Every update advances it, including pinning, hierarchy promotion, soft deletion and restoration. Revision maintenance is enforced by the committed migration rather than relying on individual callers to increment it.

PUT /api/notes/:id requires the observed revision. The conditional update, activity entry and newly mentioned teammate notifications share one transaction. A stale revision returns 409 without changing content, creating an activity entry or notifying teammates. A fresh GET/list returns the revision needed to prepare another edit. Unversioned writes are rejected; API callers must retain the revision from their read rather than fetching a fresh number immediately before saving an old draft.

Docs, project document editing and the Notes modal capture the revision when editing starts. Background list refetches do not replace it. Failed saves keep the draft. The user can download the draft, or explicitly reload the current document and discard the draft; a failed reload leaves the draft intact. Workspace MCP document reads include revision metadata.

This provides optimistic conflict detection, not simultaneous cursor editing or document version-history restoration. Retention and restore authority still require the owner's prepared policy decision. Workspace-wide wiki and page-level access are separate remaining features. No production migration, retention policy or data-input action is implied.

Acceptance must include two competing real PostgreSQL API updates, no losing-edit side effects, a raw-write revision check and an authenticated browser conflict/reload/retry journey with mobile accessibility and reflow. Local focused checks are evidence only for their tested scope; final CI, independent review and target acceptance remain required.
