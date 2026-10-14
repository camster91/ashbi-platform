# Grouping by related records

Saved table and gallery views can group by active relation fields targeting canonical clients, projects, tasks or staff. Group identities retain their ids even when two records have the same name; the UI displays authorized names. Empty values remain Unspecified, and unavailable/deleted/inactive/foreign targets remain Unavailable related record without names or links. Grouping changes no assignment, membership, project or financial identity.

Task list API and workspace HTTP/MCP list_tasks accept an optional relationField with an explicit projectId. Only the already-authorized result page is decorated with fieldRelations for that field. Project definitions and target lookups have explicit organization predicates, including raw clients; targets are read in batches of at most 100 with no per-task lookup. Personal targets must be active ADMIN/TEAM members. Canonical fieldValues remain unchanged.

The task-view UI requests labels for its selected active relation grouping and carries them into table/gallery cells. Saved view and board-template validation permit active relation fields; archived fields still require choosing an available grouping. Existing task/page relation editing and permission boundaries remain unchanged.

Local grouping, batched label, raw-client MCP scope, named-cell and persisted-view checks are required, followed by PostgreSQL tenant/availability and authenticated mobile/accessibility CI. Production and target acceptance remain held. Standalone records, formulas/rollups and reusable forms remain separate open features.
