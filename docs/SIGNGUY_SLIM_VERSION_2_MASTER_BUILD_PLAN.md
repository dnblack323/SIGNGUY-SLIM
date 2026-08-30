# Codex Master Build Prompt — SignGuy Slim Operations App, Version 2

> **Authoritative Version 2 roadmap status (updated 2026-08-30):** Stages 1-6 are implemented and merged. Stages 7 and 8 are now intentionally authorized as one combined delivery stage because both extend the existing Employee Portal communication surface and share tenant/user/unread/notification concerns. Stage 9 (Facebook Page Order Intake) is intentionally deferred until later because it requires Meta business app/Page configuration, permissions, webhook setup, and potentially app review. Do not begin Stage 9 unless the user separately authorizes it after the required Meta setup is available.

## Mission

Extend the completed SignGuy Slim Operations App Version 1 by adding only the approved Version 2 capabilities:

- SendGrid customer email and email activity history;
- Customer communication history;
- a focused Order Intake area that receives only deliberately forwarded order emails without synchronizing the shop's full mailbox;
- later optional Facebook Page message intake feeding the same Order Intake workflow;
- employee administration needed for timekeeping and portal access;
- Time Clock and editable time entries;
- simple weekly pay tracking with advances, adjustments, payments, and carryover;
- Employee Portal with Time Clock, My Pay, Messages, and Announcements;
- device-camera photo capture inside the Order Workspace;
- simple photo annotation while preserving the original image.

This is an extension of Version 1, not a rebuild, replacement product, or opportunity to add the full SignGuy AI feature set. Preserve all completed Version 1 behavior, navigation, terminology, security, responsive layout, dashboard, Production board, Calendar, Estimates, Orders, Invoices, calculator, and Order Workspace.

## Working Method

1. Start each authorized Version 2 stage from the latest clean `origin/main` in a dedicated branch/worktree.
2. Read every applicable `AGENTS.md` file and current repository architecture/decision document.
3. Inspect actual code, migrations, routes, tests, and frontend imports. Documentation is supporting evidence, not proof that a feature exists.
4. Verify the completed baseline and record its exact commit before making changes.
5. Produce a concise reuse map for the authorized stage: verified reusable code, safely adaptable code, missing code, and excluded code.
6. Reuse existing tenant, identity, permissions, audit, notification, attachment, email-activity, and workspace patterns where verified. Do not create competing systems.
7. Execute only the Version 2 delivery stage explicitly authorized by the user. The currently authorized next delivery is the combined Stages 7-8 package. Complete its backend, frontend, migrations, permissions, tests, documentation, backup/restore coverage, and validation, then stop. Do not begin or scaffold Stage 9.
8. Use additive, reversible migrations. Preserve existing records and behavior.
9. If the repository conflicts with this scope or a change would materially alter existing data, stop and report the exact conflict instead of guessing.

## Incremental Version 2 Delivery Stages

Stages 1-6 are implemented and merged. The next authorized delivery combines Stages 7 and 8. Stage 9 is deferred.

### Stage 1 — SendGrid and Customer Communication History — IMPLEMENTED

- Secure outbound customer email to Estimates, Orders, and Invoices.
- Order Workspace communication composer and communication timeline.
- SendGrid event processing, delivery history, idempotency, and failure handling.
- Manual communication notes for phone, walk-in, and externally received communication.

### Stage 2 — Email Order Intake — IMPLEMENTED

- `Order Intake` beneath Orders as a focused queue.
- Private tenant-specific inbound intake address.
- Deliberately forwarded order-email intake without Gmail/Outlook mailbox synchronization.
- Customer matching/creation, assignment, follow-up, status management, Draft Order conversion, and existing-Order linking.

### Stage 3 — Camera Capture — IMPLEMENTED

- Device-camera capture in the Order Workspace attachment area.
- Immutable original and normal upload fallback.

### Stage 4 — Photo Annotation — IMPLEMENTED

