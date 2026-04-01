# CLAUDE.md - Agency Hub

> AI-powered client request management system for agencies

## Project Overview

Agency Hub is a centralized platform for managing client communications across multiple channels. It uses AI (Claude) at every step to parse, analyze, route, and draft responses to client messages, with human oversight for all external communications.

### Core Philosophy

1. **AI-First, Human-Final** - AI handles triage, analysis, drafting, and assignment. Admin (Cameron) approves all external communications. Team sees AI reasoning and can suggest overrides.

2. **Single Source of Truth** - All client communication flows through this app. No context lost in Slack/Figma/Notion silos. Complete audit trail of every decision.

3. **Progressive Disclosure** - Surface shows priorities and actions needed. Drill down reveals AI analysis and original content. Full history always accessible.

4. **Trust But Verify** - AI confidence scores on everything. Original content always preserved. Easy override at every step.

---

## Tech Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| Runtime | Node.js 20 | Hostinger VPS |
| Framework | Fastify | High performance webhooks |
| Database | SQLite (→ PostgreSQL) | Start simple, migrate later |
| ORM | Prisma | Type-safe, migrations |
| Queue | BullMQ + Redis | Async email processing |
| AI | Claude API (claude-sonnet-4-20250514) | All analysis & generation |
| Auth | JWT + cookies | Simple session management |
| Frontend | React + Vite | Fast builds |
| UI | Tailwind + shadcn/ui | Rapid development |
| State | TanStack Query | Server state |
| Realtime | Socket.io | Notifications |
| CI/CD | GitHub Actions | Auto-deploy to VPS |
| Process | PM2 | Production stability |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Agency Hub Flow                             │
└─────────────────────────────────────────────────────────────────────┘

Forwarded Email Arrives (webhook)
              │
              ▼
     ┌────────────────┐
     │ 🤖 AI Step 1   │  Parse & Match
     │                │  • Extract sender, subject, body
     │                │  • Fuzzy match to client/project
     │                │  • Confidence scoring
     └────────────────┘
              │
              ▼
     ┌────────────────┐
     │ 🤖 AI Step 2   │  Analyze Message
     │                │  • Intent classification
     │                │  • Urgency & sentiment
     │                │  • Extract action items
     │                │  • Identify questions
     └────────────────┘
              │
              ▼
     ┌────────────────┐
     │ 🤖 AI Step 3   │  Auto-Assign
     │                │  • Skill-based routing
     │                │  • Workload balancing
     │                │  • Escalation rules
     └────────────────┘
              │
              ▼
     ┌────────────────┐
     │ 🤖 AI Step 4   │  Replan Project
     │                │  • Update project summary
     │                │  • Regenerate task plan
     │                │  • Flag risks/blockers
     └────────────────┘
              │
              ▼
     ┌────────────────┐
     │ 🤖 AI Step 5   │  Draft Response
     │                │  • Generate 2-3 options
     │                │  • Match client tone
     │                │  • Flag personalization needs
     └────────────────┘
              │
              ▼
     ┌────────────────┐
     │   Dashboard    │  Human Review
     │                │  • Approve/edit assignments
     │                │  • Refine response drafts
     │                │  • Override AI decisions
     └────────────────┘
