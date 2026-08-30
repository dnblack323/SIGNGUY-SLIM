# Codex Master Build Prompt — SignGuy Slim Operations App, Version 2

> **Authoritative Version 2 roadmap status (updated 2026-08-30):** Stages 1-6 are implemented and merged. Stages 7 and 8 are intentionally authorized as one combined delivery stage because both extend the existing Employee Portal communication surface and share tenant/user/unread/notification concerns. Stage 9 (Facebook Page Order Intake) is intentionally deferred until later because it requires Meta business app/Page configuration, permissions, webhook setup, and potentially app review. Do not begin Stage 9 unless the user separately authorizes it after the required Meta setup is available.

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

Treat this file as the authoritative Version 2 master scope. Version 1 remains usable throughout. Each authorized stage is an independently usable upgrade with focused readiness review, migrations, security checks, tests, production build, branch, pull request, and handoff. Stages 1-6 are implemented and merged. The next authorized delivery intentionally combines Stages 7 and 8. Stage 9 is deferred.

### Stage 1 — SendGrid and Customer Communication History — IMPLEMENTED

- Secure outbound customer email to Estimates, Orders, and Invoices.
- Order Workspace communication composer and communication timeline.
- SendGrid event processing, delivery history, idempotency, and failure handling.
- Manual communication notes for phone, walk-in, and externally received communication.

### Stage 2 — Email Order Intake — IMPLEMENTED

- `Order Intake` beneath Orders as a focused queue.
- Private tenant-specific inbound intake address receiving only deliberately forwarded order mail.
- No Gmail/Outlook mailbox synchronization.
- Customer matching/creation, assignment, follow-up, statuses, Draft Order conversion, and existing-Order linking.
- Original Intake Item and source message preserved after conversion.

### Stage 3 — Camera Capture — IMPLEMENTED

- Device-camera capture in the Order Workspace attachment area.
- Immutable originals and normal file-upload fallback.

### Stage 4 — Photo Annotation — IMPLEMENTED

- Small useful photo-annotation workflow for existing Order images.
- Original remains immutable; annotated derivatives are separate linked attachments.

### Stage 5 — Employee Administration, Time Clock, and Time Clock Portal — IMPLEMENTED

- Employee records linked safely to authenticated users.
- Admin and employee Time Clock behavior and editable Time Entries.
- Restricted mobile-friendly Employee Portal Time Clock surface.

### Stage 6 — Weekly Pay Tracking and My Pay — IMPLEMENTED

- Weekly pay summaries, advances, adjustments, manual payments, and carryover.
- My Pay in the Employee Portal using Stage 5 Time Entries.
- Saturday-Friday work week and Friday payday baseline.

### Combined Stages 7-8 — Employee Announcements and Internal Employee Messages — AUTHORIZED NEXT

Stages 7 and 8 are intentionally delivered together in one bounded branch and pull request. They share the Employee Portal, authenticated tenant users, unread/read state, role visibility, notification preferences, audit patterns, and optional notification-email infrastructure, so splitting them would create needless duplicate plumbing.

#### Stage 7 capability — Employee Announcements

- Add company announcements and read/unread tracking to the Employee Portal.
- Add optional SendGrid notification emails when Stage 1 is configured without making SendGrid the announcement store.
- Require the existing Stage 5 employee/user portal identity model.

#### Stage 8 capability — Internal Employee Messages

- Add basic one-to-one internal direct messages and unread state.
- Add optional SendGrid notification emails when Stage 1 is configured without turning SendGrid into the internal message transport.
- Require the existing Stage 5 employee/user portal identity model.
- Do not add group chat, channels, attachments, reactions, presence, voice, video, typing indicators, or social-feed behavior.

#### Combined-stage rule

- Complete backend models, migrations, APIs, tenant/permission rules, Employee Portal UI, owner/admin announcement controls, direct-message UI, optional notification preferences, audit, backup/restore coverage, tests, documentation, and validation for both capabilities before the combined stage is complete.
- Reuse the existing employee/user identity and Employee Portal. Do not create a second staff portal, separate messaging identity, duplicate notification store, or parallel communication framework.
- Keep customer communication history separate from employee internal messaging. They may reuse infrastructure patterns, but customer communications and internal employee messages remain different domains.
- Stop after combined Stages 7-8 are merged. Stage 9 remains deferred and must not be scaffolded, advertised, or exposed as a coming-soon UI.

### Stage 9 — Facebook Page Order Intake — DEFERRED

