# SignGuy Slim Agent Instructions

## Repository Boundary

- This repository is `SIGNGUY-SLIM`, the independent Slim application.
- Do not modify the regular `SIGNGUY-MVP` working repository from this repo.
- Use `C:\Users\thesi\Documents\GitHub\SIGNGUY-MVP-REFERENCE` only as a
  read-only reference. Its push URL must remain `DISABLED`.
- Keep portability-contract changes in `SIGNGUY-DATA-PORTABILITY`; never mix
  files from the two repositories in one commit or pull request.

## Scope Boundary

- Version 2 Stages 1-8 are implemented and merged into `main`.
- Hardening Groups A-D are complete in the current code baseline once PR #14 is
  merged. Group D modularized Employee, Time, Pay, Employee Announcements, and
  Internal Employee Messages while preserving the existing Employee Portal,
  tenant/user identity, audit, backup/restore architecture, and route/API
  behavior.
- Group E general monolith decomposition and Group F auth/session transport
  changes remain future work unless separately authorized.
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

## Employee Domain Boundary

Authorized:

- Employee administration, active/portal/pay-management flags, and
  effective-dated rates.
- Time Clock and Time & Attendance review using authoritative time-entry source
  rows.
- Saturday-Friday internal weekly pay summaries using derived open-week totals,
  immutable closed-week snapshots, and ledger source rows.
- Employee announcements with publish/start date, optional expiration, simple
  targeting, archive/edit audit history, and per-Employee read/unread state.
- Basic tenant-isolated one-to-one internal messages with immutable sent
  messages and unread/read state.
- Messages and Announcements inside the existing Employee Portal.
- Owner/admin announcement management in the existing Team area.
- Backend/frontend extraction that preserves existing public service APIs,
  routes, permissions, tests, backup/restore behavior, and product wording.

Not authorized in Group D:

- Facebook/Meta integration or Stage 9 scaffolding.
- Group chat, channels, message attachments, reactions, typing indicators,
  presence, voice, video, or social-feed features.
- Customer Portal, SMS, Pricing Engine, AI, Webstores, accounting, inventory,
  production time tracking, external payroll/accounting integrations, or other
  full-product modules.
- Group E general monolith decomposition, Group F auth/session transport
  changes, or any unrelated feature work.

## Technical-Debt Guardrails

- Read `docs/SLIM_TECHNICAL_DEBT_REGISTER.md` before implementation.
- Do not introduce another independent production-state source.
- Avoid worsening the `backend/src/services.js` and `src/App.jsx` monoliths when
  authorized domain code can be safely extracted into focused modules.
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
