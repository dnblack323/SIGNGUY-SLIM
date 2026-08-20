# SignGuy Slim

Independent slim sign-shop operations application for the Version 1 workflow.

This repository is intentionally separate from `SIGNGUY-MVP`. Version 1 Part 2
adds the independent Slim backend/database foundation, secure app auth, tenant
boundaries, company settings, Customers, Quick Entry, Estimates, direct Orders,
Estimate-to-Order conversion, Invoices, manual invoice payment status, Estimate
and Invoice PDFs, and a basic arithmetic calculator.

## Commands

```powershell
npm ci
npm run backend:migrate
npm run backend:dev
npm run test
npm run guard
npm run build
```

## Scope

Authorized in this branch:

- Version 1 Part 1 shell and documentation.
- Version 1 source/import exclusion guards.
- Version 1 Part 2 persisted backend and frontend workflows.
- GitHub Actions CI for migration, tests, guard, and production build.

Not authorized here:

- Version 1 Parts 3-7 feature workflows.
- Any Version 2 code, placeholders, dependencies, routes, pages, tests, models,
  or navigation.
