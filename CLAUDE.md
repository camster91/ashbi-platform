# CLAUDE.md - Agency Hub

> AI-powered agency management platform for Ashbi Design

## Quick Reference

```bash
# Development
npm install --legacy-peer-deps  # Install dependencies (legacy-peer-deps required)
npx prisma generate             # Generate Prisma client
npm run dev                     # Backend (Fastify on :3000, hot reload)
npm run dev:web                 # Frontend (Vite on :5173, proxies /api to :3000)
npm run dev:worker              # BullMQ job worker

# Database
npx prisma db push              # Push schema to DB
npx prisma migrate dev          # Run migrations
npx prisma db seed              # Seed data (node prisma/seed.js)
npx prisma studio               # Visual DB editor

# Build & Deploy
npm run build                   # Full build (Prisma generate + Vite build)
npm start                       # Production server
pm2 start ecosystem.config.js   # PM2 managed processes

# Quality
npm run lint                    # ESLint (src/)
npm run lint:fix                # ESLint autofix
npm test                        # Node.js native test runner
npm run test:watch              # Watch mode

# Security
node scripts/security-audit.js  # Verify admin users & security posture
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
| Styling | Tailwind CSS | ^3.4.15 | Class-based dark mode, Inter + Plus Jakarta Sans fonts |
| Components | shadcn/ui + Radix UI | - | Unstyled accessible primitives |
| Icons | Lucide React | ^0.460.0 | SVG icon library |
| Server State | TanStack Query | ^5.60.2 | Data fetching/caching |
| Real-time | Socket.IO | ^4.8.1 | WebSocket notifications |
| Auth | JWT + bcrypt | fastify-jwt | Cookie-based sessions, 12-round bcrypt |
| Payments | Stripe | ^20.4.1 | Invoicing & subscriptions |
| Email | Mailgun | ^10.2.2 | Outbound email delivery |
| Validation | Zod | ^3.23.8 | Schema validation |
| Security | Helmet + CSRF | @fastify/* | CSP, rate limiting, CSRF tokens |
| Process Mgmt | PM2 | - | API + worker processes |
| Deployment | Docker + Traefik | - | Coolify-managed on Hostinger VPS |
| CI/CD | GitHub Actions | - | Auto-deploy on push to main |

---

## Architecture

### System Flow

```
Forwarded Email (webhook) -> AI Parse & Match -> AI Analyze -> Auto-Assign -> AI Replan Project -> AI Draft Response -> Human Review & Approve
```

### Backend (`src/`)

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
│   ├── auth.routes.js          # Login, logout, password reset
│   ├── inbox.routes.js         # Inbox management
│   ├── client.routes.js        # Client CRUD
│   ├── project.routes.js       # Project management
│   ├── thread.routes.js        # Thread handling
│   ├── response.routes.js      # Response approval workflow
│   ├── task.routes.js          # Task management
│   ├── team.routes.js          # Team management
│   ├── ai.routes.js            # AI operations (draft, refine, ask)
│   ├── bot.routes.js           # Bot API for external agents
│   ├── invoice.routes.js       # Invoicing
│   ├── webhook.routes.js       # Email webhooks
│   ├── client-portal.routes.js # Client-facing portal
│   └── [agent].routes.js       # Agent-specific routes (wordpress, shopify, etc.)
├── services/                   # Business logic layer (*.service.js)
│   ├── assignment.service.js   # Auto-assignment logic
│   ├── pipeline.service.js     # Email processing pipeline
│   ├── project.service.js      # Project operations
│   ├── stripe.service.js       # Payment processing
│   └── weeklyReport.service.js # Weekly reporting
├── jobs/
│   ├── queue.js                # BullMQ queue setup
│   ├── worker.js               # Job processor (separate process)
│   └── processEmail.job.js     # Email processing pipeline
├── events/
│   └── hub-events.js           # Event bus -> Discord, OpenClaw, Socket.IO
├── webhooks/
│   ├── discord.js              # Discord webhook posting
│   └── openclaw.js             # OpenClaw messaging
├── utils/                      # Pure utility functions
└── tests/                      # Integration tests
```

