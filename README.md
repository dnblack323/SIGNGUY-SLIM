# SignGuy Slim

Independent slim sign-shop operations application for the Version 1 workflow.

This repository is intentionally separate from `SIGNGUY-MVP`. Version 1 Part 1
contains only the constrained shell, scope guards, reuse audit, architecture
boundary, and implementation plans. Feature implementation for Customers,
Estimates, Orders, Invoices, Production, Calendar, attachments, backup/restore,
and MVP import is deferred to later separately authorized Version 1 parts.

## Commands

```powershell
npm install
npm run test
npm run guard
npm run build
```

## Scope

Authorized in this branch:

- Version 1 Part 1 shell and documentation.
- Version 1 source/import exclusion guards.
- Reuse map and remaining Version 1 implementation plans.

Not authorized here:

- Version 1 Part 2-7 feature workflows.
- Any Version 2 code, placeholders, dependencies, routes, pages, tests, models,
  or navigation.
