# Pull request handoff: Ashbi unified platform candidate

**Prepared:** 2026-08-28

**Repository:** `camster91/ashbi-platform` (private)

**Base:** `main` at `6522707b0865ec66291471561cebab84e5c31762`

**Head branch:** `codex/unified-company-strategy`

**Prepared-from head:** `144784d0ca1ab82eddcfacb7e5fcba756afaf574`

**External action status:** Not authorized. Do not open, merge, deploy, import, bill, email, or retire a provider from this handoff alone.

This file makes the candidate reviewable without claiming that it is launch-ready. At pull-request creation time, replace `{{PR_HEAD_SHA}}` below with the exact output of `git rev-parse HEAD`, confirm the base has not moved unexpectedly, and retain the resulting private Actions run URLs.

## Proposed title

`feat: add unified Ashbi growth and operations candidate`

## Proposed pull request body

```markdown
## Primary issue and slice

Relates to #277, #280, #283, #289, #290, #291, #378, #379, #380, and #381.

Outcome: Establish a locally validated candidate for Ashbi.ca acquisition and Hub-based agency operations, including controlled Notion/Bonsai migration review and evidence-bound finance workflows.

Why this is one independently reviewable slice: This is an integration candidate spanning the public acquisition contract, internal operating workflows, migration controls, commercial lifecycle, and release evidence. It is intentionally not presented as launch-ready. Review should follow the ordered review map below, and none of the linked issues are closed by this PR.

Exact PR head: `{{PR_HEAD_SHA}}`

## Change summary

- Add governed Ashbi.ca inquiry capture, qualification, attribution, Hub review, and weekly growth-review evidence.
- Add tenant-scoped pipeline, proposal, contract, invoice, payment, refund, settlement, email-delivery, reporting, and client-delivery controls.
- Add checksum-bound Notion/Bonsai source verification, migration-review packets, disposition workflows, and fail-closed cutover evidence.
- Add idempotency, tenancy, approval, audit, migration, rollback, and release-gate controls around provider-sensitive workflows.
- Add 22 Prisma migration files for the candidate schema changes.
- Harden production dependency auditing for both backend and frontend lockfiles and document the remaining development-only upstream advisory.
- Add canonical status, launch-readiness, deployment-readiness, reconciliation, and operator documentation.

## Acceptance criteria

- [x] The linked issues remain open because target/provider/human evidence is still pending.
- [x] Target environment is named: isolated Ashbi Hub staging is required but not yet provisioned.
- [x] Local source validation and remaining target-environment gates are recorded in `docs/unified-platform-deployment-readiness-2026-08-28.md`.
- [ ] Required hosted checks pass for this exact PR head.
- [x] The complete 39-migration chain, including all 22 candidate migrations, and zero-drift check pass against isolated local PostgreSQL 16 with pgvector 0.8.3.
- [ ] The complete migration chain and zero-drift check pass on the named isolated staging target.
- [ ] Authenticated staff/client and synthetic acquisition-to-Stripe-test-payment journeys pass in staging.
- [ ] Approved Notion/Bonsai bundles are imported only in sandbox and reconcile with zero unresolved findings.
- [ ] Parallel-run, backup/restore, financial reconciliation, and Cameron's post-evidence cutover approval are attached before any Bonsai retirement.

## Verification

Automated commands and results:

```text
npm ci                                      PASS
npm ci --prefix web                         PASS
npm audit --omit=dev --audit-level=high     PASS, 0 production vulnerabilities
npm --prefix web audit --omit=dev --audit-level=high
                                            PASS, 0 production vulnerabilities
