# Group F Auth Transport Audit

Hardening Group F addresses `SLIM-005`: browser session bearer token stored in
`localStorage`. This audit records the current authentication transport and the
target source-of-truth before implementation changes.

## Scope

Group F changes authentication transport only. It does not change tenant
identity, user roles, Employee Portal eligibility, Group B capability
calculation, password hashing semantics, product authorization rules, or any
Stage 9/Facebook/Meta work.

## Current Behavior

### Registration

- `POST /api/auth/register` is public and creates the tenant, owner user, and
  default intake address in `SlimService.registerTenant`.
- The new owner user is mapped to the existing user shape and passed to
  `SlimService.issueSession`.
- The response includes `access_token`, `token_type`, `user`, `tenant`, and
  `capabilities`.
- No CSRF token exists because the browser authenticates later mutations with a
  bearer token rather than a cookie.

### Login

- `POST /api/auth/login` is public and validates tenant slug, email, active user
  state, and bcrypt password hash in `SlimService.login`.
- The login error remains intentionally generic:
  `invalid_shop_email_or_password`.
- Successful login calls `SlimService.issueSession`.
- The response currently exposes the plaintext bearer token to frontend
  JavaScript as `access_token`.

### Session Creation

- Sessions are stored in the `sessions` table created by
  `backend/migrations/001_v1_part2_core.sql`.
- The table stores `id`, `tenant_id`, `user_id`, `token_hash`, `created_at`,
  `expires_at`, and `revoked_at`.
- `newSessionToken()` uses `crypto.randomBytes(32).toString("base64url")`.
- `hashToken()` stores a SHA-256 hash of the opaque token, not plaintext.
- `sessionExpiry()` sets a fixed 14-day absolute expiration.
- Multiple sessions per user are supported because each login creates a new row.

### Bearer Token Format

- The bearer credential is the opaque random token returned as `access_token`.
- It has no embedded user, tenant, role, or capability claims.
- The backend hashes the received token and matches it to an unrevoked,
  unexpired `sessions` row.

### Server Validation

- `backend/src/server.js` extracts `Authorization: Bearer <token>` with
  `tokenFrom(req)`.
- `SlimService.actorForToken(token)` joins `sessions` to `users`, checks
  `revoked_at IS NULL`, checks `expires_at > now()`, and rejects inactive users.
- The returned actor is the existing mapped user object. Tenant scoping and
  authorization remain in each service method through this actor.

### Frontend Storage And Header Injection

- `src/App.jsx` uses `SESSION_KEY = "signguySlimSession"`.
- `readStoredSession()` reads and parses the stored session from
  `localStorage`.
- `setSession(next)` persists the entire session JSON to `localStorage`,
  including the bearer credential.
- `src/api.js` attaches `Authorization: Bearer ${token}` when a token is
  supplied.
- Uploads, Blob previews, and downloads use the same bearer-header path.

### `/api/auth/me`

- `/api/auth/me` is a protected GET.
- It currently authenticates using the bearer header and returns `user`,
  `tenant`, and freshly calculated `capabilities`.
- Employee capability refresh uses this endpoint after current-user Employee
  changes.

### Logout

- `POST /api/auth/logout` is protected by the same bearer token.
- `SlimService.logout(token)` hashes the token and sets `revoked_at` on the
  matching session.
- The frontend also clears `localStorage`; without the backend call, the session
  would remain valid until expiry.

### Expiry, Revocation, And Inactive Users

- Sessions have a fixed 14-day absolute expiration.
- Logout revokes only the current token hash.
- Session validation checks current `users.active`, so disabling a user stops an
  existing token from authorizing protected routes.
- There is no refresh-token system and no single-session enforcement.

### Capability Refresh

- Capabilities are not stored in the session row.
- `sessionPayload(user)` calculates capabilities from current backend state on
  login/register and `/api/auth/me`.
- Employee Portal and payroll access changes rely on this recalculation.

## Target Behavior

### Authentication Cookie

- The server remains the session source of truth using the existing `sessions`
  table and hashed opaque token model.
- Successful login and registration create a fresh random session token and send
  it only in an HttpOnly cookie named `signguy_slim_session`.
