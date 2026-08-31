# Version 2 Stages 7-8 Reuse Map

Base commit: `81775d90feb6b9576004a985ec30f7d5b2fb73d7`

Branch: `codex/v2-stages-7-8-messages-announcements`

## Scope

Combined Stages 7-8 add Employee Announcements and basic one-to-one Internal
Employee Messages. They reuse the existing authenticated tenant user model,
Employee records, Employee Portal, audit pipeline, and encrypted backup/restore
flow.

Stage 9 Facebook Page Order Intake remains deferred. No Facebook, Meta,
Instagram, WhatsApp, social-feed, group-chat, attachment, reaction, voice, video,
customer-portal, AI, payroll-processing, accounting, Stripe, webstore, or
pricing-engine code is part of this delivery.

## Reused Components

| Area | Reuse decision | Evidence |
| --- | --- | --- |
| App shell | Reuse | Messages and Announcements are added to the existing Employee Portal module tabs. Announcement management is placed in the existing Team area. |
| Identity | Reuse | Internal messages and announcement read state use existing tenant users and Employee records. No second login identity or messenger profile is added. |
| Permissions | Reuse and narrow | Employee Portal access continues to require an active same-tenant Employee with portal access. Announcement management uses owner/admin checks. |
| Audit | Reuse | Announcement create, edit, and archive actions write through the existing authenticated audit pipeline. Ordinary direct messages remain immutable source records. |
| SendGrid boundary | Preserve | Stage 1 SendGrid remains customer email and intake infrastructure. It is not used as the internal message or announcement transport in this branch. |
| Backup/restore | Adapted | The encrypted backup format includes announcements, announcement read state, direct messages, and message read timestamps with safe user/employee remapping. |

## Additive Schema Plan

Migration `013_v2_stage7_8_messages_announcements.sql` adds:

- `employee_announcements`: tenant-scoped author, title, body, start/publish
  timestamp, optional expiration, audience rule, archive state, portable ID, and
  audit-friendly timestamps.
- `employee_announcement_reads`: tenant-scoped per-Employee read state with a
  unique announcement/employee row.
- `employee_direct_messages`: tenant-scoped immutable one-to-one messages with
  sender, recipient, body, sent timestamp, and recipient read timestamp.

## Permissions And Privacy

Backend checks enforce same-tenant active users and Employee records.
Employees cannot spoof sender identity, read another tenant's messages, mark
another user's read state, or see announcements outside their active audience.
Frontend hiding is only a usability layer.

## SendGrid Boundary

This branch does not add SendGrid notification email for Messages or
Announcements. In-app records are the authoritative source, and customer email
history remains separate from internal employee communication.

## Backup/Restore Plan

Backup export includes the new Stage 7-8 records in dependency order.
Restore validates tenant ownership and remaps user/employee relationships
using the existing safe user/employee mapping pattern. Provider credentials and
SendGrid secrets remain excluded.

## Validation Plan

Final validation will run:

```powershell
npm ci
npm run test
npm run guard
npm run build
SIGNGUY_SLIM_DB_PATH=:memory: npm run backend:migrate
git diff --check
```
