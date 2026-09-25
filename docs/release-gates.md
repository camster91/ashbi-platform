# Required release gates

`.github/workflows/release-gates.yml` is the canonical, reusable release
contract (`on: workflow_call`). It is invoked by exactly one workflow,
`.github/workflows/required-release-gates.yml` (`Required release gates`), which
runs on every pull request to `main`, on every push to `main` (so the merged
result is verified too), and on manual `workflow_dispatch`.

No GitHub workflow deploys the application. Production and staging are deployed
by an operator with `scripts/deploy-vps-direct.sh` after the release gates pass
for the exact commit being shipped; see `docs/deployment-and-rollback.md`.

The canonical gate owns these blocking checks:

- secret leak scan (`npm run check:secrets`, which runs
  `scripts/check-secrets.mjs` offline against the checkout and exits non-zero on
  any finding without printing matched values);
- release gate contract (`npm run check:release-gates`, a static check of the
  workflows and deployment scripts);
- production dependency audit (`npm audit --omit=dev --audit-level=high`, backend
  and frontend);
- package-boundary validation;
- backend type check and backend/frontend lint;
- backend unit and integration tests against PostgreSQL with pgvector (the
  committed migration chain is applied with `prisma migrate deploy`);
- frontend unit tests;
- the production build, frontend performance budgets and Lighthouse budgets;
- desktop, mobile, and accessibility browser smoke, public-route splitting and
  PWA offline policy;
- full-stack E2E smoke (Postgres, Redis, worker and API in Docker).

`npm run check:release-gates` rejects missing commands (including the secret
scan), deployment bypasses, and any `continue-on-error: true` in a workflow. Its
unit test (`src/tests/unit/release-gates.test.js`) injects representative
failures and proves the contract fails closed.

Repository administrators must protect `main` and require these three checks
(the exact names emitted by the pull-request run):

1. `Required release gates / Type, lint, unit, integration, and build`
2. `Required release gates / Browser and accessibility smoke`
3. `Required release gates / Full-stack E2E smoke`

The secret scan runs inside check 1, so it is enforced even if the standalone
`.github/workflows/check-secrets.yml` (`Secret leak gate`) is disabled in the
Actions UI. That standalone workflow still exists and additionally runs the
scanner's negative regression fixtures; it is advisory, not a required check.

Other workflows in `.github/workflows/` (`enterprise-compliance.yml`,
`codeql.yml`, `pr-review.yml`, `build-and-push.yml`, `browser-e2e.yml`,
`db-backup.yml`) are supplementary and are not part of the required contract.

The `production` and `staging` GitHub environments, if used, must restrict
deployment to `main`. These settings live outside Git and must be verified in
GitHub.