- The session token is never included in JSON, never attached to the public
  session payload, and is not readable by frontend JavaScript.
- Browser API calls authenticate through that cookie with
  `credentials: "include"`.
- Browser bearer-token auth is removed; `Authorization: Bearer` is no longer the
  application authentication path.

### Cookie Options

- Cookie path is `/`.
- The cookie is `HttpOnly`.
- `SameSite=Lax` is used for the same-origin Slim app flow.
- `Secure` is enabled for production, explicit
  `SIGNGUY_SLIM_COOKIE_SECURE=1`, or direct HTTPS requests and remains disabled
  for local HTTP development.
- `X-Forwarded-Proto` is honored only when `SIGNGUY_SLIM_TRUST_PROXY=1` is set
  for a known TLS-terminating proxy path; untrusted forwarded headers cannot
  change cookie security behavior.
- Session cookies include an expiry and max-age tied to the server-side session
  expiration.
- User, tenant, role, and capability data are not embedded in any readable
  cookie.

### CSRF Token

- Cookie authentication introduces CSRF risk for unsafe methods.
- Each authenticated session gets a frontend-readable CSRF token derived from
  the server-side session record.
- The CSRF token is returned as `csrf_token` in the authenticated session
  payload after login, registration, and `/api/auth/me`.
- Frontend JavaScript stores this CSRF token only in in-memory session state.
- The frontend sends the token in `X-CSRF-Token` for unsafe authenticated
  requests.
- The backend validates the header against the authenticated session using
  timing-safe comparison.
- CSRF tokens rotate when the session rotates.

### CSRF Coverage

- CSRF is required for authenticated `POST`, `PUT`, `PATCH`, and `DELETE`
  requests.
- CSRF is not required for `GET`, `HEAD`, or `OPTIONS`.
- Initial `POST /api/auth/login` and `POST /api/auth/register` remain
  pre-session routes and do not require authenticated-session CSRF.
- Public webhook routes keep their existing provider signature protections and
  do not use browser session CSRF.
- Multipart attachment, annotation, backup preview, and backup restore routes
  are protected because CSRF validation happens before request-body parsing.
- A valid session with a missing or invalid CSRF token receives `403` with
  `csrf_invalid`.
- A missing/expired/revoked session remains `401 unauthorized`.

### `/api/auth/me` Bootstrap

- The frontend no longer bootstraps from `localStorage`.
- App startup calls `/api/auth/me` with `credentials: "include"`.
- On success, the app stores `user`, `tenant`, `capabilities`, and `csrf_token`
  in memory.
- On `401`, the app clears in-memory session state and renders login without
  exposing protected UI.

### Logout

- Logout revokes the server-side session and clears the session cookie.
- Logout is safe and idempotent when no current session is present.
- A valid authenticated logout request uses the same cookie transport and CSRF
  protection as other state-changing browser requests.

### Authorization And Capabilities

- Authentication proves the current session. Authorization remains backend
  authoritative.
- Existing role checks, capability checks, Employee Portal eligibility, payroll
  access, tenant boundaries, production state rules, payment safety, and backup
  restore permissions remain unchanged.
- `/api/auth/me` remains the authoritative capability refresh endpoint.

### CORS And Origins

- The Slim app is expected to run same-origin in production.
- No wildcard credentialed CORS policy is introduced.
- Local development keeps same-origin Vite proxy behavior.
- Reverse-proxy HTTPS detection is opt-in with `SIGNGUY_SLIM_TRUST_PROXY=1`.

### Backup Contract

- Active sessions, cookies, and CSRF tokens are authentication runtime state and
  are not portable tenant business data.
- Group F must not add sessions to backup export/import.

### Migration Decision

- No schema migration is expected because the existing `sessions` table already
  supports hashed opaque tokens, expiry, revocation, multiple sessions, and
  current-user validation.
- If implementation discovers an unavoidable schema gap, migration `015` is the
  next candidate and must be additive.

## Known Conflict In Current Model

The server-side token storage is acceptable, but transport is not: the browser
receives and persists the plaintext bearer token in readable storage. Any script
running in the page can read that credential and replay it through the
Authorization header until logout or expiration. Group F eliminates that
browser-readable credential while keeping the existing server session model.
