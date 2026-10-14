# Custom-field task view filters

Saved table, board and calendar views can combine up to ten custom-field criteria with search, status, priority and stage filters. All criteria must match. Typed zero and false remain numbers/booleans. Supported conditions are equality for scalar types, case-insensitive text containment, number/date bounds and selected-choice membership for multi-select fields. Relations are chosen by canonical record name through a project-authorized, bounded search.

Apply draft criteria before saving a view; save controls stay disabled while criteria are unapplied. Archived or missing definitions fail closed and remain removable in the editor. Existing values and stored task content are retained. This does not add empty/missing-value predicates, formulas, rollups or standalone databases; those remain separate consolidation work.

Task list requests accept `fieldFilters` as a JSON array string; saved view metadata and MCP `list_tasks` accept the criteria array directly. Each criterion has `key`, `operator` (`EQ`, `CONTAINS`, `GTE`, `LTE`, `HAS`) and a typed scalar `value`. Criteria require a project, valid active definitions and type-compatible operators/values. Existing assignment and organization permissions remain unchanged; MCP definition reads include explicit organization scope. Legacy tag filters combine with criteria instead of replacing them.

Local unit/UI coverage checks typed values, bad criteria, archived definitions, tenant checks, named choices and apply-before-save behavior. PostgreSQL integration and authenticated persisted-view journeys require CI acceptance. Production remains held.

JSON predicates follow [Prisma's PostgreSQL JSON filtering documentation](https://www.prisma.io/docs/orm/v7/prisma-client/special-fields-and-types/working-with-json-fields).
