# Agency Hub — Product Roadmap

## Vision
Replace Notion + Bonsai + Stripe + DocuSign + email threads with one AI-powered hub built for Ashbi Design.

---

## ✅ Phase 1 — Foundation (DONE)
- Client + contact management
- Project + task tracking (Notion-like)
- AI inbox (Mailgun → triage → draft response)
- Revision round tracking
- Team members + capacity
- Socket.io real-time notifications
- Bot API for external control

## ✅ Phase 2 — Agency Operations (DONE 2026-03-17)
- Client onboarding flow
- Retainer hour tracker + scope creep alerts
- Weekly AI report generator
- Lead intake form (public)

---

## 🔵 Phase 3 — Bonsai Replacement (NEXT)

### Proposals
- Proposal builder: select services, add scope, set pricing tiers
- AI-assisted scope writing from a brief
- PDF export with Ashbi branding
- Client approval link (no login required)
- Status: Draft → Sent → Viewed → Approved → Declined

### Contracts
- Contract templates (retainer, project-based, NDA)
- Digital signature via email link (no DocuSign needed — simple crypto signature)
- Signed PDF generation and storage
- Link proposals → contracts automatically

### Invoices
- Generate invoices from approved proposals or manual entry
- Line items: hours, flat fees, expenses
- Stripe payment link embedded in invoice email
- Status: Draft → Sent → Paid → Overdue
- Auto-reminders for overdue invoices

### Stripe Integration
- Connect Stripe account
- One-click payment links on invoices
- Recurring billing for retainer clients (monthly auto-charge)
- Webhook: payment confirmed → update invoice status + notify Cameron

---

## 🟡 Phase 4 — Notion Replacement

### Documents / Wiki
- Rich text pages per project (already partially built with Note model)
- Nested pages like Notion
- @mentions for team members
- Templates: Brand Guidelines, Project Brief, Meeting Notes

### Client Portal (separate domain: clients.ashbi.ca)
- Clients log in with email code (no password)
- See their projects, tasks, and milestones
- Download invoices + contracts
- Approve revision rounds
- Submit feedback / revision requests
- Real-time status without emailing back and forth

---

## 🟠 Phase 5 — Integrations

### Slack
- Incoming messages from client Slack channels → Agency Hub inbox
- Notifications pushed to your Slack when tasks are due or clients reply

### Notion (read-only sync)
- Pull existing Notion pages into Agency Hub projects
- One-time migration helper

### Google Calendar
- Sync milestones and meetings to Google Calendar
- Meeting prep tasks auto-created before scheduled calls

---

## Deployment Plan

| Phase | Timeline | Effort |
|-------|----------|--------|
| Phase 3 — Proposals + Contracts | Next session | 1 coding agent, ~2-3 hours |
| Phase 3 — Invoices + Stripe | After that | 1 coding agent, ~2 hours |
| Phase 4 — Client Portal | Week 2 | Larger — new subdomain, auth, UI |
| Phase 4 — Docs/Wiki | Week 2 | Extend existing Note model |
| Phase 5 — Slack | Week 3 | Webhook integration |
| Phase 5 — Google Cal | Week 3 | OAuth + API |

---

## Stack Notes
- All new routes follow existing Fastify patterns
- New Stripe routes need STRIPE_SECRET_KEY env var
- Client portal is a separate Next.js app at clients.ashbi.ca
- Digital signatures: use crypto HMAC — no third party needed
