# CLAUDE.md - Agency Hub

> AI-powered agency management platform for Ashbi Design

## Quick Reference

```bash
# Development
npm install                    # Install dependencies
npx prisma generate           # Generate Prisma client
npm run dev                   # Backend (Fastify on :3000, hot reload)
npm run dev:web               # Frontend (Vite on :5173, proxies /api to :3000)
npm run dev:worker            # BullMQ job worker

# Database
npx prisma db push            # Push schema to DB
npx prisma migrate dev        # Run migrations
npx prisma db seed            # Seed data (node prisma/seed.js)
npx prisma studio             # Visual DB editor

# Build & Deploy
npm run build                 # Full build (Prisma generate + Vite build)
npm start                     # Production server
pm2 start ecosystem.config.js # PM2 managed processes

# Quality
npm run lint                  # ESLint (src/)
npm run lint:fix              # ESLint autofix
npm test                      # Node.js native test runner
npm run test:watch            # Watch mode
```

---

## Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Runtime | Node.js | >=20 | ESM only (`"type": "module"`) |
| Framework | Fastify | ^5.1.0 | HTTP server + plugins |
| Database | PostgreSQL | - | SQLite in dev (`DATABASE_URL`) |
| ORM | Prisma | ^5.22.0 | Schema at `prisma/schema.prisma` |
| Queue | BullMQ + Redis | ^5.25.0 | Background job processing |
| AI (primary) | Claude API | ^0.32.0 | `@anthropic-ai/sdk` |
| AI (fallback) | Gemini API | ^0.24.1 | `@google/generative-ai` |
| Frontend | React | ^18.3.1 | Functional components + hooks |
| Bundler | Vite | ^6.0.1 | Path alias `@` -> `web/src` |
| Router | React Router | ^7.0.1 | Client-side SPA routing |
| Styling | Tailwind CSS | ^3.4.15 | Class-based dark mode |
| Components | shadcn/ui + Radix UI | - | Unstyled accessible primitives |
| Icons | Lucide React | ^0.460.0 | SVG icon library |
| Server State | TanStack Query | ^5.60.2 | Data fetching/caching |
| Real-time | Socket.IO | ^4.8.1 | WebSocket notifications |
| Auth | JWT | fastify-jwt | Cookie-based sessions |
| Payments | Stripe | ^20.4.1 | Invoicing & subscriptions |
| Email | Mailgun | ^10.2.2 | Outbound email delivery |
| Validation | Zod | ^3.23.8 | Schema validation |
| Process Mgmt | PM2 | - | API + worker processes |
| Deployment | Docker + Traefik | - | Coolify-managed on Hostinger VPS |
| CI/CD | GitHub Actions | - | Auto-deploy on push to main |

---

## Architecture

### System Flow

```
Forwarded Email (webhook) -> AI Parse & Match -> AI Analyze -> Auto-Assign -> AI Replan Project -> AI Draft Response -> Human Review & Approve
```

### Backend Architecture (`src/`)

```
src/
├── index.js                    # Fastify server + Socket.IO bootstrap
├── config/
│   ├── env.js                  # Environment validation & defaults
│   └── ai.js                   # AI model settings & constants
├── ai/
│   ├── client.js               # AI client abstraction layer
│   ├── providers/
│   │   ├── index.js            # Provider factory (claude/gemini)
│   │   ├── claude.js           # Claude API implementation
│   │   └── gemini.js           # Gemini API fallback
│   └── prompts/
│       ├── parseEmail.js       # Email parsing prompt
│       ├── analyzeMessage.js   # Message analysis prompt
│       ├── replanProject.js    # Project replanning prompt
│       └── draftResponse.js    # Response drafting prompt
├── routes/                     # Fastify route handlers (*.routes.js)
├── services/                   # Business logic layer (*.service.js)
├── jobs/
│   ├── queue.js                # BullMQ queue setup
│   ├── worker.js               # Job processor (separate process)
│   └── processEmail.job.js     # Email processing pipeline
├── events/
│   └── hub-events.js           # Event bus/emitter
├── webhooks/                   # External webhook handlers
├── utils/                      # Pure utility functions
└── tests/                      # Integration tests
```

### Frontend Architecture (`web/src/`)