```

---

## User Roles & Permissions

### ADMIN (Cameron)
- Approve/reject external responses
- Override AI assignments
- Manage clients & projects
- Manage team members & skills
- Configure AI behavior & rules
- View all analytics
- Handle billing/admin escalations

### TEAM MEMBER
- View assigned threads & projects
- Add internal notes & context
- Draft responses (submitted for approval)
- Mark tasks complete
- Request reassignment
- Paste content from other sources
- View project plans & history

---

## Core Modules

### 1. Smart Inbox

**Incoming Email Processing:**
- Webhook receives forwarded emails
- AI parses sender, extracts metadata
- Fuzzy match to client (domain, name, history)
- Fuzzy match to project (context, keywords, recency)
- Auto-route high-confidence matches (>85%)
- Queue low-confidence for manual triage

**Unmatched Message Handling:**
- AI suggests possible matches with reasoning
- One-click assign to existing client/project
- Quick-create new client from email
- Mark as spam/irrelevant (learns over time)

**Inbox Views:**
- All Incoming (unified stream)
- Needs Triage (unmatched/low-confidence)
- Needs Response (awaiting reply)
- Pending Approval (drafts awaiting admin)
- By Client, By Priority, By Assignee

**Quick Actions:**
- Assign to team member
- Change priority
- Generate response draft
- Add internal note
- Snooze (reappear at set time)
- Mark resolved

### 2. Project Command Center

**Project Dashboard:**
- Health indicator (On Track / Needs Attention / At Risk)
- AI-generated status summary (auto-updates)
- Active threads count & status breakdown
- Pending responses count
- Days since last client contact

**AI-Generated Plan:**
- Immediate (today/urgent)
- This Week
- Upcoming
- Waiting on Client
- Waiting on Us
- Completed (history)

**Plan Interactions:**
- Click task → see source thread
- Drag to reorder priority
- Assign/reassign owner
- Set/change deadline
- Mark complete → triggers plan refresh
- Add manual task

**Risk Tracking:**
- AI-identified risks with severity
- Mitigation suggestions
- Manual risk addition

### 3. Client 360

**Client Profile:**
- Company name, domain, status
- Contacts with roles
- Communication preferences (AI-learned)
- Satisfaction signals (sentiment analysis)

**Knowledge Base (per client):**
- Brand guidelines
- Technical specs
- Important decisions made
- Lessons learned

### 4. Response Studio

**Response Composer:**
- Side-by-side: Original message | Your response
- AI-generated drafts (2-3 options)
- Edit with AI assistance ("Make more formal", "Shorten this")
- Insert from templates
- Preview before submit

**Approval Workflow:**
1. Team member drafts response
2. Submits for approval
3. Admin receives notification
4. Admin: Approve / Edit / Reject with feedback
5. Approved → Copy button for email
6. Track who drafted, who approved, when

### 5. Team Workboard

**Workload Dashboard:**
- Per-member: assigned threads, tasks, estimated load
- Team overview: who's overloaded, who has capacity
- Balance suggestions

**Assignment Rules:**
- Skill-based routing (bug → dev, design feedback → designer)
- Client-based routing
- Project-based routing (default owner)
- Load balancing
- Escalation (Critical → Admin)

### 6. Notification & Escalation Engine

**Notification Types:**
- Thread assigned
- Response approved/rejected
- Thread escalated
- Client replied
- Task due
- SLA warning/breach
- Project health changed

**Escalation Rules:**
- No response in 4 hours → Notify assignee
- No response in 8 hours → Notify admin
- No response in 24 hours → Critical alert
- Critical priority → Immediate admin notification

**SLA Tracking:**
- Response time targets per priority
- Per-client SLA overrides
- Visual indicators (on track / at risk / breached)

### 7. Analytics & Insights

**Metrics:**
- Response times (by priority, client, member)
- Volume trends
- Client health & sentiment
- Team performance
- AI accuracy (match rate, override frequency)

**Reports:**
- Weekly summary
- Per-client report
- Team performance
- Export to PDF/CSV

### 8. Search & Knowledge

**Global Search:**
- Search across all messages, threads, projects
- Natural language queries
- Filter by client, project, date range

**AI-Powered Recall:**
- "What was decided about X?"
- "When did we last discuss Y with client Z?"
- Similar past issues for current thread

---

## AI Prompt Guidelines

### Step 1: Parse & Match Email

**Input:** Raw email + list of known clients/contacts
**Output:**
```json
{
  "matchedClient": {
    "id": "string or null",
    "confidence": 0.0-1.0,
    "matchReason": "why matched"
  },
  "matchedProject": {
    "id": "string or null",
    "confidence": 0.0-1.0,
    "matchReason": "why matched"
  },
  "extractedSender": {
    "email": "string",
    "name": "string",
    "inferredRole": "string"
  },
  "isSpamOrIrrelevant": {
    "likely": boolean,
    "reason": "if true"
  }
}
```

### Step 2: Analyze Message

**Input:** Message content + project context + thread history
**Output:**
```json
{
  "intent": "bug_report|feature_request|question|approval_request|feedback|status_update|urgent_issue|general",
  "summary": "2-3 sentence summary",
  "urgency": "CRITICAL|HIGH|NORMAL|LOW",
  "urgencyReason": "why this level",
  "sentiment": "frustrated|happy|neutral|anxious|confused",
  "actionItems": [
    {
      "task": "specific task",
      "assignmentSuggestion": "dev|design|cameron|anyone",
      "estimatedEffort": "quick|medium|significant"
    }
  ],
  "questionsToAnswer": [
    {
      "question": "the question",
      "explicit": boolean,
      "priority": "must_answer|should_answer|optional"
    }
  ],
  "responseApproach": {
    "suggestedTone": "professional|friendly|apologetic|reassuring",
    "keyPointsToAddress": ["point 1", "point 2"],
    "suggestedTimeline": "when to respond by"
  }
}
```

### Step 3: Replan Project

**Input:** Project + all threads + new message
**Output:**
```json
{
  "projectSummary": "2-3 sentence state summary",
  "overallHealth": "on_track|needs_attention|at_risk|blocked",
  "healthReason": "why this status",
  "plan": {
    "immediate": [
      {
        "task": "what",
        "reason": "why now",
        "suggestedAssignee": "who",
        "estimatedTime": "time",
        "blockedBy": "null or blocker"
      }
    ],
    "thisWeek": [],
    "upcoming": [],
    "waitingOnClient": [
      {
        "item": "what",
        "askedOn": "date",
        "shouldFollowUp": boolean
      }
    ]
  },
  "risks": [
    {
      "risk": "what could go wrong",
      "likelihood": "low|medium|high",
      "impact": "low|medium|high",
      "mitigation": "how to address"
    }
  ],
  "suggestedNextAction": {
    "action": "most important next step",
    "owner": "who",
    "by": "when"
  }
}
```

### Step 4: Draft Response

**Input:** Message + thread + project + analysis + client preferences
**Output:**
```json
{
  "recommendedOption": 1,
  "recommendationReason": "why this option",
  "options": [
    {
      "approach": "brief description",
      "subject": "reply subject line",
      "body": "full email body",
      "tone": "professional|friendly|apologetic",
      "length": "short|medium|detailed"
    }
  ],
  "warnings": ["any concerns"],
  "needsPersonalTouch": boolean,
  "personalTouchReason": "why customize"
}
```

---

## Assignment Algorithm

Priority order for auto-assignment:

1. **Critical → Admin** - Always escalate critical priority
2. **Project default owner** - If set and has capacity
3. **Client routing rule** - Specific client → specific member
4. **Skill matching** - Match intent to skill (bug → dev)
5. **Thread continuity** - Keep same handler for ongoing thread
6. **Load balancing** - Assign to least loaded member
7. **Escalate** - If no capacity, escalate to admin

---

## Project Health Calculation

```javascript
let score = 100;