### Frontend (`web/src/`)

```
web/src/
├── App.jsx                     # React Router configuration
├── main.jsx                    # Entry point
├── pages/                      # Route-level page components (55+)
│   ├── Dashboard.jsx           # Main dashboard
│   ├── SimplifiedDashboard.jsx # Simplified UX variant
│   ├── Inbox.jsx               # Full inbox
│   ├── SimplifiedInbox.jsx     # Simplified inbox variant
│   ├── Thread.jsx              # Thread detail
│   ├── Projects.jsx / Project.jsx
│   ├── Clients.jsx / Client.jsx
│   ├── TaskKanban.jsx          # Kanban board
│   ├── Invoices.jsx / Proposals.jsx / Contracts.jsx
│   ├── AgentTeamDashboard.jsx  # AI agent management
│   └── [Agent]Dashboard.jsx    # Per-agent pages
├── components/
│   ├── ui/                     # shadcn/ui components (Button, Card, Badge, etc.)
│   │   └── index.js            # Barrel exports
│   ├── project/                # Project-specific components
│   │   ├── ProjectContext.jsx  # Project context provider
│   │   └── ProjectCommunications.jsx
│   ├── AIChatPanel.jsx         # Floating AI chat
│   ├── TaskAIChat.jsx          # Task-specific AI chat
│   ├── AIActions.jsx           # Quick AI action buttons
│   └── KanbanBoard.jsx         # Task board
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

- **ADMIN** (Cameron, Bianca): Full access. Approves all external communications, manages team, overrides AI decisions.
- **TEAM_MEMBER**: Views assigned work, drafts responses (submitted for approval), adds internal notes, marks tasks complete.

### AI Pipeline

5-step AI pipeline for email processing:
1. **Parse & Match** - Extract sender, fuzzy match to client/project, confidence scoring (>85% = auto-route)
2. **Analyze** - Classify intent, urgency, sentiment, extract action items
3. **Auto-Assign** - Skill-based routing, workload balancing, escalation
4. **Replan Project** - Update project summary, regenerate task plan, flag risks
5. **Draft Response** - Generate 2-3 response options matching client tone

AI provider is pluggable (`AI_PROVIDER=claude|gemini`) via factory in `src/ai/providers/`.

### Core Modules

1. **Smart Inbox** - Email webhook processing, fuzzy matching, triage queue
2. **Project Command Center** - Health indicators, AI-generated plans, risk tracking
3. **Client 360** - Profiles, contacts, knowledge bases, satisfaction signals (NPS)
4. **Response Studio** - AI drafts, approval workflow (DRAFT->PENDING_APPROVAL->APPROVED->SENT)
5. **Team Workboard** - Workload dashboard, assignment rules
6. **Notification Engine** - SLA tracking, escalation rules (4h/8h/24h)
7. **Analytics** - Response times, volume trends, team performance
8. **Search & Knowledge** - Global search, AI-powered recall
9. **Proposals** - AI-assisted scope writing, client approval links, PDF export
10. **Contracts** - Templates (retainer, project, NDA), digital signatures
11. **Invoices** - Line items, Stripe payment links, auto-reminders
12. **Client Portal** - Token-authenticated views for clients (projects, invoices, approvals)

### Agent Systems

| Agent | Route Prefix | Purpose |
|-------|-------------|---------|
| Email Triage | `/api/email-triage` | Automated email categorization |
| WordPress | `/api/wordpress-agent` | WordPress site management |
| Shopify | `/api/shopify-agent` | E-commerce integration |
| Sales | `/api/sales-agent` | Lead qualification |
| LinkedIn | `/api/linkedin-outreach` | Connection campaigns |
| Cold Email | `/api/cold-email` | Outreach sequences |
| SEO Blog | `/api/seo-blog` | Content generation |
| Social Content | `/api/social-content` | Multi-platform posting |
| Upwork | `upwork-agent/` | Job scraping, proposals, messages (Playwright) |

### Integrations

- **Discord** - Real-time event notifications to `#agency-hub`, `#alerts`, `#deployments` channels
- **OpenClaw** - AI specialist spawning (coding, SEO, deploy, email, content, research, analytics agents)
- **Stripe** - Payment links on invoices, recurring billing for retainers
- **Mailgun** - Outbound email delivery
- **Google APIs** - Gmail draft creation, Google Drive

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
- Bot API uses `BOT_SECRET` header auth
- Response format: `{ data: ... }` on success, `{ error: "message" }` on failure
- Route files export a function receiving the Fastify instance

