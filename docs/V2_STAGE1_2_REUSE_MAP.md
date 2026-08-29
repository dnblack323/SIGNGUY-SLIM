# Version 2 Stages 1-2 Reuse Map

Base commit: `9b392210e10a7defdd9db6af69d6bf0d19d8c1a3`

Branch: `codex/v2-stages-1-2`

## Scope

Stages 1 and 2 add SendGrid-backed customer email, customer communication
history, and focused Email Order Intake. They do not add Time Clock, Employee
Portal, pay tracking, Facebook, camera capture, photo annotation, Gmail or
Outlook synchronization, SMS, payment processing, pricing-engine imports, or
automatic confirmed Order creation.

## Reused Components

| Area | Reuse decision | Evidence |
| --- | --- | --- |
| Tenant, auth, roles, and sessions | Reused as-is | `SlimService.requireRole`, authenticated HTTP routes, and tenant-scoped IDs remain the enforcement layer. |
| Audit events | Reused with new actions | Email sends, delivery events, manual notes, intake receipt, assignment/linking/conversion, and address rotation write append-only audit events. |
| Estimate, Order, and Invoice services | Reused directly | Email sends resolve same-tenant records before dispatch; Estimate `draft` can become `sent`; Invoice `draft` can become `issued`; payment and production states remain unchanged. |
| Document PDFs | Reused for customer email | Estimate and Invoice emails attach the existing server-generated PDF. |
| Order attachments | Reused for Intake carry-forward | Accepted inbound attachment bytes are copied into `order_attachments` only when a user deliberately converts or links an Intake Item. |
| Settings page and Orders child navigation | Adapted | Settings exposes sender metadata and the private intake address; Order Intake is a child route below Orders. |

## Created Components

- Migration `010_v2_stage1_2_communications_intake.sql`.
- Tenant email settings, outbound email send log, SendGrid event log, and
  customer communication timeline tables.
- Tenant private intake address table with rotation support.
- Inbound source message, Intake Item, and intake attachment tables.
- Protected service methods for sender settings, outbound sends, manual notes,
  communication timeline reads, intake review updates, Customer creation from
  Intake, Draft Order conversion, and existing Order linking.
- Public webhook endpoints:
  - `POST /api/webhooks/sendgrid/events`
  - `POST /api/webhooks/order-intake/email`
- UI surfaces for customer email compose, communication timelines, Order
  Intake queue/review, and Stage 1/2 settings.

## Provider Configuration

Required environment variables:

- `SIGNGUY_SLIM_SENDGRID_API_KEY`: SendGrid API key used only server-side.
- `SIGNGUY_SLIM_SENDGRID_WEBHOOK_SECRET`: shared HMAC secret for SendGrid event
  webhook verification. Required when `NODE_ENV=production`.
- `SIGNGUY_SLIM_INTAKE_WEBHOOK_SECRET`: shared HMAC secret for inbound email
  webhook verification. Required when `NODE_ENV=production`.
- `SIGNGUY_SLIM_INTAKE_DOMAIN`: optional domain used when generating tenant
  intake addresses.

Webhook signatures use the `X-SignGuy-Signature` header as either a raw hex
HMAC-SHA256 digest or `sha256=<digest>` over the parsed JSON body.

## Data Compatibility

The migration is additive. Existing Version 1 records remain unchanged. Existing
tenants receive an intake address lazily when Settings or Intake is opened; new
tenants receive one at registration. Provider payloads and secrets are not
stored in full, and private intake addresses are never written to logs by the
application.

## Validation

- `npm run test`: 128 tests passed.
- `npm run guard`: passed.
- `npm run build`: passed.
- `npm ci`: blocked by Windows `EPERM` while unlinking a locked Rolldown native
  binding in `node_modules`; `npm install` restored dependencies and reported
  zero vulnerabilities.
