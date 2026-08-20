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

## Money Rules

Slim stores money as integer cents and Quick Entry quantities as decimal strings
with up to four fractional digits. Line totals use half-up rounding to the
nearest cent after multiplying quantity by unit price. Document-level discounts
are allocated proportionally between taxable and non-taxable line totals before
sales tax is calculated. Manually recorded invoice payments cannot exceed the
invoice total because Version 1 Part 2 has no credit-balance model.

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
