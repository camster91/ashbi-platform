# AGENTS.md

## Cursor Cloud specific instructions

Ashbi Hub is a single-repo app: a Fastify backend (`src/`), a Vite + React SPA
(`web/`), a Prisma/PostgreSQL datastore (`prisma/`), and a BullMQ worker
(`src/jobs/worker.js`). Standard commands live in the root `README.md`, root
`package.json` scripts, and `web/package.json`; prefer those. Notes below cover
only the non-obvious cloud setup.

### Services that must already be running
The update script only refreshes JS deps + the Prisma client. The datastore
services are installed at the OS level (captured in the VM snapshot) but are
**not auto-started** (no systemd). Start them at the beginning of a session:

```bash
sudo pg_ctlcluster 16 main start        # PostgreSQL 16 (+pgvector), port 5432
sudo redis-server /etc/redis/redis.conf --daemonize yes   # Redis, port 6379
```

- The local DB is `ashbihub`, role `ashbihub` / password `localdevpass`
  (SUPERUSER, local dev only), with the `vector` extension already enabled.
- If a disposable local DB is empty, apply the committed chain with
  `npx prisma migrate deploy`. Use `prisma db push` only for throwaway schema
  experiments; it is not the source of truth for shared or production data.
  `npx prisma generate` is already handled by the update script.

### Env vars: the app does NOT auto-load `.env`
`src/` never imports `dotenv`, so `npm run dev` / `dev:web` / `dev:worker` do
**not** pick up `.env` on their own. Export it into the shell first, otherwise
the backend aborts on startup with `@fastify/jwt: missing secret`:

```bash
set -a; source .env; set +a
```

A local `.env` already exists (gitignored, in the snapshot) with working dev
values: `DATABASE_URL`, `JWT_SECRET`, `CREDENTIALS_KEY`, `ADMIN_INVITE_TOKEN`,
`REDIS_URL`, `CORS_ORIGIN=http://localhost:5173`, `AI_PROVIDER=ollama`.
(Prisma CLI commands read `.env` on their own via `prisma.config.ts`.)

### Running the app (dev)
Three processes, each after sourcing `.env`:
- Backend API: `npm run dev` → http://localhost:3000
- Frontend: `npm run dev:web` → http://localhost:5173 (proxies `/api` +
  `/socket.io` to :3000; this is the URL to open in a browser)
- Worker (optional, for async jobs): `npm run dev:worker`

First admin bootstrap (no seed needed): POST to `/api/auth/register` with
`adminInviteToken` equal to `ADMIN_INVITE_TOKEN`, then log in at the SPA.
Optional seeding via `npx prisma db seed` / `node prisma/seed.js` uses
`bcrypt` (not `bcryptjs`) and requires `ADMIN_SEED_PASSWORD` when configured.

### Lint / test / build
Commands are in `package.json` / `web/package.json`:
- Backend: `npm run lint`, `npm run type-check`, `npm test` (~455 unit tests),
  `npm run build`.
- Frontend: `npm test --prefix web` (Vitest; some tests intentionally assert
  thrown errors — the stderr stack traces are expected, not failures).
- Unit/integration tests set `NODE_ENV=test`, which mocks Redis/BullMQ, so
  they do not need live Redis.

### Product / review authority
- Canonical capability status: `docs/product-status.md` (code-present ≠
  market-ready).
- `CODE_REVIEW.md` is a historical May 2026 snapshot — do not treat it as the
  current risk register (many items, including Zod validation coverage, have
  since been remediated).

### Previously fixed bugs (do not re-chase)
These were fixed in tree; ignore older notes that still claim them:
- Dashboard stats raw SQL uses `FROM "invoices"` (Prisma `@@map`) with an
  explicit `organizationId` predicate — not `FROM "Invoice"`.
- Clients page reads `response.clients` (with a contract test); it no longer
  falls back to hardcoded `ASHBI_DESIGN_CLIENTS` when the API returns an object.
- `prisma/seed.js` imports `bcrypt`, not `bcryptjs`.
