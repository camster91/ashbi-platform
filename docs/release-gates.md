# Required release gates

`.github/workflows/release-gates.yml` is the canonical, reusable release
contract (`on: workflow_call`). It is invoked by exactly one workflow,
`.github/workflows/required-release-gates.yml` (`Required release gates`), which
runs on every pull request to `main`, on every push to `main` (so the merged
result is verified too), and on manual `workflow_dispatch`. A newer push to a
pull request cancels that pull request's in-progress run, but runs for pushes
to `main` are never cancelled, so every merge is verified.

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
  committed migration chain is applied with `prisma migrate deploy`) and Redis
  (the realtime adapter/emitter tests; the gate sets `REQUIRE_REDIS_TESTS=1`, so
  a missing Redis fails the run instead of skipping those tests);
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
The visual-regression baselines (`npm run test:visual`, see
[visual-baselines.md](visual-baselines.md)) are opt-in and not a release gate
until they are regenerated and proven stable on the CI runner.

The `production` and `staging` GitHub environments, if used, must restrict
deployment to `main`. These settings live outside Git and must be verified in
GitHub.

## Ownership and recovery

The repository owner (camster91) owns the required checks: the workflows,
their runners and minutes, and the branch-protection settings. Changes to
`.github/workflows/release-gates.yml`, `required-release-gates.yml` or
`scripts/check-release-gates.mjs` need the same review as application code;
the contract test above fails closed if a required command, service or job is
removed.

When the required checks do not run or do not report on a pull request:

1. Check GitHub Actions status and the repository's Actions settings
   (Settings → Actions → General): Actions enabled, workflow permissions,
   billing/minute limits. `Required release gates` must be enabled; it is the
   only workflow the contract needs (the reusable `release-gates.yml` runs as
   part of it even though it is not triggered on its own).
2. Re-run the workflow for the pull request's head commit from the Actions tab
   (or `workflow_dispatch` on the branch). Never mark a check as passed by
   hand, rename a job to satisfy protection, or merge with the checks
   bypassed.
3. If a required job fails for infrastructure reasons (runner loss, checkout
   or install failure before any test ran), re-run that job once; a second
   failure is treated as real and investigated from its logs and uploaded
   artifacts (`lighthouse-reports`, `required-browser-gate-failure-evidence`,
   `required-full-stack-gate-output`).
4. If the checks cannot run for a sustained period, releases stop: the
   deployment runbook requires the release gates to pass for the exact commit
   being shipped, and a local run does not replace them.

To prove the protection blocks a failing change, an administrator opens a
throwaway pull request that breaks one gate (for example a failing unit test),
confirms that GitHub reports the required check as failed and refuses to
merge, then closes the pull request without merging. Record the date and the
pull request link in the release evidence. This check needs repository-admin
access and cannot be automated from a pull request.