### Frontend Patterns

- API client in `web/src/lib/api.js` - fetch-based with `ApiError` class
- Auth via React Context (`useAuth` hook)
- Socket.IO via `useSocket` hook for real-time updates
- TanStack Query for server state management
- Path alias: `@/` resolves to `web/src/`
- UI components: `web/src/components/ui/` (shadcn/ui pattern)
- Button variants: `primary|secondary|outline|ghost|danger|success|warning`
- Button sizes: `xs|sm|md|lg|xl`

---

## Key Data Models

### Primary Models

| Model | Purpose | Key Fields |
|-------|---------|------------|
| `User` | Team members | role (ADMIN/TEAM), skills (JSON), capacity, hourlyRate |
| `Client` | Client companies | domain, tier (T1/T2/T3), status, knowledgeBase (JSON), satisfactionSignals |
| `Project` | Client projects | status, health, healthScore, aiSummary, aiPlan (JSON), budget |
| `Thread` | Communication threads | priority, intent, sentiment, matchConfidence, needsTriage, slaDeadline |
| `Message` | Individual messages | direction (INBOUND/OUTBOUND), bodyText, rawEmail, aiExtracted (JSON) |
| `Response` | Draft responses | status (DRAFT->PENDING_APPROVAL->APPROVED->SENT), aiGenerated |
| `Task` | Project tasks | status, priority, category, position (Kanban), parentId (subtasks), content (JSON blocks) |
| `TimeEntry` | Time tracking | duration (minutes), billable, invoiced, invoiceId |
| `Invoice` | Client invoices | status, subtotal, tax, total, viewToken |
| `Proposal` | Client proposals | status (DRAFT->SENT->VIEWED->APPROVED->DECLINED), lineItems, viewToken |
| `Contract` | Client contracts | status, signedAt, templateType |
| `ProjectContext` | AI rolling summary | aiSummary, humanNotes, compactionVersion, emailCount |
| `ProjectCommunication` | Email log per project | gmailMessageId, direction, summary, actionItems |
| `ClientEmailMapping` | Email-to-client matching | emailAddress, emailDomain, contactName |

### Supporting Models

`Contact`, `Notification`, `AssignmentRule`, `Template`, `UnmatchedEmail`, `ChatMessage`, `ChatReaction`, `Note`, `Milestone`, `Attachment`, `Activity`, `CalendarEvent`, `EventAttendee`, `RetainerPlan`, `Report`, `RevisionRound`, `Credential`, `Expense`, `AiTeamMessage`, `RevenueSnapshot`, `Approval`, `SurveyResponse`

---

## Security

### Implemented Controls

- **Password hashing**: bcrypt with 12 salt rounds (replaced SHA-256)
- **Rate limiting**: 5 login attempts per 15 minutes per IP
- **CSRF protection**: `@fastify/csrf-protection` with secure cookies
- **Security headers**: Helmet.js (CSP, X-Frame-Options, HSTS, etc.)
- **Cookie security**: httpOnly, secure (prod), sameSite: strict
- **JWT**: Token in cookie only (not response body), 7-day expiry
- **Input validation**: Zod schemas, Prisma parameterized queries
- **Admin controls**: Self-demotion prevention, audit endpoints

### Authorized Admins

- cameron@ashbi.ca (Primary)
- bianca@ashbi.ca (Secondary)

### Security Maintenance

- Run `node scripts/security-audit.js` monthly
- Run with `--fix` to remediate unauthorized admin accounts
- Rotate `JWT_SECRET` if breach suspected, then restart to invalidate all sessions

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

### Production Environment Variables