```
web/src/
├── App.jsx                     # React Router configuration
├── main.jsx                    # Entry point
├── pages/                      # Route-level page components (55+)
├── components/
│   ├── ui/                     # shadcn/ui components (Button, Card, Badge, etc.)
│   │   └── index.js            # Barrel exports
│   ├── project/                # Project-specific components
│   └── [feature].jsx           # Feature components
├── hooks/
│   ├── useAuth.jsx             # Auth context + provider
│   └── useSocket.js            # Socket.IO connection
└── lib/
    ├── api.js                  # Fetch-based API client (~32KB)
    └── utils.js                # cn(), formatDate(), getPriorityColor(), etc.
```

---

## Core Concepts

### User Roles

- **ADMIN** (Cameron): Full access. Approves all external communications, manages team, overrides AI decisions.
- **TEAM_MEMBER**: Views assigned work, drafts responses (submitted for approval), adds internal notes, marks tasks complete.

### AI Pipeline

The system uses a 5-step AI pipeline for email processing:
1. **Parse & Match** - Extract sender, fuzzy match to client/project, confidence scoring
2. **Analyze** - Classify intent, urgency, sentiment, extract action items
3. **Auto-Assign** - Skill-based routing, workload balancing, escalation
4. **Replan Project** - Update project summary, regenerate task plan, flag risks
5. **Draft Response** - Generate 2-3 response options matching client tone

AI provider is pluggable (`AI_PROVIDER=claude|gemini`) via the factory in `src/ai/providers/`.

### Core Modules

1. **Smart Inbox** - Email webhook processing, fuzzy matching, triage queue
2. **Project Command Center** - Health indicators, AI-generated plans, risk tracking
3. **Client 360** - Profiles, contacts, knowledge bases, satisfaction signals
4. **Response Studio** - AI drafts, approval workflow, templates
5. **Team Workboard** - Workload dashboard, assignment rules
6. **Notification Engine** - SLA tracking, escalation rules (4h/8h/24h)
7. **Analytics** - Response times, volume trends, team performance
8. **Search & Knowledge** - Global search, AI-powered recall

### Additional Agent Systems

- **Email Triage Agent** - Automated email categorization
- **WordPress Agent** - WordPress site management
- **Shopify Agent** - E-commerce integration
- **Sales Agent** - Lead qualification
- **LinkedIn Outreach** - Connection campaigns
- **Cold Email** - Outreach sequences
- **SEO Blog** - Content generation
- **Social Content** - Multi-platform posting

---

## Conventions

### File Naming

| Type | Pattern | Example |
|------|---------|---------|
| Routes | `{feature}.routes.js` | `inbox.routes.js` |
| Services | `{feature}.service.js` | `assignment.service.js` |
| Jobs | `{name}.job.js` | `processEmail.job.js` |
| React Pages | `PascalCase.jsx` | `TaskKanban.jsx` |
| React Components | `PascalCase.jsx` | `AIChatPanel.jsx` |
| Hooks | `use{Name}.{js,jsx}` | `useAuth.jsx` |
| Utils | `camelCase.js` | `emailParser.js` |
| Tests | `{module}.test.js` | `invoice.test.js` |
| Config | `{name}.js` | `env.js` |

### Code Style

- **ESM only** - `import`/`export`, never `require`/`module.exports`
- **Async/await** - No raw promise chains
- **Functional React** - No class components, hooks only
- **camelCase** variables/functions, **PascalCase** components/models, **UPPER_SNAKE_CASE** constants/enums
- **Tailwind CSS** for all styling, using `cn()` utility for class merging
- **shadcn/ui** component variants via `class-variance-authority`

### Database Conventions (Prisma)

- Model names: PascalCase (`User`, `Client`, `Project`)
- Field names: camelCase (`createdAt`, `clientId`, `assignedToId`)
- Enum-like strings: UPPER_SNAKE_CASE (`ADMIN`, `ACTIVE`, `CRITICAL`)
- IDs: `cuid()` default
- Timestamps: `createdAt` + `updatedAt` on all models
- JSON stored as `String` fields with `@default("[]")` or `@default("{}")`
- Table mapping: `@@map("snake_case_plural")`
- Cascade deletes on parent relations

### API Patterns

- All routes under `/api/` prefix
- JWT authentication via `fastify.authenticate` decorator
- Admin-only routes check `user.role === 'ADMIN'`
- Response format: `{ data: ... }` on success, `{ error: "message" }` on failure
- Route files export a function receiving the Fastify instance

### Frontend Patterns

