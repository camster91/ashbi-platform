# Prisma migration baseline and recovery

The active migration chain begins at `20260808040000_baseline`. It was
generated from the reviewed Prisma schema after production was synchronized to
that schema. Older, incomplete migrations are archived under
`prisma/migrations_legacy_prebaseline` and must never be executed.

## Fresh database

1. Restore the required environment variables, including `DATABASE_URL`.
2. Run `npx prisma migrate deploy`.
3. Run `npx prisma migrate diff --exit-code --from-config-datasource --to-schema prisma/schema.prisma`.
4. Start the application and verify `/api/health` plus representative foreign-key and row counts.

## Adopt an existing pre-migration database

Only use this path for a database that has **no Prisma migration history**
(no `_prisma_migrations` table) and whose schema is **exactly** the schema the
baseline migration (`prisma/migrations/20260808040000_baseline/migration.sql`)
creates. Adoption records only the baseline as applied; every later migration
is then applied normally by `prisma migrate deploy`, so their data backfills
run against the existing rows.

1. Create and validate a PostgreSQL custom-format backup.
2. Stop application writers or use an approved maintenance window.
3. Create a new, empty, disposable database with pgvector available (the
   same PostgreSQL major version is best) and set
   `BASELINE_SHADOW_DATABASE_URL` to it. Prisma resets this database and builds
   the baseline schema in it, so it must never hold data. Drop it afterwards.
4. Set `ALLOW_BASELINE_ADOPTION=20260808040000_baseline`.
5. Run `npm run db:adopt-baseline` with the target `DATABASE_URL`.

`scripts/adopt-prisma-baseline.mjs` fails closed. It refuses, before writing
any migration metadata, when:

- the confirmation, `DATABASE_URL` or `BASELINE_SHADOW_DATABASE_URL` is missing,
  or the shadow URL names the same host, port and database as the target;
- the target already has a `_prisma_migrations` table (use `migrate deploy`),
  or is empty (a fresh database uses the steps above);
- the shadow database contains any table, view or sequence;
- `prisma migrate diff --exit-code --from-migrations <baseline only>
  --to-config-datasource` reports any difference between the target and the
  baseline schema (exit 2), or cannot run (exit 1).

Only then does it run `prisma migrate resolve --applied
20260808040000_baseline`, `prisma migrate deploy`, and a final
`prisma migrate diff --exit-code` against `prisma/schema.prisma`. If `deploy` or
the final check fails after the baseline was recorded, keep writers stopped,
inspect `prisma migrate status`, and repair forward or restore the backup.

A database that already matches the **current** `prisma/schema.prisma` (for
example one built with `prisma db push`) but has no history is refused, because
it matches no single point in the migration chain the tool can verify. Marking
later migrations applied by hand would skip their data backfills; reconcile such
a database individually with a reviewed plan instead.

The required release gates rehearse this path on every pull request: a database
built from the baseline SQL alone is adopted and must end with zero drift from
`prisma/schema.prisma` and every migration recorded, and a drifted database must
be refused with no `_prisma_migrations` table created (see
[release-gates.md](release-gates.md)).

## Recovery and rollback

- The baseline only creates schema objects on an empty database. On an adopted
  database it is recorded, not executed.
- Application rollback does not reverse schema migrations. Prefer additive,
  backward-compatible migrations and roll the application image back first.
- Restore the pre-change custom-format backup when forward repair is unsafe.
- After restore, verify migration status, schema drift, critical row counts,
  foreign keys, and application health before reopening writes.
