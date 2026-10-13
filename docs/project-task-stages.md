# Project task stages

The project Kanban screen now offers Configure stages. Team members can add, rename, reorder and remove up to 20 project-local stages. Each stage has an immutable key, a unique name and a task lifecycle status. Saving preserves tasks and their existing status; moving/creating a task into a stage applies that stage's configured status and sets/clears completion time accordingly.

Stage membership and task lifecycle are separate: changing a task's status elsewhere does not automatically move its stage. The board displays lifecycle status on staged tasks. Renaming or changing the status mapping affects future moves/creates only. Tasks without a stage, including old records, remain visible in status columns; orphaned stage references also appear there. No existing task is automatically classified.

Occupied stages cannot be removed. Settings carry a revision and reject stale edits rather than overwrite another teammate's change. Serializable transactions prevent stage removal racing a task creation or stage move. Conflicts offer a reload; unsaved input remains available until the user chooses it. Moving through the legacy status API clears the stage assignment.

## API / MCP

- `PUT /api/projects/:id/task-stages`: authenticated ADMIN/TEAM body `{revision, stages: [{key, name, status}]}`. Invalid/duplicate keys or names are rejected; stale revisions or occupied removed stages return 409. Keys contain letters, digits, underscore or hyphen only. Unknown/foreign projects return 404.
- `GET /api/projects/:id` returns `taskStages` and `boardRevision`.
- `POST /api/tasks/:id/move`: accepts `status` or `stageKey`. With a stage key, the server resolves the task's own project and uses that stage's lifecycle, rather than trusting any supplied status.
- `POST /api/tasks/:projectId/quick`: accepts optional `stageKey`, with the same server-side lifecycle resolution.
- Workspace HTTP/MCP `list_projects` returns stage configuration/revision; `list_tasks` returns membership. The read-only ChatGPT connection remains read-only. Stage-specific confirmed MCP writes are a follow-up; REST writes are available through existing authenticated application access.

The board fetches all 100-row pages, with a stable secondary ID order, to avoid hiding later tasks under the tenant proxy's read cap.

## Release / acceptance

Apply `20261013140000_project_task_stages` and regenerate Prisma before running this version. It adds nullable JSON configuration, revision zero and nullable task membership. It neither creates stages nor rewrites tasks. The schema is additive and compatible with the preceding release.

Automated checks cover validation, retained lifecycle, occupied/stale conflict, failed serialization, project-local move/create, completion time, legacy moves, 101-task boards, editor ordering, failed-save recovery and keyboard focus. The disposable-database integration test additionally checks persisted JSON/membership, tenant isolation and concurrent revision conflicts.

Authenticated target acceptance remains pending: save and reload a configured project, move/create with desktop drag/drop and keyboard/mobile controls, race settings in two sessions, test removing an occupied stage, check client visibility, and query the configuration/membership from the intended ChatGPT/MCP account.

This implements one board per project. Multiple boards, recurring tasks, stage templates and saved alternative views remain separate feature slices.
