# Local database verification

`npm run verify:quick` does not need a database. `npm run verify`,
`npm run verify:release` and `npm run test:integration` include mutating fixture
suites. Do not point them at the development `ashbihub` database or any shared
or production database. The test runner sets `NODE_ENV=test`; that alone does
not make a connection disposable.

The invoice and proposal/contract suites require a loopback PostgreSQL URL with
database name `testdb`, `test_*` or `*_test`. Cleanup is limited to known fixture
IDs, including when setup fails. The required GitHub workflow provisions its
own `pgvector/pgvector:pg16` service and `testdb`; it never needs live credentials.

## Provision a separate local database

Prerequisite: a running local Docker engine and an unused loopback port 55432.
This creates a disposable database container, with no application data volume:

```sh
docker run --rm -d --name ashbi-test-db -e POSTGRES_PASSWORD=testpass -e POSTGRES_DB=testdb -p 127.0.0.1:55432:5432 pgvector/pgvector:pg16
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
The local Windows task that added this guide had no Docker command; the
provisioning configuration matches the migrated required-CI database, but was
not independently executed on that Windows computer.
