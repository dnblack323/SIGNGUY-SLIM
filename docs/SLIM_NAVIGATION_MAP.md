# SignGuy Slim Navigation Map

Current baseline: Hardening Group B branch after merged Version 2 Stages 1-8 and Hardening Group A.

This document maps the current user-facing areas, pages, deep links, utilities, and route decisions implemented by the Slim frontend. It describes the current code, not a proposed redesign.

## Global Application Structure

Every authenticated app page uses the shared Slim shell:

1. left area sidebar;
2. compact Quick Access toolbar/header;
3. area/module tabs;
4. contextual Office-style ribbon;
5. page content/workspace;
6. optional full-screen Order Workspace overlay;
7. optional calculator modal.

The sidebar is generated from `src/navigation.js`. Navigation is role-aware where broad roles are sufficient and capability-aware where backend permissions or employee eligibility are narrower than role. Backend service methods remain authoritative for permissions.

The authenticated session payload includes:

- `can_manage_employees`;
- `can_review_time`;
- `can_manage_pay`;
- `can_use_employee_portal`;
- `can_manage_announcements`.

---

## 1. Home

Route: `#/`

Current content:

- mini Production board;
- rolling Calendar;
- Attention panel.

Contextual ribbon:

- New Order;
- Calculator.

---

## 2. Shop Operations

Sidebar area: **Shop Operations**

Default route: `#/customers`

Direct modules:

- Customers;
- Quotes;
- Orders.

### Customers

Route: `#/customers`

Current page combines:

- Customer list/search/filter;
- create Customer form;
- edit Customer form;
- related Quotes;
- related Orders;
- Customer communication history.

There is no separate `/customers/new` page. `New Customer` returns to this page/form.

Contextual ribbon:

- New Customer;
- New Order.

### Quotes

Route: `#/estimates`

The route and backend API retain `estimate*` identifiers for compatibility, but current user-facing terminology is **Quote**.

Current page combines:

- Quote list;
- create Quote;
- edit Quote;
- duplicate;
- Quote-to-Order conversion;
- Send Quote email;
- PDF download;
- commercial bundle editing.

There is no separate `/estimates/new` page. New Quote uses the page's built-in form.

### Orders

Route: `#/orders`

Current page provides:

- Orders list;
- search and filters;
- production progress summaries;
- access to Order Workspace.

Contextual ribbon includes:

- New Order;
- Incoming Requests;
- Search;
- Filters;
- Saved Views;
- Clear Filters;
- Calculator.

### Incoming Requests

Canonical route: `#/orders/incoming`

Compatibility route: `#/orders/intake` redirects to `#/orders/incoming`.

Current page provides the focused inbound queue introduced by Version 2 Stage 2:

- review deliberately forwarded order email;
- Customer match/create;
- assignment/follow-up/status management;
- create one Draft Order;
- link to an existing Order;
- preserve original intake/source records and accepted attachments.

The underlying backend endpoints and portable record names still use `order_intake`/`intake` identifiers. That is an internal compatibility detail, not a separate current navigation destination.

### New Order

Deep-link route: `#/orders/new`

This is not a sidebar/module destination. It opens the New Order workspace over the normal application shell.

### Order Workspace

Deep-link route: `#/orders/:orderId`

This is not a top-level navigation area. It is a full-screen workspace overlay over the existing shell.

Current Order Workspace responsibilities include:

- Order and Order Item editing;
- attachments/artwork;
- device camera capture;
- photo annotation;
- scheduling;
- customer email and communication notes;
- invoicing;
- production grouping/send-to-production behavior;
- commercial bundle behavior where applicable.

---

## 3. Team & Productivity

Sidebar area: **Team & Productivity**

Default route: `#/production`

Direct modules:

- Employees, when `can_manage_employees`;
- Time & Attendance, when `can_review_time`;
- Work Board;
- Calendar;
- Announcements, when `can_manage_announcements`.

### Employees

Route: `#/employees`

Navigation visibility: `can_manage_employees`.

Current page covers employee administration and employee/user linkage used by Time Clock, pay tracking, Messages, and Announcements. The backend allows owner/admin/manager employee listing; create/update remains owner/admin controlled.

Contextual ribbon:

- Time;
- Payroll only when `can_manage_pay`.

### Time & Attendance

Route: `#/time`

Navigation visibility: `can_review_time`.

Current page provides manager time-entry review/correction workflows.

Contextual ribbon:

- Employees;
- Employee Portal only when `can_use_employee_portal`.

### Work Board / Production

Route: `#/production`

Current page is the Production / Work Board surface.

It uses Work Orders and production-required Order Items and exposes the production stages:

- Not Started;
- Ready;
- In Progress;
- Waiting;
- Complete.

### Calendar

Route: `#/calendar`

Current Calendar supports:

- Month;
- Week;
- Day;
- Agenda;
- Event creation;
- Task creation;
- Appointment creation;
- filters;
- linked Orders / Order Items / Work Orders / Quotes;
- departments/resources/assignees;
- conflict handling.

Contextual ribbon includes Event, Task, Appointment, Today, calendar views, and Filters.

### Announcements

Route: `#/announcements`

Navigation visibility: `can_manage_announcements`.

Current page is the management surface for Version 2 Stage 7 Employee Announcements. Employee reading occurs in Employee Portal rather than this owner/admin management page.

---

## 4. Business Management

Sidebar area: **Business Management**

Default route: `#/invoices`

Direct modules:

- Invoices;
- Payments;
- Payroll, when `can_manage_pay`.

### Invoices

Route: `#/invoices`

Current page handles Invoice records, document status, bundles, outbound email/PDF, and manual payment recording.

Contextual ribbon:

- Create From Order.

### Payments

Route: `#/payments`

Current page is a distinct Payments surface backed by invoice payment records. It filters invoices by payment status and records the cumulative total amount paid against invoices through the same backend payment API; it does not model individual payment transactions.

Contextual ribbon:

- Invoices.

### Payroll

Route: `#/payroll`

Navigation visibility: `can_manage_pay`.

Current page provides internal weekly pay-management summaries introduced in Version 2 Stage 6. Sensitive payroll APIs require owner access or explicit pay-management permission. Pay-authorized non-manager employees load the page through a payroll-scoped employee-summary endpoint rather than the broader Employee Administration list.

Contextual ribbon:

- Employees;
- Time.

---

## 5. Employee Portal

Sidebar area: **Employee Portal**

Default route: `#/employee-portal/time-clock`

Navigation visibility: `can_use_employee_portal`, which requires the authenticated user to be linked to an active same-tenant Employee with portal access enabled.

Direct modules:

1. Time Clock
2. My Pay
3. Messages
4. Announcements

### Time Clock

Route: `#/employee-portal/time-clock`

Current functionality:

- Clock In;
- Clock Out;
- current clock state;
- current/open Time Entry;
- current-week entries and totals.

### My Pay

Route: `#/employee-portal/my-pay`

Current functionality:

- employee's own open/closed pay-week summaries;
- hours;
- rate snapshot;
- gross estimate;
- advances;
- adjustments;
- manual payments;
- carryover / estimated amount due.

### Messages

Route: `#/employee-portal/messages`

Version 2 Stage 8 one-to-one internal Employee Messages.

Current behavior:

- conversation list;
- one-to-one same-tenant messaging;
- unread/read state;
- immutable message body;
- historical conversation viewing with inactive former employees;
- new sends only to eligible active recipients.

### Announcements

Route: `#/employee-portal/announcements`

Version 2 Stage 7 employee announcement-reading surface.

Current behavior:

- permitted current announcements;
- read/unread state;
- publish/expiration visibility rules.

---

## 6. Settings And Utilities

### Settings / Company

Route: `#/settings`

Current Settings page includes:

- company settings;
- shop timezone;
- sales tax rate;
- locale/currency;
- user administration where permitted;
- SendGrid sender/configuration status;
- private Incoming Requests intake address and rotation;
- Backup & Restore panel.

### Backup & Restore

Route: `#/backup`

This is a real Settings deep link that renders the Backup & Restore surface directly.

### Sign Out

Sidebar utility action; no route.

Removed stale utilities:

- Notifications utility;
- Account utility.

---

## 7. Global Quick Access

Current Quick Access actions:

- New Order -> `#/orders/new`;
- New Customer -> `#/customers`;
- Calendar -> `#/calendar`;
- Calculator -> modal utility.

The Calculator is not a routed page. It opens as a modal over the current page.

---

## Current Route Summary

| Route | Surface | Distinct page? | Notes |
|---|---|---:|---|
| `#/` | Home | Yes | Dashboard / production / calendar / attention |
| `#/customers` | Customers | Yes | List + create/edit form |
| `#/estimates` | Quotes | Yes | Route/API retains internal estimate identifier |
| `#/orders` | Orders | Yes | Orders list |
| `#/orders/incoming` | Incoming Requests | Yes | Canonical focused intake queue |
| `#/orders/intake` | Incoming Requests redirect | No | Compatibility redirect to `#/orders/incoming` |
| `#/orders/new` | New Order | Workspace | Overlay/deep-link |
| `#/orders/:orderId` | Order Workspace | Workspace | Full-screen overlay |
| `#/production` | Work Board / Production | Yes | Production board |
| `#/calendar` | Calendar | Yes | Month/Week/Day/Agenda |
| `#/employees` | Employees | Yes | Requires `can_manage_employees` |
| `#/time` | Time & Attendance | Yes | Requires `can_review_time` |
| `#/announcements` | Announcement Management | Yes | Requires `can_manage_announcements` |
| `#/payroll` | Payroll | Yes | Requires `can_manage_pay` |
| `#/invoices` | Invoices | Yes | Invoice + payment behavior |
| `#/payments` | Payments | Yes | Payment-focused invoice balance view |
| `#/employee-portal/time-clock` | Portal Time Clock | Yes | Requires `can_use_employee_portal` |
| `#/employee-portal/my-pay` | Portal My Pay | Yes | Requires `can_use_employee_portal` |
| `#/employee-portal/messages` | Portal Messages | Yes | Requires `can_use_employee_portal` |
| `#/employee-portal/announcements` | Portal Announcements | Yes | Requires `can_use_employee_portal` |
| `#/settings` | Settings | Yes | Company/users/email/intake/backup |
| `#/backup` | Backup & Restore | Yes | Direct backup/restore deep link |
| `#/tasks` | Removed alias | No | Not exposed; manual route shows unavailable destination |
| `#/pricing` | Removed alias | No | Not exposed; manual route shows unavailable destination |

---

## Current Navigation Hierarchy At A Glance

```text
Home

Shop Operations
|- Customers
|- Quotes
`- Orders
   `- Incoming Requests
      |- New Order            [deep link/workspace]
      `- Order Workspace      [deep link/workspace]

Team & Productivity
|- Employees                 [can_manage_employees]
|- Time & Attendance         [can_review_time]
|- Work Board / Production
|- Calendar
`- Announcements             [can_manage_announcements]

Business Management
|- Invoices
|- Payments
`- Payroll                   [can_manage_pay]

Employee Portal              [can_use_employee_portal]
|- Time Clock
|- My Pay
|- Messages
`- Announcements

Settings
|- Company
`- Backup & Restore

Utilities
`- Sign Out

Global Quick Access
|- New Order
|- New Customer
|- Calendar
`- Calculator                [modal]
```

## Capability Matrix

| Surface | Owner | Admin | Manager | Staff / Employee |
|---|---:|---:|---:|---:|
| Customers / Quotes / Orders / Invoices / Payments | Yes | Yes | Yes | Yes |
| Employees list | Yes | Yes | Yes | No |
| Employee create/update | Yes | Yes | No | No |
| Time & Attendance review | Yes | Yes | Yes | No |
| Payroll | Yes | Explicit pay-management Employee permission if not owner | Explicit pay-management Employee permission | Explicit pay-management Employee permission |
| Announcement management | Yes | Yes | No | No |
| Employee Portal | Only when also linked to an active portal-enabled Employee | Only when also linked to an active portal-enabled Employee | Only when linked to an active portal-enabled Employee | Only when linked to an active portal-enabled Employee |
| Backup & Restore | Yes | Yes | No | No |

## Map Maintenance Rule

Update this document whenever a page, route, sidebar area, module tab, deep-link workspace, capability gate, or portal destination is added, removed, renamed, or materially repurposed.
