# SignGuy Select + Price Lab Dual-Track Master Completion Plan

**Updated:** September 10, 2026

This is the shared implementation roadmap for SignGuy Select / SignGuy Slim and Price Lab. The same copy belongs in both repositories so references like “Step 9” or “Step 14” mean the same thing everywhere.

## Operating rules
- Use bounded stages and normal GitHub merge commits.
- Shared Price Lab pricing formulas remain shared and are not forked into SignGuy Select.
- Price Lab visual approval precedes mirroring shared visual patterns into SignGuy Select.
- Keep Select practical for a small sign shop.
- Customer Communications and Management-to-Employee Messages are separate systems.
- Employees do not message each other. Employee messaging is management-to-employee only.
- Meta/Facebook work remains deferred until separately authorized.
- Before launch, every visible page/control must be working, deliberately deferred, or removed.

# Step 1 - Release B + Price Lab 5D
**Status: COMPLETE**
- Complete SignGuy Select Release B.
- Complete Price Lab Phase 5D.
- Preserve shared-engine boundaries.

# Step 2 - SignGuy Select C + D + Convergence Architecture
**Status: COMPLETE**
- Complete SignGuy Select Releases C and D.
- Establish convergence architecture and shared/application-specific boundaries.
- Preserve portable data and shared pricing-engine rules.

# Step 3 - Price Lab Shell + SignGuy Select Business Foundation
## SignGuy Select lane
- Expenses.
- Sales Tax tracking/reporting.
- Home/dashboard refinements.
- Sales navigation and Order workspace cleanup.
- Demo/sample data controls.
- Compact desktop shell, tabs and ribbons.
- Shared navigation/capability visibility cleanup.
- Preserve one natural page scroll.

## Price Lab lane
- Finalize header, navigation, ribbon, tabs, spacing, cards, forms, tables, typography, buttons, dialogs, empty states and scrolling.
- User personally approves the Price Lab desktop shell.
- Document approved shell rules.
- Mirror approved Price Lab section-shell patterns into SignGuy Select where appropriate.
- Finalize Price Lab Overview/Dashboard and mirror the approved pattern where appropriate.

# Step 4 - Banner Pilot + Calculator UI Contract V1
- Customer selection/add customer.
- Quantity, dimensions and units.
- Manufacturer-filtered material selection with exact material cost.
- Finishing, hems, grommets, pockets, specialty finishing and hardware.
- Double-sided, artwork, artwork complexity/minutes, installation, install complexity and rush.
- Live estimate.
- Multiple pricing methods.
- Suggested prices, show-math and cost breakdown.
- Alternate quantities.
- Add/save to Quote, Invoice or package as appropriate.
- Establish reusable compact calculator UI contract.

# Step 5 - Remaining Product Calculators
Build the remaining calculators using the approved contract, with product-specific inputs, materials, labor, equipment, outsourcing, finishing, install, quantity pricing, complexity, rush, multiple methods, show-math, cost breakdown and Quote/Order/Package integration.

# Step 6 - Saved Work + Package Builder
- Saved calculations/jobs.
- Reusable work.
- Duplicate/edit.
- Product/service packages.
- Package pricing and quantities.
- Add packages to Quotes/Orders.
- Preserve calculation details and pricing snapshots.

# Step 7 - Materials Library + Simple Supply Room
## Price Lab Materials Library
- Materials, equipment, outsourced services and pricing defaults.
- Shop values, supplier/manufacturer, cost/unit metadata and verification/source metadata.
- Add/hide/remove custom records.
- Keep categories consolidated and understandable.

## SignGuy Select Simple Supply Room
- Material/supply name and category.
- Vendor/supplier.
- Unit and cost.
- Quantity on hand.
- Minimum/reorder quantity.
- Low-stock indicator.
- Manual adjustments.
- Basic receiving/restocking.
- Basic usage history.
- Optional Order/job association.
- Active/inactive items.
- Do not turn this into warehouse-management software.

