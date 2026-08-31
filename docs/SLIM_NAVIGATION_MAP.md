# SignGuy Slim Navigation Map

Current baseline: `main` after merged PR #10 (Version 2 Stages 1-8).

This document maps the current user-facing areas, pages, deep links, overlays, utilities, and route aliases implemented by the Slim frontend. It describes the current code, not a proposed redesign.

## Global Application Structure

Every authenticated app page uses the shared Slim shell:

1. left area sidebar;
2. compact Quick Access toolbar/header;
3. area/module tabs;
4. contextual Office-style ribbon;
5. page content/workspace;
6. optional full-screen Order Workspace overlay;
7. optional calculator modal.

The sidebar is generated from `src/navigation.js`. Role filtering currently uses the authenticated user's broad role for ordinary navigation items. Some feature eligibility, such as employee portal access and pay-management permission, is enforced later by backend/page logic rather than fully represented by the navigation registry.

---

## 1. Home

### Home

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

### Customers

Route: `#/customers`

Current page combines:

- Customer list/search/filter;
- create Customer form;
- edit Customer form;
- related Estimates;
- related Orders;
- Customer communication history.

There is no separate `/customers/new` page. `New Customer` returns to this page/form.

Contextual ribbon:

- New Customer;
- New Order.

### Sales grouping

The current module registry nests the following destinations beneath **Sales**.

#### Estimates

Route: `#/estimates`

Current page combines:

- Estimate list;
- create Estimate;
- edit Estimate;
- duplicate;
- Estimate-to-Order conversion;
- Send Estimate email;
- PDF download;
- commercial bundle editing.

There is no separate `/estimates/new` page. New Estimate uses the page's built-in form.

#### Order Intake

Route: `#/orders/intake`

Current page provides the focused inbound Order Intake queue introduced by Version 2 Stage 2.

Primary behavior:

- review deliberately forwarded order email;
- Customer match/create;
- assignment/follow-up/status management;
- create one Draft Order;
- link to an existing Order;
- preserve original intake/source records and accepted attachments.

The Orders ribbon switches between Orders and Order Intake.

#### Orders

Route: `#/orders`

Current page provides:

- Orders list;
- search and filters;
- production progress summaries;
- access to Order Workspace.

Contextual ribbon includes:

- New Order;
- Order Intake;
- Search;
- Filters;
- Saved Views;
- Clear Filters;
- Calculator.

#### New Order

Deep-link route: `#/orders/new`

This is not a sidebar/module destination. It opens the New Order workspace over the normal application shell.

#### Order Workspace

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

### Employees

Route: `#/employees`

Navigation role visibility: owner/admin/manager.

Current page covers employee administration and employee/user linkage used by Time Clock, pay tracking, Messages, and Announcements.

Contextual ribbon:

- Time;
- Payroll.

Note: current ribbon/navigation visibility does not fully account for the separate pay-management permission used by the backend.

### Time & Attendance

Route: `#/time`

Navigation role visibility: owner/admin/manager.

Current page provides manager time-entry review/correction workflows.

Contextual ribbon:

- Employees;
- Employee Portal.

### Work Board / Production

Route: `#/production`

Current page is the Production / Work Board surface.

It uses Work Orders and production-required Order Items and exposes the production stages:

- Not Started;
- Ready;
- In Progress;
- Waiting;
- Complete.

### Tasks route alias

Route recognized by the frontend: `#/tasks`

Current renderer: the same `ProductionPage` used by `#/production`.

There is no separate Tasks page in the current navigation registry.

Calendar can create `task` entries, but that is separate from this route alias.

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
- linked Orders / Order Items / Work Orders;
- departments/resources/assignees;
- conflict handling.

Contextual ribbon includes Event, Task, Appointment, Today, calendar views, and Filters.

### Announcements

Route: `#/announcements`

Navigation role visibility: owner/admin.

Current page is the management surface for Version 2 Stage 7 Employee Announcements.

Employee reading occurs in Employee Portal rather than this owner/admin management page.

---

## 4. Business Management

Sidebar area: **Business Management**

Default route: `#/invoices`

### Money grouping

#### Invoices

Route: `#/invoices`

Current page handles Invoice records and manual payment-status behavior.

Contextual ribbon:

- Create From Order (returns to Orders).

#### Payments

Route: `#/payments`

Current renderer: the same `InvoicesPage` used by `#/invoices`.

This is therefore currently a navigation alias/view into invoice/payment functionality rather than a distinct Payments page implementation.

#### Payroll

Route: `#/payroll`

Navigation role visibility currently uses owner/admin/manager.

Current page provides internal weekly pay-management summaries introduced in Version 2 Stage 6.

Sensitive payroll APIs additionally require owner access or explicit pay-management permission. Current navigation visibility is broader than that backend capability model and is tracked for correction.

Contextual ribbon:

- Employees;
- Time.

---

