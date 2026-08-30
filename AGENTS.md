# SignGuy Slim Agent Instructions

## Repository Boundary

- This repository is `SIGNGUY-SLIM`, the independent Slim application.
- Do not modify the regular `SIGNGUY-MVP` working repository from this repo.
- Use `C:\Users\thesi\Documents\GitHub\SIGNGUY-MVP-REFERENCE` only as a
  read-only reference. Its push URL must remain `DISABLED`.
- Keep portability-contract changes in `SIGNGUY-DATA-PORTABILITY`; never mix
  files from the two repositories in one commit or pull request.

## Scope Boundary

- Version 2 Stages 1-6 are implemented and merged into `main`.
- The next explicitly authorized delivery is **combined Version 2 Stages 7-8**:
  Employee Announcements plus basic one-to-one Internal Employee Messages.
- Stages 7 and 8 must be implemented together as one bounded delivery using the
  existing Employee Portal, tenant/user identity, audit, optional SendGrid
  notification patterns, and backup/restore architecture. Do not create a
  second employee portal, messaging identity, notification store, or customer
  communication system.
- Version 2 Stage 9, Facebook Page Order Intake, is **deferred**. Do not create
  Stage 9 code, routes, pages, database models, migrations, dependencies,
  navigation, settings, placeholders, tests, feature flags, or scaffolding
  unless the user separately authorizes Stage 9 after required Meta business
  app/Page setup is available.
- Do not expose incomplete or deferred pages as disabled links, teaser cards,
  coming-soon pages, or customer-visible planning copy.
- The authoritative Version 2 roadmap is
  `docs/SIGNGUY_SLIM_VERSION_2_MASTER_BUILD_PLAN.md`.
- `docs/V1_REMAINING_IMPLEMENTATION_PLAN.md` is historical Version 1 planning
  material and must not override the current Version 2 roadmap or merged code.

## Combined Stages 7-8 Boundary

Authorized:

- Employee announcements with publish/start date, optional expiration, simple
  targeting, archive/edit audit history, and per-Employee read/unread state.
- Basic tenant-isolated one-to-one internal messages with immutable sent
  messages and unread/read state.
- Messages and Announcements inside the existing Employee Portal.
- Owner/admin announcement management in the existing Team area or smallest
  appropriate Team subview.
- Optional SendGrid notification email when configured, without using SendGrid
  as announcement storage or internal message transport.
- Additive migrations, backend permissions, audit, backup/restore coverage,
  tests, documentation, and regression validation needed for both capabilities.

Not authorized in Stages 7-8:

- Facebook/Meta integration or Stage 9 scaffolding.
- Group chat, channels, message attachments, reactions, typing indicators,
  presence, voice, video, or social-feed features.
- Customer Portal, SMS, Pricing Engine, AI, Webstores, accounting, inventory,
  production time tracking, or other full-product modules.

## Technical-Debt Guardrails

- Read `docs/SLIM_TECHNICAL_DEBT_REGISTER.md` before implementation.
- Do not introduce another independent production-state source.
- Avoid worsening the `backend/src/services.js` and `src/App.jsx` monoliths when
  new Stage 7-8 code can be safely extracted into focused modules.
- Keep customer communication history and internal employee messaging as
  separate domains even when infrastructure patterns are reused.

## Required Validation

Run these before handoff after code changes:

```powershell
npm ci
npm run backend:migrate
npm run test
npm run guard
npm run build
```

Also run `git diff --check` and preserve the user-owned untracked `artifacts/`
folder without staging, deleting, cleaning, or modifying it.
