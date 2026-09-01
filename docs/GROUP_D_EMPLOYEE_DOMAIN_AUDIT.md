# Group D Employee Domain Audit

Date: 2026-09-01

Scope: Hardening Group D only. This audit maps the current Employee, Time, Pay,
Announcements, Messages, and Employee Portal implementation before extraction
from the central backend and frontend monoliths. It does not authorize Group E,
Group F, or Stage 9 work.

## Source And Snapshot Ownership

### Employee Identity

Employee identity is the `employees` row linked to an authenticated same-tenant
`users` row. `users` remains the login/session identity. `employees` is the
staff/portal/pay identity.

Source rows:

- `users`: authentication identity, role, active state, email, display name.
- `employees`: staff identity, employee number, linked `user_id`, role label,
  portal access flag, pay-management flag, active state, hire date, and notes.
- `employee_rates`: effective-dated hourly rate source rows created by a
  pay-authorized actor.

Derived values:

- session capabilities:
  - `can_manage_employees`;
  - `can_review_time`;
  - `can_manage_pay`;
  - `can_use_employee_portal`;
  - `can_manage_announcements`.
- current employee rate shown with Employee administration when the actor may
  view pay.

Protection rules:

- Employee rows must link to a same-tenant User.
- Only one active Employee row may link to a User per tenant.
- Owner/admin can create and update Employee management records.
- Only an owner can grant pay-management permission.
- Employee Portal access requires an active User linked to an active Employee
  with `portal_access_enabled = 1`.
- Deactivation prevents new portal/time actions but preserves history.

Current backend locations before Group D:

- `backend/src/services.js`: `nextEmployeeNumber`, `currentRateRow`,
  `employeeRecord`, `activeEmployeeForActor`, `employeePortalRecordForActor`,
  `activeEmployeeForUser`, `canManagePay`, `requirePayManagement`,
  `capabilitiesForActor`, `listEmployees`, `listPayrollEmployees`,
  `createEmployee`, `updateEmployee`, `addEmployeeRate`, `employeeRates`.
- `backend/src/server.js`: stable `/api/employees`, `/api/payroll`, and
  `/api/employee-portal` routes delegate to `SlimService`.

Current frontend locations before Group D:

- `src/App.jsx`: `EmployeesPage`, Employee Portal routing, capability-gated
  rendering through app route selection.
- `src/navigation.js`: capability-gated module definitions.

Backup sections:

- `employees`
- `employee_rates`
- `tenant_sequences`

## Time

Time Entry rows are authoritative worked-time source records.

Source rows:

- `employee_time_entries`: clock-in/out timestamps, duration, rate snapshot,
  status, implausible flag, correction metadata, void metadata, before/after
  snapshots, created actor, and timestamps.

Derived values:

- current open-entry state;
- displayed local clock-in/out text;
- current-week total minutes/hours;
- pay-week allocation by actual interval overlap.

Mutable records:

- Open entries may be clocked out.
- Manager corrections rewrite time-entry values with reason and before/after
  audit metadata.
- Voids change status to `void` with explicit reason and actor.

Protection rules:

- Employee self-service punch timestamps use server-authoritative time.
- Manager-created/corrected entries may use supplied historical timestamps.
- Only one open time entry is allowed per Employee.
- Voided entries cannot be corrected or resurrected into worked time.
- Overlapping non-void entries are rejected.
- Shifts over the implausible threshold are flagged instead of discarded.
- Time changes are blocked for closed pay weeks unless reopened.
- Cross-week time is allocated by overlap with the pay-week interval, not only
  by the clock-in date.

Current backend locations before Group D:

- `backend/src/services.js`: `rateForInstant`, `requireOpenPayWeeksForInterval`,
  `requireNoOpenTimeEntryInPayWeek`, `currentTimeClock`,
  `timeClockForEmployee`, `clockIn`, `clockOut`, `listTimeEntries`,
  `addTimeEntry`, `updateTimeEntry`, `voidTimeEntry`.

Current frontend locations before Group D:

- `src/App.jsx`: `TimeAttendancePage`, Employee Portal Time Clock branch.

Backup sections:

- `employee_time_entries`

## Pay

Pay Week open summaries are derived/recalculable. Closed Pay Week rows are
authoritative historical snapshots until explicitly reopened.

Source rows:

- `employee_time_entries`: closed non-void worked-time source.
- `employee_rates`: effective-dated rate source rows.
- `employee_pay_advances`: advance ledger source rows.
- `employee_pay_adjustments`: positive/negative adjustment source rows.
- `employee_pay_manual_payments`: manual payment source rows.

Derived while open:

- valid minutes;
- gross pay;
- rate breakdown;
- advance total;
- positive and negative adjustment totals;
- manual payment total;
- estimated amount due;
- opening carryover propagation into following open weeks.

Snapshot when closed:

- valid minutes;
- gross pay;
- ledger totals;
- rate breakdown JSON;
- opening and closing carryover;
- final estimated amount due;
- close actor and timestamp;
- calculation snapshot JSON.

Protection rules:

- Pay weeks are Saturday-Friday with Friday payday.
- Closing a week requires no open Time Entry in that week.
- Closing an earlier week is blocked when a later week is already closed.
- Reopening follows the same downstream-closed-week guard.
- Closed weeks do not silently recalculate when underlying time/rate/ledger
  source rows change.
- Reopen is the explicit transition back to recalculation.
- Advances, adjustments, and manual payments remain separate ledger records and
  are voided rather than deleted.