// Deductions
if (criticalOpenThreads > 0) score -= 30;
if (threadsNeedingResponse > 2) score -= 15;
if (staleThreads > 0) score -= (10 * count);
if (longClientWaits > 0) score -= 5;

// Health status
if (score >= 80) return 'ON_TRACK';
if (score >= 50) return 'NEEDS_ATTENTION';
return 'AT_RISK';
```

---

## Project Structure

```
agency-hub/
├── .github/
│   └── workflows/
│       └── deploy.yml
├── prisma/
│   ├── schema.prisma
│   └── seed.js
├── src/
│   ├── index.js
│   ├── config/
│   │   ├── env.js
│   │   └── ai.js
│   ├── ai/
│   │   ├── client.js
│   │   ├── prompts/
│   │   │   ├── parseEmail.js
│   │   │   ├── analyzeMessage.js
│   │   │   ├── replanProject.js
│   │   │   └── draftResponse.js
│   │   └── schemas/
│   ├── services/
│   │   ├── email.service.js
│   │   ├── pipeline.service.js
│   │   ├── project.service.js
│   │   ├── client.service.js
│   │   └── assignment.service.js
│   ├── routes/
│   │   ├── webhook.routes.js
│   │   ├── inbox.routes.js
│   │   ├── project.routes.js
│   │   ├── client.routes.js
│   │   ├── thread.routes.js
│   │   ├── response.routes.js
│   │   ├── team.routes.js
│   │   └── analytics.routes.js
│   ├── jobs/
│   │   ├── queue.js
│   │   ├── processEmail.job.js
│   │   └── escalation.job.js
│   └── utils/
│       └── emailParser.js
├── web/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── pages/
│   │   │   ├── Inbox.jsx
│   │   │   ├── Project.jsx
│   │   │   ├── Thread.jsx
│   │   │   ├── Client.jsx
│   │   │   ├── Team.jsx
│   │   │   └── Analytics.jsx
│   │   ├── components/
│   │   └── hooks/
│   ├── package.json
│   └── vite.config.js
├── package.json
├── ecosystem.config.js
├── .env.example
└── CLAUDE.md
```

---

## API Routes

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

# Responses
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

# Settings
GET    /api/settings/assignment-rules
POST   /api/settings/assignment-rules
GET    /api/settings/templates
POST   /api/settings/templates

# AI
POST   /api/ai/draft-response
POST   /api/ai/refine-response
POST   /api/ai/ask
```

