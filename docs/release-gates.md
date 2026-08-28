# Required release gates

`.github/workflows/release-gates.yml` is the canonical release contract. Pull
requests invoke it through `Required release gates`; production and staging
deploy workflows invoke the same reusable workflow and declare
`needs: release-gates`, so deployment cannot begin after a failed gate.

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

Repository administrators must protect `main` and require these three checks
(the exact names emitted by the first pull-request run):

1. `Required release gates / Type, lint, unit, integration, and build`
2. `Required release gates / Browser and accessibility smoke`
3. `Required release gates / Full-stack E2E smoke`

The `production` and `staging` GitHub environments must restrict deployment to
`main`. Production should require an authorized reviewer. These settings live
outside Git and must be verified in GitHub after this workflow change merges.
