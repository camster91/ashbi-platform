# ashbi-platform — State of the Build (2026-07-23)

> **Superseded / historical.** This 2026-07-23 build snapshot is retained for history only; its status and completion claims are not maintained. Use [docs/product-status.md](docs/product-status.md) (canonical status map) and roadmap issue [#393](https://github.com/camster91/ashbi-platform/issues/393) for current status.


**The PRODUCT_ROADMAP.md is stale.** Phase 3 is largely already implemented at the schema + route level. This document is the corrected state.

## What's actually built vs. what's in the roadmap

### ✅ Phase 1–2 (claimed done in roadmap → confirmed)
- 60+ route files in `src/routes/`
- 19 service files in `src/services/`
- Connection points, Socket.io, bot API, weeklyReport, timeTracking, retainer plans

### Phase 3 — Bonsai replacement (roadmap says "next", but largely built)

| Route / service | Status | Notes |
|---|---|---|
| `src/routes/proposal.routes.js` | ✅ Built | List, create, update, send, PDF, AI generation metadata, status FSM (DRAFT/SENT/VIEWED/APPROVED/DECLINED), viewToken, Mailgun |
| `src/routes/proposal-builder.routes.js` | ✅ Built | Separate builder route |
| `src/routes/contract.routes.js` | ✅ Built | Crypto signing via clientSigHash, three template types (RETAINER/PROJECT/NDA), send/signed FSM |
| `src/services/contractTemplates.service.js` | ✅ Built | |
| `src/routes/invoice.routes.js` | ✅ Built | Full CRUD, line items, Stripe, PDF, payments, reminders, recurring |
| `src/routes/invoice-chaser.routes.js` | ✅ Built | Auto-reminders |
| `src/services/stripe.service.js` | ✅ Built | Payment links + webhook handler |
| `src/routes/estimate.routes.js` | ✅ Built | Lightweight pre-proposal |
| `src/routes/expense.routes.js` | ✅ Built | Expense tracking |
| Frontend: Proposals.jsx, ProposalDetail.jsx, Contracts.jsx, Invoices.jsx, InvoiceDetail.jsx, PortalProposal.jsx, PortalContract.jsx, PortalInvoice.jsx | ✅ Built | |

**What's missing in Phase 3 (likely):**
- Real-world testing of the PDF templates (verify branding looks pro)
- Real-world testing of Stripe webhooks (Stripe is env-var-gated, may not be live)
- Frontend polish — these pages exist but probably need design pass

### Phase 4 — Notion replacement (roadmap "Planned")

| Route | Status |
|---|---|
| `src/routes/note.routes.js` | ✅ Built (basic) |
| `src/routes/client-portal.routes.js` | ✅ Built (PortalProposal/Contract/Invoice already wired) |
| `clients.ashbi.ca` subdomain | ❓ Unknown — need to check |

**Likely gaps in Phase 4:**
- nested pages (currently flat)
- templates gallery
- @mentions
- branded deliverable approval flow

### Phase 5 — Integrations (roadmap "Planned")

| Route | Status |
|---|---|
| `src/routes/slack.routes.js` (or similar) | 🔍 Need to check |
| `src/routes/calendar.routes.js` | ✅ Built |
| `src/routes/google-calendar/...` | ❓ TBD |
| Notion sync | ❓ TBD |

**Likely Phase 5 gap:** Slack inbound (client channels → Hub inbox) — the platform has Discord webhook integration per `INTEGRATIONS.md`, but Slack is unclear.

---

## Open GitHub issues — actual state

| # | Title | Reported | Actual state |
|---|---|---|---|
| #181 | `[P0] Bug: request.request.prisma` | 2026-06-02 | ✅ **Already fixed.** `grep -rn "request.request.prisma" src/` returns 0 matches. The fix predates the report. |
| #183 | `[P1] Unbounded findMany` | 2026-06-02 | ✅ **Already fixed at infrastructure level.** `src/utils/query-limits.js` exports `clampTake()`; `src/config/db.js` proxy auto-caps `findMany` to `take ≤ 100`. Code scanning the 8 reported lines shows all have `take: 5/10/200` (intentional). The issue body is stale. |
| #186 | `[P2] Dead TODO filter` | 2026-06-02 | ✅ **Already fixed.** `client-portal.routes.js:280` shows the filter IS assigned to `columns.TODO` and IS used in the response. |
| #187 | `[P2] CI partially failing` | 2026-06-02 | ⚠️ **Real.** 2 workflows failing since 2026-06-01 (deploy, enterprise-compliance). |

**Action:** close #181, #183, #186 with a "no longer reproducible" comment. Verify #187 against current CI status.

---

## What's actually missing (delta over current state)

### High priority
1. **Verify Phase 3 in production** — PDF generation, Stripe webhook, contract signing flow end-to-end
2. **Verify #187 CI workflows** — the platform CI is broken; can't ship anything new
3. **Notion 10-page migration** — moved clients' notes to Hub's Note model
4. **Slack integration** — out of 52 channels, no inbound to Hub yet

### Medium priority
5. **Phase 4 polish** — nested pages, @mentions, template gallery
6. **Time tracking front-end** — `timeTracking.service.js` exists but how mature is the UI?
7. **Pipeline view** (Bonsai) — `pipelineDeals` model exists, but does the UI deliver?

### Low priority (defer)
8. **Form builder** — currently single lead-intake form
9. **Cross-workspace search**
10. **Native Gantt/timeline**

---

## Recommended next 30 days

| Week | Action |
|---|---|
| 1 | Close #181, #183, #186. Verify #187 CI; fix if still broken. |
| 1 | Manual smoke test of full proposal → contract → invoice flow with Stripe sandbox. |
| 2 | Migrate 10 Notion pages into Hub. Build Slack inbound (Phase 5.1). |
| 3 | Polish Phase 4 (nested pages, templates). |
| 4 | Production verification + sunset Bonsai/Notion for new clients. |
