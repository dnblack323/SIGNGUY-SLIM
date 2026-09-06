# Commercial Release D Operations Readiness

Commercial Release D is the bounded operations, support, and release-readiness
pass for SignGuy Slim. It does not add ordinary shop features, document design
polish, Price Lab shell work, Expenses, Sales Tax, Inventory, Stripe,
Webstores, onboarding redesign, or Version 2 Stage 9 Facebook/Meta work.

## Release D Finding Map

Release D addresses the following findings from
`docs/COMMERCIAL_RELEASE_READINESS_AUDIT.md`:

| Finding | Scope in Release D | Implementation type |
| --- | --- | --- |
| CRR-010 Email deliverability and retry operations | Make delivery failures easier to identify, document safe manual resend, and expose bounded operator diagnostics without creating an automatic retry queue. | Code plus runbook |
| CRR-011 Operational monitoring and error diagnostics | Add liveness/readiness endpoints, request correlation IDs, safe structured logs, and operator diagnostics. | Code plus tests |
| CRR-012 CI/release gate adequacy | Add dependency audit gates and a deterministic operations smoke gate to CI. | CI plus script |
| CRR-014 Legal/business launch operations | Create a business checklist that separates owner/legal duties from code-complete repository work. | Documentation |
| CRR-015 Support and recovery tooling | Turn Release B account recovery primitives and Release A backup primitives into an operator support runbook and diagnostics workflow. | Documentation plus diagnostics CLI |
| CRR-016 Empty/error state and release usability verification | Create a practical commercial release checklist and smoke matrix. | Documentation |
| CRR-017 Documentation staleness | Refresh status language for Releases A-C complete, Release D current, Release E next, and Stage 9 deferred. | Documentation |
| CRR-020 Browser/device support statement | Document the realistic initial browser/device support boundary and keep real-device camera/photo smoke as deployment validation. | Documentation |

## What Is Code

Release D may add only operational code:

- `GET /api/health` for cheap unauthenticated process liveness.
- `GET /api/ready` for bounded readiness checks.
- request IDs on every HTTP response.
- safe JSON-line request and error logging.
- a non-mutating operator diagnostics command.
- deterministic operations smoke tests and CI gates.
- bounded email-delivery visibility using existing communication tables.

No migration is expected because delivery records, audit rows, rate limits,
password recovery, durable storage, and backup state already exist in the
current schema.

## What Is Operator Procedure

The host/operator remains responsible for:

- external uptime monitoring against `/api/health` and `/api/ready`;
- log collection, retention, search, and alerting;
- TLS certificate and domain monitoring;
- CPU, memory, disk, and volume monitoring;
- off-host backup replication;
- periodic restore drills;
- SendGrid account health, verified sender/domain configuration, and bounce
  review;
- customer-support identity verification before issuing reset links or restore
  assistance.

Slim provides safe hooks and diagnostics for those procedures. It does not
include a hosted monitoring vendor, ticketing system, legal approval workflow,
or managed infrastructure backup service.

## What Remains Release E

Release E owns customer-facing document polish:

- Quote PDF presentation;
- Invoice PDF presentation;
- customer-facing document template content;
- document branding and visual standards;
- any Price Lab convergence work for quote/invoice presentation.

Release D must not redesign Quote or Invoice documents.

## External Legal And Business Responsibility

Commercial launch still requires human owner/legal review for:

- Terms of Service;
- Privacy Policy;
- data retention and deletion policy;
- acceptable use;
- customer data export explanation;
- support contact expectations;
- incident contact process;
- payroll, sales tax, and backup disclaimers.

Repository documentation can list these requirements, but Markdown text is not
legal approval.

## Monitoring And Logging Privacy Rules

Operational logs must prefer request IDs, entity IDs, event names, status
codes, and bounded error codes. They must not include:

- passwords;
- password reset tokens;
- signup invitation tokens;
- session tokens;
- CSRF tokens;
- cookies;
- Authorization headers;
- backup passphrases;
- SendGrid API keys;
- webhook secrets;
- customer artwork or attachment bytes;
- private message bodies.

Emails, customer names, addresses, notes, message bodies, and attachment names
are PII or customer content. Use them only where a domain audit record already
requires them; structured operational logs should avoid them.

## Support Boundaries

Normal shop owners/admins can manage users, invitations, password reset links,
customer records, backup export/restore, and email settings in the app according
to their capabilities.

The deployment operator may use CLI diagnostics and runbooks to help with:

- initial tenant bootstrap;
- lost-owner recovery;
- suspected account compromise;
- SendGrid outage or rejection triage;
- storage quota incidents;
- failed portable restore;
- failed hosted restore;
- server backup verification and restore drills.

The operator should not collect customer attachment contents, passwords, reset
tokens, session cookies, CSRF tokens, or backup passphrases as part of ordinary
support.

## Initial Hosted Topology Assumptions

The first controlled commercial topology remains:

- one backend process;
- one file-backed SQLite database on explicitly provisioned durable storage;
- WAL and production synchronous durability enabled by the database layer;
- one durable private attachment root;
- one durable private server-backup root separate from the database and
  attachments;
- HTTPS termination before the browser;
- `SIGNGUY_SLIM_TRUST_PROXY=1` only when the app is actually behind a trusted
  HTTPS-terminating proxy;
- explicit allowed origins for split-origin hosting;
- SendGrid configured only with server-side environment variables;
- customer portable backups kept separate from hosted server backups.

Release D improves supportability for that topology. It does not make
multi-process SQLite writes, ephemeral storage, public unaudited signup, or
unmonitored production hosting acceptable.

## Completion Criteria

Release D is complete when:

- health and readiness endpoints expose safe bounded state;
- request IDs are returned and logged;
- unexpected errors include request/error correlation without leaking stack
  traces to clients;
- operator diagnostics run without exposing secrets;
- CI includes dependency-audit and operations-smoke gates;
- support, incident, release, smoke, browser/device, and legal/business
  checklists are documented;
- the commercial readiness audit records Release D outcomes while preserving
  overall `NOT READY` until Release E and the final re-audit pass.

## Implemented Contract

This branch implements the Release D code contract without a database
migration:

- `GET /api/health` returns safe liveness metadata: `status`, service name,
  package version, and configured release SHA.
- `GET /api/ready` returns safe readiness metadata for database reachability,
  migration state, production configuration, and incomplete restore-marker
  state.
- every HTTP response includes `X-Request-Id`;
- safe caller request IDs are accepted only when short and injection-safe;
  malformed or oversized values are replaced server-side;
- structured JSON-line logs record request completion and HTTP errors with
  request IDs, safe path names without query strings, status, duration, and
  authenticated tenant/user IDs where available;
- unexpected errors include an internal `error_id` and server-side stack log,
  while client responses remain safe JSON;
- `npm run backend:diagnostics` produces a non-mutating operator snapshot with
  path fingerprints, migration status, restore-marker status, backup metadata
  summary, attachment byte counts, email delivery-state counts, tenant count,
  and active-user count;
- `npm run backend:operations-smoke` provides the deterministic CI smoke gate
  for health, readiness, request IDs, and log redaction;
- Slim CI now runs operations smoke plus full and production-only dependency
  audits.

Email resend remains a controlled manual workflow through the existing
Quote/Order/Invoice send actions with a fresh explicit user action. Existing
delivery rows and SendGrid event rows preserve prior provider evidence; Release
D does not add an automatic retry loop or background queue.
