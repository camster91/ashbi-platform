# Local verification

## Daily core suite

Run `npm run test:core` for about 100 focused cases spanning the existing Hub's
API and rendered React interface. It runs whole files through the existing Node
and Vitest runners, without case-name filters or a hard count cap. Selections
live in `package.json` under `test:core:api` and `test:core:web`.

At the 27 October 2026 checkpoint, 61 API cases and 43 rendered UI cases passed
on Node 24.22.0: 104 total, with reported runner times of 0.7 and 3.0 seconds.
Let meaningful coverage guide future changes rather than enforcing that count.

| Workflow | Selected checks |
| --- | --- |
| Identity and access | Revocable sessions, current portal principals, foreign-client invitation denial, MFA sign-in and recovery codes |
| Tenant isolation | Scoped proxy reads/writes, nested relations and rejection of unlisted methods |
| Clients and delivery | Contact editing, project paging/classification, task creation and keyboard stage movement |
| Time | Persisted start/stop behavior, minute rounding, ownership and approved/invoiced-entry locks |
| Billing | Atomic invoice replacement/rollback, reviewed unbilled-source claims and restricted portal balances |
| Files | Extension/MIME/signature policy, upload progress/failure/size checks and authenticated download controls |
| Documents | Revision races, foreign/deleted-note refusal, conflict comparison, retained drafts and failed-read recovery |

Install root and frontend dependencies and generate Prisma before the first run
(`npm ci`, `npm ci --prefix web`, `npm run db:generate`). Core tests use synthetic
fixtures and need no live database, Redis, browser installation or provider
credentials. API tests use in-memory doubles; rendered UI tests use jsdom and
mocked API boundaries. They do not prove real database transactions, provider
delivery, actual-browser behavior or hosted acceptance.

`npm test`, `npm --prefix web test`, `verify:quick`, integration/browser suites
and CI retain the full regression checks. Choose affected focused suites while
editing; run the complete applicable checks before review or release. The
separate Cloudflare pilot in `apps/workspace/` keeps its own commands.

## Full verification and database safety

`npm run verify:quick` does not need a database. `npm run verify`,
`npm run verify:release` and `npm run test:integration` include mutating fixture
suites. Do not point them at the development `ashbihub` database or any shared
or production database. The test runner sets `NODE_ENV=test`; that alone does
not make a connection disposable.

The invoice and proposal/contract suites require a loopback PostgreSQL URL with
database name `testdb`, `test_*` or `*_test`. Cleanup is limited to known fixture
IDs, including when setup fails. The required GitHub workflow provisions its
own `pgvector/pgvector:pg18` service and `testdb`; it never needs live credentials.

## Provision a separate local database

Prerequisite: a running local Docker engine and an unused loopback port 55432.
This creates a disposable database container, with no application data volume:

```sh
docker run --rm -d --name ashbi-test-db -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=testdb -p 127.0.0.1:55432:5432 pgvector/pgvector:pg18
docker exec ashbi-test-db pg_isready -U postgres -d testdb
```

Wait until `pg_isready` reports accepting connections. In the terminal used for
verification, set the explicit local test URL (the password here is test-only):

```sh
export DATABASE_URL='postgresql://postgres:testpass@127.0.0.1:55432/testdb'
npx prisma generate
npx prisma migrate deploy
npm run test:integration
```

PowerShell uses this first line instead of `export`:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:testpass@127.0.0.1:55432/testdb'
```

After migration, `npm run verify` and `npm run verify:release` can use the same
disposable URL. Keep the app's development terminal separate so its connection
is not changed. Close the verification terminal when finished. Stop only the
named disposable container to remove it and its test data:

```sh
docker stop ashbi-test-db
```

If Docker is unavailable, use the isolated database services in required CI,
or provision an equivalent separate loopback PostgreSQL/pgvector test database.
Do not relax the guard or reuse development/customer data to make tests pass.
The original Windows task that added this guide did not execute Docker.
The provisioning image now matches the current CI and development Compose
configuration; this alignment is not evidence of a local database run.