# Step 8 - Pricing Foundation + Guided Setup + Benchmark Program
- Rent/overhead, utilities, insurance, employees, wages and productive hours.
- Production labor, design labor and shop rate.
- Equipment, materials, services and outsourced services.
- Complexity, installation, quantity discounts, double-sided and rush.
- Guided setup/interview.
- Starter researched defaults.
- Accept/reject suggested updates.
- Effective-value history.
- Benchmark Program and offline-friendly defaults.
- Clear engine-vs-application variable separation.

# Step 9 - Artwork Approval + Order Inbox + Customer Messaging
## Artwork Approval
- Send proof.
- Approve/reject/request changes.
- Approval history.
- Customer/Order/Item association.
- Files/proofs.
- Customer Portal support later.

## Order Inbox / Incoming Requests
- Request list.
- Forwarded email intake.
- Attachments.
- Customer matching/create/link.
- Create/link Order.
- Duplicate/provider-retry protection.
- Read/status state.
- Assignment, archive/complete and failed/unmatched handling.
- Future business-text intake.

## Customer Messaging
- Customer conversation history.
- Outgoing email.
- Incoming/forwarded email.
- Manual communication notes.
- Business texting when provider integration is enabled.
- Attachments.
- Read/unread state.
- Customer, Quote, Order, Invoice and artwork-approval association.
- Conversation access from Customer and Order.
- Future Customer Portal replies.
- Keep separate from Employee Messages.

# Step 10 - Sales Documents + Management-to-Employee Messaging + Release E Groundwork
## Sales Documents
- Quotes, Orders, Invoices, PDFs, sending and status.
- Historical pricing/financial snapshots.
- Customer associations.
- Quote-to-Order and Order-to-Invoice flow.

## Management-to-Employee Messaging
- Management can send to one employee, optionally multiple selected employees.
- Management can view sent/history and read/unread state.
- Employee Portal can receive/read/mark read.
- Employees cannot message other employees.
- No staff social chat, channels or Slack-like workspace.
- Announcements remain the broad shop-wide communication tool.

# Step 11 - SignGuy Select Full Existing-App Review & Completion Audit
Review the entire current app together. Find and correct placeholders, dead controls, incomplete workflows, sample-only UI, missing CRUD/search/filter/navigation, broken links, unfinished dialogs/forms, missing validation/error/empty states, bad permissions, UI/backend disconnects, bad record relationships, missing audit/history behavior, layout/scroll problems, capability visibility issues and development leftovers.

For every visible feature, classify it as:
1. Working end-to-end.
2. Deliberately deferred and identified.
3. Removed until it works.

## Areas to review
### Home
Dashboard, widgets, one-week calendar, jobs/work, clocked-in employees, attention items, quick actions, demo data, widget preferences, record links and ribbons.

### Customers
List/search/filter, create/edit/detail, contact/billing/tax exemption, notes/files, communications, Quotes, Orders, Invoices, Payments, future Portal relationship, archive/delete and related-record navigation.

### Quotes
List/search/filter, create/edit/duplicate, items, calculator items, totals/tax/discounts, packages, status, PDF, send/email, customer, convert to Order, pricing snapshot, acceptance/decline and ribbons.

### Orders
List/search/filter, New Order, Order Workspace, customer, items, editing, pricing/totals, production, Work Orders, due dates, installation, calendar, attachments, camera/photo, annotation, communications, invoices, payments, status, Send to Production, completion, duplicate/copy, ribbons, single-scroll and sectioned cards.

### New Order
Customer select/add, required fields, Order/Item titles, multiple items, calculator/product selection, quantity/price/tax, notes, due date, production, artwork, installation, attachments, save draft, create, cancel/exit, validation and data-loss protection.