- API client in `web/src/lib/api.js` - fetch-based with `ApiError` class
- Auth via React Context (`useAuth` hook)
- Socket.IO via `useSocket` hook for real-time updates
- TanStack Query for server state management
- Path alias: `@/` resolves to `web/src/`
- UI components: `web/src/components/ui/` (shadcn/ui pattern)

---

## Key Data Models

### Primary Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `User` | Team members | role (ADMIN/TEAM), skills (JSON), capacity |
| `Client` | Client companies | domain, tier (T1/T2/T3), status, knowledgeBase (JSON) |
| `Project` | Client projects | status, health, healthScore, aiSummary, aiPlan (JSON) |
| `Thread` | Communication threads | priority, intent, sentiment, matchConfidence, needsTriage |
| `Message` | Individual messages | direction (INBOUND/OUTBOUND), bodyText, aiExtracted (JSON) |
| `Response` | Draft responses | status (DRAFT->PENDING_APPROVAL->APPROVED->SENT), aiGenerated |
| `Task` | Project tasks | status, priority, category, position (Kanban), parentId (hierarchy) |
| `TimeEntry` | Time tracking | duration (minutes), billable, invoiced |
| `Invoice` | Client invoices | status, subtotal, tax, total, viewToken |
| `Proposal` | Client proposals | status (DRAFT->SENT->APPROVED), lineItems, viewToken |
| `Contract` | Client contracts | status, signedAt, templateType |

### Supporting Models

`Contact`, `Notification`, `AssignmentRule`, `Template`, `UnmatchedEmail`, `ChatMessage`, `Note`, `Milestone`, `Attachment`, `Activity`, `CalendarEvent`, `RetainerPlan`, `Report`, `RevisionRound`, `Credential`, `Expense`

---

## API Routes (Primary)

```
# Auth
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/auth/me

# Webhooks
POST   /api/webhooks/email

# Inbox
GET    /api/inbox
GET    /api/inbox/unmatched
POST   /api/inbox/unmatched/:id/assign
POST   /api/inbox/unmatched/:id/ignore

# Clients
GET    /api/clients
POST   /api/clients
GET    /api/clients/:id
PUT    /api/clients/:id
GET    /api/clients/:id/contacts
POST   /api/clients/:id/contacts
GET    /api/clients/:id/insights

# Projects
GET    /api/projects
POST   /api/projects
GET    /api/projects/:id
PUT    /api/projects/:id
GET    /api/projects/:id/plan
POST   /api/projects/:id/plan/refresh
GET    /api/projects/:id/tasks
POST   /api/projects/:id/tasks

# Threads
GET    /api/threads
GET    /api/threads/:id
PUT    /api/threads/:id
POST   /api/threads/:id/assign
POST   /api/threads/:id/snooze
POST   /api/threads/:id/resolve
POST   /api/threads/:id/messages
POST   /api/threads/:id/analyze

# Responses & Approval
GET    /api/responses/pending
POST   /api/threads/:id/responses
PUT    /api/responses/:id
POST   /api/responses/:id/submit
POST   /api/responses/:id/approve
POST   /api/responses/:id/reject

# Tasks
GET    /api/tasks
GET    /api/tasks/my
PUT    /api/tasks/:id
POST   /api/tasks/:id/complete

# Team
GET    /api/team
POST   /api/team
GET    /api/team/:id
PUT    /api/team/:id
GET    /api/team/workload

# AI
POST   /api/ai/draft-response
POST   /api/ai/refine-response
POST   /api/ai/ask

# Notifications
GET    /api/notifications
POST   /api/notifications/read/:id
POST   /api/notifications/read-all

# Search
GET    /api/search
GET    /api/search/similar/:threadId

# Analytics
GET    /api/analytics/overview
GET    /api/analytics/response-times
GET    /api/analytics/team

# Invoicing, Proposals, Contracts (full CRUD)
# Agent routes (email-triage, wordpress, shopify, sales, linkedin, cold-email, seo-blog, social)
# Client Portal (public, token-authenticated)
```

---

## Environment Variables

See `.env.example` for all variables. Critical ones:

```env
# Required
DATABASE_URL="file:./dev.db"          # PostgreSQL URL in production
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key
ANTHROPIC_API_KEY=your-api-key
REDIS_URL=redis://localhost:6379

# Email
WEBHOOK_SECRET=your-webhook-secret
MAILGUN_API_KEY=your-mailgun-api-key
MAILGUN_DOMAIN=your-domain

# AI Provider Selection
AI_PROVIDER=claude                     # or 'gemini'
GEMINI_API_KEY=your-gemini-key         # if using gemini

# Integrations (optional)
STRIPE_SECRET_KEY=...
GITHUB_TOKEN=...
NOTION_TOKEN=...
HUNTER_API_KEY=...
```

