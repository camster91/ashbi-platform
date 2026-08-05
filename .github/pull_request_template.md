## Primary issue and slice

Closes #

Outcome:

Why this is one independently reviewable slice:

## Change summary

- 

## Acceptance criteria

- [ ] The linked issue's acceptance criteria are mapped here and pass.
- [ ] Target environment is named: 
- [ ] Target-environment evidence is linked or recorded: 

## Verification

Automated commands and results:

```text
npm ci --no-audit --no-fund
npm ci --no-audit --no-fund --prefix web
npx prisma generate
npm run type-check
npm run lint
npm test
npm test --prefix web
npm run build
```

Manual checks and evidence:

## Risk gates

- Security and tenant isolation: 
- Privacy, retention, and sensitive logging: 
- Accessibility: 
- Performance: 
- Browser/mobile/API/plugin compatibility: 

Use `Not applicable` only with a reason.

## Migration, deployment, and rollback

- Schema or data migration: 
- Backup or restore prerequisite: 
- Deployment target and immutable artifact: 
- Previous known-good artifact/configuration: 
- Rollback or repair steps and owner: 
- Post-release observation window: 

## Release notes

Category: Added / Changed / Fixed / Security / Migration / Known issue / No release note

Entry and user/operator impact:

## Independent review

- [ ] Draft until automated and applicable manual checks pass.
- [ ] Reviewer is independent of the implementation.
- [ ] Security/privacy/data/auth/finance/deployment-sensitive changes have an appropriate reviewer.
- [ ] No direct push or failed-check bypass is required.
