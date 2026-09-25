# tests/e2e — Full-stack smoke

Boots the real service stack from `docker-compose.test.yml` and exercises it
over HTTP. This is the required "Full-stack E2E smoke" release gate.

| Service | Role |
|---|---|
| `postgres` | Fresh pgvector database per run |
| `redis` | BullMQ queues and readiness |
| `migrate` | `prisma migrate deploy` |
| `seed` | `prisma/seed.js` (admin `cameron@ashbi.ca`) |
| `worker` | BullMQ worker; writes the heartbeat `/api/health` requires |
| `hub` | Fastify API on host port 3001 |

`hub-smoke.test.mjs` checks readiness (database, redis, worker), anonymous
rejection, admin login and session cookie, wrong-password rejection, client
creation scoped to the admin's organization (verified in Postgres), client
read/list, and that the retired `/api/wp-bridge` routes return 404.

The hub serves the image's built SPA (`SERVE_BUILT_SPA=true`), so the
Playwright journeys in `journeys/` (config: `playwright.stack.config.ts`) drive
the real UI and API with no request mocking:

- `agency-revenue.spec.ts` — admin logs in, creates a client, contact, project
  and a proposal with line items, sends it from the proposal page; the client
  approves on the public proposal page; the generated contract is sent from the
  Contracts page and signed by the client through the client portal; admin
  invoices the accepted work, sends it, the public invoice page shows the
  HST-inclusive total, admin records a manual bank payment, and the invoice,
  public page, invoice stats and dashboard revenue all reflect it.
- `portal-isolation.spec.ts` — two clients of one agency, each with a portal
  user; client A signs in by magic link and sees only its own invoice and
  contract in the portal UI and API, downloads its own invoice PDF, gets 404 for
  client B's, and is refused on every staff API (invoices, contracts, proposals,
  clients) for client B's records.

Email and Stripe are not configured in the stack. Public links are read back
through the admin API, the portal magic link is minted from the claims
`POST /api/client-portal/request-access` signs (with the stack's
`JWT_SECRET`, override via `HUB_JWT_SECRET`), and payments use the manual
"Record payment" path. Journeys assert deltas, so they tolerate the shared
database.

```bash
npm run test:e2e:setup     # build + boot, wait for /api/health, verify login
npm run test:e2e
npx playwright install chromium   # once
npm run test:e2e:journeys
npm run test:e2e:teardown  # removes containers and volumes
```

Without Docker, point the journeys at any hub started with
`SERVE_BUILT_SPA=true API_RATE_LIMIT_MAX=2000` (and a built `dist/`) via
`HUB_BASE` and `HUB_DB_HOST/PORT/USER/PASSWORD/NAME`;
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` selects a preinstalled Chromium.

Requires Docker. `setup.sh` prints the health report and hub/worker logs if
the stack never becomes ready.