### Order Inbox / Incoming Requests
Request list, forwarded email, future text intake, attachments, customer matching/create/link, create/link Order, duplicate detection, read/status, assignment, archive/complete, communication history and failed/unmatched intake.

### Invoices
List, create/open, Order/customer relationship, lines/totals/tax, status, issue/send, PDF/email, deposits/payments/balance, paid/partial/unpaid, void, historical snapshot, future Stripe and Portal visibility.

### Payments
List, manual payment, Invoice/customer association, amount/method/date/reference/notes, cumulative paid-to-date, balances, permissions, reporting, future Stripe records and refund/void needs.

### Expenses
List, create/edit, vendor/category/description/amount/payment method/date, receipt upload, filtering, totals/reporting, permissions and delete/archive.

### Sales Tax
Taxable/non-taxable sales, tax collected, reporting periods/totals, issued-Invoice basis, draft/void exclusion, filtering, tax-exempt customers, bundle allocations and report/export needs. Tracking/reporting only, not tax filing.

### Payroll
Employee pay data/rates, time records, Saturday-Friday week, weekly calculations, close/reopen, corrections, voided entries, historical rate snapshots, My Pay, summaries, permissions and reports/exports.

### Employees
List, create/edit, active/inactive, user association, roles/permissions/pay access/contact, Employee Portal, scheduling, Work Board, time, payroll, management messages and announcements.

### Time & Attendance
Time Clock, clock in/out/current status, overnight shifts, corrections, voids, employee filtering, weekly records, pay-week integration, overlap protection, manager corrections, permissions and Employee Portal.

### Work Board
Production queue, Order Items, Work Orders, assignment/unassigned, stages, due dates, complete/reopen, regrouping, filters, employee assignments, Order/calendar links, unreleased/released production, employee financial redaction and ribbons.

### Calendar
Month/Week/Day/Agenda, events/tasks/appointments/installs, Order/Work Order links, employees, departments, resources, shared/personal views, My Schedule, conflicts, complete/reopen, filtering, category colors, rescheduling where supported, permissions and employee financial redaction. Calendar completion remains independent from production/business completion.

### Announcements
Create/edit/publish/schedule/expire/archive, target audience, employee visibility/read state, Employee Portal and management permissions.

### Management-to-Employee Messages
Management send, recipient selection, optional multi-recipient, employee receive, read/unread, history, permissions, Employee Portal and confirmation that employees cannot message each other.

### Customer Messaging
Conversation history, outgoing/incoming email, manual notes, Customer/Quote/Order/Invoice associations, attachments, read/unread, future texting and future Portal messaging. Keep separate from employee communications.

### Company Settings
Company info, logo, address, phone, email, website, hours, tax, document settings, Quote/Invoice settings, numbering where applicable, user management, roles/permissions, communications, payments, demo data, preferences and placeholders.

### Backup Center / Backup & Restore
Portable customer backup, export, encryption, passphrase, preview, restore, validation, version compatibility, attachments, employees, time/pay, communications, announcements, expenses, demo markers, failure/recovery, server/operator backup where applicable and clear separation of portable data from server runtime backups.

### Employee Portal
Time Clock, My Pay, management messages, announcements, employee permissions/data isolation, no management-only financial information and no employee-to-employee messaging.

### Navigation + Ribbon Audit
Sidebar categories/pages, module tabs, ribbons, Quick Access, page titles, active states, duplicate/missing/dead actions, capability-hidden actions, routes, back navigation and Customer -> Quote -> Order -> Invoice -> Payment links.

## Completion matrix
For every page/feature record:
- UI exists: Yes/No
- Backend exists: Yes/No
- Connected end-to-end: Yes/No
- Create works: Yes/No/N/A
- Edit works: Yes/No/N/A
- Delete/archive works: Yes/No/N/A
- Search/filter works: Yes/No/N/A
- Permissions correct: Yes/No
- Navigation correct: Yes/No
- Empty state complete: Yes/No
- Error handling complete: Yes/No
- Tested: Yes/No
- Placeholder remaining: Yes/No
- Fix required: description