- Pay management requires owner role or explicit active Employee
  `pay_management_enabled` permission.

Current backend locations before Group D:

- `backend/src/services.js`: `ensurePayWeek`, `payWeekCalculation`,
  `refreshOpenPayWeek`, `requireOpenPayWeek`, `updateOpenCarryoverChain`,
  `propagateFollowingOpenWeeks`, `paySummary`, `myPaySummary`, `listPayWeeks`,
  `payWeekDetail`, `recordPayAdvance`, `recordPayAdjustment`,
  `recordManualPayment`, `voidPayLedger`, `closePayWeek`, `reopenPayWeek`.

Current frontend locations before Group D:

- `src/App.jsx`: `PayrollPage`, Employee Portal My Pay branch.

Backup sections:

- `employee_pay_weeks`
- `employee_pay_advances`
- `employee_pay_adjustments`
- `employee_pay_manual_payments`

## Announcements

Announcement management records are mutable until archived under the existing
rules. Read state is separate per Employee.

Source rows:

- `employee_announcements`: author, title, body, publish time, optional
  expiration, audience role, archive metadata.
- `employee_announcement_reads`: per Employee/User read state.

Derived values:

- management display status: scheduled, active, expired, archived.
- portal visibility: published, unexpired, unarchived, audience-matching
  announcements for the active Employee.
- unread flag from absence of a read row.

Protection rules:

- Owner/admin manage announcements.
- Archived announcements cannot be edited.
- `expires_at` must be after `publish_at`.
- Portal read state belongs to the authenticated active Employee.
- Announcement read state does not mutate the announcement source record.

Current backend locations before Group D:

- `backend/src/services.js`: `normalizeAnnouncementInput`,
  `announcementRow`, `announcement`, `listAnnouncements`,
  `createAnnouncement`, `updateAnnouncement`, `archiveAnnouncement`,
  `visibleAnnouncementRows`, `portalAnnouncements`, `portalAnnouncement`.

Current frontend locations before Group D:

- `src/App.jsx`: `AnnouncementManagementPage`, `PortalAnnouncementsPage`.

Backup sections:

- `employee_announcements`
- `employee_announcement_reads`

## Direct Messages

Direct messages are immutable sent history. Recipient read state may change.

Source rows:

- `employee_direct_messages`: sender User, recipient User, body, sent time,
  recipient read timestamp, created timestamp.

Derived values:

- conversation list by other participant;
- unread count for messages where the authenticated user is recipient and
  `recipient_read_at` is null;
- message direction relative to the authenticated user.

Protection rules:

- One-to-one only.
- Sender identity comes from authenticated actor.
- Sender spoofing is rejected.
- Sender and recipient must differ.
- New sends require an active same-tenant portal-enabled recipient.
- Historical conversation viewing remains available after participant
  deactivation.
- Only the recipient read timestamp changes; message body remains immutable.
- Internal Employee Messages stay separate from Customer communication history,
  SendGrid customer email, and Incoming Requests.

Current backend locations before Group D:

- `backend/src/services.js`: `messageParticipants`, `sendDirectMessage`,
  `messageById`, `listMessageConversations`, `historicalMessageParticipant`,
  `messageConversation`.

Current frontend locations before Group D:

- `src/App.jsx`: `PortalMessagesPage`.

Backup sections:

- `employee_direct_messages`

## Employee Portal

The Employee Portal reuses the existing authenticated User session and
same-tenant Employee record. It is not a second identity or owner/admin app.

Portal routes:

- `#/employee-portal/time-clock`
- `#/employee-portal/my-pay`
- `#/employee-portal/messages`
- `#/employee-portal/announcements`

Backend API routes:

- `GET /api/employee-portal/time-clock`
- `POST /api/employee-portal/clock-in`
- `POST /api/employee-portal/clock-out`
- `GET /api/employee-portal/my-pay`
- `GET /api/employee-portal/announcements`
- `GET /api/employee-portal/announcements/:id`
- `GET /api/employee-portal/message-participants`
- `GET /api/employee-portal/messages`
- `POST /api/employee-portal/messages`
- `GET /api/employee-portal/messages/:userId`

Permission checks:

- Time Clock, My Pay, Messages, and portal Announcements require
  `activeEmployeeForActor`.
- My Pay always resolves to the actor's own Employee.
- Message read state updates only messages addressed to the actor.
- Announcement read state updates only the actor's Employee read row.

## Backup And Restore

Group D does not require a schema migration. The portable backup contract must
remain stable.

Current backup coverage includes:

- Employee identity and rates;
- Time Entry source rows;
- Pay Week open/closed rows and snapshots;
- pay ledger rows;
- announcement records and read state;
- direct messages and recipient read timestamps.

Restore validation must preserve:

- user remapping for Employee rows;
- Employee remapping for time/pay/announcement reads;
- source and snapshot pay values;
- message sender/recipient mapping;
- announcement read ownership;
- older supported schema compatibility.

## Extraction Boundary

Group D may extract:

- Employee capabilities;
- Employee administration and rates;
- Time Clock and Time & Attendance;
- Pay Week and ledger behavior;
- Announcement management and portal reads;
- one-to-one Employee Messages;
- Employee Portal frontend pages.

Group D must not extract unrelated customer communication, Incoming Requests,
Orders, Production, Calendar, auth transport, or Stage 9 Meta/Facebook code.