- Small Order-photo annotation workflow.
- Immutable originals with separately saved annotated derivatives.

### Stage 5 — Employee Administration, Time Clock, and Time Clock Portal — IMPLEMENTED

- Employee records linked safely to authenticated users.
- Admin and employee Time Clock behavior and editable Time Entries.
- Restricted mobile-friendly Employee Portal Time Clock surface.

### Stage 6 — Weekly Pay Tracking and My Pay — IMPLEMENTED

- Weekly pay summaries, advances, adjustments, manual payments, and carryover.
- My Pay in the Employee Portal.
- Saturday-Friday work week and Friday payday baseline.

### Combined Stages 7-8 — Employee Announcements and Internal Employee Messages — AUTHORIZED NEXT

Stages 7 and 8 are intentionally delivered together in one bounded branch and pull request. They share the Employee Portal, authenticated tenant users, unread/read state, role visibility, and optional notification-email infrastructure, so splitting them would create needless duplicate plumbing.

#### Stage 7 capability — Employee Announcements

- Add company announcements and read/unread tracking to the Employee Portal.
- Allow authorized owner/admin users to create, publish, edit, archive, schedule, expire, and target announcements only within the simple scope defined below.
- Add optional SendGrid notification emails when Stage 1 is installed without making SendGrid the announcement store.
- Require Stage 5.

#### Stage 8 capability — Internal Employee Messages

- Add basic one-to-one internal direct messages and unread state.
- Add optional SendGrid notification emails when Stage 1 is installed without turning SendGrid into the internal message transport.
- Require Stage 5.
- Do not add group chat, channels, attachments, reactions, presence, voice, video, typing indicators, or social-feed behavior.

#### Combined-stage rules

- Complete backend models, migrations, APIs, tenant/permission rules, Employee Portal UI, owner/admin announcement controls, direct-message UI, optional notification preferences, audit, backup/restore coverage, tests, documentation, and validation for both capabilities before the combined stage is complete.
- Reuse the existing employee/user identity and Employee Portal. Do not create a second staff portal, separate messaging identity, duplicate notification store, or parallel communication framework.
- Keep customer communication history separate from employee internal messaging. They may reuse infrastructure patterns, but customer communications and internal employee messages remain different domains.
- Stop after combined Stages 7-8 are merged. Stage 9 remains deferred and must not be scaffolded, advertised, or exposed as a coming-soon UI.

### Stage 9 — Facebook Page Order Intake — DEFERRED

- **Deferred:** do not implement this stage during the combined Stages 7-8 work. Begin only after separate user authorization and required Meta business/Page setup is available.
- Connect an authorized business Facebook Page through supported Meta business messaging APIs and verified webhooks.
- Receive eligible Page messages into the communication surface and provide `Send to Order Intake` so a user deliberately promotes a potential order into the existing Stage 2 queue.
- Preserve Page conversation identifiers, sender identity available through the authorized API, timestamps, message text, and supported attachments.
- Reuse the same Customer matching, assignment, follow-up, Draft Order conversion, existing-Order linking, deduplication, audit, and status rules as email Intake Items.
- Do not automatically turn every Page inquiry into an Order Intake Item or Order.
- Respect Meta permissions, app-review requirements, messaging windows, webhook verification, retention rules, and platform policies current when implemented.
- Support business Pages only. Do not access personal-profile Messenger inboxes.
- Do not add Instagram, WhatsApp, SMS, marketing automation, or a general social-media CRM.

## Locked Terminology and Existing Contracts

Continue using: Customer, Estimate, Order, Order Item, Work Order, Invoice, Employee, Time Entry, Pay Week, Advance, Adjustment, Manual Payment, Carryover, Message, Announcement, Communication Activity, Attachment, Order Intake Item, and Intake Source Message.

Never introduce `Job`, `Job Item`, `Job Ticket`, or `Production Ticket` as replacements for the canonical Order workflow.

Preserve these contracts:

- Estimate/Quote → Order conversion remains idempotent and audited.
- An Order contains Order Items.
- Production-required Order Items flow through the existing Work Order/production contract.
- Order Item completion remains separate from calendar-event completion.
- One Invoice per Order remains enforced.
- Invoice document status and payment status remain separate.
- Version 2 additions must not change authoritative price, tax, production, scheduling, or document calculations.

## Combined Stages 7-8 Detailed Scope

### Employee Portal

The Employee Portal remains a restricted portal surface, not a duplicate owner/admin application. After combined Stages 7-8, portal navigation may contain:

1. Time Clock
2. My Pay
3. Messages
4. Announcements

Only active authorized Employees may access portal content. Employees may view only their own pay/time records, while Messages and Announcements use same-tenant user/employee visibility rules.

### Internal Messages

Build basic in-app direct messaging. SendGrid is not the message transport.

- one-to-one messages between active authorized users;
- simple conversation threads;
- unread count and read timestamp;
- sender, recipient, sent time, and message body;
- tenant isolation and active-user validation;
- no editing after send; authorized moderation/deletion requires an audit event;
- optional SendGrid notification email may announce a new in-app message, respecting notification preferences and excluding sensitive pay details;
- no file attachments, reactions, channels, group chat, voice, video, typing indicators, presence, or analytics-heavy read receipts.

### Announcements

Authorized owner/admin users can:

- create an announcement;
- add a title and plain-text or safely sanitized rich-text body;
- set publish/start date and optional expiration date;
- target all active Employees or a supported simple role group;
- edit or archive with audit history.

Employees can:

- view current permitted announcements;
- see published date and author;
- mark/read automatically when opened;
- distinguish unread from read.

Do not add surveys, polls, social feeds, public comments, likes, or complex campaign scheduling.

### Optional Notification Email

If Stage 1 SendGrid configuration is active, combined Stages 7-8 may send simple notification emails for new messages or announcements. Notification email is optional and supplemental only.

- SendGrid must not become the announcement database or message transport.
- Notification failure must not lose or roll back the underlying in-app message/announcement.
- Do not include employee pay information or unnecessary sensitive content in notification emails.
- Respect per-user notification preferences where implemented.

### Backup and Restore

Combined Stages 7-8 must extend the existing encrypted backup/restore contract to include applicable announcement, announcement-read, direct-message, message-read/unread, and notification-preference records.

Restore must preserve tenant isolation and safely remap user/employee relationships according to the existing restore model. Do not restore or create login credentials from backup data.

## Navigation and Ribbon

Keep the current Slim navigation architecture and existing compact Office-style ribbon. Do not horizontally scroll the ribbon or duplicate page navigation.

For combined Stages 7-8:

- expose Messages and Announcements inside the existing Employee Portal;
- place owner/admin announcement management under the existing Team area or the smallest appropriate Team subview;
- do not create a new top-level Communications area;
- add `New Announcement` only where useful to authorized owner/admin users;
- do not add every messaging/announcement action to the global ribbon.

Stage 9 Facebook controls must remain absent until Stage 9 is separately authorized.

## Security, Privacy, Audit, and Data Requirements

- Enforce tenant isolation in every message, announcement, read state, employee relationship, and notification preference query/mutation.
- Enforce permissions on the backend; hidden frontend controls are not security.
- Validate sender/recipient/target users are active and same-tenant.
- Audit announcement create/edit/archive and authorized message moderation/deletion.
- Ordinary direct messages are immutable after send.
- Do not expose employee pay/time details through internal messaging notifications.
- Use additive, reversible migrations with safe defaults.
- Preserve loading, empty, error, retry, validation, permission-denied, and notification-failure states.
- Preserve keyboard accessibility, focus management, readable contrast, touch targets, and mobile usability.

## Absolute Exclusions

Do not import, expose, recreate, stub, advertise, or add navigation for:

- Pricing Engine or pricing calculators;
- detailed order entry;
- AI tools or credits;
- Webstores;
- Stripe or payment processing;
- expenses, bookkeeping, accounting, tax reporting, business analytics, or reports;
- formal payroll processing, payroll providers, taxes, direct deposit, benefits, or tax forms;
- Asset/Document Library or DocuLink;
- Wrap Lab or Design Studio;
- Customer Portal or Decision Room;
- production time tracking, station checkout, machine time, or capacity planning;
- inventory, purchasing, suppliers, or automatic ordering;
- SMS/MMS or Twilio;
- Gmail/Outlook mailbox synchronization;
- complete mailbox import or OAuth access to the normal shop mailbox;
- personal Facebook profile or personal Messenger inbox access;
- automatic conversion of communications into confirmed Orders;
- Instagram, WhatsApp, or a general social-media CRM;
- marketing campaigns or bulk email;
- group chat, channels, message attachments, reactions, voice, video, typing indicators, or presence;
- advanced workflow builder or advanced image editor;
- disabled `coming soon` placeholders for excluded/deferred features.

## Required Tests for Combined Stages 7-8

At minimum add/update focused tests for:

### Portal, Messages, and Announcements

- portal access for active/inactive Employees;
- tenant and recipient isolation for direct messages;
- active-user validation;
- unread/read behavior;
- no message editing after send;
- authorized moderation/deletion audit behavior;
- announcement publish/start/expiration and target rules;
- per-Employee announcement read state;
- owner/admin management boundaries;
- staff/employee visibility boundaries;
- optional notification email failure does not lose the in-app record;
- optional notification email does not expose pay details;
- Stage 9 Facebook UI/routes/models remain absent.

### Backup/Restore

- Stage 7-8 records export and validate;
- restore remaps user/employee relationships tenant-safely;
- cross-tenant message/announcement relationships are rejected;
- read/unread state is preserved where appropriate;
- no credentials or external notification secrets are exported/restored.

### Integration and Regression

- Version 1 and Stages 1-6 tests remain passing;
- customer communication history remains separate from internal employee messaging;
- Time Clock and My Pay permissions are unchanged;
- Slim navigation/frontend bundle does not import excluded or Stage 9 modules;
- production frontend build passes.

Run the complete relevant backend tests, frontend tests, guard, migration check, and production build. Fix regressions introduced by combined Stages 7-8 and clearly separate verified pre-existing failures.

## Definition of Done

- **Stages 1-6:** implemented and merged.
- **Combined Stages 7-8:** authorized users can publish/manage announcements and Employees can read permitted current announcements with correct read/unread state; active authorized users can exchange basic tenant-isolated one-to-one messages with correct unread behavior and without excluded chat features. Both capabilities use the existing Employee Portal/identity model, preserve audit and tenant boundaries, include backup/restore coverage, and support optional notification email without depending on SendGrid as storage or transport.
- **Stage 9 (deferred):** after separate authorization and Meta setup, an authorized business Facebook Page can feed eligible messages through a verified connection and a user can deliberately promote a potential order into the existing Stage 2 queue without personal-profile access or automatic Order creation.

After combined Stages 7-8 are merged, stop. Do not represent deferred Stage 9 as missing completion work.

## Final Handoff for Combined Stages 7-8

Return:

1. branch/worktree, base commit, and final commit;
2. concise architecture/reuse summary;
3. exact reused, adapted, created, and excluded components;
4. migrations and data-compatibility notes;
5. tenant, role, permission, privacy, and audit verification;
6. optional SendGrid notification behavior and configuration requirements without secrets;
7. backup/restore changes and relationship remapping behavior;
8. exact backend/frontend test, guard, migration, and production-build commands/results;
9. verified pre-existing failures, if any;
10. screenshots or short walkthrough only of Messages and Announcements;
11. remaining blockers inside combined Stages 7-8 only;
12. explicit confirmation Stage 9 was not started or scaffolded.
