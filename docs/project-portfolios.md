# Shared work portfolios

Projects can be classified as `ASHBI_DESIGN` or `FREELANCE`, or left unclassified (`null`). Classification is a view within one organization and does not change tenant, role, client visibility, assignee or billing identity.

The Projects screen offers All work, Ashbi Design, Freelance and Unclassified views. Its filter is stored in the URL. New projects inherit the selected portfolio in their creation form; existing projects can be reclassified using the selector below each project card. Failed writes display an error and retain the persisted classification. The board loads all returned pages rather than silently showing only the first page.

## API and MCP

- `POST /api/projects` and `PUT /api/projects/:id` accept `portfolio: "ASHBI_DESIGN"`, `"FREELANCE"` or `null`. Omitting the field preserves existing defaults/classification.
- `GET /api/projects?portfolio=FREELANCE` filters records and counts before pagination. `UNCLASSIFIED` selects `null`; omit the filter for all work.
- `GET /api/tasks?portfolio=ASHBI_DESIGN` filters via the task's project and retains existing assignment restrictions.
- Workspace HTTP/MCP `list_projects` and `list_tasks` accept the same optional portfolio filter and preserve explicit organization scope. `list_projects` returns the portfolio alongside identity/status.

Unknown filters/writes are rejected. Time, finance and workspace-document portfolio filters are follow-up slices; their UI does not gain filters from this change.

## Release and acceptance

Apply the committed `20261011190000_project_portfolios` migration before running this version. It adds a nullable column, a value constraint and an organization/portfolio index; it classifies no existing records. Generate the Prisma client from the updated schema. An older release can run with this additive schema.

Acceptance in a test tenant: create one project in each portfolio and one unclassified project; reload and verify each filter, classify and clear an existing project, check a second team's access and client portal visibility, and query filtered project/task results via API/MCP. Use more than one page to verify pagination. Local automated tests do not replace this persisted, authenticated acceptance.
