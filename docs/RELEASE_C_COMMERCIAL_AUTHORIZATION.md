# Commercial Release C Authorization Matrix

Commercial Release C addresses `CRR-006`: the generic `staff` role was included
in broad commercial write authorization through `WRITE_ROLES`. This document
defines the implemented initial commercial role boundary for the Release C
branch.

## Scope

Release C is limited to runtime authorization and matching frontend visibility
for existing Slim roles:

- `owner`
- `admin`
- `manager`
- `staff`

It does not add persisted ACLs, tenant-custom permission sets, SSO, payroll
features, Release D/E work, or Stage 9 Facebook/Meta code.

No migration is expected. Existing tenant, user, employee, role, session,
capability, backup, and portability contracts remain authoritative.

## Policy Summary

The backend is authoritative. Frontend navigation and buttons should match the
backend where practical, but hidden UI is not security.

`staff` is no longer a general commercial writer. Staff may perform the
operational work required for production and the Employee Portal, but may not
create or mutate commercial customer, Quote, Order, Invoice, Payment, customer
email, settings, backup, invitation, recovery, quota, or payroll-management
records unless an existing narrower capability explicitly grants the action.

## Role Matrix

| Area | Owner | Admin | Manager | Staff |
| --- | --- | --- | --- | --- |
| Company settings | Manage | Manage | View only | View only |
| User/employee administration | Manage | Manage | List/review time only | No admin access |
| Customers | Read/write | Read/write | Read/write | No direct commercial route; customer context only through assigned operational Order/Work Order payloads |
| Quotes | Read/write/send/convert | Read/write/send/convert | Read/write/send/convert | No commercial mutation/send/convert |
| Orders | Read/write/commercial email | Read/write/commercial email | Read/write/commercial email | Assigned operational workspace only, financially stripped; no commercial mutation |
| Incoming Requests | Review/update/convert/link | Review/update/convert/link | Review/update/convert/link | No direct intake route or commercial workflow mutation |
| Production setup/regrouping | Manage | Manage | Manage | No structure/regroup release authority |
| Production execution | Manage | Manage | Manage | Update assigned active Work Order production state |
| Production evidence attachments | Manage | Manage | Manage | Upload/photo/annotate/delete assigned operational Order attachments |
| Calendar personal entries | Manage own | Manage own | Manage own | Manage own |
| Calendar shared/commercial schedule | Manage | Manage | Manage | View only unless assigned/personal |
| Customer communications | Send/log | Send/log | Send/log | No customer-facing communication mutation |
| Internal employee messages | Use if portal-eligible | Use if portal-eligible | Use if portal-eligible | Use if portal-eligible |
| Announcements management | Manage | Manage | No | No |
| Employee Portal announcements | Read if portal-eligible | Read if portal-eligible | Read if portal-eligible | Read if portal-eligible |
| Invoices | Create/status/send | Create/status/send | Create/status/send | No invoice mutation/send |
| Payments | Record/manage | Record/manage | Record/manage | No payment mutation |
| Time review | Review/manage | Review/manage | Review/manage | Own Time Clock only |
| Pay management | Yes | Only with pay-management employee capability | Only with pay-management employee capability | Only with pay-management employee capability |
| Backup/restore | Manage | Manage | No | No |
| Signup invitations | Manage | Manage | No | No |
| Password recovery operator links | Manage | Manage | No | No |
| Tenant quota policy | Operator/runtime only | Operator/runtime only | No | No |

## Backend Policy Sets

Release C keeps the existing roles and helper pattern, but splits broad write
authority by domain:

- `ADMIN_ROLES`: owner/admin administration, settings, backup, onboarding, and
  account-security controls.
- `MANAGER_ROLES`: owner/admin/manager commercial management and shared
  scheduling authority.
- `COMMERCIAL_WRITE_ROLES`: alias for owner/admin/manager commercial document,
  customer, customer-email, Invoice, Payment, and Incoming Request mutations.