---

## Environment Variables

```env
# Database
DATABASE_URL="file:./dev.db"

# Server
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key

# AI
ANTHROPIC_API_KEY=your-api-key

# Redis (for queues)
REDIS_URL=redis://localhost:6379

# Email webhook secret (validate incoming)
WEBHOOK_SECRET=your-webhook-secret
```

---

## Development Commands

```bash
# Install dependencies
npm install

# Database
npx prisma generate      # Generate client
npx prisma migrate dev   # Run migrations
npx prisma db seed       # Seed data
npx prisma studio        # Visual editor

# Development
npm run dev              # Start with hot reload
npm run dev:worker       # Start queue worker

# Build
npm run build            # Build frontend
npm run build:all        # Build everything

# Production
npm start                # Start production server
pm2 start ecosystem.config.js

# Testing
npm test
npm run test:watch

# Linting
npm run lint
npm run lint:fix
```

---

## Deployment (GitHub Actions)

On push to `main`:
1. Run tests and linting
2. Build frontend
3. Generate Prisma client
4. Create deployment package
5. SCP to Hostinger VPS
6. Run migrations
7. Restart PM2 processes

**Required GitHub Secrets:**
- `VPS_HOST` - Hostinger VPS IP/hostname
- `VPS_USER` - SSH username
- `VPS_SSH_KEY` - Private SSH key

---

## Development Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Project setup, database, auth
- [ ] Email webhook endpoint
- [ ] Basic AI pipeline (parse, match, analyze)
- [ ] Inbox view (list messages)
- [ ] Thread detail view
- [ ] Manual client/project CRUD

### Phase 2: Core Workflow (Week 3-4)
- [ ] AI auto-assignment
- [ ] Response composer + drafts
- [ ] Approval workflow
- [ ] Unmatched queue + resolution
- [ ] Project dashboard + AI plans

### Phase 3: Team Features (Week 5)
- [ ] Team management
- [ ] Assignment rules
- [ ] Workload views
- [ ] Notifications (in-app)

### Phase 4: Polish (Week 6)
- [ ] Search
- [ ] Analytics
- [ ] Email notifications
- [ ] Escalation rules
- [ ] SLA tracking

---

## Key Design Decisions

1. **Email forwarding over OAuth** - Simpler setup, no token management, works with any email provider

2. **SQLite to start** - Zero config, fast development, migrate to PostgreSQL when scale requires

3. **Approval required for all external comms** - Maintains quality control, builds response patterns

4. **AI at every step** - Not just analysis, but active participant in routing, planning, drafting

5. **Original always preserved** - Never lose source content, AI summaries are additive

6. **Confidence scores everywhere** - Know when to trust AI, when to verify

7. **Paste-based integrations** - Simple, reliable, no API maintenance for Slack/Figma/etc.
