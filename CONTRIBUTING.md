# Contributing to Ashbi Platform

This document is the authoritative repository delivery policy. If another document
conflicts with it about branches, pull requests, verification, review, or issue closure,
this document wins. `PRODUCTION_DEPLOYMENT.md` remains authoritative for production
operations, and the issue's accepted criteria remain authoritative for product behavior.

## One issue, one reviewable slice

1. Start from current `main` with an accepted GitHub issue.
2. Create `agent/<issue-number>-<short-description>`. Do not push directly to `main`.
3. Keep the branch limited to one independently reviewable outcome. Split unrelated or
   follow-up work into linked issues and branches.
4. Open a draft pull request as soon as the approach is concrete. Complete every section
   in the repository pull-request template and link the primary issue.
5. Request independent review only after automated checks and the applicable manual
   checks pass. The author cannot be the only reviewer of security-, privacy-, data-,
   migration-, finance-, authentication-, or deployment-sensitive work.
6. Merge by squash after required checks and review pass. Never bypass a failed check to
   meet a schedule.
7. Close the issue only after its acceptance criteria pass in the named target
   environment. A merged PR alone is not acceptance evidence.

## Local verification

Use the Node/npm versions declared by the repository and install only from lockfiles:

```bash
npm ci --no-audit --no-fund
npm ci --no-audit --no-fund --prefix web
npx prisma generate
npm run type-check
npm run lint
npm test
npm test --prefix web
npm run build
```

Run the following when the changed paths or acceptance criteria require them:

```bash
npm run test:integration
npm run test:e2e:setup
npm run test:e2e
npm run test:e2e:teardown
```

Do not report a command as passing if it did not run. Record failures and distinguish a
change regression from a confirmed default-branch failure.

## Required pull-request gates

Every pull request records the applicable result for:

- correctness and automated tests;
- security and tenant isolation, including secret scanning;
- privacy, retention, and sensitive logging;
- keyboard, screen-reader, contrast, and reduced-motion accessibility;
- public-route and bundle performance impact;
- supported browser, mobile, API, plugin, and data compatibility;
- schema/data migration, rollback, and backup prerequisites;
- target-environment acceptance and operational observation.

Use `Not applicable` only with a reason. Security, privacy, migrations, and rollback are
fail-closed: an unknown result blocks merge.

## Database and deployment changes

- Never edit production data or rewrite repository history as an implicit PR step.
- Include forward migration, rollback/repair, backup, compatibility, and rehearsal notes.
- Promote the already-tested immutable artifact; do not rebuild different code during
  deployment.
- Record the target environment, release identifier, previous known-good identifier,
  validation evidence, rollback owner, and observation window.
- Stop and obtain the named owner or approver when credentials, legal/privacy policy,
  destructive data work, or production access is required.

## Release notes

Every user-visible, operational, security, schema, or compatibility change adds a short
entry to the pull request's Release notes section. The release owner compiles merged
entries into the GitHub release, grouped as Added, Changed, Fixed, Security, Migration,
and Known issues. Internal refactors may use `No release note` with a reason.

Release and rollback evidence belongs on the pull request or linked issue, without
credentials, tokens, personal data, or sensitive production output.
