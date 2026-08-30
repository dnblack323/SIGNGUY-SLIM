# SignGuy Slim Agent Instructions

## Repository Boundary

- This repository is `SIGNGUY-SLIM`, the independent Slim application.
- Do not modify the regular `SIGNGUY-MVP` working repository from this repo.
- Use `C:\Users\thesi\Documents\GitHub\SIGNGUY-MVP-REFERENCE` only as a
  read-only reference. Its push URL must remain `DISABLED`.
- Keep portability-contract changes in `SIGNGUY-DATA-PORTABILITY`; never mix
  files from the two repositories in one commit or pull request.

## Scope Boundary

- Current authorized scope includes Version 2 Stages 1-6 as implemented through
  the active SignGuy Slim PR sequence.
- Do not create Stage 7+ code, routes, pages, database models, migrations,
  dependencies, navigation, placeholders, tests, feature flags, or scaffolding
  unless the user explicitly authorizes that later-stage work.
- Do not expose incomplete pages as disabled links, teaser cards, coming-soon
  pages, or customer-visible planning copy.

## Required Validation

Run these before handoff after code changes:

```powershell
npm ci
npm run test
npm run guard
npm run build
```