**Exit:** Every current Select area and visible control is accounted for and incomplete functionality is fixed, deliberately deferred or removed.

# Step 12 - Stripe Customer Payments
This is Stripe used by shops to collect money from customers.
- Stripe Connect/shop setup.
- Invoice payments.
- Deposits and balances.
- Payment links.
- Customer Portal payments.
- Success/failure and confirmations.
- Order/Invoice association.
- Payment history.
- Refund/void handling where required.

# Step 13 - Simple Supply Room Final Integration + Simple Web Store
Finish any remaining Supply Room integration, then implement:
- Store enable/disable.
- Selected products/packages.
- Image, name, description, price.
- Simple options/variants.
- Active/inactive and basic availability.
- Customer order/request.
- Stripe payment/deposit when enabled.
- Flow into Select as customer + request/order + payment as appropriate.
- No warehouse network, marketplace, advanced ecommerce CMS or Shopify replacement.

# Step 14 - Customer Portal + Full Onboarding
## Customer Portal
- Secure access to only the customer's records.
- Quotes and accept/decline.
- Orders and customer-facing status.
- Invoices.
- Pay invoices/deposits and view payment status.
- Documents/downloads.
- Artwork proofs and approve/reject/request changes.
- Upload artwork/files.
- Send/reply to customer messages and appropriate history.
- Never expose internal notes, costs, margins, employee info or shop-only production details.

## Full shop onboarding
- Company/address/contact/logo.
- Owner account.
- Business hours.
- Tax information.
- Employees/users and roles/permissions.
- Management access.
- Payment/Stripe setup.
- Email/customer communications.
- Optional texting.
- Workflow preferences.
- Demo/sample data.
- Backup basics.
- Pricing setup entry point.
- Do not force every advanced setting before basic use.

# Step 15 - Price Lab Final UX Parity + Freeze
- Final visual review.
- Calculator/navigation/shared-pattern consistency.
- Workflow polish.
- Desktop UX approval.
- Correct remaining drift.
- Freeze major Price Lab UX before release engineering.

# Step 16 - Price Lab Desktop Licensing + Release Engineering
- Windows installer.
- License activation.
- Final perpetual/time-limited licensing model.
- Offline operation.
- Machine/license handling.
- Reinstall/recovery.
- Update channel.
- Download delivery.
- Release packaging.
- Production builds.
- Backup/restore compatibility.

# Step 17 - Platform Commerce + Website + Hosting + Entitlements
This is SignGuy's own billing and platform operation.
- SignGuy Select subscription billing.
- Price Lab license sales.
- Stripe platform billing.
- Plans/subscriptions/upgrades/downgrades/cancellation.
- Entitlements.
- Download access.
- Account/billing management.
- Website/product pages/checkout.
- Hosting/deployment/environments.
- Connect paid plan/license to capabilities.

Stripe distinction:
- Step 12: shops get paid by customers.
- Step 17: SignGuy gets paid by shops/users.

# Step 18 - Alpha + Beta + Public Launch
## Alpha
Test fresh onboarding, existing-shop workflows, backup/restore, customer messaging, management messages, Customer Portal, Stripe, Web Store, Supply Room, Quotes/Orders/Invoices/Payments, Work Board, Calendar, Time/Payroll, Price Lab install/licensing and permissions/security.

## Beta
Use selected real shops, capture usability/pricing issues, fix genuine blockers, retest recovery/payment paths and confirm support/documentation needs.

## Public launch
Production readiness, deployment, billing/entitlements, installer/downloads, monitoring/support basics, final documentation and release.

# Shared definition of complete
A step is not complete because a route, button or screen exists. It is complete only when the required workflow is implemented, connected, permissioned appropriately, tested at the level appropriate to its risk, and its user-facing controls perform the behavior they claim to perform.
