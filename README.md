# SignGuy Slim

Independent slim sign-shop operations application for the Version 1 workflow.

This repository is intentionally separate from `SIGNGUY-MVP`. Version 1 Part 4
contains the independent Slim backend/database foundation, secure app auth,
tenant boundaries, company settings, Customers, Quick Entry, Estimates, direct
Orders, Estimate-to-Order conversion, Invoices, manual invoice payment status,
Estimate and Invoice PDFs, a basic arithmetic calculator, Order Workspace,
secure ordinary Order attachments, item-level Production board workflow,
Dashboard, Calendar scheduling, and in-app attention reminders.

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

## Part 3 Order Workspace And Production

Order rows expose an `Open` action for `#/orders/:orderId`. The workspace is a
full-screen authenticated dialog over the existing Slim shell. It supports
deep-link loading, focus trapping, background inertness, Escape/Close behavior,
dirty-change prompts for close/hash/browser navigation, and optimistic
concurrency through the Order `updated_at` value. Stale saves return
`409 order_conflict` and the UI offers Reload. Workspaces opened from
Production return to Production when closed.

Production progress is derived from production-required Order Items:
completed count, total count, and percentage. It is shown in the Orders list,
Order Workspace, and Production board. The progress value is not stored as a
separate editable field.

Production stages are:

- `not_started` - work has not begun.
- `ready` - work is ready to start.
- `in_progress` - active production work.
- `waiting` - blocked or waiting on a non-calendar condition.
- `complete` - item production is complete.

Moving an item to `complete` marks it done. Marking Done moves it to
`complete`. Reopening a done item returns it to `in_progress`. These actions
are audited in the same transaction as the item mutation and parent Order
timestamp update, and do not change the Order status. Marking an Order complete
does not mark production items complete. Workspace saves use differential item
updates so existing Order Item IDs, portable IDs, Estimate source item links,
and creation timestamps survive editing and reordering.

When an Invoice exists for an Order, the backend locks customer-changing and
financially relevant item edits: description, quantity, unit price, taxable
status, discount, item add/remove/duplicate, and item reorder. Safe production
fields remain editable: Order due date, internal notes, item due date, assigned
user, item note, production-required status, production stage, and completion.

## Part 4 Dashboard, Calendar, And Attention

Home contains exactly three operational areas: a mini Production board, a
rolling 14-day Calendar, and an in-app Attention panel. The mini Production
board summarizes the five existing production stages and links urgent items to
Production or the related Order Workspace. The rolling Calendar shows today and
the next 13 calendar days in the shop timezone.

Calendar Events are persisted as tenant-owned records with stable IDs and
portable IDs. Timed events are stored as normalized UTC ISO timestamps and
displayed with tenant shop-time labels; all-day events are stored as plain
dates so browser timezone conversion cannot shift them. Events may link to one
Order or one Order Item, may be assigned to an active same-tenant user, and
support `scheduled`, `complete`, and `cancelled` status. Create, edit,
reschedule, complete, reopen, and cancel actions are audited in the same
transaction as the Calendar mutation. Calendar completion never completes an
Order, Order Item, or production stage, and production completion never
completes Calendar Events.

The full Calendar provides Month, Week, Day, and Agenda views with Previous,
Today, and Next controls, assigned-user/status/linked-record filters, an
accessible edit form for rescheduling, and links back to the related Order
Workspace. The Order Workspace includes Schedule Order and item-level Schedule
actions that open an overlay without saving or discarding dirty workspace form
state.

The Attention panel is derived from existing Orders, production-required Order
Items, Estimates, scheduled Calendar Events, and issued Invoices with remaining
balances. Invoice reminders are labeled as payment attention unless a real due
date supports overdue or due-today wording.

## Attachments

Part 3 stores ordinary Order attachment metadata in SQLite and file bytes in a
Slim-owned local filesystem root. Defaults:

- `SIGNGUY_SLIM_ATTACHMENT_ROOT=./data/attachments`
- `SIGNGUY_SLIM_UPLOAD_LIMIT_BYTES=10485760`

Uploads are parsed with `busboy` streaming multipart handling, written to a
temporary file while enforcing the configured byte limit, and finalized only
after metadata and audit succeed. Allowed upload MIME types are PDF, common
web-safe images, plain text, CSV, and JSON. The backend verifies file signatures
or safe text/JSON content instead of trusting browser-supplied MIME alone.
HTML, SVG, JavaScript, executables, shell scripts, and other active content are
blocked, including extension/content mismatches. Stored object names are
random, tenant-separated keys; the frontend never receives filesystem paths or
unauthenticated public URLs. Upload, preview/download, and delete are
authenticated, tenant-scoped, checksum-backed, and audited. Preview/download
verifies the file is regular, byte size matches metadata, and SHA-256 matches
before audit; mismatches return `attachment_integrity_mismatch`. Storage roots
and ancestors are checked for symlink escapes. Downloads use safe
`Content-Disposition` and `X-Content-Type-Options: nosniff`; non-image previews
are sandboxed.

## Scope

Authorized in this branch:

- Version 1 Part 1 shell and documentation.
- Version 1 source/import exclusion guards.
- Version 1 Part 2 persisted backend and frontend workflows.
- Version 1 Part 3 Order Workspace, secure ordinary Order attachments, and
  item-level Production board workflow.
- Version 1 Part 4 Dashboard, full Calendar, scheduling, and in-app attention
  reminders.
- GitHub Actions CI for migration, tests, guard, and production build.

Not authorized here:

- Version 1 Parts 5-7 feature workflows.
- Any Version 2 code, placeholders, dependencies, routes, pages, tests, models,
  or navigation.
- Backup/export, restore, MVP import, portals, communications, Pricing Engine,
  production time tracking, camera capture, photo annotation, Stripe, webstores,
  inventory, payroll, AI, reports, financial dashboards, recurring events,
  resource-capacity scheduling, route optimization, or outbound notifications.