```env
# Required (validated in src/config/env.js)
DATABASE_URL=postgresql://...       # PostgreSQL connection string
JWT_SECRET=<strong-random-secret>   # openssl rand -base64 32
ANTHROPIC_API_KEY=<api-key>
WEBHOOK_SECRET=<strong-secret>
CREDENTIALS_KEY=<strong-secret>     # For credential encryption
NODE_ENV=production
CORS_ORIGIN=https://hub.ashbi.ca
REDIS_URL=redis://localhost:6379

# Email
MAILGUN_API_KEY=<key>
MAILGUN_DOMAIN=<domain>
MAILGUN_SIGNING_KEY=<key>

# AI Provider
AI_PROVIDER=claude                  # or 'gemini'
GEMINI_API_KEY=<key>                # if using gemini

# Integrations (optional)
STRIPE_SECRET_KEY=<key>
GITHUB_TOKEN=<token>
NOTION_TOKEN=<token>
HUNTER_API_KEY=<key>
BOT_SECRET=<secret>                 # For bot API auth
```

---

## Event System

Hub events flow through `src/events/hub-events.js` to three destinations:

```
Hub Event -> Discord webhooks (notifications)
          -> OpenClaw gateway (specialist spawning)
          -> Socket.IO (frontend real-time updates)
```

Events: `project_created`, `task_assigned`, `task_completed`, `message_received`, `approval_needed`, `response_sent`, `alert`

---

## Upwork Agent (`upwork-agent/`)

Standalone Playwright-based automation for Upwork:

```bash
cd upwork-agent
npm install
npm run messages    # Scrape unread messages
npm run feed        # Find job listings
npm run proposals   # Track proposal statuses
npm run hiring      # Client hiring mode
npm run all         # Run everything
```

- Uses Chrome Profile 4 (cameron@ashbi.ca session)
- Syncs to Hub via bot API as tagged tasks
- 10-15x faster than previous Claude CLI approach

---

## Testing

- **Framework**: Node.js native test runner (`node --test`)
- **Assertions**: `node:assert/strict`
- **Pattern**: Fastify injection (`fastify.inject()`) for HTTP tests
- **Test files**: `src/tests/*.test.js`
- **Setup/teardown**: `before()`/`after()` hooks with Prisma cleanup (`deleteMany`)

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

## Key Algorithms

### Project Health Scoring

```javascript
let score = 100;
if (criticalOpenThreads > 0) score -= 30;
if (threadsNeedingResponse > 2) score -= 15;
if (staleThreads > 0) score -= (10 * count);
if (longClientWaits > 0) score -= 5;
// ON_TRACK (>=80) | NEEDS_ATTENTION (>=50) | AT_RISK (<50)
```

### Assignment Algorithm

Priority order for auto-assignment:
1. **Critical -> Admin** - Always escalate critical priority
2. **Project default owner** - If set and has capacity
3. **Client routing rule** - Specific client -> specific member
4. **Skill matching** - Match intent to skill (bug -> dev)
5. **Thread continuity** - Keep same handler for ongoing thread
6. **Load balancing** - Assign to least loaded member
7. **Escalate** - If no capacity, escalate to admin

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
11. **Bot API for agents** - External agents (Upwork, email-triage) communicate via `BOT_SECRET`-authenticated endpoints
12. **ProjectContext compaction** - Rolling AI summaries instead of dumping full history (token efficiency)

---

## Common Gotchas

- Use `--legacy-peer-deps` for `npm install` (peer dependency conflicts)
- Frontend dev server proxies `/api` and `/socket.io` to localhost:3000 - both backend and frontend must be running
- JSON fields in Prisma are stored as `String` - parse with `JSON.parse()`, serialize with `JSON.stringify()`
- Vite root is `web/` but build output goes to top-level `dist/`
- Fastify serves static files from `dist/` in production (SPA fallback for React Router)
- The `server.js` at root is the Hostinger-specific entry point
- No git hooks are configured - linting is manual or CI-enforced
- `ProjectCommunication.gmailMessageId` is unique - use upsert to prevent duplicate email imports
- Credential encryption uses `CREDENTIALS_KEY` env var - rotating it invalidates stored credentials
- CSRF tokens required on all state-changing requests in production
