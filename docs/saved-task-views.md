# Shared saved task views

Each project now has a Task views page, reached from its project card or task board. Save a named combination of status, priority, stage and title/description search with priority, due-date or title sorting. Table, board and calendar layouts are available. Select a saved view, adjust it, save changes or save a new view. Deleting a view removes its configuration, never its tasks.

Views are shared metadata within the project. Existing task permissions remain: the normal task-list API still limits TEAM users to their assigned work. No view grants access to another organization or changes client visibility. The board layout is a read-only projection; Open task board leads to the existing editable Kanban workflow. Every API page is fetched before sorting so later tasks are not silently omitted. Unknown task statuses remain visible in unfiltered views. Undated tasks sort last by due date; priority uses the shared semantic ordering.

Settings use a separate revision to reject stale/concurrent overwrites. Unavailable stage references cannot be newly saved. If a stage is removed later, its saved view labels the filter as unavailable so the user can clear it; it does not reinterpret the stage or silently broaden the view.

The calendar starts at the current UTC month; browse with Previous/Next, This month or a month picker. Dates use the same UTC calendar-date display as task details, avoiding midnight-date shifts across timezones. All matching undated or invalid-date tasks remain in No due date; dated tasks outside the displayed month are counted explicitly. Desktop uses seven columns; mobile lists each day vertically. Calendar links open the canonical task for editing. Sorting applies within each day. The browsed month is temporary navigation, not a saved filter or stored due-date change.

## API / MCP

Typed-field follow-up: saved views may include `columns` (up to 20 distinct active project field keys). GET metadata includes project field definitions. The table displays selected columns; archived/unavailable columns can be explicitly cleared. Fields and their values keep the same project/workspace boundaries.

- `GET /api/projects/:id/task-views`: staff-only, tenant-scoped metadata `{projectId, projectName, views, revision, stages}`.
- `PUT /api/projects/:id/task-views`: staff-only, body `{revision, views}`. Up to 20 views; unique keys/names, bounded search/name/key values and known layouts/sorts/filter values. Empty views is supported. A view is `{key, name, layout: "TABLE" | "BOARD" | "CALENDAR", sort: "PRIORITY" | "DUE_DATE" | "TITLE", filters: {status?, priority?, stageKey?, search?}}`.
- `GET /api/tasks` adds bounded `search` (case-insensitive title/description) and `stageKey` filters alongside existing project/status/priority/portfolio/assignment filters. Filtering precedes pagination/counting.
- Workspace HTTP/MCP `list_projects` exposes saved configuration/revision. `list_tasks` accepts `projectId`, `search`, `stageKey`, `status` and `priority`, so callers can reproduce a saved view under its existing tenant/scoped read contract. MCP catalog discovery exposes the filters. Confirmed view writes remain a follow-up; existing read-only ChatGPT access is unchanged.

## Release / acceptance

Apply `20261013200000_saved_task_views` and regenerate Prisma before running this version. It adds nullable project view metadata and revision zero; it alters no existing task records or permissions. This slice is separate from PR #566's production release.

Tests cover validation, metadata-only updates/deletion, revisions, unavailable stages, search/assignment/tenant preservation, filtering through MCP, URL-based reload, board/calendar layout, semantic sorting, later pages, leap dates and month boundaries. A disposable-database test adds persisted JSON, real filtering, tenant isolation and concurrent writes. Table/board revision `407661c` passed all required CI in run `38442920519`. The calendar extension adds authenticated save/reload, desktop/mobile overflow and scoped axe checks plus screenshot attachments in the shared-workflow CI journey; its new CI evidence must be collected separately. Deployment and target acceptance of this slice remain pending.

Typed/custom databases, relational fields, formulas/rollups, gallery layouts, column customization and per-user private views are follow-up work. Saved task views are not complete Notion database parity.
