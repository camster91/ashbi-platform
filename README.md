# Ashbi Hub

Repository changes follow the issue-to-release policy in [CONTRIBUTING.md](CONTRIBUTING.md).

Agency management platform for operations, finance, project management, team collaboration, and client delivery. Product claims and remaining gates are classified in [docs/product-status.md](docs/product-status.md); route presence alone is not treated as launch proof.

## Brand

**Colors:**
- Deep Indigo: `#2e2958` (primary)
- Lime Accent: `#e6f354` (accent)
- Sage Green: `#d0dd9a` (secondary)
- Cream: `#faf9f2` (background)

**Typography:**
- Body: DM Sans
- Headings: Instrument Serif

## Structure

```
ashbi-platform/
├── src/                    # Backend (Fastify)
│   ├── routes/             # API endpoints
│   ├── services/           # Business logic
│   ├── ai/                 # AI agents
│   ├── jobs/               # Background jobs
│   └── index.js            # Entry point
├── web/                    # Frontend (Vite + React)
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # React hooks
│   │   └── lib/            # Utilities
│   └── package.json
├── prisma/                 # Database schema
├── docker-compose.yml      # Local service composition
└── package.json
```

## Development

Prerequisites: Node.js 20+ (the production image currently uses 22), PostgreSQL 16 with pgvector, and Redis 7+. The backend does not implicitly load `.env`; export it into each backend/worker shell. Prisma reads it through `prisma.config.ts`.

```bash
# Install locked dependencies
npm ci
npm ci --prefix web

# Create a local environment from the sanitized template, then edit placeholders
cp .env.example .env

# Apply the committed migration chain and generate Prisma
npx prisma migrate deploy
npm run db:generate

# Export .env in each Git Bash/WSL backend or worker shell
set -a; source .env; set +a

# Start backend, frontend, and worker in separate shells
npm run dev
npm run dev:web
npm run dev:worker
```

The API defaults to `http://localhost:3000`; Vite serves `http://localhost:5173` and proxies API/socket traffic. PostgreSQL and Redis must already be running. Bootstrap the first administrator with `POST /api/auth/register` using the local `ADMIN_INVITE_TOKEN`; never commit or document its value. `prisma db push` is restricted to disposable local databases—shared and production environments use the committed migrations.

Run the supported gates with:

```bash
npm run lint
npm run type-check
npm test
npm run test:integration
npm test --prefix web -- --run
npm run build
npm run check:release-gates
```

### Dependency and build ownership

The repository root owns the Fastify backend, Prisma client, workers, and backend/E2E
tooling. `web/` exclusively owns browser dependencies, Tailwind/PostCSS, and Vite.
Canonical frontend commands are delegated from the root (`npm run dev:web`,
`npm run build:web`, `npm run test:web`) and use `web/vite.config.js`, producing
`web/dist`. The Docker frontend stage uses the same manifest, lockfile, configuration,
and output path. Root production installs contain no React, Radix, Tailwind, or Vite
packages. Check both resolved dependency graphs with `npm run check:dependencies`.

### Offline and private-data behavior

The PWA caches only the public application shell and static assets. Requests under
`/api/` are always network-only and return `503 Offline` when unavailable; private
client, project, invoice, and session data is never stored in Cache Storage. Worker
upgrades, login/account transitions, session expiry, and logout purge every legacy
`hub-api-*` cache while preserving the public static cache.

## Deployment

Production has one controller: the immutable direct-VPS procedure in [docs/deployment-and-rollback.md](docs/deployment-and-rollback.md). GitHub Actions and Coolify do not promote production. Every release uses the reviewed revision, archive checksum, immutable image ID, migration/status preflight, dependency-aware API/worker readiness, retained rollback containers, trusted HTTPS verification, and the encrypted backup policy in [docs/backup-and-restore.md](docs/backup-and-restore.md).

## Features

### Code-present core
- Clients CRM with health tracking
- Projects with tasks, milestones, time tracking
- Invoices, proposals, contracts
- Client portal with view tokens
- User authentication and team management

These capabilities are code-present, but production/market readiness varies by workflow and external provider. See the canonical status map before describing any integration or AI workflow as supported.

## Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **Backend**: Fastify + Prisma
- **Database**: PostgreSQL 16 + pgvector
- **Jobs/cache**: Redis + BullMQ worker
- **AI**: Anthropic Claude, Google Gemini, Ollama
- **Deploy**: immutable Docker image through the reviewed direct-VPS controller