- Do not implement during combined Stages 7-8.
- Begin only after separate user authorization and the required Meta business/Page setup is available.
- Connect an authorized business Facebook Page through the supported Meta business messaging APIs and verified webhooks.
- Receive eligible Page messages into the communication surface and provide `Send to Order Intake` so a user deliberately promotes a potential order into the same Stage 2 queue.
- Preserve Page conversation identifiers, sender identity available through the authorized API, timestamps, message text, and supported attachments.
- Reuse the same matching, assignment, follow-up, Draft Order conversion, existing-Order linking, deduplication, audit, and status rules as email Intake Items.
- Do not automatically turn every Page inquiry into an Order Intake Item or Order.
- Respect Meta permissions, app-review requirements, messaging windows, webhook verification, retention rules, and current platform policies.
- Support Facebook business Pages only. Do not access personal-profile Messenger inboxes.
- Do not add Instagram, WhatsApp, SMS, marketing automation, or a general social-media CRM.

## Locked Terminology and Existing Contracts

Continue using the established canonical terms:

- Customer
- Estimate in the Slim UI, while retaining canonical Quote internals when already established
- Order
- Order Item
- Work Order and Work Order Summary only where required by the production contract
- Invoice
- Employee
- Time Entry
- Pay Week
- Advance
- Adjustment
- Manual Payment
- Carryover
- Message
- Announcement
- Communication Activity
- Attachment
- Order Intake Item
- Intake Source Message

Never introduce `Job`, `Job Item`, `Job Ticket`, or `Production Ticket` as new domain objects or replacements for the canonical Order workflow.

Preserve these contracts:

- Estimate/Quote → Order conversion remains idempotent and audited.
- An Order contains Order Items.
- Production-required Order Items flow through the existing Work Order/production contract.
- Order Item completion remains separate from calendar-event completion.
- One Invoice per Order remains enforced.
- Invoice document status and payment status remain separate.
- Version 2 additions must not change authoritative price, tax, production, scheduling, or document calculations.

## Navigation and Ribbon

Keep the current Slim navigation architecture and compact Office-style ribbon. The Employee Portal remains a restricted portal surface, not a duplicate owner/admin navigation system. `Order Intake` remains beneath Orders.

For combined Stages 7-8:

- expose Messages and Announcements inside the existing Employee Portal;
- place owner/admin announcement management under the existing Team area or the smallest appropriate Team subview;
- add `New Announcement` only where useful to authorized users;
- do not add every Stage 7-8 action to the global ribbon;
- do not create a new top-level Communications area;
- do not expose Stage 9 Facebook settings, routes, navigation, placeholders, or teaser UI.

## Employee Portal after Combined Stages 7-8

Portal navigation contains only the installed usable surfaces:

1. Time Clock
2. My Pay
3. Messages
4. Announcements

### Time Clock

Preserve the completed Stage 5 behavior, including server-authoritative employee punch timestamps, current clock state, current open entry, current Saturday-Friday week entries, weekly hours, and appropriate missing/open-entry warnings.

### My Pay

Preserve completed Stage 6 behavior, including current/prior authorized pay weeks, valid hours, rate snapshot, gross estimate, opening carryover, advances, adjustments, manual payments, estimated amount due/closing carryover, and open-versus-closed distinction. Employees see only their own pay data.

## Internal Messages

Build basic in-app direct messaging. SendGrid is not the message transport.

- one-to-one messages between active authorized same-tenant users;
- simple conversation threads;
- unread count and read timestamp;
- sender, recipient, sent time, and message body;
- recent conversation list/basic search only if it does not expand scope materially;
- tenant isolation and active-user validation;
- no editing after send;
- authorized moderation/deletion only with audit evidence;
- no file attachments, reactions, channels, group chat, voice, video, typing indicators, presence, or analytics-heavy read receipts.

Optional SendGrid notification email may tell an Employee a new in-app message exists, respecting notification preferences. Notification email must not include sensitive pay details and is not the message transport.

## Announcements

Authorized owner/admin users can:

- create an announcement;
- add title and plain-text or safely sanitized rich-text body;
- set publish/start date and optional expiration date;
- target all active Employees or a supported simple role group;
- edit or archive with audit history.

Employees can:

- view current announcements they are permitted to see;
- see published date and author;
- mark/read automatically when opened;
- distinguish unread from read.

Do not add surveys, polls, social feeds, public comments, likes, or complex campaign scheduling.

Optional SendGrid notification email may announce a new announcement, respecting notification preferences. SendGrid must not become the announcement database.

## Backup and Restore for Combined Stages 7-8

Extend the existing encrypted backup/restore contract to include applicable:

- announcements;
- announcement target metadata;
- announcement read state;
- direct messages/conversation relationships;
- message read/unread state;
- employee notification preferences added by this stage.

Restore must preserve tenant isolation and safely remap user/employee relationships using the existing restore model. Do not restore/create login credentials from backup data. Do not export/restore SendGrid secrets or other provider credentials.

## Security, Privacy, Audit, and Data Requirements

