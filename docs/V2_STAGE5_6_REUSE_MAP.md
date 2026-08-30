# Version 2 Stages 5-6 Reuse Map

Base commit: `c79e6e7953d7ebe8221ffe82d3b2c5f41211b88a`

Branch: `codex/v2-stages-5-6-time-pay`

## Scope

Stages 5 and 6 add employee administration, employee self-service time clock,
manager time review, and internal weekly pay summaries. They do not add
bookkeeping, sales-tax filings, payment-provider payroll, employee scheduling
automation, HR onboarding, public employee portals, accounting exports, Stage 7+
navigation, or integrations outside the local Slim app.

## Reused Components

| Area | Reuse decision | Evidence |
| --- | --- | --- |
| App shell | Reused | Employees, Time & Attendance, Payroll, and Employee Portal routes use the existing sidebar/module/tab/ribbon shell rather than a separate employee app. |
| Settings users | Reused | Employee records link to existing tenant users and reject cross-tenant or duplicate active user relationships. |
| Authorization | Reused and narrowed | Employee administration uses existing owner/admin gates; sensitive pay views and rate/ledger actions require owner or explicit employee pay-management permission. |
| Audit | Reused | Employee, rate, clock, correction, void, advance, adjustment, manual payment, close, and reopen actions write through the existing authenticated audit pipeline. |
| Backup/restore | Adapted | The encrypted Slim backup format now includes employee, rate, time, pay-week, and pay-ledger sections with tenant and relationship validation. |

## Additive Schema

Migration `012_v2_stage5_6_time_pay.sql` creates employee time and pay tables:

- `employees`: tenant-scoped employee records linked to existing users.
- `employee_rates`: effective-dated hourly rates.
- `employee_time_entries`: open, closed, and voided time entries with immutable
  rate snapshots, duration, correction, and void metadata.
- `employee_pay_weeks`: Saturday-Friday internal pay summaries with Friday
  payday, opening/closing carryover, close/reopen metadata, and rate breakdown
  snapshots.
- `employee_pay_advances`, `employee_pay_adjustments`, and
  `employee_pay_manual_payments`: pay-ledger records that can be voided without
  deleting history.

The migration is additive. It does not alter existing customer, Estimate, Order,
Invoice, attachment, calendar, intake, or communication tables.

## Permission Model

Owners can manage pay by role. Non-owner users must be active employees with
portal access and `pay_management_enabled` before they can see internal pay
summaries, rates, advances, adjustments, or manual payments. Standard managers
can review and correct time entries, but they do not receive sensitive pay data
unless explicitly granted pay-management access.

Employee portal endpoints resolve the authenticated user to a same-tenant active
employee record. They return only that employee's time clock and My Pay data.

## Time And Pay Rules

Clock-in is idempotent when an open entry already exists. Clock-out is
idempotent when no open entry exists. The server computes durations from stored
instants, snapshots the applicable effective-dated hourly rate at clock-in, and
flags shifts over 16 hours as implausible instead of silently discarding them.

Pay weeks run Saturday through Friday, with Friday as the payday. Open summaries
recalculate from valid closed time entries and non-voided ledger records. Closed
weeks preserve their snapshot and reject time or ledger changes until reopened.
Reopening an earlier closed week is blocked when a later week is already closed,
so carryover changes do not silently rewrite finalized downstream pay history.

The displayed formula is:

`Estimated Amount Due = Opening Carryover + Gross Pay + Positive Adjustments - Negative Adjustments - Advances - Manual Payments`

## Backup And Restore

Backup export includes the new employee sections in dependency order. Restore
preview and restore validation reject cross-tenant employee, rate, time-entry,
pay-week, advance, adjustment, and manual-payment relationships. Linked employee
users must map to a target tenant user, preserving the user-to-employee boundary
instead of restoring sensitive employee records against the wrong actor.

Employee sequence state is included so restored tenants continue issuing
`EMP-####` numbers after the restored maximum.

## Validation

Focused coverage was added for:

- same-tenant employee/user linking and duplicate active-link rejection;
- portal disabled and inactive employee rejection;
- explicit pay-management permission;
- idempotent clock-in and clock-out;
- overnight and daylight-saving duration handling;
- overlap rejection, correction audit, voided time totals, and implausible shift
  flags;
- Saturday-Friday pay-week math, effective-dated rate snapshots, advances,
  adjustments, manual payments, close, reopen, and downstream carryover;
- employee-only portal time/My Pay visibility;
- encrypted backup export and restore remapping for employee time and pay data;
- Stage 5-6 navigation, employee admin, time review, payroll, and employee
  portal UI smoke paths.

Final validation for this branch should include `npm run test`, `npm run guard`,
`npm run build`, `SIGNGUY_SLIM_DB_PATH=:memory: npm run backend:migrate`, and
`git diff --check`.
