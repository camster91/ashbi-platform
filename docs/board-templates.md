# Shared board templates

Task views → Board templates saves a snapshot of a project's configured stages, saved views and typed field definitions. Use it to create an empty project for a selected existing client and a selected shared work portfolio. The new project gets fresh workflow revisions and normal project defaults. Task values, tasks, owners, schedules, comments, documents, files and financial history are not copied. Existing clients remain canonical.

Templates are shared within the organization and require staff authentication. Source projects, templates and selected clients use scoped lookups; foreign/deleted targets return 404. Snapshot save and project creation are serializable transactions. Broken stage/column references must be cleared in the source views before saving a template. Unconfigured stages remain the normal default workflow.

Archive hides a board template from active selection; restore makes its preserved configuration available again. Archived templates cannot create projects. Existing project/task templates continue their separate workflow. Legacy project templates get kind PROJECT through the additive migration `20261013220000_board_templates`; new board snapshots use BOARD/BOARD_ARCHIVED and version-one JSON. No legacy template payload is rewritten.

## API

- `GET /api/projects/board-templates?includeArchived=true&after=...`: 25 records per page, `{items, nextCursor}`. The UI supports Load more.
- `POST /api/projects/board-templates`: `{projectId, name, description?}`; snapshots definitions from the source project.
- `PATCH /api/projects/board-templates/:templateId`: `{archived: boolean}`; archive/restore.
- `POST /api/projects/from-board-template`: `{templateId, clientId, name, portfolio?}`; creates an empty configured project. Portfolio is ASHBI_DESIGN, FREELANCE or null/unclassified, never an access boundary.

Workspace HTTP/MCP `list_board_templates` exposes scoped definitions with standard bounded cursor pagination and optional archived records. Confirmed template writes remain follow-up work. Legacy project-template creation/deletion routes cannot consume or delete board snapshots.

Tests cover snapshot contents, default/unavailable settings, canonical clients, empty projects, isolation, transaction boundaries, paging and reversible archive. Disposable database and authenticated CI journeys cover persisted creation and source-data preservation. Deployment/target acceptance remain pending. Multiple boards within one project and confirmed MCP template writes remain follow-up work.
