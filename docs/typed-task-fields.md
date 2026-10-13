# Typed task fields and relations

Projects define up to 40 shared fields (including archived fields): text, finite numbers, booleans, calendar dates, HTTP(S) URLs without embedded credentials, select/multiple-select choices, or a single relation to a task, project, client or active staff member in the same workspace. Reach definitions from Task views → Configure task fields, or a task's Custom fields section. Each task supports editing, saving and reloading values. Relation pickers search up to 25 matching records; callers can narrow the search.

Definitions have stable keys and immutable types/targets. Choices may be added but existing choices remain. Archive a definition to hide it without removing values, and unarchive to restore it. Names may change without changing stored keys. Archived and unknown historical values are retained. Task content and the existing legacy `properties` JSON are untouched. Calendar recurring occurrences copy typed values from their source; they start with a new values revision.

Definitions and values each have optimistic revisions and serializable writes. Editing a task captures both revisions, so background refetches do not silently rebase a draft. A conflict retains the draft and offers explicit reload. Patches alter only submitted active fields, preserving all other values. Dates reject impossible calendar days, URLs reject executable protocols, and values are never silently coerced by the API.

Relations reference canonical IDs, never copied records. Scoped lookups reject foreign, deleted or unavailable targets. Deleted references become unavailable labels and can be cleared/replaced; JSON relations are not foreign keys or cascading deletions. They never grant client visibility. All new HTTP routes require ADMIN/TEAM authentication and use tenant-scoped Prisma. These are internal fields; no portal publication is added.

## API and MCP

- `GET/PUT /api/projects/:id/task-fields`: definitions; PUT `{revision, fields}`. Definition `{key, name, type, archived, options?, target?}`. Choices apply only to SELECT/MULTI_SELECT; target only to RELATION.
- `GET/PUT /api/tasks/:id/fields`: typed values, definition metadata and resolved relation labels; PUT `{revision, definitionRevision, values}`. Each value is strictly typed or `null` to clear it.
- `GET /api/tasks/:id/fields/:key/options?search=...`: bounded search for a configured relation field, scoped to the workspace. PERSON targets contain active ADMIN/TEAM users.
- Existing workspace HTTP/MCP `list_projects` exposes definitions/revision; `list_tasks` exposes typed values/revision. Confirmed field writes through MCP remain a follow-up.

Migration `20261013210000_typed_task_fields` adds nullable JSON definitions/values and revision-zero columns. It does not rewrite historical data. Generate Prisma and apply the committed migration chain before running this revision.

Tests cover strict schemas and values, unknown/archive handling, metadata-only patches, stale revisions, foreign relation denial, persisted isolation/concurrency and preserved task content. The authenticated CI journey creates all eight field types, edits values/relations, reloads and archives while checking retained data, plus desktop/mobile scoped axe checks. Local disposable database and target acceptance remain pending; this is not full Notion database parity.

Standalone databases, custom-field filters/columns, formulas, rollups, bidirectional/multiple relations, computed fields and client sharing remain follow-up work.
