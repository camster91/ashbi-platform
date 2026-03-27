# TASK: Build Email Communications & Project Context System

## What you're building:
A system where the email agent can log client email communications to Hub projects, maintain running AI context per project, and support smart Gmail draft creation.

## 1. Prisma Schema Changes (prisma/schema.prisma)

Add these new models:

**ProjectCommunication** - logs email exchanges per project:
- id (cuid)
- projectId (relation to Project)
- gmailThreadId (String, for thread grouping)
- gmailMessageId (String, unique - prevents duplicate imports)
- from (String)
- to (String) 
- subject (String)
- bodySnippet (String - first 500 chars)
- fullBody (String - complete email body)
- direction (String: INBOUND / OUTBOUND)
- sentiment (String? - AI classified)
- summary (String? - AI one-liner)
- actionItems (String? - JSON array extracted by AI)
- account (String - which inbox: cameron@ashbi.ca or bianca@ashbi.ca)
- receivedAt (DateTime)
- createdAt, updatedAt
- Index on [projectId, receivedAt]
- Index on [gmailMessageId] unique

**ProjectContext** - running AI summary + human notes per project:
- id (cuid)
- projectId (String, unique relation to Project)
- aiSummary (String - compacted running context)
- humanNotes (String? - free-form notes by Cameron/Bianca)
- lastCompactedAt (DateTime?)
- compactionVersion (Int, default 0)
- emailCount (Int, default 0 - total emails tracked)
- createdAt, updatedAt

**ClientEmailMapping** - maps email addresses to clients for auto-matching:
- id (cuid)
- clientId (relation to Client)
- emailAddress (String)
- emailDomain (String?)
- contactName (String?)
- isPrimary (Boolean, default false)
- createdAt
- Unique on [emailAddress, clientId]

Also update the **Project** model to add relations:
- communications ProjectCommunication[]
- context ProjectContext?

Update **Client** model to add:
- emailMappings ClientEmailMapping[]

## 2. Bot API Routes (src/routes/bot.routes.js - extend existing)

Add these endpoints (all require bot auth header):

**POST /api/bot/communications** - Log an email to a project
Body: { projectId, gmailThreadId, gmailMessageId, from, to, subject, bodySnippet, fullBody, direction, sentiment?, summary?, actionItems?, account, receivedAt }
- Upsert by gmailMessageId (prevents duplicates on re-scan)
- Auto-increment emailCount on ProjectContext
- Return the created/updated communication

**GET /api/bot/communications/:projectId** - Get email history for a project
Query params: limit (default 20), offset, since (datetime)
- Returns communications ordered by receivedAt DESC
- Include summary and actionItems (not fullBody by default)
- ?full=true to include fullBody

**POST /api/bot/context/:projectId** - Update project context
Body: { aiSummary?, humanNotes?, compactionVersion? }
- Creates ProjectContext if doesn't exist
- Only updates provided fields
- Sets lastCompactedAt if aiSummary changed

**GET /api/bot/context/:projectId** - Get project context
- Returns aiSummary, humanNotes, lastCompactedAt, compactionVersion, emailCount
- Also returns last 5 communications (with summaries) for quick context

**GET /api/bot/client-email-map** - Get all client email mappings
- Returns flat list: [{ clientId, clientName, emailAddress, emailDomain, contactName }]
- Used by email agent to match incoming emails to clients

**POST /api/bot/client-email-map** - Add/update email mapping
Body: { clientId, emailAddress, emailDomain?, contactName?, isPrimary? }
- Upsert by [emailAddress, clientId]

**POST /api/bot/gmail-draft** - Create a Gmail draft (via stored OAuth tokens)
Body: { account (cameron or bianca), to, subject, body, inReplyTo?, threadId? }
- Uses the OAuth tokens stored in the workspace memory folder
- Creates a draft in the specified accounts Gmail
- Returns draftId
- Token paths:
  - cameron: C:/Users/camst/.openclaw/workspace/memory/google-tokens.json  
  - bianca: C:/Users/camst/.openclaw/workspace/memory/google-tokens-bianca.json

## 3. React UI (web/src/)

Add a Communications tab to the project detail page:

**Communications Timeline** (web/src/components/project/ProjectCommunications.jsx):
- Timeline view of emails, newest first
- Each entry shows: date, from, subject, summary, direction badge (IN/OUT), sentiment indicator
- Click to expand full body
- Action items highlighted in yellow
- Filter by direction (all/inbound/outbound)

**Project Context Card** (web/src/components/project/ProjectContext.jsx):
- Shows AI Summary (read-only, with last compacted date)
- Editable Human Notes field (auto-saves on blur)
- Email count badge

Add both to the project detail page as new tabs or sections.

## 4. Migration
After schema changes, generate the Prisma migration:
npx prisma migrate dev --name add-email-communications-context

## Important Notes:
- Follow existing code patterns in the repo
- Check existing auth middleware pattern for bot routes in bot.routes.js
- Use existing Prisma client setup
- The Gmail draft endpoint needs googleapis package - check if already in package.json, add if not
- Keep the UI consistent with existing project page styling
- All bot endpoints should validate required fields and return proper error responses