## 5. Employee Portal

Sidebar area currently registered as: **Employee Portal**

Default route: `#/employee-portal/time-clock`

The Employee Portal is intended to be a restricted employee-facing surface using the existing authenticated user + Employee relationship.

Current child pages are ordered:

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

### Current navigation caveat

`Employee Portal` is currently registered as an ordinary operational sidebar area without a navigation-level employee/portal eligibility predicate. The backend/page layer still protects portal data, but users who are not eligible Employees may still be offered the route. This is tracked in the technical-debt register.

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
- private Order Intake address and rotation;
- Backup & Restore panel.

### Backup & Restore

Route: `#/backup`

Current renderer: the same `SettingsPage` used by `#/settings`, with Backup & Restore contained in that page.

Navigation presents Backup & Restore as a Settings module even though it is not rendered by a separate page component.

### Pricing route alias

Route recognized by frontend/navigation context: `#/pricing`

Current renderer: `SettingsPage`.

No Pricing Engine or pricing-calculator feature is implemented in Slim. This route is a legacy/compatibility alias and is not exposed as a current user-facing module.

### Notifications utility

Sidebar utility label: **Notifications**

Current target: `#/`

There is no separate Notifications page; this utility currently routes to Home.

### Account utility

Sidebar utility label: **Account**

Current target: `#/settings`

There is no separate Account page; this utility currently routes to Settings.

### Sign Out

Sidebar utility action; no route.

---

## 7. Global Quick Access

Current Quick Access actions:

- New Order → `#/orders/new`;
- New Customer → `#/customers`;
- Calendar → `#/calendar`;
- Calculator → modal utility.

The Calculator is not a routed page. It opens as a modal over the current page.

---

## Current Route Summary

| Route | Surface | Distinct page? | Notes |
|---|---|---:|---|
| `#/` | Home | Yes | Dashboard / production / calendar / attention |
| `#/customers` | Customers | Yes | List + create/edit form |
| `#/estimates` | Estimates | Yes | List + create/edit form |
| `#/orders` | Orders | Yes | Orders list |
| `#/orders/intake` | Order Intake | Yes | Focused intake queue |
| `#/orders/new` | New Order | Workspace | Overlay/deep-link |
| `#/orders/:orderId` | Order Workspace | Workspace | Full-screen overlay |
| `#/production` | Work Board / Production | Yes | Production board |
| `#/tasks` | Production alias | No | Renders ProductionPage |
| `#/calendar` | Calendar | Yes | Month/Week/Day/Agenda |
| `#/employees` | Employees | Yes | Manager+ navigation |
| `#/time` | Time & Attendance | Yes | Manager+ navigation |
| `#/announcements` | Announcement Management | Yes | Owner/admin |
| `#/payroll` | Payroll | Yes | Backend has additional pay permission |
| `#/invoices` | Invoices | Yes | Invoice + payment behavior |
| `#/payments` | Invoices alias | No | Renders InvoicesPage |
| `#/employee-portal/time-clock` | Portal Time Clock | Yes | Restricted Employee Portal |
| `#/employee-portal/my-pay` | Portal My Pay | Yes | Restricted Employee Portal |
| `#/employee-portal/messages` | Portal Messages | Yes | Stage 8 |
| `#/employee-portal/announcements` | Portal Announcements | Yes | Stage 7 |
| `#/settings` | Settings | Yes | Company/users/email/intake/backup |
| `#/backup` | Settings alias | No | Same SettingsPage |
| `#/pricing` | Settings legacy alias | No | No pricing feature |

---

## Current Navigation Hierarchy At A Glance

```text
Home

Shop Operations
├─ Customers
└─ Sales
   ├─ Estimates
   ├─ Order Intake
   └─ Orders
      ├─ New Order            [deep link/workspace]
      └─ Order Workspace      [deep link/workspace]

Team & Productivity
├─ Employees                 [owner/admin/manager]
├─ Time & Attendance         [owner/admin/manager]
├─ Work Board / Production
├─ Calendar
└─ Announcements             [owner/admin]

Business Management
└─ Money
   ├─ Invoices
   ├─ Payments               [currently InvoicesPage alias]
   └─ Payroll                [nav manager+, backend pay permission is narrower]

Employee Portal              [restricted in backend/page logic]
└─ Restricted Portal
   ├─ Time Clock
   ├─ My Pay
   ├─ Messages
   └─ Announcements

Settings
├─ Company
└─ Backup & Restore          [same SettingsPage]

Utilities
├─ Notifications             [currently routes Home]
├─ Account                   [currently routes Settings]
└─ Sign Out

Global Quick Access
├─ New Order
├─ New Customer
├─ Calendar
└─ Calculator               [modal]
```

## Map Maintenance Rule

Update this document whenever a page, route, sidebar area, module tab, deep-link workspace, or portal destination is added, removed, renamed, or materially repurposed.