- Enforce tenant isolation in every query and mutation involving messages, announcements, read state, employee/user relationships, or notification preferences.
- Enforce permissions on the backend; hidden frontend controls are not security.
- Validate related users/employees belong to the same tenant and are active where required.
- Employees access only their own Time Clock and My Pay data.
- Customer communication history must remain separate from internal employee messaging.
- Audit announcement create/edit/archive and authorized moderation/deletion.
- Ordinary direct messages are immutable after send.
- Notification email must not expose employee pay data or unrelated sensitive content.
- Use additive, reversible migrations with safe defaults and relationship-hardening tests.
- Preserve loading, empty, error, retry, validation, permission-denied, and partial notification-failure states.
- Preserve keyboard accessibility, focus management, readable contrast, touch targets, and mobile usability.

## Absolute Exclusions

Do not import, expose, recreate, stub, advertise, or add navigation for:

- Pricing Engine or pricing calculators;
- detailed order entry;
- materials, labor, overhead, markup, machine, square-foot, or cost formulas;
- AI tools, assistants, recommendations, image generation, or AI credits;
- Webstores or online catalog;
- Stripe or any payment processor;
- expenses, bookkeeping, accounting, tax reporting, business analytics, or reports;
- formal payroll processing, payroll-provider integration, payroll taxes, withholding, overtime rules, direct deposit, benefits, or tax forms;
- Asset/Document Library or DocuLink;
- Wrap Lab;
- Design Studio;
- Customer Portal or Decision Room;
- production time tracking, station checkout, machine time, or capacity planning;
- inventory, purchasing, suppliers, or automatic ordering;
- SMS/MMS or Twilio;
- Gmail/Outlook mailbox synchronization or full-mailbox OAuth;
- personal Facebook profile or personal Messenger inbox access;
- automatic conversion of email or Facebook messages into confirmed Orders;
- Instagram, WhatsApp, or a general social-media CRM;
- marketing campaigns or bulk email;
- group chat, channels, file attachments in messages, reactions, voice, video, typing indicators, or presence;
- advanced workflow builder;
- advanced image editor;
- disabled `coming soon` placeholders for excluded or deferred features.

## Required Tests for Combined Stages 7-8

At minimum add/update focused tests for:

### Portal, Messages, and Announcements

- portal access for active/inactive Employees;
- tenant and recipient isolation for direct messages;
- sender/recipient active-user validation;
- unread/read behavior;
- no direct-message editing after send;
- authorized moderation/deletion audit behavior;
- announcement publish/start/expiration and target rules;
- per-Employee announcement read state;
- owner/admin announcement-management permission boundaries;
- employee/staff visibility boundaries;
- optional notification email failure does not lose the underlying in-app record;
- optional notification email does not expose pay details;
- no customer communication is mixed into internal employee message conversations;
- Stage 9 Facebook routes/models/navigation remain absent.

### Backup/Restore

- Stage 7-8 records export, validate, and restore;
- restore remaps user/employee relationships tenant-safely;
- cross-tenant message/announcement relationships are rejected;
- read/unread state is preserved appropriately;
- no credentials or external notification secrets are exported/restored.

### Integration and Regression

- Version 1 and Stages 1-6 behavior/tests remain passing;
- Time Clock does not become production-time tracking;
- My Pay/pay-management boundaries remain unchanged;
- customer communication history remains separate from internal messages;
- Slim navigation/frontend bundle does not import excluded or Stage 9 modules;
- production frontend build passes.

Run the complete relevant backend tests, frontend tests, migration check, exclusion guard, and production build. Fix regressions introduced by combined Stages 7-8 and clearly separate verified pre-existing failures.

## Definition of Done

- **Stages 1-6:** implemented and merged.
- **Combined Stages 7-8:** authorized users can publish/manage announcements while Employees can read only permitted current announcements with correct read/unread state, and active authorized users can exchange basic tenant-isolated one-to-one messages with correct unread behavior and without excluded chat features. Both capabilities use the existing Employee Portal/identity model, preserve audit/tenant boundaries, include backup/restore coverage, and support optional notification email without depending on SendGrid as storage or internal message transport.
- **Stage 9 (deferred):** after separate authorization and Meta setup, an authorized business Facebook Page can feed eligible messages through a verified connection, a user can deliberately send a potential order into the existing Stage 2 queue, and no personal-profile inbox or automatic Order creation is present.

After combined Stages 7-8 are merged, stop. Do not represent deferred Stage 9 as missing completion work for Stages 7-8.

## Final Handoff for Combined Stages 7-8

Return:

1. branch/worktree, base commit, and final commit;
2. concise architecture and reuse summary;
3. exact reused, adapted, created, and excluded components;
4. migrations and data-compatibility notes;
5. tenant, role, permission, privacy, and audit verification;
6. optional SendGrid notification configuration requirements without secrets;
7. backup/restore changes and remapping behavior;
8. exact backend test, frontend test, guard, migration, and production-build commands/results;
9. verified pre-existing failures, if any;
10. screenshots or short walkthrough only of Messages and Announcements;
11. remaining blockers inside combined Stages 7-8 only;
12. explicit confirmation Stage 9 was not started or scaffolded.
