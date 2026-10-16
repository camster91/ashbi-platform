# Integration file scheduling and Serializable conflicts

The required integration job runs all test files against one disposable
PostgreSQL 16 `testdb`. UUID organization/project identifiers isolate records,
but do not isolate PostgreSQL predicate locks. Serializable transactions can
abort when overlapping fixtures access different rows in the same relation.
In particular, a sequential scan takes a relation-level predicate lock.
[PostgreSQL 16 documents this behavior](https://www.postgresql.org/docs/16/transaction-iso.html#XACT-SERIALIZABLE).

`run-node-tests.mjs` schedules integration **files** one at a time. Required unit
commands retain the existing Node file parallelism. An explicit invocation that
mixes unit and integration files serializes that whole invocation for database
safety. Discovery now accepts exactly `.test.js` and `.test.mjs`, including an
explicit `.test.mjs` file target previously silently omitted. Other extensions
remain excluded. Relative target arguments, stdout protection, exit codes
and test assertions remain unchanged. The four existing `.test.mjs` Coolify and
backup suites were already run directly by the mandatory preinstall release
safety step; that early gate remains unchanged. They now also execute in normal
unit discovery and focused runner invocations. `Promise.all` races inside each integration
file still execute concurrently, including saved-view and stage revision races.
No application isolation level, retry policy or error handling changes.

## Evidence and limits

Docs PR629 run38851799472 failed on the first `saveTaskViews` call at line30 of
`task-views.database.test.js`, before its deliberate concurrent writes. The
service converted Prisma `P2034` into its existing409 response. The fixture uses
unique IDs. The log did not retain PostgreSQL error detail, query plan or the
other transaction, so the exact original conflict remains **unproven**. A later
passing run cannot establish its cause or erase the failed check.

The new real PostgreSQL test uses two sessions, separate rows/organizations and
a unique synthetic schema. It deterministically requests a sequential scan with
session-local transaction settings, checks actual relation `SIReadLock` locks,
requires SQLSTATE40001 for the overlapping transaction, and proves both writes
succeed when run sequentially. This reproduces the mechanism; it does not
retroactively prove the original CI query plan. The test accepts only the
explicit integration URL on local `testdb` with `NODE_ENV=test`, never
`DATABASE_URL`, and removes only its own synthetic schema.

Local runner tests exercise actual file execution, discovery, internal concurrent
operations and failure propagation without any database. The real PostgreSQL
mechanism/control test requires hosted disposable CI; a local skip is not a
database validation. PR629 remains failed until reviewed scheduling changes are
included on its branch and its required CI passes.
