# Standalone collections, computed fields, and reusable forms

Implementation in progress in draft #590 on `feat/structured-records-20261014`, tracked by #565. Shared calculation/input contracts, Prisma models/migration, fresh staff authorization, serializable audited services and authenticated HTTP endpoints are implemented. Local service/HTTP tests pass; PostgreSQL acceptance is pending CI. Confirmed API/MCP actions, UI screens and new browser journeys remain open. This document does not claim a shipped feature or replacement readiness. Production remains held.

Local validation on October 14: 58 contract/service/HTTP/tenant-policy tests pass, changed-file ESLint passes with zero warnings, Prisma validation/generation and repository TypeScript checking pass. Route/access/OpenAPI/data-dictionary snapshots are regenerated. The earlier contract-only full backend/AI run passed 1,896 tests with zero failures and one skip; it does not cover the subsequent persistence changes. A new PostgreSQL integration test covers same-workspace composite foreign keys, raw relation/type/identity refusal, one-winner concurrent revisions, required-audit rollback, dependent rollup guards, stale forms and archived-parent refusal. No local PostgreSQL instance is available and no standalone-collection browser journey has run yet.

Persistence uses `WorkspaceCollection`, `WorkspaceRecord` and `WorkspaceRecordForm` in the existing organization; it does not create projects/tasks as surrogates. `RELATION` selects either a collection or a canonical CLIENT/PROJECT/TASK/PERSON target, with up to 100 selected IDs. Shared services validate IDs against active available same-workspace records. Composite foreign keys bind collection and author ownership; database triggers retain identities, increment revisions, validate relation rosters/defaults and refuse stored computed values. Collection schema changes preserve existing input types/choices and reject invalid active data or dependent rollups. Forms pin `schemaRevision` and report `needsReview` after schema changes. Writes require the audit evidence in their transaction. Relation hydration is batched in chunks of 100 and retains only scalar rollup targets, with a 5,000-reference page budget; no partial sum is substituted when a selected row is unavailable.

Session HTTP endpoints are under `/api/collections`: collection/record/form list/read/create/update, relation options and form submissions. Pagination uses stable ID cursors with page size at most 50. Archive restores the existing identity and values; restoring a record under an archived collection is rejected. CLIENT/BOT/deactivated users cannot access these routes, and mutations resolve the stored staff role rather than trusting actor metadata.

## Intended usable workflow

Staff create a standalone named collection in the existing organization, define typed fields, and create/edit/archive canonical records without manufacturing tasks or projects. Records retain revisions and archived values. Collections and relations stay inside the organization, and client/BOT access is denied unless explicitly designed and tested later. Ashbi Design and Freelance remain shared organizational views, not new tenants. Records can reference existing canonical clients/projects/tasks/people in the service layer; collection relations enable rollups.

Staff configure formulas and relation rollups, view results and explicit errors in tables/record details, and save reusable staff forms. Form submissions create the same canonical records as manual/API creation, with the current schema and the same relation authorization. Scoped HTTP/MCP reads and confirmed/audited writes must use the same service and calculations. A form is not an email/webhook provider integration and creates no external notification.

## Shared contract implemented so far

`src/shared/record-calculations.js` validates at most 40 definitions, unique names/keys, typed expressions, active references and acyclic local dependencies. Arithmetic, comparisons, booleans, text concatenation, lazy conditional/coalesce, rounding and calendar-day differences use a bounded JSON expression tree. No JavaScript expression, property traversal, environment access, dynamic evaluation or remote fetch is supported. Expressions are limited to 100 nodes, 12 nested levels and bounded arguments/literals; output text and numeric overflow are checked. Financial invoices retain their own decimal/tax/currency rules; these general-purpose number fields are not financial ledger authority.

Example quantity calculation:

```json
{"key":"total","name":"Total","type":"FORMULA","expression":{"op":"multiply","args":[{"field":"hours"},{"field":"rate"}]}}
```

Computed results return `{ value, error, type }`. Missing inputs return null with no error; division by zero, malformed inputs, overflow and incomplete relations return explicit errors. Zero, false and empty text are preserved. Conditional and coalesce branches are lazy. Formula dependencies may be declared in any order. Archived fields cannot be referenced by active calculations; stored client-supplied computed values are ignored by calculation reads.

Rollups support COUNT, SUM, AVERAGE, MIN, MAX and UNIQUE over an active collection relation. Numeric aggregates require stored numeric target fields. UNIQUE returns a typed scalar list. Remote computed targets are not implemented yet; they require a cross-collection dependency graph before support can safely expand. The scoped service must supply the complete selected roster (maximum 100 records), including matching unique IDs and authorized active values. Missing, filtered, archived, unavailable or incomplete selected relations must produce `INCOMPLETE_RELATION`, never a misleading partial total. Empty relations return zero for count/sum, an empty list for unique, and null for average/min/max. Null numeric values are omitted from numeric aggregates; zero contributes to averages.

`src/shared/record-inputs.js` validates stored primitive/relation input shapes and forbids unknown, computed or archived value patches. Required false/zero are valid; null, blank required text and empty required lists are rejected. Archived historical values survive ordinary edits. Definition updates retain existing keys, types, relation collections and prior choices; removal uses archive. Form definitions select active editable fields, retain collection-required fields, validate defaults, and pin an exact definition revision. Submissions reject unconfigured fields and stale form/schema revisions. Relation ID shape checks do not establish authorization: the service must verify every selected ID before storing it or returning a result.

## Remaining completion evidence

- PostgreSQL acceptance of the implemented migration, tenant policy and direct-write guards.
- Broader regression acceptance of implemented service/HTTP writes, fresh authorization, relation resolution, pagination and archive behavior.
- Usable collection/field/form builders and table/record screens, errors and recovery with scoped API/MCP parity, confirmation/audit and idempotency.
- PostgreSQL tests plus authenticated full-stack journeys at desktop/mobile widths; required PR/main CI and normal merge.
- Owner-held release, populated target QA, approved one-time mappings/input and team acceptance tracked separately.

Document retention/restore policy remains pending and is independent of this work. No retention choice, deployment approval, live data input or source retirement is implied.
