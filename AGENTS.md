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
- If the DB is ever empty/reset, resync the schema with `npx prisma db push`
  (there are no committed migration files; `db push` is the source of truth
  for local dev). `npx prisma generate` is already handled by the update script.

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

First admin bootstrap (no seed needed — see below): POST to
`/api/auth/register` with `adminInviteToken` equal to `ADMIN_INVITE_TOKEN`,
then log in at the SPA.

### Lint / test / build
Commands are in `package.json` / `web/package.json`. All pass as of setup:
- Backend: `npm run lint`, `npm run type-check`, `npm test` (149 unit tests),
  `npm run build`.
- Frontend: `npm test --prefix web` (Vitest; some tests intentionally assert
  thrown errors — the stderr stack traces are expected, not failures).
- Unit/integration tests set `NODE_ENV=test`, which mocks Redis/BullMQ, so
  they do not need live Redis.

### Known pre-existing bugs (NOT environment issues; unrelated to setup)
- `npx prisma db seed` / `node prisma/seed.js` fail: `prisma/seed.js` imports
  `bcryptjs`, which is not a dependency (the app uses `bcrypt`). Seeding is
  optional — bootstrap the admin via `/api/auth/register` instead.
- Dashboard stats endpoint returns 500: `src/routes/dashboard.routes.js` runs a
  `$queryRaw` against `FROM "Invoice"`, but the table is `invoices` (Prisma
  `@@map`). The SPA dashboard shows "Failed to load dashboard stats".
- The Clients page always shows 6 hardcoded fallback clients and does not show
  real ones: `web/src/pages/Clients.jsx` treats the `{ clients: [...] }` API
  response as an array, so `.length` is undefined and it falls back to
  `ASHBI_DESIGN_CLIENTS`. Client creation still persists correctly to the DB
  (verify via `GET /api/clients` or `psql`).