- `PRODUCTION_WRITE_ROLES`: owner/admin/manager/staff operational production
  execution and production evidence/photo actions.

`WRITE_ROLES` may remain as an explicit all-authenticated-role set only for
staff-operational actions. It must not be used for commercial mutation.

## Domain Rules

### Customers

Owner/admin/manager may create and update customer records. Staff may read
customer context only through tenant-scoped assigned operational Order/Work
Order payloads, and staff response shaping avoids unnecessary financial
leakage.

### Quotes

Owner/admin/manager may create, edit, duplicate, send, and convert Quotes.
Staff may not mutate Quote pricing, line items, status, bundles, PDF sending, or
conversion. Direct Quote list/detail routes are commercial routes and are
manager-level.

### Orders

Owner/admin/manager may create and edit commercial Orders, Order Items,
commercial bundles, Order status, and customer-facing Order email. Staff may
read operational Order/Work Order context and perform production execution, but
may not alter commercial totals, pricing, customer notes, Quote conversion, or
business status. Direct Order list routes are commercial routes. Direct Order
detail/workspace access for staff requires assigned operational work and strips
financial fields.

### Production

Owner/admin/manager may release Orders to production, choose grouping, regroup,
and manage production structure. Staff may update operational production stage
and completion for existing production work and add operational evidence through
attachments, camera uploads, and annotations. Staff may not use production
endpoints to change commercial Order state or pricing.

### Incoming Requests

Owner/admin/manager may update intake workflow status, assign follow-up, attach
customers, convert to Draft Orders, and link to existing Orders. Staff has no
direct intake route or commercial intake mutation authority in Release C.

### Customer Communications

Owner/admin/manager may send customer Quote/Order/Invoice emails and create
manual customer communication notes. Staff customer-facing sends and customer
timeline reads/mutations are rejected. SendGrid delivery webhooks and signed
inbound intake webhooks remain system/provider paths, not staff permissions.

### Invoices and Payments

Owner/admin/manager may create/open Invoices, change document status, send
customer Invoice email, and record payments under existing payment validation.
Staff may not read or mutate direct Invoice or Payment routes.

### Settings, Backup, and Account Security

Owner/admin controls remain owner/admin only: company/email settings, Backup &
Restore, signup invitations, operator reset links, onboarding controls, and
account recovery operations. Manager and staff do not inherit these powers from
commercial authority.

### Employee, Time, Pay, Announcements, and Messages

Existing capability rules remain more specific than broad role rules:

- employee creation/update remains owner/admin;
- employee listing and time review remain manager-level;
- pay management requires owner or explicit pay-management employee capability;
- Employee Portal requires an active portal-enabled employee record;
- announcement management remains owner/admin;
- internal employee messages remain portal/participant scoped.

### Calendar

Owner/admin/manager may manage shared/commercial scheduling, departments,
resources, and shared views. Staff may keep practical operational visibility and
personal calendar/saved-view behavior, but staff cannot manage shared schedule
structure or broad commercial schedule entries.

## Direct API Contract

A staff user who manually calls a hidden commercial endpoint must receive the
canonical permission failure (`403 permission_denied`). Assigned operational
Order/Work Order exceptions are tenant-scoped and financially stripped. Tenant
isolation remains independent: manager or owner privilege never crosses tenant
boundaries.

## Frontend Alignment

Session capabilities may be extended with a small number of derived booleans if
needed to avoid role guessing. Candidate capabilities:

- `can_manage_commercial`
- `can_send_customer_email`
- `can_manage_production`
- `can_perform_production_work`
- `can_manage_calendar`
- `can_manage_settings`
- `can_manage_backup`
- `can_manage_account_security`

These capabilities are backend-derived convenience signals only. Backend
permission checks remain authoritative.

## Commercial Readiness Status

Release C marks `CRR-006` as remediated in
`docs/COMMERCIAL_RELEASE_READINESS_AUDIT.md`. The overall commercial release
classification remains **NOT READY** until Release D/E work and the final
commercial re-audit are complete.