Production requires: `JWT_SECRET`, `ANTHROPIC_API_KEY`, `WEBHOOK_SECRET` (validated in `src/config/env.js`).

---

## Testing

- **Framework**: Node.js native test runner (`node --test`)
- **Assertions**: `node:assert/strict`
- **Pattern**: Fastify injection (`fastify.inject()`) for HTTP tests
- **Test files**: `src/tests/*.test.js`
- **Setup/teardown**: `before()`/`after()` hooks with Prisma cleanup (`deleteMany`)

Example test structure:
```javascript
import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';

describe('Feature', () => {
  before(async () => { /* setup fastify, seed data */ });
  after(async () => { /* cleanup, close server */ });

  test('should do something', async () => {
    const res = await fastify.inject({ method: 'GET', url: '/api/...' });
    assert.equal(res.statusCode, 200);
  });
});
```

---

## Deployment

### Infrastructure

- **Host**: Hostinger VPS (187.77.26.99)
- **Reverse Proxy**: Traefik (via Coolify)
- **Domain**: hub.ashbi.ca
- **Containers**: Docker Compose (API on port 3002 + worker)
- **Process Manager**: PM2 (api: 500MB max, worker: 300MB max)

### CI/CD Pipeline (`.github/workflows/deploy.yml`)

Triggered on push to `main`:
1. SSH into VPS
2. `git pull` latest code
3. `npm install --legacy-peer-deps`
4. Build frontend (`cd web && npm install && npm run build`)
5. `npx prisma generate && npx prisma db push`
6. `docker compose down && docker compose up -d`

### PR Review (`.github/workflows/pr-review.yml`)

Triggered on PRs to `main`:
- AI code review using Claude Sonnet
- Checks: ESM compliance, Prisma usage, React patterns, security, shadcn/ui styling, BullMQ for async jobs

---

## Key Design Decisions

1. **Email forwarding over OAuth** - Simpler setup, no token management, works with any email provider
2. **PostgreSQL in production** - SQLite for local dev, PostgreSQL via `DATABASE_URL` in production
3. **Approval required for all external comms** - Quality control, builds response patterns over time
4. **AI at every step** - Active participant in routing, planning, and drafting (not just analysis)
5. **Original content always preserved** - AI summaries are additive, raw email stored in `rawEmail` field
6. **Confidence scores everywhere** - `matchConfidence` on threads, guides when to trust vs verify
7. **Pluggable AI providers** - Claude primary, Gemini fallback, abstracted via factory pattern
8. **BullMQ for async work** - Email processing, report generation run as background jobs
9. **shadcn/ui pattern** - Components in `web/src/components/ui/`, customized via Tailwind
10. **Dual-process architecture** - API server and job worker run as separate Node.js processes

---

## Project Health Scoring

```javascript
let score = 100;
if (criticalOpenThreads > 0) score -= 30;
if (threadsNeedingResponse > 2) score -= 15;
if (staleThreads > 0) score -= (10 * count);
if (longClientWaits > 0) score -= 5;

// ON_TRACK (>=80) | NEEDS_ATTENTION (>=50) | AT_RISK (<50)
```

---

## Assignment Algorithm

Priority order for auto-assignment:
1. **Critical -> Admin** - Always escalate critical priority
2. **Project default owner** - If set and has capacity
3. **Client routing rule** - Specific client -> specific member
4. **Skill matching** - Match intent to skill (bug -> dev)
5. **Thread continuity** - Keep same handler for ongoing thread
6. **Load balancing** - Assign to least loaded member
7. **Escalate** - If no capacity, escalate to admin

---

## Common Gotchas

- Use `--legacy-peer-deps` for `npm install` (peer dependency conflicts)
- Frontend dev server proxies `/api` and `/socket.io` to localhost:3000 - both backend and frontend must be running
- JSON fields in Prisma are stored as `String` - parse with `JSON.parse()`, serialize with `JSON.stringify()`
- Vite root is `web/` but build output goes to top-level `dist/`
- Fastify serves static files from `dist/` in production (SPA fallback for React Router)
- The `server.js` at root is the Hostinger-specific entry point
- No git hooks are configured - linting is manual or CI-enforced