npx prisma validate                         PASS
npx prisma generate                         PASS
npm run type-check                          PASS
npm run lint                                PASS
npm test                                    PASS, 947 backend unit tests
npm run test:all                            PASS, 964 passed, 0 failed, 0 skipped
npm test --prefix web                       PASS, 517 frontend tests
npm run build                               PASS
frontend budgets                            PASS
Lighthouse CI                               PASS, 3 mobile and 3 desktop runs
release-gate contract                       PASS locally
```

The current full backend unit/integration suite passes with 964 tests against the isolated PostgreSQL/pgvector rehearsal database. All 39 migrations apply and the exact drift command reports no difference. Hosted Required release gates have not run. Local proof does not establish target deployment, target migration execution, provider delivery, production payment, accessibility, or reconciliation success.

Manual checks and evidence:

- Source and governance audit: `docs/unified-platform-deployment-readiness-2026-08-28.md`
- Complete local pgvector migration rehearsal: `docs/unified-platform-migration-rehearsal-2026-08-28.md`
- Canonical capability status: `docs/product-status.md`
- Launch evidence contract: `docs/unified-launch-readiness.md`
- Replacement evidence contract: `docs/replacement-readiness-matrix.md`
- Bonsai reconciliation decision order: `docs/bonsai-reconciliation-decision-order-2026-08-28.md`
- Deployment and rollback: `docs/deployment-and-rollback.md`

## Risk gates

- Security and tenant isolation: Local tests and production audits pass. Target secrets, headers, tenancy, and access controls still require authenticated staging evidence. One unpatched development-only `extract-zip` advisory remains through Lighthouse tooling; it is not in either production dependency graph.
- Privacy, retention, and sensitive logging: Source controls exist; retention, e-signature evidence, and production credential custody remain externally approved gates.
- Accessibility: Automated local checks exist; physical Safari/iOS, forced-colour, keyboard, reflow, and human assistive-technology evidence remain pending.
- Performance: Local budgets and Lighthouse pass; target performance remains unverified.
- Browser/mobile/API/plugin compatibility: Local automated coverage exists; authenticated target Chromium, Firefox, WebKit, mobile, provider, and recovery flows remain pending.

## Migration, deployment, and rollback

- Schema or data migration: 22 committed Prisma migrations are introduced. Shared targets must use `prisma migrate deploy` and the exact schema-drift gate; `db push` is forbidden for release evidence.
- Backup or restore prerequisite: Verified isolated backup and restore evidence is required before staging promotion or any source import.
- Deployment target and immutable artifact: No target is authorized. Any staging handoff must bind the exact passing Required run URL, full Git SHA, and immutable artifact IDs.
- Previous known-good artifact/configuration: Record the currently deployed revision and configuration backup at action time; do not infer them from this PR.
- Rollback or repair steps and owner: Follow `docs/deployment-and-rollback.md`; Cameron retains production, provider, billing, DNS, import, and cutover approvals.
- Post-release observation window: Define and record the staging observation window before promotion; production and Bonsai retirement are separate later approvals.

## Release notes

Category: Added / Changed / Security / Migration / Known issue

Entry and user/operator impact: Adds a candidate unified acquisition and agency-operations system with evidence-bound migration and financial controls. It is not a production launch, provider cutover, data import, or authorization to retire Bonsai.

## Independent review

- [ ] Draft until hosted automated and applicable manual checks pass.
- [ ] Reviewer is independent of the implementation.
- [ ] Security/privacy/data/auth/finance/deployment-sensitive changes have an appropriate reviewer.
- [x] No direct push or failed-check bypass is required.

## Ordered review map

1. Release, security, tenancy, migration, rollback, and approval boundaries.
2. Prisma schema and all 22 migration files.
3. Finance and provider-sensitive proposal-to-settlement workflows.
4. Notion/Bonsai capture, comparison, decision, import, reconciliation, and cutover gates.
5. Ashbi.ca inquiry, Hub review, pipeline, growth cadence, reporting, and client-delivery workflows.
6. Frontend behavior, accessibility, responsive states, and documentation consistency.

## Known external gates

- No isolated staging deployment or hosted Required run exists.
- No provider journey has been executed for Stripe test mode, transactional email, or e-signature evidence.
- Notion/Bonsai packets remain unapplied: 24 project links, 88 task dispositions, 238 project dispositions, 65 active-project outcomes, and 117 financial exceptions remain pending.
- The 20 source-backed owner decisions (19 Cameron, 1 Bianca) are recorded as evidence only and have not changed Bonsai or Hub records.
- No production/provider/Bonsai/Notion/Stripe mutation is authorized by this PR.
- Bonsai retirement remains prohibited until sandbox validation, parallel operation, zero-unresolved reconciliation, recoverable backups, and Cameron's explicit post-evidence financial cutover approval.
```

## Action-time preflight and creation command

Run only after Cameron explicitly approves opening the private PR and possible GitHub Actions usage:

```powershell
$repo = 'C:\Users\camst\Documents\Codex\2026-08-26\we-need-to-check-x20-4\work\ashbi-platform-strategy'
$head = git -C $repo rev-parse HEAD
$base = git -C $repo rev-parse origin/main
git -C $repo status --short --branch
gh pr list --repo camster91/ashbi-platform --head codex/unified-company-strategy --state all
```

Confirm the worktree is clean, the head is the intended pushed revision, no duplicate PR exists, and any base movement is reviewed. Then copy the proposed body to a temporary file, replace `{{PR_HEAD_SHA}}` with `$head`, and run:

```powershell
gh pr create --repo camster91/ashbi-platform --base main --head codex/unified-company-strategy --title 'feat: add unified Ashbi growth and operations candidate' --body-file <prepared-body-file> --draft
```

Do not merge, enable auto-merge, dispatch deployment, import data, change providers, or dismiss dependency alerts as part of PR creation.
