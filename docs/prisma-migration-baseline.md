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

## Adopt an existing current-schema database

Only use this path when the database already matches `prisma/schema.prisma` but
has no Prisma migration history.

1. Create and validate a PostgreSQL custom-format backup.
2. Stop application writers or use an approved maintenance window.
3. Set `ALLOW_BASELINE_ADOPTION=20260808040000_baseline`.
4. Run `npm run db:adopt-baseline` with the target `DATABASE_URL`.

The command first runs a live-to-schema diff with `--exit-code`. Any drift or
verification error stops the operation before migration metadata is written.
It then records the baseline as applied and runs `migrate deploy`.

## Recovery and rollback

- The baseline only creates schema objects on an empty database. On an adopted
  database it is recorded, not executed.
- Application rollback does not reverse schema migrations. Prefer additive,
  backward-compatible migrations and roll the application image back first.
- Restore the pre-change custom-format backup when forward repair is unsafe.
- After restore, verify migration status, schema drift, critical row counts,
  foreign keys, and application health before reopening writes.
