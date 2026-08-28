# Required release gates

`.github/workflows/release-gates.yml` is the canonical release contract. Pull
requests and approved manual workflow dispatches invoke it through `Required
release gates`. GitHub Actions does not deploy staging or production; the sole
deployment controller is `scripts/deploy-vps-direct.sh`. Before any manual VPS
deployment, the operator must retain the passing Required release-gates run URL,
its exact full commit SHA, and the immutable deployment artifact identifiers.
An Actions environment setting does not gate the direct-VPS script by itself.

The canonical gate owns these blocking checks:

- package-boundary validation;
- high-severity production dependency audits for both backend and frontend lockfiles;
- backend and frontend type/lint checks;
- backend unit and integration tests against PostgreSQL with pgvector;
- frontend unit tests;
- desktop, mobile, and accessibility browser smoke;
- full-stack WordPress/hub E2E smoke;
- the production build.

`npm run check:release-gates` rejects missing commands, deployment bypasses,
and any `continue-on-error: true` in a workflow. Its unit test also injects
representative failures and proves the contract fails closed.

As verified through the GitHub API on 2026-08-28, `main` is protected, requires
the branch to be current, enforces the policy for administrators, requires
conversation resolution, blocks force-push and deletion, and requires these
three checks:

1. `Required release gates / Type, lint, unit, integration, and build`
2. `Required release gates / Browser and accessibility smoke`
3. `Required release gates / Full-stack E2E smoke`

The `production` and `staging` GitHub environments currently restrict deployment
to protected branches. Neither has a required reviewer, and no current workflow
references either environment. If an Actions deployment controller is ever
introduced, production must gain an authorized reviewer and the workflow must
use that environment. For the current direct-VPS controller, the signed-off
deployment handoff is the human approval boundary.
