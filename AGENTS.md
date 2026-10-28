# Repository instructions

## Application boundaries

- The existing Hub uses Fastify in `src/`, React/Vite in `web/`, Prisma/PostgreSQL in `prisma/`, and a BullMQ worker in `src/jobs/worker.js`.
- `apps/workspace/` is the owner-selected Cloudflare app, with its own package, lockfile and [local commands](apps/workspace/README.md). The Hub remains a fallback. Deployment, authenticated daily-use acceptance and legacy retirement are separate; see [deployment and rollback](docs/deployment-and-rollback.md).
- Use the nearest package's commands. Root scripts verify the existing Hub, not the pilot.

## Local development and verification

- Use the Node version in `.nvmrc`. Install from lockfiles with `npm ci` and `npm ci --prefix web`; generate the Prisma client with `npm run db:generate`.
- The API and worker do not automatically load `.env`. Export the intended local values in their shells before `npm run dev` or `npm run dev:worker`. The frontend runs with `npm run dev:web`.
- `npm run test:core` runs the focused daily API/UI suite (about 100 cases). Use it for quick feedback; the full suites below remain release checks.
- `npm run verify:quick` checks package boundaries, types, both linters and backend/frontend unit tests without a database.
- `verify`, `verify:release` and `test:integration` mutate fixtures. Use only the separate disposable loopback test database in [local-verification.md](docs/local-verification.md). Never disable its safety guard or use development/customer data.
- Shared environments use committed migrations with `prisma migrate deploy`. Reserve `prisma db push` for throwaway schema experiments.
- Keep lint/type-check ratchets and meaningful security, tenant-isolation, money, accessibility and recovery assertions. [Frontend test placement](docs/frontend-tests.md) explains which tests need Node or jsdom.

## Architecture and authority

- Route handlers use `request.prisma` for tenant-scoped access. Follow the existing tenant policy and domain registration boundaries when changing routes or models.
- [CONTRIBUTING.md](CONTRIBUTING.md) owns delivery policy. [deployment-and-rollback.md](docs/deployment-and-rollback.md) owns the current production procedure; [backup-and-restore.md](docs/backup-and-restore.md) owns recoverability. Historical deployment guides do not grant release authority.
- [product-status.md](docs/product-status.md) distinguishes source capability from accepted behavior. [launch-status.md](docs/launch-status.md) retains dated deployment/QA evidence.
- On 27 October 2026 the owner closed all remaining issues and pull requests. Their references in older plans are historical; closure does not establish implementation, deployment or acceptance. Follow the current owner request and verify older claims against code and evidence.
- Older architecture, reviews and model-specific guides live in `docs/archive/`. Do not use them as current instructions or a new work queue.
