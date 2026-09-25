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

```bash
npm run test:e2e:setup     # build + boot, wait for /api/health, verify login
npm run test:e2e
npm run test:e2e:teardown  # removes containers and volumes
```

Requires Docker. `setup.sh` prints the health report and hub/worker logs if
the stack never becomes ready.
